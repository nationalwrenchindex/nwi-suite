// The block that every outbound SMS passes through.
//
// ===========================================================================
// THIS IS NOT THE CALLER'S JOB. It is enforced here, in the send path.
// ===========================================================================
//
// WHY IT EXISTS
//
// 32 numbers opted out of the directory outreach programme between 2026-06-30 and
// 2026-10-04. One received 36 messages before replying STOP. One received 8 and then
// had FOUR MORE SENDS ATTEMPTED AFTER its STOP; Twilio refused them with error 21610.
//
// The opt-outs were recorded the whole time, in directory_optouts and
// hd_directory_optouts. NOTHING ON THE SEND PATH EVER READ THEM. The check lived only
// in the inbound reply handler, which is the one place it cannot prevent anything.
//
// So the check moved to where the send happens, and every sender in the codebase calls
// it. A caller cannot opt out of the guard; it can only fail to be a caller, which is
// what the audit at the bottom of this file is for.
//
// FAIL CLOSED
//
// If do_not_contact cannot be read - table missing, database unreachable, RLS
// misconfigured - this REFUSES THE SEND. A guard that lets messages through when it
// cannot see the blocklist is not a guard, it is a comment. The cost of failing closed
// is a delayed booking confirmation. The cost of failing open is texting someone who
// told us to stop.

import { createServiceClient } from '@/lib/supabase/service'

/** Keywords that mean "never contact me again", per the carriers and the brief. */
export const OPT_OUT_KEYWORDS = [
  'stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit',
  'optout', 'opt out', 'opt-out', 'revoke',
  'no soliciting', 'do not solicit', 'no sales calls',
] as const

/** Twilio error codes that mean the recipient is unsubscribed at the carrier. */
export const CARRIER_OPT_OUT_CODES = ['21610'] as const

/**
 * Per-number frequency cap.
 *
 * The 36-message number was reached one text at a time by a daily cron with nothing
 * counting. A cap is the thing that would have stopped it at 3 regardless of which
 * code path was doing the sending or why it thought it should.
 *
 * Transactional messages legitimately come in bursts - a booking confirmation and then
 * a reminder - so the window is generous. It exists to catch a LOOP, not to ration
 * normal use.
 */
export const FREQUENCY_CAP = {
  maxPerNumberPerDay: 5,
  maxPerNumberPerWeek: 12,
} as const

export type SmsRefusal =
  | { allowed: true }
  | { allowed: false; reason: 'do_not_contact'; detail: string }
  | { allowed: false; reason: 'frequency_cap'; detail: string }
  | { allowed: false; reason: 'guard_unavailable'; detail: string }
  | { allowed: false; reason: 'invalid_number'; detail: string }

/** E.164, the only form anything here accepts. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  const e164 = digits.length === 10 ? `+1${digits}`
    : digits.startsWith('1') && digits.length === 11 ? `+${digits}`
    : `+${digits}`
  return /^\+[1-9]\d{9,14}$/.test(e164) ? e164 : null
}

/** Does this inbound message body mean "stop"? */
export function isOptOutMessage(body: string): boolean {
  // Strip the instruction footer first. "yes Reply STOP to opt out." is a YES; the
  // app's old matcher read it as an opt-out and suppressed a prospect who agreed.
  const normalized = body.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (/configure your number s sms url|reply help for help/.test(normalized)) return false
  const stripped = normalized
    .replace(/\b(reply|text|send|type)\s+\w+\s+to\s+(opt\s*out|unsubscribe|cancel|stop|end|quit)\b/g, ' ')
    .replace(/\b(reply|text|send|type)\s+(stop|stopall|unsubscribe|quit|cancel|end|help)\b/g, ' ')
    .replace(/\bto\s+(opt\s*out|unsubscribe)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return OPT_OUT_KEYWORDS.some(k =>
    stripped === k || stripped.startsWith(`${k} `) || stripped.endsWith(` ${k}`) || stripped.includes(` ${k} `))
}

/**
 * MAY WE TEXT THIS NUMBER?
 *
 * Called by every sender before every send. Returns a refusal, never throws, and never
 * returns `allowed: true` on an error path.
 */
export async function checkSmsAllowed(
  to: string,
  opts: { skipFrequencyCap?: boolean } = {},
): Promise<SmsRefusal> {
  const phone = toE164(to)
  if (!phone) {
    return { allowed: false, reason: 'invalid_number', detail: `Not a valid phone number: ${to}` }
  }

  let supabase: ReturnType<typeof createServiceClient>
  try {
    supabase = createServiceClient()
  } catch (err: unknown) {
    return {
      allowed: false,
      reason: 'guard_unavailable',
      detail: `Could not reach the blocklist: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  // 1. The blocklist.
  const { data: blocked, error } = await supabase
    .from('do_not_contact')
    .select('phone, opted_out_at, reason')
    .eq('phone', phone)
    .maybeSingle()

  if (error) {
    // FAIL CLOSED. This includes the window where migration 150 has not been applied
    // yet - code deploys independently of migrations here, and during that window the
    // correct behaviour is to send nothing rather than to send unguarded.
    console.error('[sms/guard] blocklist unreadable, REFUSING SEND:', error.message)
    return {
      allowed: false,
      reason: 'guard_unavailable',
      detail: `do_not_contact could not be read (${error.code ?? 'unknown'}). Refusing to send unguarded.`,
    }
  }

  if (blocked) {
    return {
      allowed: false,
      reason: 'do_not_contact',
      detail: `${phone} opted out on ${String(blocked.opted_out_at).slice(0, 10)} (${blocked.reason}).`,
    }
  }

  // 2. The frequency cap.
  if (opts.skipFrequencyCap) return { allowed: true }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: recent, error: logErr } = await supabase
    .from('sms_send_log')
    .select('sent_at')
    .eq('phone', phone)
    .gte('sent_at', weekAgo)

  if (logErr) {
    // The log is for the CAP, not for the blocklist. A missing log table must not stop
    // a booking confirmation - the blocklist above already answered the question that
    // matters, and it answered it from a table that exists. Logged and allowed.
    console.warn('[sms/guard] sms_send_log unreadable, frequency cap not enforced:', logErr.message)
    return { allowed: true }
  }

  const sends = recent ?? []
  const inDay = sends.filter(r => String(r.sent_at) >= dayAgo).length
  if (inDay >= FREQUENCY_CAP.maxPerNumberPerDay) {
    return {
      allowed: false,
      reason: 'frequency_cap',
      detail: `${phone} has had ${inDay} messages in 24h (cap ${FREQUENCY_CAP.maxPerNumberPerDay}).`,
    }
  }
  if (sends.length >= FREQUENCY_CAP.maxPerNumberPerWeek) {
    return {
      allowed: false,
      reason: 'frequency_cap',
      detail: `${phone} has had ${sends.length} messages in 7 days (cap ${FREQUENCY_CAP.maxPerNumberPerWeek}).`,
    }
  }

  return { allowed: true }
}

/**
 * Record a send, so the frequency cap can count.
 *
 * Best effort: a failure here must not fail a message that already went out. The
 * consequence of a lost log line is a slightly loose cap, not an unguarded send.
 */
export async function recordSmsSend(
  to: string,
  kind: string,
  twilioSid?: string | null,
): Promise<void> {
  const phone = toE164(to)
  if (!phone) return
  try {
    const supabase = createServiceClient()
    await supabase.from('sms_send_log').insert({ phone, kind, twilio_sid: twilioSid ?? null })
  } catch (err: unknown) {
    console.warn('[sms/guard] could not log send:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Add a number to the blocklist. The ONLY way the application should ever block one.
 *
 * There is deliberately no corresponding unblock function. Removing someone from the
 * blocklist means texting a person who asked us not to, and that decision is made by a
 * human reading the evidence column, in SQL, not by code.
 */
export async function blockNumber(
  to: string,
  reason: string,
  evidence: string,
  blockedBy = 'system',
): Promise<boolean> {
  const phone = toE164(to)
  if (!phone) return false
  try {
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('do_not_contact')
      .upsert({ phone, reason, evidence, blocked_by: blockedBy }, { onConflict: 'phone', ignoreDuplicates: true })
    if (error) {
      console.error('[sms/guard] FAILED TO BLOCK', phone, error.message)
      return false
    }
    return true
  } catch (err: unknown) {
    console.error('[sms/guard] FAILED TO BLOCK', phone, err instanceof Error ? err.message : String(err))
    return false
  }
}
