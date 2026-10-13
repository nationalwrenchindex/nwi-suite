// POST /api/quotes/[id]/send
// Sends a quote to the customer via SMS, email, or link.
// Generates a public_token if one doesn't exist, marks status='sent'.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { money } from '@/lib/format'

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
  return money(n)
}

// GUARDED 2026-10-08. This route had its OWN Twilio call, so disabling the outreach
// sender did nothing for it. checkSmsAllowed is now the first statement of the local
// sender: it consults do_not_contact and FAILS CLOSED if it cannot read it.
// See src/lib/sms/guard.ts.
async function sendSms(to: string, body: string): Promise<{ success: boolean; error?: string }> {
  const verdict = await checkSmsAllowed(to)
  if (!verdict.allowed) {
    console.error(`[quote_sent] SMS REFUSED (${verdict.reason}): ${verdict.detail}`)
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

import { checkSmsAllowed, recordSmsSend } from '@/lib/sms/guard'

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

  let body: { method: 'sms' | 'email' | 'link'; phone?: string; email?: string; preview?: boolean }
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

  // ===========================================================================
  // PREVIEW: mint the link, claim nothing.
  // ===========================================================================
  //
  // The Copy Link tab and the QR generator both need a URL before the tech has shared
  // anything, and QuotesTab asks for one from a useEffect the moment that tab opens.
  // Under the old route that merely LOOKING at the link tab set status 'sent' and bumped
  // times_sent - which is a large part of why the counter reads 3 on quotes nobody
  // received.
  //
  // The token IS written, because a link that exists only in one HTTP response is not a
  // link. Status, sent_at and the counter are not touched.
  if (body.preview === true) {
    const { error: previewErr } = await supabase
      .from('quotes')
      .update({ public_token: token })
      .eq('id', id)
      .eq('user_id', user.id)
    if (previewErr) {
      console.error('[send] could not mint preview token:', previewErr)
      return NextResponse.json({ error: 'Could not create the quote link.' }, { status: 500 })
    }
    return NextResponse.json({
      sent:       false,
      preview:    true,
      quote,
      quote_url:  quoteUrl,
      sms_sent:   false,
      email_sent: false,
    })
  }

  // ===========================================================================
  // SEND FIRST, RECORD SECOND. This order is the fix, not an accident.
  // ===========================================================================
  //
  // This route used to UPDATE the quote - status 'sent', sent_at, times_sent - and THEN
  // attempt the SMS and the email. The write was unconditional, so a send that failed
  // for any reason still left a quote that said it had been sent, and a counter that
  // had gone up.
  //
  // Measured on live data: QT-2026-0005 reads times_sent 3, sent_at today, against the
  // owner's own email address. Three attempts, nothing delivered, and nowhere in the
  // database recording that - the error was returned once in the HTTP response and
  // then gone.
  //
  // A tech who sees "sent 3x" and hears nothing back blames his customer, not the
  // software. So nothing is written until a channel actually confirms.
  //
  // HD's invoice send (src/app/api/hd/invoices/[id]/send/route.ts) already worked this
  // way and its live data proves it: no hd_invoices row has a last_sent_at from a day
  // its sends failed. This brings LD in line with it.

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

  // A 'link' send is a real outcome: the tech asked for a shareable link, got one, and
  // hands it over himself. That IS the delivery, so it records like one - this branch
  // must not treat it as a failure just because no channel fired.
  const linkIssued = method === 'link'

  // NOTHING DELIVERED. The quote keeps whatever status it had, the counter does not
  // move, and the tech is told why.
  //
  // 200 rather than 500: the request was understood and handled correctly, and the
  // quote is intact. It is the DELIVERY that failed, which is a different thing and
  // needs a different message. Same contract HD's invoice send uses.
  if (!smsSent && !emailSent && !linkIssued) {
    const detail = [smsError, emailError].filter(Boolean).join('; ')
    console.error(`[send] nothing delivered for quote ${id}:`, detail || 'no channel attempted')

    // The token is persisted even though the send failed, and that is not a claim of
    // delivery - status and times_sent are what claim that, and neither moves. The
    // token has to exist or the link in the error message above would 404, which is
    // how a workaround turns into a second bug.
    const { error: tokenErr } = await supabase
      .from('quotes')
      .update({ public_token: token })
      .eq('id', id)
      .eq('user_id', user.id)
    if (tokenErr) console.error('[send] could not persist token after failed send:', tokenErr)

    return NextResponse.json({
      sent:       false,
      quote:      quote,
      quote_url:  quoteUrl,
      sms_sent:   false,
      email_sent: false,
      ...(smsError   && { sms_error:   smsError }),
      ...(emailError && { email_error: emailError }),
      error: detail
        ? `Could not send the quote: ${detail}. The quote is saved and its link works - copy it and send it yourself, or try again.`
        : 'Nothing was sent: no phone number or email address to send to.',
    })
  }

  // At least one channel confirmed. NOW it is true that this was sent.
  const updatePayload: Record<string, unknown> = {
    public_token:     token,
    status:           'sent',
    sent_at:          quote.sent_at ?? now,           // keep original sent_at on resend
    times_sent:       (quote.times_sent ?? 0) + 1,
    quote_expires_at: quote.quote_expires_at ?? expires,
  }

  // Only the channel that actually worked is recorded. Writing sent_to_email for a
  // send that failed is how the record starts lying about where the quote went.
  if (smsSent   && phone) updatePayload.sent_to_phone = phone
  if (emailSent && email) updatePayload.sent_to_email = email

  const { data: updated, error: updateErr } = await supabase
    .from('quotes')
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(QUOTE_SELECT)
    .single()

  if (updateErr || !updated) {
    // The customer HAS the quote - the send succeeded. Failing the request now would
    // tell the tech to send again, which would send it twice. Report the bookkeeping
    // failure instead and keep the delivery true.
    console.error('[send] delivered but could not record it:', updateErr)
    return NextResponse.json({
      sent:       true,
      quote:      quote,
      quote_url:  quoteUrl,
      sms_sent:   smsSent,
      email_sent: emailSent,
      warning:    'The quote was sent, but we could not update its record. Do not send it again.',
    })
  }

  return NextResponse.json({
    sent:       true,
    quote:      updated,
    quote_url:  quoteUrl,
    sms_sent:   smsSent,
    email_sent: emailSent,
    ...(smsError   && { sms_error:   smsError }),
    ...(emailError && { email_error: emailError }),
  })
}
