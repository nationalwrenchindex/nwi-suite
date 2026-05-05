import { Resend } from 'resend'

const TO   = 'nwisuite@nationalwrenchindex.com'
const FROM = 'NWI Suite Alerts <onboarding@resend.dev>'

export async function sendFounderAlert({ subject, html }: { subject: string; html: string }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email-alerts] RESEND_API_KEY not set — skipping alert')
    return
  }
  try {
    const resend = new Resend(apiKey)
    await resend.emails.send({ from: FROM, to: TO, subject, html })
  } catch (err) {
    console.error('[email-alerts] failed to send alert:', err)
  }
}
