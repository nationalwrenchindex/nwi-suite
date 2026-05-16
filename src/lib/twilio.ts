// Sends an SMS to a subscriber's own phone number using the registered 10DLC
// Messaging Service so all messages route through the verified campaign.
// Failures are logged but never thrown — callers must not block on SMS success.
//
// sendSmsResult is the same send path but surfaces success/failure to the caller
// so batch jobs (e.g. TorqueWrench cron) can implement retry logic.

const MESSAGING_SERVICE_SID = 'MGbc3ba6d2d67f6d2b5cffaa62df481e36'

export async function sendSubscriberSms({
  to,
  body,
}: {
  to:   string
  body: string
}): Promise<void> {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN

  if (!sid || !token) {
    console.warn('[subscriber-sms] Twilio credentials not configured — skipping')
    return
  }

  const digits = to.replace(/\D/g, '')
  const e164   = digits.startsWith('1') ? `+${digits}` : `+1${digits}`

  try {
    const basicAuth = Buffer.from(`${sid}:${token}`).toString('base64')
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method:  'POST',
        headers: {
          Authorization:  `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          MessagingServiceSid: MESSAGING_SERVICE_SID,
          To:                  e164,
          Body:                body,
        }).toString(),
      },
    )
    if (!res.ok) {
      const data = await res.json() as { message?: string; code?: number }
      console.error('[subscriber-sms] Twilio error (HTTP', res.status, 'code', data.code, '):', data.message)
    }
  } catch (err) {
    console.error('[subscriber-sms] fetch error:', err instanceof Error ? err.message : String(err))
  }
}

export async function sendSmsResult({
  to,
  body,
}: {
  to:   string
  body: string
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
          MessagingServiceSid: MESSAGING_SERVICE_SID,
          To:                  e164,
          Body:                body,
        }).toString(),
      },
    )

    if (!res.ok) {
      const data = await res.json() as { message?: string; code?: number }
      const msg  = `HTTP ${res.status} code ${data.code}: ${data.message}`
      console.error('[sms-result] Twilio error:', msg)
      return { success: false, error: msg }
    }

    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sms-result] fetch error:', msg)
    return { success: false, error: msg }
  }
}
