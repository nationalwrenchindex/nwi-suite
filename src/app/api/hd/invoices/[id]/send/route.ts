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
import { mintInvoiceToken, publicInvoiceUrl } from '@/lib/hd/invoice-token'
import { buildInvoiceSms } from '@/lib/hd/sms-templates'

export const dynamic = 'force-dynamic'

interface SendBody {
  method: 'sms' | 'email'
  phone?: string
  email?: string
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
    .select('id, invoice_number, status, total, customer_phone, customer_email, sent_at')
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
  try {
    const svc   = createServiceClient()
    const token = await mintInvoiceToken(svc, id, user.id)
    publicUrl   = publicInvoiceUrl(token)
  } catch (err) {
    console.error('[hd-invoice-send] token mint failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Could not create a payment link for this invoice.' }, { status: 500 })
  }

  // ── Email ────────────────────────────────────────────────────────────────
  // Not wired. Say so plainly rather than returning a fake success: a tech who
  // believes the invoice went out will not follow up, and the bill ages.
  if (method === 'email') {
    return NextResponse.json(
      {
        sent:  false,
        error: 'Email delivery is not configured yet. Use SMS, or copy the link and send it yourself.',
        url:   publicUrl,
      },
      { status: 501 },
    )
  }

  // ── SMS ──────────────────────────────────────────────────────────────────
  const to = (body.phone ?? invoice.customer_phone ?? '').trim()
  if (!to) {
    return NextResponse.json({ sent: false, error: 'No phone number for this customer.', url: publicUrl })
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

  // Record the send. Only ever an upgrade: a 'paid', 'partial', 'void', or
  // 'overdue' invoice keeps its status, because re-texting a receipt must not
  // reopen a settled bill or wipe an overdue flag the late-fee job depends on.
  const update: Record<string, unknown> = {
    sent_at:    (invoice.sent_at as string | null) ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (invoice.status === 'unpaid') update.status = 'sent'

  const { data: updated, error: updateErr } = await supabase
    .from('hd_invoices')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, status, sent_at')
    .single()

  if (updateErr) {
    // The text is already in the customer's hand — report the send as the
    // success it was and only note that the record lagged.
    console.error('[hd-invoice-send] status update failed after delivery:', updateErr.message)
  }

  return NextResponse.json({
    sent:    true,
    to,
    url:     publicUrl,
    status:  (updated?.status as string | undefined) ?? invoice.status,
    sent_at: (updated?.sent_at as string | undefined) ?? update.sent_at,
  })
}
