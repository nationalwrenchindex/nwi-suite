// ─── Fleet Pro — compliance status, the single classifier ────────────────────
// CLIENT-SAFE. Pure functions, no Supabase, no server imports. The calendar page,
// the API route and the nightly alert cron all classify a deadline the same way,
// and they only stay in agreement if they all call this file.
//
// Modelled directly on src/lib/fleet-pro/registration.ts — same noon-anchored date
// arithmetic, same "state + days + label" answer. Where that module answers one
// question about one date, this one answers it for eight kinds of deadline that do
// not share a warning window, so the window is a lookup rather than a constant.
//
// Rather than restate registration.ts's arithmetic, this file IMPORTS it. There is
// one implementation of "how many days until a date" in Fleet Pro and it lives
// there; a second copy would eventually disagree by a day at a DST boundary.

import {
  daysUntilExpiration,
  registrationLabel,
  todayIso,
  REGISTRATION_WARN_DAYS,
} from './registration'

export { daysUntilExpiration, todayIso }

// ─── The colour ladder ───────────────────────────────────────────────────────
// Four states carry a colour, and the two windows are the SAME for every item type:
// orange at 30 days, yellow at 60. What varies per type is only whether an item at
// 60 days is worth an EMAIL (see COMPLIANCE_ALERT_DAYS below) — not what colour it
// is on screen. Keeping the colour ladder uniform is what lets a manager read the
// whole calendar at a glance without learning eight different rules.

/** Within this many days an item turns orange — act now. */
export const CRITICAL_WINDOW_DAYS = 30
/** Within this many days an item turns yellow — get it on the calendar. */
export const WARNING_WINDOW_DAYS = 60

export type ComplianceState =
  | 'expired'    // red    — the date has passed
  | 'missing'    // red    — no date on file at all
  | 'due_soon'   // orange — inside 30 days
  | 'upcoming'   // yellow — inside 60 days
  | 'current'    // green

const RED    = '#ef4444'
const ORANGE = '#F97316'
const YELLOW = '#F59E0B'
const GREEN  = '#22C55E'

/**
 * MISSING IS RED, deliberately, and for the reason registration.ts gives: an unknown
 * expiry is not a neutral empty field. A driver whose medical card date nobody can
 * produce is exactly as un-dispatchable at a roadside inspection as one whose card
 * has lapsed, so the two share a colour. Treating "we never entered it" as green is
 * the single most dangerous thing a compliance calendar can do.
 */
export const COMPLIANCE_COLOR: Record<ComplianceState, string> = {
  expired:  RED,
  missing:  RED,
  due_soon: ORANGE,
  upcoming: YELLOW,
  current:  GREEN,
}

export const COMPLIANCE_STATE_LABEL: Record<ComplianceState, string> = {
  expired:  'Expired',
  missing:  'Not on file',
  due_soon: 'Due soon',
  upcoming: 'Upcoming',
  current:  'Current',
}

/** Sort order for the calendar and the digest — worst first. */
export const COMPLIANCE_STATE_RANK: Record<ComplianceState, number> = {
  expired:  0,
  missing:  1,
  due_soon: 2,
  upcoming: 3,
  current:  4,
}

// ─── What is tracked ─────────────────────────────────────────────────────────

export type ComplianceSubject = 'unit' | 'driver' | 'fleet'

export type ComplianceItemType =
  // per unit
  | 'annual_dot_inspection'
  | 'registration'
  | 'irp'
  // per driver
  | 'cdl'
  | 'medical_card'
  // per fleet (the carrier's own obligations)
  | 'ifta'
  | 'hut_2290'
  | 'insurance'

export const COMPLIANCE_ITEM_TYPES: ComplianceItemType[] = [
  'annual_dot_inspection', 'registration', 'irp',
  'cdl', 'medical_card',
  'ifta', 'hut_2290', 'insurance',
]

export const COMPLIANCE_TYPE_LABEL: Record<ComplianceItemType, string> = {
  annual_dot_inspection: 'Annual DOT Inspection',
  registration:          'Registration / Plate',
  irp:                   'IRP Registration',
  cdl:                   'CDL',
  medical_card:          'Medical Card',
  ifta:                  'IFTA Quarterly Filing',
  hut_2290:              'HUT Form 2290',
  insurance:             'Insurance Certificate',
}

export const COMPLIANCE_TYPE_SUBJECT: Record<ComplianceItemType, ComplianceSubject> = {
  annual_dot_inspection: 'unit',
  registration:          'unit',
  irp:                   'unit',
  cdl:                   'driver',
  medical_card:          'driver',
  ifta:                  'fleet',
  hut_2290:              'fleet',
  insurance:             'fleet',
}

/**
 * How many days ahead each item type is worth an EMAIL. Colour is uniform (30/60);
 * this is only the digest threshold.
 *
 * ── REGISTRATION: 60, NOT THE 30 THE BRIEF ASKED FOR ────────────────────────
 * src/lib/fleet-pro/registration.ts already classifies plate expiry with a 60-day
 * window, the unit page and the dashboard's registration_alert_count already count
 * on that number, and its reasoning holds: a plate renewal goes through a DMV and
 * thirty days is not always enough to get the sticker back before the current one
 * dies. Two surfaces answering "is this plate OK" differently is worse than either
 * answer, so this file imports that constant instead of restating 30 beside it.
 * The 30-day escalation the brief wanted is not lost — the item still turns ORANGE
 * at 30 days on the calendar, the same as everything else. It simply starts being
 * mentioned at 60.
 */
export const COMPLIANCE_ALERT_DAYS: Record<ComplianceItemType, number> = {
  annual_dot_inspection: 30,
  registration:          REGISTRATION_WARN_DAYS,  // 60 — see above
  irp:                   30,
  cdl:                   60,
  medical_card:          60,
  // The carrier filings. IFTA and 2290 are paperwork with a hard federal deadline
  // and no grace, so they get the long lead time.
  ifta:                  30,
  hut_2290:              30,
  insurance:             60,
}

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * The spec, in order:
 *   no date at all, or an unreadable one    -> 'missing'
 *   the date is in the past                 -> 'expired'
 *   within CRITICAL_WINDOW_DAYS (30)        -> 'due_soon'
 *   within WARNING_WINDOW_DAYS (60)         -> 'upcoming'
 *   otherwise                               -> 'current'
 *
 * An unparseable date classifies as 'missing' rather than throwing: one malformed
 * value must not blank the whole calendar, and "we do not know" is the honest answer
 * for a date nobody can read.
 */
export function computeComplianceState(
  expiresOn: string | null | undefined,
  today: string,
): ComplianceState {
  const days = daysUntilExpiration(expiresOn, today)
  if (days == null) return 'missing'
  if (days < 0) return 'expired'
  if (days <= CRITICAL_WINDOW_DAYS) return 'due_soon'
  if (days <= WARNING_WINDOW_DAYS) return 'upcoming'
  return 'current'
}

/**
 * Human sentence for the same date: "expired 12 days ago", "expires in 43 days".
 * Delegated to registrationLabel() — the wording is already right and having two
 * phrasings of the same fact on two Fleet Pro screens reads as a bug.
 */
export function complianceLabel(
  expiresOn: string | null | undefined,
  today: string,
): string {
  return registrationLabel(expiresOn, today)
}

/** True when this state belongs in the attention list rather than the archive. */
export function complianceNeedsAttention(state: ComplianceState): boolean {
  return state !== 'current'
}

/**
 * True when this item should appear in tonight's email/SMS digest. Expired and
 * missing always qualify regardless of type — there is no window in which an
 * already-lapsed medical card is not worth mentioning.
 */
export function complianceNeedsAlert(
  type: ComplianceItemType,
  expiresOn: string | null | undefined,
  today: string,
): boolean {
  const state = computeComplianceState(expiresOn, today)
  if (state === 'expired' || state === 'missing') return true
  const days = daysUntilExpiration(expiresOn, today)
  if (days == null) return true
  return days <= COMPLIANCE_ALERT_DAYS[type]
}

/** State, days, label and colour in one pass, for callers that render all four. */
export function complianceStatus(
  expiresOn: string | null | undefined,
  today: string,
): {
  state:                 ComplianceState
  daysUntilExpiration:   number | null
  label:                 string
  color:                 string
} {
  const state = computeComplianceState(expiresOn, today)
  return {
    state,
    daysUntilExpiration: daysUntilExpiration(expiresOn, today),
    label:               complianceLabel(expiresOn, today),
    color:               COMPLIANCE_COLOR[state],
  }
}

// ─── Date helpers for the recurring items ────────────────────────────────────
// Everything below is pure string arithmetic on YYYY-MM-DD. No Date-object month
// rollover games: adding a year to 2028-02-29 has to land on a real day, and
// `setUTCFullYear` silently produces 2029-03-01 for it.

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function iso(year: number, month: number, day: number): string {
  const d = Math.min(day, daysInMonth(year, month))
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Twelve months on from an ISO date, clamped to a real day. Feb 29 + 1 year is
 * Feb 28, which is what a regulator means by "within 12 months" — not March 1.
 */
export function addMonths(isoDate: string, months: number): string | null {
  if (!isIsoDate(isoDate)) return null
  const [y, m, d] = isoDate.split('-').map(Number)
  const total = (y * 12) + (m - 1) + months
  return iso(Math.floor(total / 12), (total % 12) + 1, d)
}

/**
 * 49 CFR 396.17: a commercial vehicle must be inspected at least once every 12
 * months, so the next one is due twelve months after the last one was performed.
 * Null in, null out — an un-inspected unit has no due date, which the classifier
 * then reports as 'missing' (red), not as 'no problem'.
 */
export const DOT_INSPECTION_INTERVAL_MONTHS = 12

export function annualDotInspectionDue(lastInspectionDate: string | null | undefined): string | null {
  if (!isIsoDate(lastInspectionDate)) return null
  return addMonths(lastInspectionDate, DOT_INSPECTION_INTERVAL_MONTHS)
}

/**
 * IFTA period ends: March 31, June 30, September 30, December 31.
 *
 * ── A DELIBERATE ONE-MONTH-EARLY REMINDER ───────────────────────────────────
 * These are the QUARTER-END dates, which is what the spec for this feature asked
 * for. The statutory IFTA return deadline is the last day of the month AFTER the
 * quarter closes — April 30, July 31, October 31, January 31. The calendar tracks
 * the quarter end anyway, on purpose: it puts the reminder in front of the fleet a
 * month before the money is actually due, and the mileage they need to file it is
 * the mileage from the quarter that just ended. An early reminder costs nothing; a
 * late one costs a penalty. The filing deadline is shown alongside so nobody reads
 * the quarter end as the drop-dead date.
 */
export const IFTA_PERIOD_ENDS: ReadonlyArray<readonly [number, number]> = [
  [3, 31], [6, 30], [9, 30], [12, 31],
]

/**
 * The next IFTA quarter end strictly on or after `today`, skipping any period the
 * fleet has already filed for (`filedThrough` = the period end it filed).
 */
export function nextIftaPeriodEnd(today: string, filedThrough?: string | null): string | null {
  if (!isIsoDate(today)) return null
  const year = Number(today.slice(0, 4))

  // Two years of candidates covers the December-31 wrap without special-casing it.
  const candidates: string[] = []
  for (const y of [year, year + 1]) {
    for (const [m, d] of IFTA_PERIOD_ENDS) candidates.push(iso(y, m, d))
  }

  for (const candidate of candidates) {
    if (candidate < today) continue
    // Already filed for this period (or a later one) — look further out.
    if (isIsoDate(filedThrough) && filedThrough >= candidate) continue
    return candidate
  }
  return null
}

/** "Q2 2026" for a period-end date, for the calendar row and the email. */
export function iftaPeriodLabel(periodEnd: string | null | undefined): string {
  if (!isIsoDate(periodEnd)) return 'IFTA'
  const y = periodEnd.slice(0, 4)
  const m = Number(periodEnd.slice(5, 7))
  const q = Math.ceil(m / 3)
  return `Q${q} ${y}`
}

/** The statutory filing deadline for an IFTA period: last day of the next month. */
export function iftaFilingDeadline(periodEnd: string | null | undefined): string | null {
  if (!isIsoDate(periodEnd)) return null
  const [y, m] = periodEnd.split('-').map(Number)
  const nextMonth = m === 12 ? 1 : m + 1
  const nextYear  = m === 12 ? y + 1 : y
  return iso(nextYear, nextMonth, 31)
}

/**
 * HUT Form 2290 (heavy vehicle use tax) is due August 31 for the tax period that
 * began July 1 of the same year. `filedForYear` is that starting year, so a fleet
 * that filed for 2026 is pointed at August 31, 2027 rather than nagged again.
 *
 * The period boundary is July 1, not January 1: on 2026-07-15 the live obligation
 * is the 2026 period due 2026-08-31, while on 2026-06-15 it is still the 2025
 * period — already past its deadline, which is exactly the red flag a fleet that
 * never filed should be seeing.
 */
export const HUT_2290_DUE_MONTH = 8
export const HUT_2290_DUE_DAY   = 31

export function hut2290TaxPeriodYear(today: string): number | null {
  if (!isIsoDate(today)) return null
  const year  = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  return month >= 7 ? year : year - 1
}

export function nextHut2290Due(today: string, filedForYear?: number | null): string | null {
  const period = hut2290TaxPeriodYear(today)
  if (period == null) return null
  // Filed for the current period already — the next obligation is a year out.
  const year = (typeof filedForYear === 'number' && filedForYear >= period) ? period + 1 : period
  return iso(year, HUT_2290_DUE_MONTH, HUT_2290_DUE_DAY)
}
