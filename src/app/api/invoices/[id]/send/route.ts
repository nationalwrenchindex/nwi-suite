// POST /api/invoices/[id]/send
// Sends a finalized invoice to the customer via SMS, email, or generates a link.
// Requires invoice_status = 'awaiting_payment'.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncInvoiceToGarage, buildGarageJoinSmsLink, type GarageSyncResult } from '@/lib/garage/link'
import { garageEmailSection, invoiceHtmlEmail } from '@/lib/garage/email'
import { money } from '@/lib/format'

const INVOICE_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin, mileage),
  source_quote:quotes!invoices_source_quote_id_fkey(id, quote_number, line_items, labor_hours, labor_rate, parts_subtotal, parts_markup_percent, labor_subtotal, tax_percent, tax_amount, grand_total)
`

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tools.nationalwrenchindex.com'

function genToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

/**
 * One-line service summary for the garage record. Built from the invoice's line
 * descriptions rather than the invoice number, so the customer sees "Brakes,
 * Oil change" in their history instead of an opaque reference.
 */
function summariseService(inv: Record<string, unknown>): string {
  const lines = [
    ...(Array.isArray(inv.service_lines) ? inv.service_lines : []),
    ...(Array.isArray(inv.line_items)    ? inv.line_items    : []),
  ] as Array<Record<string, unknown>>

  const labels = lines
    .map(l => (l.description ?? l.name ?? l.service ?? l.title))
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim())

  const unique = [...new Set(labels)]
  if (unique.length === 0) return 'Service'
  const summary = unique.slice(0, 3).join(', ')
  return unique.length > 3 ? `${summary} +${unique.length - 3} more` : summary
}

/** The date the work happened, falling back through the columns that exist. */
function invoiceServiceDate(inv: Record<string, unknown>): string {
  const candidate =
    (inv.service_date as string | null) ??
    (inv.invoice_date as string | null) ??
    (inv.issued_at    as string | null) ??
    (inv.created_at   as string | null)
  const d = candidate ? new Date(candidate) : new Date()
  return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 10)
}

function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '$0.00'
  return money(n)
}

// GUARDED 2026-10-08. This route had its OWN Twilio call, so disabling the outreach
// sender did nothing for it. checkSmsAllowed is now the first statement of the local
// sender: it consults do_not_contact and FAILS CLOSED if it cannot read it.
// See src/lib/sms/guard.ts.
async function sendSms(to: string, body: string): Promise<{ success: boolean; error?: string }> {
  const verdict = await checkSmsAllowed(to)
  if (!verdict.allowed) {
    console.error(`[invoice_sent] SMS REFUSED (${verdict.reason}): ${verdict.detail}`)
    return { success: false, error: `refused:${verdict.reason}` }
  }

  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from  = process.env.TWILIO_PHONE_NUMBER
  if (!sid || !token || !from) return { success: false, error: 'Twilio not configured' }

  const digits = to.replace(/\D/g, '')
  const e164   = digits.startsWith('1') ? `+${digits}` : `+1${digits}`
  const auth   = Buffer.from(`${sid}:${token}`).toString('base64')

  try {
    const res  = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body:   new URLSearchParams({ From: from, To: e164, Body: body }).toString(),
    })
    const data = await res.json() as { message?: string }
    if (!res.ok) return { success: false, error: data.message }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// Invoice delivery runs on Resend rather than SMTP: nationalwrenchindex.com is
// a verified sending domain there, which SPF/DKIM-signs the mail and keeps
// invoices out of spam. Matches src/lib/email-alerts.ts.
//
// Never throws. A bounced or misconfigured email must not stop an invoice being
// saved and marked sent — the caller surfaces the error in the response instead.
const INVOICE_FROM = process.env.INVOICE_FROM_EMAIL ?? 'invoices@nationalwrenchindex.com'

async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { success: false, error: 'RESEND_API_KEY not set' }

  try {
    const { Resend } = await import('resend')
    const { error } = await new Resend(apiKey).emails.send({
      from:    INVOICE_FROM,
      to,
      subject,
      text,
      ...(html ? { html } : {}),
    })
    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

import { checkSmsAllowed, recordSmsSend } from '@/lib/sms/guard'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: invoice, error: fetchErr } = await supabase
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !invoice) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })
  }

  if (!['awaiting_payment', 'paid'].includes(invoice.invoice_status as string)) {
    return NextResponse.json(
      { error: 'Invoice must be finalized before sending.' },
      { status: 400 }
    )
  }

  let body: { method: 'sms' | 'email' | 'link'; phone?: string; email?: string; mileage_at_service?: number; preview?: boolean }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { method, phone, email } = body
  const mileageAtService =
    typeof body.mileage_at_service === 'number' && Number.isFinite(body.mileage_at_service) && body.mileage_at_service >= 0
      ? Math.round(body.mileage_at_service)
      : null

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, business_name, phone')
    .eq('id', user.id)
    .single()

  const p = profile as { full_name?: string; business_name?: string; phone?: string } | null
  const bizName  = p?.business_name ?? 'Your Technician'
  const techName = p?.full_name     ?? 'Your Technician'

  const inv = invoice as Record<string, unknown>
  const customer = inv.customer as { first_name?: string; last_name?: string } | null
  const vehicle  = inv.vehicle  as { year?: number; make?: string; model?: string } | null

  const customerName  = customer ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() : 'Customer'
  const vehicleLabel  = vehicle  ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') : 'your vehicle'

  // Reuse existing token or generate fresh one
  const token      = (inv.public_token as string | null) ?? genToken()
  const invoiceUrl = `${APP_URL}/invoice/${token}`
  const now        = new Date().toISOString()

  // ===========================================================================
  // PREVIEW: mint the link, claim nothing.
  // ===========================================================================
  //
  // The Copy Link tab needs a URL before the tech has shared anything. Asking for that
  // URL is not a send, so it must not set sent_to_customer_at or move times_sent -
  // that is exactly how the counter got to 3 on invoices nobody ever received.
  //
  // The token IS written, because a link that only exists in one HTTP response is not
  // a link. Returning early also skips the garage sync, which has no business running
  // because someone opened a tab.
  if (body.preview === true) {
    const previewPayload: Record<string, unknown> = { public_token: token }
    if (mileageAtService != null) previewPayload.mileage_at_service = mileageAtService
    const { error: previewErr } = await supabase
      .from('invoices')
      .update(previewPayload)
      .eq('id', id)
      .eq('user_id', user.id)
    if (previewErr) {
      console.error('[send invoice] could not mint preview token:', previewErr)
      return NextResponse.json({ error: 'Could not create the invoice link.' }, { status: 500 })
    }
    return NextResponse.json({
      sent:        false,
      preview:     true,
      invoice,
      invoice_url: invoiceUrl,
      sms_sent:    false,
      email_sent:  false,
    })
  }

  // ===========================================================================
  // SEND FIRST, RECORD SECOND. Same fix as the quote send route.
  // ===========================================================================
  //
  // This used to write sent_to_customer_at and bump times_sent BEFORE attempting
  // delivery, unconditionally. A failed send still produced an invoice that claimed it
  // had gone out and a counter that had moved. Measured live: several of the owner's
  // own test invoices carry times_sent of 2 and 3 against his own number with nothing
  // delivered.
  //
  // An invoice that says "sent" and was not is worse than one that says nothing: the
  // bill ages, nobody chases it, and the tech assumes the customer is ignoring him.
  //
  // The public_token is still issued ABOVE this point, deliberately - the link has to
  // exist for the message to contain it. Issuing a token is not a claim that anything
  // was delivered; sent_to_customer_at is.

  let smsSent   = false
  let emailSent = false
  let smsError: string | undefined
  let emailError: string | undefined

  const grandTotal = fmtCurrency(inv.total as number)
  const invTotal   = typeof inv.total === 'number' ? inv.total : null

  // ── NWI Garage ────────────────────────────────────────────────────────────
  // Runs before the email is composed, because the outcome decides what the
  // email says: an existing customer gets told their garage was updated, a new
  // one gets a signup button with their vehicle pre-filled. Deliberately
  // non-fatal — a garage outage must never stop an invoice reaching a customer.
  const fullVehicle = inv.vehicle as {
    year?: number; make?: string; model?: string; vin?: string; mileage?: number
  } | null
  const customerEmail =
    (email as string | undefined) ??
    ((inv.customer as { email?: string } | null)?.email ?? null)

  let garage: GarageSyncResult = { linked: false, joinUrl: '' }
  try {
    garage = await syncInvoiceToGarage({
      invoiceId:     id,
      customerEmail,
      vehicle: fullVehicle
        ? {
            vin:     fullVehicle.vin     ?? null,
            year:    fullVehicle.year    ?? null,
            make:    fullVehicle.make    ?? null,
            model:   fullVehicle.model   ?? null,
            // Mechanic-entered odometer wins: vehicles.mileage is whatever was
            // recorded when the vehicle was added and drifts every visit.
            mileage: mileageAtService ?? (inv.mileage_at_service as number | null) ?? fullVehicle.mileage ?? null,
          }
        : null,
      mechanicName:  bizName,
      mechanicPhone: p?.phone ?? null,
      serviceType:  summariseService(inv),
      notes:        (inv.notes as string | null) ?? null,
      cost:         invTotal,
      serviceDate:  invoiceServiceDate(inv),
    })
  } catch (err) {
    console.error('[send invoice] garage sync failed:', err instanceof Error ? err.message : String(err))
  }
  const paymentInstructions = (inv.payment_instructions as string | null) ?? ''
  const invoiceNumber       = inv.invoice_number as string
  const poNumber            = (inv.po_number as string | null) ?? null

  if (method === 'sms' && phone) {
    // Offered only to customers without a Garage account, and only when the
    // vehicle has a VIN for the join page to key on. Someone who already has a
    // garage should not be pitched a signup — their update notice lives in the
    // email path.
    const joinVin  = !garage.linked ? (fullVehicle?.vin ?? null) : null
    const joinLine = joinVin ? ` Free service records for this vehicle: ${buildGarageJoinSmsLink(joinVin)}.` : ''

    const smsBody =
      `Hi ${customerName}, your invoice from ${bizName} is ready. ` +
      `Total due: ${grandTotal}. ` +
      `View and download here: ${invoiceUrl}.${joinLine} Reply STOP to opt out.`
    const r  = await sendSms(phone, smsBody)
    smsSent  = r.success
    smsError = r.error
  }

  if (method === 'email' && email) {
    const subject = `Invoice from ${bizName} — Total Due: ${grandTotal}`
    const bodyLines = [
      `Hi ${customerName},`,
      `Your invoice for service on your ${vehicleLabel} is ready.`,
      `Invoice: ${invoiceNumber}`,
      ...(poNumber ? [`PO #: ${poNumber}`] : []),
      `Total Due: ${grandTotal}`,
      `View and download your invoice: ${invoiceUrl}`,
      ...(paymentInstructions ? [`Payment Instructions: ${paymentInstructions}`] : []),
      `Please contact ${bizName} directly with any questions.`,
    ]
    const section = garageEmailSection(garage)

    const text = [
      `Hi ${customerName},`,
      '',
      `Your invoice for service on your ${vehicleLabel} is ready.`,
      '',
      `Invoice: ${invoiceNumber}`,
      ...(poNumber ? [`PO #: ${poNumber}`] : []),
      `Total Due: ${grandTotal}`,
      '',
      `View and download your invoice: ${invoiceUrl}`,
      '',
      ...(paymentInstructions ? ['Payment Instructions:', paymentInstructions, ''] : []),
      `Please contact ${bizName} directly with any questions.`,
      section.text,
      '',
      `Thanks,`,
      `${techName}`,
      `${bizName}`,
    ].join('\n')

    const html = invoiceHtmlEmail({
      heading:    `Invoice from ${bizName}`,
      bodyLines:  [...bodyLines, `Thanks, ${techName} — ${bizName}`],
      garageHtml: section.html,
    })

    const r     = await sendEmail(email, subject, text, html)
    emailSent   = r.success
    emailError  = r.error
  }

  // A 'link' send is a real outcome: the tech asked for a shareable link, got one, and
  // will hand it over himself. That is a delivery he performed, so it records like one.
  const linkIssued = method === 'link'

  // NOTHING DELIVERED. sent_to_customer_at and times_sent are untouched, so the
  // invoice does not claim to have gone out. The token IS persisted - see below.
  //
  // 200 rather than 500: the request was understood, the invoice is intact, and it is
  // the DELIVERY that failed. That needs its own message, not a server error.
  if (!smsSent && !emailSent && !linkIssued) {
    const detail = [smsError, emailError].filter(Boolean).join('; ')
    console.error(`[send invoice] nothing delivered for invoice ${id}:`, detail || 'no channel attempted')

    // The token and the odometer reading are persisted even on failure, and neither is
    // a claim of delivery. The token has to exist or the link in the error message -
    // "copy the link and send it yourself" - would 404, which is how a workaround
    // becomes a second bug. mileage_at_service is something the tech typed; losing it
    // because Twilio was down would make him type it again.
    const failPayload: Record<string, unknown> = { public_token: token }
    if (mileageAtService != null) failPayload.mileage_at_service = mileageAtService
    const { error: tokenErr } = await supabase
      .from('invoices')
      .update(failPayload)
      .eq('id', id)
      .eq('user_id', user.id)
    if (tokenErr) console.error('[send invoice] could not persist token after failed send:', tokenErr)

    return NextResponse.json({
      sent:        false,
      invoice,
      invoice_url: invoiceUrl,
      sms_sent:    false,
      email_sent:  false,
      garage:      garage.linked ? { linked: true, posted: garage.posted } : { linked: false },
      ...(smsError   && { sms_error:   smsError }),
      ...(emailError && { email_error: emailError }),
      error: detail
        ? `Could not send the invoice: ${detail}. The invoice is saved and its link works - copy it and send it yourself, or try again.`
        : 'Nothing was sent: no phone number or email address to send to.',
    })
  }

  // A channel confirmed. NOW it is true that this invoice was sent.
  const updatePayload: Record<string, unknown> = {
    public_token:        token,
    sent_to_customer_at: (inv.sent_to_customer_at as string | null) ?? now,
    times_sent:          ((inv.times_sent as number | null) ?? 0) + 1,
  }
  // Only the channel that actually worked is recorded. Writing sent_to_email for a
  // send that failed is how the record starts lying about where the invoice went.
  if (smsSent   && phone) updatePayload.sent_to_phone = phone
  if (emailSent && email) updatePayload.sent_to_email = email
  if (mileageAtService != null) updatePayload.mileage_at_service = mileageAtService

  const { data: updated, error: updateErr } = await supabase
    .from('invoices')
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(INVOICE_SELECT)
    .single()

  if (updateErr || !updated) {
    // The customer HAS the invoice. Failing the request now would tell the tech to send
    // again, which would send it twice. Report the bookkeeping failure and keep the
    // delivery true.
    console.error('[send invoice] delivered but could not record it:', updateErr)
    return NextResponse.json({
      sent:        true,
      invoice,
      invoice_url: invoiceUrl,
      sms_sent:    smsSent,
      email_sent:  emailSent,
      garage:      garage.linked ? { linked: true, posted: garage.posted } : { linked: false },
      warning:     'The invoice was sent, but we could not update its record. Do not send it again.',
    })
  }

  return NextResponse.json({
    sent:        true,
    invoice:     updated,
    invoice_url: invoiceUrl,
    sms_sent:    smsSent,
    email_sent:  emailSent,
    garage:      garage.linked
      ? { linked: true, posted: garage.posted, ...(garage.reason && { reason: garage.reason }) }
      : { linked: false },
    ...(smsError   && { sms_error:   smsError }),
    ...(emailError && { email_error: emailError }),
  })
}
