// POST /api/invoices/[id]/send
// Sends a finalized invoice to the customer via SMS, email, or generates a link.
// Requires invoice_status = 'awaiting_payment'.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncInvoiceToGarage, type GarageSyncResult } from '@/lib/garage/link'
import { garageEmailSection, invoiceHtmlEmail } from '@/lib/garage/email'

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
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

async function sendSms(to: string, body: string): Promise<{ success: boolean; error?: string }> {
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

async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<{ success: boolean; error?: string }> {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM ?? user ?? 'notifications@nationalwrenchindex.com'
  if (!host || !user || !pass) return { success: false, error: 'SMTP not configured' }

  try {
    const nodemailer = await import('nodemailer')
    const t = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
    await t.sendMail({ from, to, subject, text, ...(html ? { html } : {}) })
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

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

  let body: { method: 'sms' | 'email' | 'link'; phone?: string; email?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { method, phone, email } = body

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

  const updatePayload: Record<string, unknown> = {
    public_token:        token,
    sent_to_customer_at: (inv.sent_to_customer_at as string | null) ?? now,
    times_sent:          ((inv.times_sent as number | null) ?? 0) + 1,
  }
  if (method === 'sms'   && phone) updatePayload.sent_to_phone = phone
  if (method === 'email' && email) updatePayload.sent_to_email = email

  const { data: updated, error: updateErr } = await supabase
    .from('invoices')
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(INVOICE_SELECT)
    .single()

  if (updateErr || !updated) {
    console.error('[send invoice] update failed:', updateErr)
    return NextResponse.json({ error: 'Failed to update invoice.' }, { status: 500 })
  }

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
            mileage: fullVehicle.mileage ?? null,
          }
        : null,
      mechanicName: bizName,
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

  if (method === 'sms' && phone) {
    const smsBody =
      `Hi ${customerName}, your invoice from ${bizName} is ready. ` +
      `Total due: ${grandTotal}. ` +
      `View and download here: ${invoiceUrl}. Reply STOP to opt out.`
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

  return NextResponse.json({
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
