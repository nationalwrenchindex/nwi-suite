// POST /api/hd/invoices/[id]/send
// Delivers an HD invoice to the customer over SMS (or email, once configured)
// and records the send on the row.
//
// DELIVERY FAILURE IS NOT A REQUEST FAILURE. Mirrors the LD route at
// src/app/api/invoices/[id]/send/route.ts: a bad phone number, a Twilio outage,
// or a carrier rejection returns 200 with { sent: false, error } so the UI can
// show the tech what went wrong and hand them the link to send by hand. Throwing
// here would lose the minted token and leave the tech with nothing.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendSmsResult } from '@/lib/twilio'
import { getContactSuppression } from '@/lib/customer-contact'
import { mintInvoiceToken, publicInvoiceUrl } from '@/lib/hd/invoice-token'
import { buildInvoiceSms, buildInvoiceEmail } from '@/lib/hd/sms-templates'
import { buildPMReportAttachment } from '@/lib/hd/pm-report-attachment'

export const dynamic = 'force-dynamic'

// Same sender as the LD invoice route: nationalwrenchindex.com is a verified
// Resend domain, so the mail is SPF/DKIM-signed and does not land in spam.
const INVOICE_FROM = process.env.INVOICE_FROM_EMAIL ?? 'invoices@nationalwrenchindex.com'

interface SendBody {
  method: 'sms' | 'email'
  phone?: string
  email?: string
}

interface EmailAttachment {
  filename: string
  /** base64, which is the only encoding Resend accepts for inline content. */
  content: string
}

/**
 * The PM report, rendered for the email as an attached file.
 *
 * BEST-EFFORT BY CONTRACT. Returns null on anything that goes wrong, and the
 * caller sends the invoice without it. A customer who receives their bill
 * without the inspection sheet can ask for the sheet; a customer who receives
 * nothing because the sheet failed to render has not been billed at all, and
 * the tech has no idea. So the report never gets a vote on whether the invoice
 * goes out.
 *
 * The file is .html, not .pdf. This codebase has no PDF library — every "PDF"
 * route (/api/hd/invoices/[id]/pdf, the DOT route) serves self-contained
 * text/html with a print button, and the attachment matches that convention so
 * the customer can open it in any browser and print to PDF themselves.
 */
async function buildAttachment(
  svc:       ReturnType<typeof createServiceClient> | null,
  userId:    string,
  invoiceId: string,
): Promise<EmailAttachment | null> {
  if (!svc) return null
  try {
    const report = await buildPMReportAttachment(svc, userId, invoiceId)
    if (!report) return null
    return {
      filename: report.filename,
      content:  Buffer.from(report.html, 'utf8').toString('base64'),
    }
  } catch (err) {
    console.error(
      '[hd-invoice-send] PM report attachment failed, sending invoice without it:',
      err instanceof Error ? err.message : String(err),
    )
    return null
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: SendBody
  try {
    body = await req.json() as SendBody
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const method = body.method === 'email' ? 'email' : 'sms'

  // Ownership is the security boundary: scoping the read by user_id means
  // another subscriber's invoice is indistinguishable from a missing one.
  const { data: invoice, error: fetchErr } = await supabase
    .from('hd_invoices')
    .select('id, invoice_number, status, total, customer_phone, customer_email, sent_at, sent_count, last_sent_at, customer_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  // White-label identity. Everything the customer reads comes from here, never
  // from NWI — see the branding rule in src/lib/hd/sms-templates.ts.
  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, phone, email')
    .eq('id', user.id)
    .maybeSingle()

  // An attached inspection is worth a sentence in the text, so the customer
  // knows the invoice is not the whole story. Head-only counts — we need the
  // existence, not the rows.
  const [pm, dot, aerial] = await Promise.all([
    supabase.from('hd_pm_checklists').select('id', { count: 'exact', head: true }).eq('invoice_id', id).eq('user_id', user.id),
    supabase.from('hd_dot_inspections').select('id', { count: 'exact', head: true }).eq('invoice_id', id).eq('user_id', user.id),
    supabase.from('hd_aerial_inspections').select('id', { count: 'exact', head: true }).eq('invoice_id', id).eq('user_id', user.id),
  ])
  const hasReports = Boolean((pm.count ?? 0) + (dot.count ?? 0) + (aerial.count ?? 0))

  // Mint before sending. The token is idempotent and belongs to the invoice, not
  // to this attempt — a failed text must still leave the tech a working link.
  let publicUrl: string
  // Held past the try so the attachment builder can reuse the same service
  // client instead of opening a second one. Null only if the mint threw, which
  // returns below before anything reads it.
  let svc: ReturnType<typeof createServiceClient> | null = null
  try {
    svc         = createServiceClient()
    const token = await mintInvoiceToken(svc, id, user.id)
    publicUrl   = publicInvoiceUrl(token)
  } catch (err) {
    console.error('[hd-invoice-send] token mint failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Could not create a payment link for this invoice.' }, { status: 500 })
  }

  // Records a successful delivery on the row, for either channel.
  //
  // THREE TIMESTAMPS THAT ARE NOT THE SAME THING:
  //   sent_at      — FIRST delivery only, never overwritten (`?? now()` below).
  //                  Invoice aging and the late-fee cron count days from it, so
  //                  a courtesy re-send must not restart that clock on a bill
  //                  that is already 45 days old.
  //   last_sent_at — EVERY delivery. This is what the detail page shows the tech
  //                  so they can tell "texted an hour ago" from "texted in July".
  //   updated_at   — ordinary row bookkeeping.
  //
  // sent_count is a read-modify-write off the row fetched at the top of this
  // handler, not an atomic increment: Supabase's REST layer has no `col = col +
  // 1` without an RPC, and adding one for a display counter is not worth the
  // surface. Two sends landing inside the same round-trip would therefore both
  // write the same number and undercount by one. What actually prevents that is
  // the UI — the send button is disabled for the whole request, so a double
  // click cannot produce a second in-flight send. The failure mode if it ever
  // did is a count that reads low, never a lost or duplicated invoice.
  //
  // `inv` / `userId` are captured as plain locals because TypeScript drops the
  // null narrowings established by the guards above once a value is read inside
  // a nested function; both are guaranteed non-null by those early returns.
  const inv    = invoice
  const userId = user.id
  async function recordSend() {
    const now         = new Date().toISOString()
    const priorCount  = Number(inv.sent_count ?? 0)
    const update: Record<string, unknown> = {
      sent_at:      (inv.sent_at as string | null) ?? now,
      last_sent_at: now,
      sent_count:   priorCount + 1,
      updated_at:   now,
    }
    // Status is only ever an upgrade: a 'paid', 'partial', 'void' or 'overdue'
    // invoice keeps its status, because re-sending a receipt must not reopen a
    // settled bill or wipe an overdue flag the late-fee job depends on.
    if (inv.status === 'unpaid') update.status = 'sent'

    const { data: updated, error: updateErr } = await supabase
      .from('hd_invoices')
      .update(update)
      .eq('id', id)
      .eq('user_id', userId)
      .select('id, status, sent_at, sent_count, last_sent_at')
      .single()

    if (updateErr) {
      // The invoice is already in the customer's hand — report the send as the
      // success it was and only note that the record lagged.
      console.error('[hd-invoice-send] send record update failed after delivery:', updateErr.message)
    }

    return {
      status:       (updated?.status as string | undefined) ?? (inv.status as string),
      sent_at:      (updated?.sent_at as string | undefined) ?? (update.sent_at as string),
      sent_count:   (updated?.sent_count as number | undefined) ?? priorCount + 1,
      last_sent_at: (updated?.last_sent_at as string | undefined) ?? now,
    }
  }

  // ── Email ────────────────────────────────────────────────────────────────
  if (method === 'email') {
    const toEmail = (body.email ?? invoice.customer_email ?? '').trim()
    if (!toEmail) {
      return NextResponse.json({ sent: false, error: 'No email address for this customer.', url: publicUrl })
    }

    const emailSuppression = await getContactSuppression(supabase, invoice.customer_id as string | null)
    if (emailSuppression.no_email) {
      return NextResponse.json({
        sent:       false,
        suppressed: true,
        error:      'This customer has asked not to receive email.',
        url:        publicUrl,
      })
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      // Say so plainly rather than returning a fake success: a tech who believes
      // the invoice went out will not follow up, and the bill ages.
      return NextResponse.json({
        sent:  false,
        error: 'Email delivery is not configured on this deployment. Use SMS, or copy the link and send it yourself.',
        url:   publicUrl,
      })
    }

    const { subject, text } = buildInvoiceEmail({
      businessName:  profile?.business_name as string | null | undefined,
      businessPhone: profile?.phone as string | null | undefined,
      invoiceNumber: invoice.invoice_number as string,
      total:         invoice.total as number | string | null,
      url:           publicUrl,
      hasReports,
    })

    // Built before the send and treated as optional throughout — see
    // buildAttachment. A null here means "send exactly as before".
    const attachment = await buildAttachment(svc, user.id, id)

    try {
      const { Resend } = await import('resend')
      const { error: sendErr } = await new Resend(apiKey).emails.send({
        from:    INVOICE_FROM,
        to:      toEmail,
        subject,
        text,
        ...(attachment ? { attachments: [attachment] } : {}),
      })
      if (sendErr) {
        // 200 on purpose, same contract as the SMS branch below: the request
        // succeeded, the mail provider did not, and the tech keeps the link.
        return NextResponse.json({
          sent:  false,
          error: sendErr.message || 'The email could not be delivered.',
          url:   publicUrl,
          to:    toEmail,
        })
      }
    } catch (err) {
      return NextResponse.json({
        sent:  false,
        error: err instanceof Error ? err.message : 'The email could not be delivered.',
        url:   publicUrl,
        to:    toEmail,
      })
    }

    const record = await recordSend()
    return NextResponse.json({
      sent:       true,
      to:         toEmail,
      url:        publicUrl,
      attached:   Boolean(attachment),
      ...record,
    })
  }

  // ── SMS ──────────────────────────────────────────────────────────────────
  const to = (body.phone ?? invoice.customer_phone ?? '').trim()
  if (!to) {
    return NextResponse.json({ sent: false, error: 'No phone number for this customer.', url: publicUrl })
  }

  // A customer marked do-not-SMS is not texted, even on a manual send: the flag is
  // the customer's instruction, not a preference about automation. Returns 200 with a
  // reason and the link so the tech can still copy it and phone them instead.
  const suppression = await getContactSuppression(supabase, invoice.customer_id as string | null)
  if (suppression.no_sms) {
    return NextResponse.json({
      sent: false,
      suppressed: true,
      error: 'This customer has asked not to receive text messages.',
      url: publicUrl,
    })
  }

  const smsBody = buildInvoiceSms({
    businessName:  profile?.business_name as string | null | undefined,
    businessPhone: profile?.phone as string | null | undefined,
    invoiceNumber: invoice.invoice_number as string,
    total:         invoice.total as number | string | null,
    url:           publicUrl,
    hasReports,
  })

  const result = await sendSmsResult({ to, body: smsBody })

  if (!result.success) {
    // 200 on purpose — the request succeeded, the carrier did not. The client
    // renders result.error and keeps the link copyable.
    return NextResponse.json({
      sent:  false,
      error: result.error ?? 'Text message could not be delivered.',
      url:   publicUrl,
      to,
    })
  }

  // Record the send. Shared with the email branch so both channels move the
  // same three timestamps the same way — see recordSend above.
  const record = await recordSend()

  return NextResponse.json({
    sent: true,
    to,
    url:  publicUrl,
    ...record,
  })
}
