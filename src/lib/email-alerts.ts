import { Resend } from 'resend'

const FROM = 'NWI Suite Alerts <onboarding@resend.dev>'

async function getResend(): Promise<Resend | null> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email-alerts] RESEND_API_KEY not set — skipping alert')
    return null
  }
  return new Resend(apiKey)
}

export async function sendFounderAlert({ subject, html }: { subject: string; html: string }) {
  const resend = await getResend()
  if (!resend) return
  try {
    await resend.emails.send({ from: FROM, to: 'nwisuite@nationalwrenchindex.com', subject, html })
  } catch (err) {
    console.error('[email-alerts] sendFounderAlert failed:', err)
  }
}

export async function sendNewSubscriberAlert({
  name,
  email,
  planName,
  tier,
  amountDollars,
}: {
  name:          string
  email:         string
  planName:      string
  tier:          string
  amountDollars: number | null
}) {
  const resend = await getResend()
  if (!resend) return
  const ts      = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
  const amount  = amountDollars != null ? `$${amountDollars}/mo` : '—'
  try {
    await resend.emails.send({
      from:    FROM,
      to:      'nationalwrenchindex@gmail.com',
      subject: `New Subscriber — ${tier} — ${email}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#1a1a1a;color:#fff;padding:32px;border-radius:12px;">
          <h2 style="color:#FF6600;font-size:24px;margin:0 0 20px;">🔔 New NWI Subscriber!</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="color:#999;padding:6px 0;width:110px;">Name</td><td style="color:#fff;padding:6px 0;">${name}</td></tr>
            <tr><td style="color:#999;padding:6px 0;">Email</td><td style="color:#fff;padding:6px 0;">${email}</td></tr>
            <tr><td style="color:#999;padding:6px 0;">Plan</td><td style="color:#FF6600;padding:6px 0;font-weight:bold;">${planName}</td></tr>
            <tr><td style="color:#999;padding:6px 0;">Amount</td><td style="color:#fff;padding:6px 0;">${amount}</td></tr>
            <tr><td style="color:#999;padding:6px 0;">Time</td><td style="color:#fff;padding:6px 0;">${ts}</td></tr>
          </table>
          <div style="margin-top:24px;">
            <a href="https://tools.nationalwrenchindex.com/admin"
               style="display:inline-block;background:#FF6600;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
              View Admin Dashboard →
            </a>
          </div>
        </div>
      `,
    })
  } catch (err) {
    console.error('[email-alerts] sendNewSubscriberAlert failed:', err)
  }
}
