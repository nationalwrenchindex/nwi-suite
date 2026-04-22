// POST /api/invoices/public/[token]/view
// Called on public invoice page mount. Increments customer_view_count,
// sets customer_viewed_at on first view, and notifies tech on first view.
// No auth required.

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
    console.error('[invoice view] email error:', err)
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 400 })
  }

  const sc = createServiceClient()

  const { data: invoice, error } = await sc
    .from('invoices')
    .select('id, invoice_number, invoice_status, user_id, total, customer_view_count, customer_viewed_at, customer:customers(first_name, last_name)')
    .eq('public_token', token)
    .single()

  if (error || !invoice) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })
  }

  const inv         = invoice as Record<string, unknown>
  const isFirstView = !(inv.customer_viewed_at as string | null)
  const now         = new Date().toISOString()

  const patch: Record<string, unknown> = {
    customer_view_count: ((inv.customer_view_count as number | null) ?? 0) + 1,
  }
  if (isFirstView) patch.customer_viewed_at = now

  const { error: updateErr } = await sc
    .from('invoices')
    .update(patch)
    .eq('id', inv.id as string)

  if (updateErr) {
    console.error('[invoice view] update failed:', updateErr)
  }

  // Notify tech on first view — fire and forget
  if (isFirstView) {
    ;(async () => {
      try {
        const { data: profile } = await sc
          .from('profiles')
          .select('email, phone, business_name')
          .eq('id', inv.user_id as string)
          .single()

        const p = profile as { email?: string; phone?: string; business_name?: string } | null
        const c = inv.customer as { first_name?: string; last_name?: string } | null
        const customerName = c ? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() : 'Your customer'

        const msg = `Your invoice ${inv.invoice_number as string} was viewed by ${customerName}. Total due: ${fmtCurrency(inv.total as number)}.`

        if (p?.phone)  await sendSms(p.phone, msg)
        if (p?.email)  await sendEmail(p.email, `Invoice ${inv.invoice_number as string} viewed by ${customerName}`, msg)
      } catch (notifErr) {
        console.error('[invoice view] tech notification error:', notifErr)
      }
    })()
  }

  return NextResponse.json({
    invoice_status:     inv.invoice_status as string,
    customer_view_count: ((inv.customer_view_count as number | null) ?? 0) + 1,
  })
}
