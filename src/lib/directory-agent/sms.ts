// Outbound SMS for the directory agents (LD and HD).
//
// Deliberately NOT src/lib/twilio.ts: that sender routes every message through
// the subscriber 10DLC Messaging Service. Directory outreach runs as separate
// campaigns on their own numbers, so this sends with an explicit From — the
// caller supplies which one. Everything else — Basic auth, form encoding, error
// surfacing — mirrors sendSmsResult().

import { LD_FROM_NUMBER } from './config'

export async function sendAgentSms({
  to,
  body,
  from,
}: {
  to:    string
  body:  string
  /** Defaults to the LD outreach number. HD callers pass their own. */
  from?: string
}): Promise<{ success: boolean; error?: string }> {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN

  if (!sid || !token) {
    return { success: false, error: 'Twilio credentials not configured' }
  }

  const digits    = to.replace(/\D/g, '')
  const e164      = digits.startsWith('1') ? `+${digits}` : `+1${digits}`
  const basicAuth = Buffer.from(`${sid}:${token}`).toString('base64')

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method:  'POST',
        headers: {
          Authorization:  `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: from ?? LD_FROM_NUMBER(),
          To:   e164,
          Body: body,
        }).toString(),
      },
    )

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { message?: string; code?: number }
      const msg  = `HTTP ${res.status} code ${data.code}: ${data.message}`
      console.error('[directory-agent/sms] Twilio error:', msg)
      return { success: false, error: msg }
    }

    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[directory-agent/sms] fetch error:', msg)
    return { success: false, error: msg }
  }
}
