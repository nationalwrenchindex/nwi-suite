// POST /api/quotes/[id]/send
// Sends a quote to the customer via SMS, email, or link.
// Generates a public_token if one doesn't exist, marks status='sent'.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const QUOTE_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin)
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

async function sendEmail(
  to: string,
  subject: string,
  text: string,
): Promise<{ success: boolean; error?: string }> {
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

  const { data: quote, error: fetchErr } = await supabase
    .from('quotes')
    .select(QUOTE_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !quote) return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })

  let body: { method: 'sms' | 'email' | 'link'; phone?: string; email?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { method, phone, email } = body

  // Reuse existing token or generate a fresh one
  const token    = (quote.public_token as string | null) ?? genToken()
  const quoteUrl = `${APP_URL}/quote/${token}`

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, business_name, phone')
    .eq('id', user.id)
    .single()

  const bizName  = (profile as { business_name?: string } | null)?.business_name ?? 'Your Technician'
  const techName = (profile as { full_name?: string } | null)?.full_name          ?? 'Your Technician'

  const customerName = quote.customer
    ? `${quote.customer.first_name} ${quote.customer.last_name}`.trim()
    : 'Customer'

  const vehicleLabel = quote.vehicle
    ? [quote.vehicle.year, quote.vehicle.make, quote.vehicle.model].filter(Boolean).join(' ')
    : 'your vehicle'

  const now     = new Date().toISOString()
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  const updatePayload: Record<string, unknown> = {
    public_token:     token,
    status:           'sent',
    sent_at:          quote.sent_at ?? now,           // keep original sent_at on resend
    times_sent:       (quote.times_sent ?? 0) + 1,
    quote_expires_at: quote.quote_expires_at ?? expires,
  }

  if (method === 'sms' && phone) updatePayload.sent_to_phone = phone
  if (method === 'email' && email) updatePayload.sent_to_email = email

  const { data: updated, error: updateErr } = await supabase
    .from('quotes')
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(QUOTE_SELECT)
    .single()

  if (updateErr || !updated) {
    console.error('[send] update failed:', updateErr)
    return NextResponse.json({ error: 'Failed to update quote.' }, { status: 500 })
  }

  let smsSent   = false
  let emailSent = false
  let smsError: string | undefined
  let emailError: string | undefined

  if (method === 'sms' && phone) {
    const smsBody =
      `Hi ${customerName}, your quote from ${bizName} is ready. ` +
      `Total: ${fmtCurrency(quote.grand_total)}. ` +
      `Review and approve here: ${quoteUrl}. Reply STOP to opt out.`
    const r = await sendSms(phone, smsBody)
    smsSent  = r.success
    smsError = r.error
  }

  if (method === 'email' && email) {
    const subject = `Your quote from ${bizName}`
    const text    = [
      `Hi ${customerName},`,
      '',
      `Your quote for service on ${vehicleLabel} is ready for review.`,
      '',
      `Total: ${fmtCurrency(quote.grand_total)}`,
      '',
      `Review and approve: ${quoteUrl}`,
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
    quote:      updated,
    quote_url:  quoteUrl,
    sms_sent:   smsSent,
    email_sent: emailSent,
    ...(smsError   && { sms_error:   smsError }),
    ...(emailError && { email_error: emailError }),
  })
}
