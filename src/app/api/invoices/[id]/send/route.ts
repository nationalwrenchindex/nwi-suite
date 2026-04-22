// POST /api/invoices/[id]/send
// Sends a finalized invoice to the customer via SMS, email, or generates a link.
// Requires invoice_status = 'awaiting_payment'.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const INVOICE_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin),
  source_quote:quotes!invoices_source_quote_id_fkey(id, quote_number, line_items, labor_hours, labor_rate, parts_subtotal, parts_markup_percent, labor_subtotal, tax_percent, tax_amount, grand_total)
`

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tools.nationalwrenchindex.com'

function genToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
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

async function sendEmail(to: string, subject: string, text: string): Promise<{ success: boolean; error?: string }> {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM ?? user ?? 'notifications@nationalwrenchindex.com'
  if (!host || !user || !pass) return { success: false, error: 'SMTP not configured' }

  try {
    const nodemailer = await import('nodemailer')
    const t = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
    await t.sendMail({ from, to, subject, text })
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
    const text    = [
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
      '',
      `Thanks,`,
      `${techName}`,
      `${bizName}`,
    ].join('\n')
    const r     = await sendEmail(email, subject, text)
    emailSent   = r.success
    emailError  = r.error
  }

  return NextResponse.json({
    invoice:     updated,
    invoice_url: invoiceUrl,
    sms_sent:    smsSent,
    email_sent:  emailSent,
    ...(smsError   && { sms_error:   smsError }),
    ...(emailError && { email_error: emailError }),
  })
}
