// Sends an SMS to a subscriber's own phone number using the registered 10DLC
// Messaging Service so all messages route through the verified campaign.
// Failures are logged but never thrown — callers must not block on SMS success.
//
// sendSmsResult is the same send path but surfaces success/failure to the caller
// so batch jobs (e.g. TorqueWrench cron) can implement retry logic.

import { checkSmsAllowed, recordSmsSend } from '@/lib/sms/guard'

const MESSAGING_SERVICE_SID = 'MGbc3ba6d2d67f6d2b5cffaa62df481e36'

// ===========================================================================
// EVERY SEND IN THIS FILE GOES THROUGH checkSmsAllowed FIRST - 2026-10-08
// ===========================================================================
//
// Not the caller's job. The check is here, in the send function, because the cold
// outreach incident happened precisely BECAUSE the check lived somewhere else: the
// opt-out was recorded faithfully in directory_optouts and the send path never read
// it, so one number received 36 messages and another had four sends attempted after
// it replied STOP.
//
// The guard FAILS CLOSED. If do_not_contact cannot be read, nothing is sent. That
// includes the window before migration 150 is applied - during it, SMS is off rather
// than unguarded, which is the correct way round.
//
// `kind` is passed through to the send log so a spike can be identified as
// transactional or not without reading code.

export async function sendSubscriberSms({
  to,
  body,
  kind = 'subscriber_notification',
}: {
  to:   string
  body: string
  kind?: string
}): Promise<void> {
  const verdict = await checkSmsAllowed(to)
  if (!verdict.allowed) {
    console.error(`[subscriber-sms] REFUSED (${verdict.reason}): ${verdict.detail}`)
    return
  }

  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN

  if (!sid || !token) {
    console.warn('[subscriber-sms] Twilio credentials not configured - skipping')
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
      // 21610 means the carrier has this number as unsubscribed. It is PERMANENT, and
      // treating it as a transient failure is what produced the retry loop. Block it so
      // nothing tries again.
      if (String(data.code) === '21610') {
        const { blockNumber } = await import('@/lib/sms/guard')
        await blockNumber(to, 'twilio_21610_unsubscribed',
          `Twilio refused a ${kind} send with 21610 on ${new Date().toISOString()}.`, 'auto')
      }
      return
    }
    const sent = await res.json().catch(() => ({})) as { sid?: string }
    await recordSmsSend(to, kind, sent.sid ?? null)
  } catch (err) {
    console.error('[subscriber-sms] fetch error:', err instanceof Error ? err.message : String(err))
  }
}

export async function sendSmsResult({
  to,
  body,
  kind = 'subscriber_notification',
}: {
  to:   string
  body: string
  kind?: string
}): Promise<{ success: boolean; error?: string }> {
  // Same guard as sendSubscriberSms. This is the variant batch jobs call for retry
  // logic, which makes it the MORE important of the two to guard: a retrying caller
  // plus an unguarded sender is exactly the shape that sent one number 36 messages.
  const verdict = await checkSmsAllowed(to)
  if (!verdict.allowed) {
    console.error(`[sms-result] REFUSED (${verdict.reason}): ${verdict.detail}`)
    // NOT a retryable failure. A caller that retries on { success: false } must not be
    // able to turn a blocklist hit into a loop, so the error names the refusal.
    return { success: false, error: `refused:${verdict.reason}` }
  }

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
      // 21610 is PERMANENT - the carrier has this number as unsubscribed. Block it so
      // no caller's retry logic can ever present it again. Treating this code as a
      // transient failure is what produced the four sends after a STOP.
      if (String(data.code) === '21610') {
        const { blockNumber } = await import('@/lib/sms/guard')
        await blockNumber(to, 'twilio_21610_unsubscribed',
          `Twilio refused a ${kind} send with 21610 on ${new Date().toISOString()}.`, 'auto')
        return { success: false, error: 'refused:do_not_contact' }
      }
      return { success: false, error: msg }
    }

    const sent = await res.json().catch(() => ({})) as { sid?: string }
    await recordSmsSend(to, kind, sent.sid ?? null)
    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sms-result] fetch error:', msg)
    return { success: false, error: msg }
  }
}
