// ─── Fleet Pro — registration status, the single source of truth ──────────────
// CLIENT-SAFE. Pure functions, no Supabase, no server imports. The unit page, the
// dashboard unit list and the alerts feed all classify a plate the same way, and
// they only stay in agreement if they all call this file.
//
// Modelled on pmStateFor() in src/types/fleet-pro.ts — same noon-anchored date
// arithmetic, same "state + days" answer — but kept separate because the two
// windows differ (PM warns at 30 days, a plate at 60) and because a missing
// registration is an alarm while a missing PM schedule is merely 'unscheduled'.

export type RegistrationState = 'expired' | 'missing' | 'expiring_soon' | 'current'

/**
 * How far ahead a plate starts warning. Two months, not the PM's one: a renewal
 * goes through a DMV, and thirty days is not always enough to get the sticker back
 * before the current one dies.
 */
export const REGISTRATION_WARN_DAYS = 60

const RED    = '#ef4444'
const YELLOW = '#F59E0B'
const GREEN  = '#22C55E'

/**
 * MISSING IS RED, deliberately. An unknown expiry is not a neutral empty field —
 * a truck whose tag status nobody can prove is exactly as un-dispatchable as one
 * with a dead tag, so the two share a color.
 */
export const REGISTRATION_COLOR: Record<RegistrationState, string> = {
  expired:       RED,
  missing:       RED,
  expiring_soon: YELLOW,
  current:       GREEN,
}

export const REGISTRATION_LABEL: Record<RegistrationState, string> = {
  expired:       'Expired',
  missing:       'Not on file',
  expiring_soon: 'Expiring soon',
  current:       'Current',
}

/** True when this state should show up in the renewal queue / alerts feed. */
export function registrationNeedsAttention(state: RegistrationState): boolean {
  return state !== 'current'
}

/** A date-only value is valid if it is YYYY-MM-DD and a real calendar day. */
function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
}

/**
 * Whole days from `today` to `expiresOn`; negative once the plate has lapsed, null
 * when there is no usable date. Both ends are anchored at noon UTC so a DST shift
 * or a browser in a negative-offset timezone can never move the answer by a day —
 * the same trick pmStateFor and the PM route use.
 */
export function daysUntilExpiration(
  expiresOn: string | null | undefined,
  today: string,
): number | null {
  if (!isIsoDate(expiresOn) || !isIsoDate(today)) return null
  const due = Date.parse(`${expiresOn}T12:00:00Z`)
  const now = Date.parse(`${today}T12:00:00Z`)
  return Math.round((due - now) / 86_400_000)
}

/**
 * The spec, in order:
 *   no row at all, or no expiry on the row -> 'missing'
 *   expiry is in the past                  -> 'expired'
 *   expiry within REGISTRATION_WARN_DAYS   -> 'expiring_soon'
 *   otherwise                              -> 'current'
 *
 * An unparseable date is treated as 'missing' rather than thrown: a malformed value
 * in one row must not blank the whole dashboard, and "we do not know" is the honest
 * classification for a date nobody can read.
 */
export function computeRegistrationState(
  expiresOn: string | null | undefined,
  today: string,
): RegistrationState {
  const days = daysUntilExpiration(expiresOn, today)
  if (days == null) return 'missing'
  if (days < 0) return 'expired'
  if (days <= REGISTRATION_WARN_DAYS) return 'expiring_soon'
  return 'current'
}

/**
 * Human sentence for the same date: "expired 12 days ago", "expires in 43 days".
 * Lower case and unpunctuated so it can sit beside the state pill or inside a
 * larger sentence without reading as a heading.
 */
export function registrationLabel(
  expiresOn: string | null | undefined,
  today: string,
): string {
  const days = daysUntilExpiration(expiresOn, today)
  if (days == null) return 'no expiration date on file'
  if (days === 0) return 'expires today'
  if (days < 0) {
    const n = Math.abs(days)
    return `expired ${n} day${n === 1 ? '' : 's'} ago`
  }
  return `expires in ${days} day${days === 1 ? '' : 's'}`
}

/** State, days and label in one pass, for callers that render all three. */
export function registrationStatus(
  expiresOn: string | null | undefined,
  today: string,
): { state: RegistrationState; daysUntilExpiration: number | null; label: string } {
  return {
    state:               computeRegistrationState(expiresOn, today),
    daysUntilExpiration: daysUntilExpiration(expiresOn, today),
    label:               registrationLabel(expiresOn, today),
  }
}

/** Today as YYYY-MM-DD, matching how every other Fleet Pro surface stamps a day. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
