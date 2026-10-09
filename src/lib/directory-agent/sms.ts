// Outbound SMS for the directory agents (LD and HD).
//
// Deliberately NOT src/lib/twilio.ts: that sender routes every message through
// the subscriber 10DLC Messaging Service. Directory outreach runs as separate
// campaigns on their own numbers, so this sends with an explicit From — the
// caller supplies which one. Everything else — Basic auth, form encoding, error
// surfacing — mirrors sendSmsResult().

import { LD_FROM_NUMBER } from './config'

// ===========================================================================
// COLD OUTREACH IS PERMANENTLY DISABLED - 2026-10-08
// ===========================================================================
//
// DO NOT RE-ENABLE THIS. It is not paused, it is finished.
//
// WHAT HAPPENED
//
// 32 numbers opted out between 2026-06-30 and 2026-10-04. One received 36 messages
// before it said STOP. Another received 16. One received 8 - and FOUR MORE SENDS WERE
// ATTEMPTED AFTER IT REPLIED STOP. Twilio refused those four with error 21610. This
// code tried anyway, and would have kept trying daily forever.
//
// WHY IT HAPPENED - all four of these are in this file's callers
//
//   1. NO OPT-OUT CHECK ON THE SEND PATH. invite/route.ts selects prospects by
//      status='pending' and sends. Nothing consulted directory_optouts. The opt-out
//      was only ever checked when a reply came IN, never before a message went OUT.
//
//   2. A FAILED SEND LEFT THE ROW PENDING, ON PURPOSE. invite/route.ts: "A prospect is
//      only marked contacted when Twilio accepted the message - a failed send leaves
//      it pending so tomorrow's batch retries it." With a DAILY cron and no attempt
//      counter, that is an unbounded retry loop.
//
//   3. 21610 WAS TREATED AS TRANSIENT. This function returns success:false for every
//      non-2xx, so "the recipient has unsubscribed" was indistinguishable from "the
//      network blipped" - and therefore retried. 21610 is PERMANENT and is the
//      carrier telling us to stop.
//
//   4. NO FREQUENCY CAP. Nothing limited how many times one number could be texted.
//
// The combination is what produced 36 messages to one number: a permanent failure read
// as a transient one, retried once a day, with nothing counting.
//
// WHAT STAYS WORKING
//
// Transactional SMS is untouched - booking confirmations, appointment reminders,
// invoice and quote sends, work-order status updates. Those go to people who gave us
// their number, through src/lib/twilio.ts and src/lib/notifications.ts. This file is
// ONLY the cold outreach sender for the LD and HD directory agents.
//
// This refusal is at the SENDER, not at its six callers, so no existing or future call
// path can get around it by being written somewhere new.
const COLD_OUTREACH_PERMANENTLY_DISABLED = true

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
  // THE KILL. First statement in the function, before credentials, before any network
  // call, and with no environment variable or argument that can turn it back on.
  if (COLD_OUTREACH_PERMANENTLY_DISABLED) {
    console.error(
      `[directory-agent/sms] REFUSED: cold outreach is permanently disabled (2026-10-08). ` +
      `Attempted to ${to.replace(/\d(?=\d{4})/g, '*')} - not sent.`,
    )
    return { success: false, error: 'Cold outreach is permanently disabled.' }
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
