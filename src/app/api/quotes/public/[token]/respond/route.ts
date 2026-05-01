// POST /api/quotes/public/[token]/respond
// Customer approves or declines a quote from the public page.
// No auth required — the public_token is the authentication mechanism.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '$0.00'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

async function sendSms(to: string, body: string): Promise<void> {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from  = process.env.TWILIO_PHONE_NUMBER
  if (!sid || !token || !from) return

  const digits = to.replace(/\D/g, '')
  const e164   = digits.startsWith('1') ? `+${digits}` : `+1${digits}`

  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: e164, Body: body }).toString(),
  }).catch(() => {})
}

async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM ?? user ?? 'notifications@nationalwrenchindex.com'
  if (!host || !user || !pass) return

  try {
    const nodemailer = await import('nodemailer')
    const t = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
    await t.sendMail({ from, to, subject, text })
  } catch (err) {
    console.error('[public/respond] email error:', err)
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 400 })
  }

  let body: { action: 'approve' | 'decline'; note?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (body.action !== 'approve' && body.action !== 'decline') {
    return NextResponse.json({ error: 'action must be "approve" or "decline".' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  const { data: quote, error } = await serviceClient
    .from('quotes')
    .select(`
      id, quote_number, status, user_id, grand_total,
      customer:customers(first_name, last_name)
    `)
    .eq('public_token', token)
    .single()

  if (error || !quote) {
    return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
  }

  if (quote.status !== 'sent') {
    return NextResponse.json({
      error:  'This quote has already been responded to.',
      status: quote.status,
    }, { status: 409 })
  }

  const now   = new Date().toISOString()
  const patch: Record<string, unknown> =
    body.action === 'approve'
      ? { status: 'approved', approved_at: now, approval_method: 'customer_link' }
      : { status: 'declined', declined_at: now, customer_response_note: body.note || null, approval_method: 'customer_link' }

  const { error: updateErr } = await serviceClient
    .from('quotes')
    .update(patch)
    .eq('id', quote.id)

  if (updateErr) {
    console.error('[public/respond] update failed:', updateErr)
    return NextResponse.json({ error: 'Failed to record response.' }, { status: 500 })
  }

  // Notify the tech — fire and forget, non-blocking
  ;(async () => {
    try {
      const { data: profile } = await serviceClient
        .from('profiles')
        .select('email, phone, full_name, business_name')
        .eq('id', quote.user_id)
        .single()

      const p = profile as {
        email?: string; phone?: string; full_name?: string; business_name?: string
      } | null

      const c = quote.customer as { first_name?: string; last_name?: string } | null
      const customerName = c ? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() : 'A customer'
      const action       = body.action === 'approve' ? 'approved' : 'declined'
      const noteText     = body.note ? `\nNote: ${body.note}` : ''

      const smsMsg = [
        `Your quote ${quote.quote_number} was ${action} by ${customerName}.`,
        `Grand total: ${fmtCurrency(quote.grand_total)}.`,
        noteText,
      ].filter(Boolean).join(' ')

      const emailSubject = `Quote ${quote.quote_number} was ${action}`
      const emailBody    = [
        `Your quote ${quote.quote_number} was ${action} by ${customerName}.`,
        `Grand total: ${fmtCurrency(quote.grand_total)}.`,
        noteText,
      ].filter(Boolean).join('\n')

      if (p?.phone)  await sendSms(p.phone, smsMsg)
      if (p?.email)  await sendEmail(p.email, emailSubject, emailBody)

      // Insert in-app inbox notification for the mechanic
      const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tools.nationalwrenchindex.com'
      const notifTitle = body.action === 'approve'
        ? `Quote ${quote.quote_number} approved`
        : `Quote ${quote.quote_number} declined`
      const notifBody = body.action === 'approve'
        ? `${customerName} approved your quote for ${fmtCurrency(quote.grand_total)}.`
        : `${customerName} declined your quote.${body.note ? ` Reason: ${body.note}` : ''}`
      await serviceClient.from('notifications').insert({
        user_id:    quote.user_id,
        type:       body.action === 'approve' ? 'quote_approved' : 'quote_declined',
        title:      notifTitle,
        body:       notifBody,
        link:       `${APP_URL}/financials?tab=quotes&quote=${quote.id}`,
      })
    } catch (notifErr) {
      console.error('[public/respond] tech notification error:', notifErr)
    }
  })()

  return NextResponse.json({ success: true, action: body.action })
}
