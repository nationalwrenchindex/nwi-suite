import { Resend } from 'resend'

const FROM = 'LawnPlatform Alerts <onboarding@resend.dev>'

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

// Notifies the founders whenever a brand-new diagnostic is cached (never on a
// cache hit, never on the fallback placeholder) so they can review/correct the
// AI-generated content — especially electrical/voltage specs.
export async function sendNewCacheAlert({
  manufacturer,
  unitModel,
  alarmCode,
  displayMessage,
  cacheKey,
  source,
}: {
  manufacturer:   string
  unitModel:      string
  alarmCode:      string
  displayMessage: string
  cacheKey:       string
  source:         string
}) {
  const resend = await getResend()
  if (!resend) return
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))
  try {
    await resend.emails.send({
      from:    FROM,
      to:      ['brock@nationalwrenchindex.com', 'nationalwrenchindex@gmail.com'],
      subject: `[NWI Cache] New diagnostic cached — ${manufacturer} ${alarmCode}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;line-height:1.6;color:#1a1a1a;">
          <p>New diagnostic cached and ready for your review.</p>
          <p>
            <strong>Manufacturer:</strong> ${esc(manufacturer)}<br/>
            <strong>Unit Model:</strong> ${esc(unitModel)}<br/>
            <strong>Alarm Code:</strong> ${esc(alarmCode)}<br/>
            <strong>Display Message:</strong> ${displayMessage ? esc(displayMessage) : 'Not entered'}<br/>
            <strong>Cache Key:</strong> ${esc(cacheKey)}<br/>
            <strong>Source:</strong> ${esc(source)}
          </p>
          <p>
            <a href="https://tools.nationalwrenchindex.com/admin">Review and correct this entry</a><br/>
            Link: https://tools.nationalwrenchindex.com/admin
          </p>
          <p>If this entry contains incorrect electrical specifications or voltage values, edit it before approving.</p>
        </div>
      `,
    })
  } catch (err) {
    console.error('[email-alerts] sendNewCacheAlert failed:', err)
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
          <h2 style="color:#16a34a;font-size:24px;margin:0 0 20px;">🔔 New NWI Subscriber!</h2>
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="color:#999;padding:6px 0;width:110px;">Name</td><td style="color:#fff;padding:6px 0;">${name}</td></tr>
            <tr><td style="color:#999;padding:6px 0;">Email</td><td style="color:#fff;padding:6px 0;">${email}</td></tr>
            <tr><td style="color:#999;padding:6px 0;">Plan</td><td style="color:#16a34a;padding:6px 0;font-weight:bold;">${planName}</td></tr>
            <tr><td style="color:#999;padding:6px 0;">Amount</td><td style="color:#fff;padding:6px 0;">${amount}</td></tr>
            <tr><td style="color:#999;padding:6px 0;">Time</td><td style="color:#fff;padding:6px 0;">${ts}</td></tr>
          </table>
          <div style="margin-top:24px;">
            <a href="https://tools.nationalwrenchindex.com/admin"
               style="display:inline-block;background:#16a34a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
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
