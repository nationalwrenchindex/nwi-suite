// ─── Fleet Pro — the one PM status calculator ─────────────────────────────────
//
// WHY THIS FILE EXISTS: Fleet Pro used to derive PM state from
// `fleet_pro_pm_schedules.next_due_date` alone. That table is date-based, it was
// added late (migration 105) and it is empty, so every unit rendered
// "Unscheduled" even though the fleet had real PM data all along.
//
// The real PM data lives on `hd_units` and it is HOURS-based — `total_hours`
// against `next_pm_due_hours`, which is what the mechanic's own HD pages have
// always read. There is no `hd_pm_schedules` table; /hd/pm-schedules reads
// hd_units directly.
//
// Both sources are legitimate, so both are honored here, in one place, so the
// fleet dashboard, the partner dashboard, the partner account drill-down and the
// unit detail page can never disagree about whether a truck is overdue.

import type { PmState } from '@/types/fleet-pro'

export type PmSource = 'hours' | 'date' | 'none'

export interface PmStatus {
  state:           PmState
  source:          PmSource
  next_due_date:   string | null
  next_due_hours:  number | null
  hours_remaining: number | null   // negative when overdue
  days_until_due:  number | null   // negative when overdue
  last_pm_date:    string | null
  last_pm_type:    string | null
  label:           string          // "445 hrs remaining" / "1,233 hrs overdue"
}

/** The hd_units columns this calculator reads. Select these alongside your own. */
export const PM_UNIT_COLUMNS = 'total_hours, next_pm_due_hours, last_pm_date, last_pm_type'

/** hd_units, as much of it as PM cares about. Numerics arrive as strings from PostgREST. */
export interface PmUnitInput {
  total_hours?:       number | string | null
  next_pm_due_hours?: number | string | null
  last_pm_date?:      string | null
  last_pm_type?:      string | null
}

/** fleet_pro_pm_schedules, the date-based override a fleet manager sets by hand. */
export interface PmScheduleInput {
  next_due_date?:     string | null
  last_service_date?: string | null
  interval_days?:     number | string | null
}

// DUE-SOON THRESHOLD, HOURS. The existing HD pages disagree: /hd/dashboard's
// "needs PM" tile and /hd/fleet-units' badge use 150, while /hd/pm-schedules,
// /hd/intel (both the list and the drill-down) and /hd/dashboard's own PM alert
// card use 200. 200 wins here because it is the majority convention, it is the
// one used by the pages a fleet customer is most likely to have been shown, and
// erring wide only means a truck turns orange sooner — the failure mode of a
// narrow window is a PM that goes red with no warning.
export const PM_DUE_SOON_HOURS = 200

// DUE-SOON THRESHOLD, DAYS. Matches pmStateFor() in @/types/fleet-pro and the
// "Within 30 days" copy on the fleet dashboard KPI tile.
export const PM_DUE_SOON_DAYS = 30

function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** timestamptz or date -> YYYY-MM-DD. */
function dayOf(value: unknown): string | null {
  if (!value) return null
  const s = String(value)
  return s.length >= 10 ? s.slice(0, 10) : null
}

function hrs(n: number): string {
  return Math.round(Math.abs(n)).toLocaleString('en-US')
}

/** Whole days between two YYYY-MM-DD strings. Midday pins it clear of DST. */
function daysBetween(due: string, today: string): number | null {
  const a = Date.parse(`${due}T12:00:00Z`)
  const b = Date.parse(`${today}T12:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((a - b) / 86_400_000)
}

function dayLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${days === -1 ? '' : 's'} overdue`
  if (days === 0) return 'Due today'
  return `Due in ${days} day${days === 1 ? '' : 's'}`
}

/**
 * Resolve one unit's PM standing.
 *
 * ── THE BUG THIS WAS CHANGED TO FIX ─────────────────────────────────────────
 *
 * It used to RETURN EARLY from each branch: a manager-set date won outright, and
 * otherwise only the hours were considered. Since fleet_pro_pm_schedules is
 * empty, that meant PM was effectively HOURS-ONLY — so a unit last serviced in
 * August 2024 reported 'scheduled' and rendered green, because its hours were in
 * range and nothing ever looked at the calendar.
 *
 * DUE IS WHICHEVER COMES FIRST. Both clocks are evaluated and the WORSE state
 * wins. A unit that has aged out is overdue even if it has barely run.
 *
 * ── WHERE THE DATE CLOCK COMES FROM ─────────────────────────────────────────
 *
 *   1. fleet_pro_pm_schedules.next_due_date — a manager sat down and set it.
 *   2. Otherwise last_service_date + interval_days from that same row.
 *   3. Otherwise hd_units.last_pm_date + interval_days, so a unit with real PM
 *      history on the HD side gets a calendar reading even with no schedule row.
 *
 * With no interval_days anywhere there is no date clock, and the hours decide —
 * which is the old behaviour, correctly scoped to the case where it is all the
 * data there is.
 *
 * A unit carrying next_pm_due_hours must NEVER come back 'unscheduled'.
 */
export function computePmStatus(
  unit:     PmUnitInput | null | undefined,
  schedule: PmScheduleInput | null | undefined,
  today:    string,
): PmStatus {
  const lastPmDate = dayOf(unit?.last_pm_date) ?? dayOf(schedule?.last_service_date)
  const lastPmType = unit?.last_pm_type ?? null

  const base = {
    next_due_date:   null as string | null,
    next_due_hours:  null as number | null,
    hours_remaining: null as number | null,
    days_until_due:  null as number | null,
    last_pm_date:    lastPmDate,
    last_pm_type:    lastPmType,
  }

  // ── The date clock ──────────────────────────────────────────────────────────
  const intervalDays = toNum(schedule?.interval_days)
  let nextDueDate = dayOf(schedule?.next_due_date)
  if (!nextDueDate && intervalDays !== null && intervalDays > 0 && lastPmDate) {
    const from = Date.parse(`${lastPmDate}T12:00:00Z`)
    if (!Number.isNaN(from)) {
      nextDueDate = new Date(from + intervalDays * 86_400_000).toISOString().slice(0, 10)
    }
  }
  const days = nextDueDate ? daysBetween(nextDueDate, today) : null
  const dateState: PmState | null = days === null ? null
    : days < 0                   ? 'overdue'
    : days <= PM_DUE_SOON_DAYS   ? 'due_soon'
    : 'scheduled'

  // ── The hours clock ─────────────────────────────────────────────────────────
  const dueHours = toNum(unit?.next_pm_due_hours)
  // A unit with a due-hours target but no meter reading yet has run zero hours,
  // not unknown hours — the PM is still scheduled, just a long way off.
  const remaining = dueHours === null ? null : dueHours - (toNum(unit?.total_hours) ?? 0)
  const hoursState: PmState | null = remaining === null ? null
    : remaining <= 0                   ? 'overdue'
    : remaining <= PM_DUE_SOON_HOURS   ? 'due_soon'
    : 'scheduled'

  // ── Nothing to go on ────────────────────────────────────────────────────────
  if (dateState === null && hoursState === null) {
    return { ...base, state: 'unscheduled', source: 'none', label: 'No PM scheduled' }
  }

  // ── Whichever comes first ───────────────────────────────────────────────────
  const RANK: Record<PmState, number> = { unscheduled: 0, scheduled: 1, due_soon: 2, overdue: 3 }
  const states: PmState[] = []
  if (dateState  !== null) states.push(dateState)
  if (hoursState !== null) states.push(hoursState)
  const state = states.sort((a, b) => RANK[b] - RANK[a])[0]

  // WHICH clock decided, so the label can say so. "1,233 hrs overdue" and "412
  // days overdue by date" tell a tech two different things, and before this change
  // the second one was never shown at all.
  const byDate  = dateState  === state
  const byHours = hoursState === state
  const source: PmSource = byDate && byHours ? 'date' : byDate ? 'date' : 'hours'

  const hoursLabel = remaining === null ? null
    : remaining <= 0 ? `${hrs(remaining)} hrs overdue` : `${hrs(remaining)} hrs remaining`
  const dateLabel = days === null ? null : dayLabel(days)

  // When both clocks are in the same state, both are named — a tech reading
  // "412 days overdue · 1,233 hrs overdue" has no argument left to have.
  const label = byDate && byHours && dateLabel && hoursLabel
    ? `${dateLabel} · ${hoursLabel}`
    : byDate ? (dateLabel ?? hoursLabel ?? 'No PM scheduled')
             : (hoursLabel ?? dateLabel ?? 'No PM scheduled')

  return {
    ...base,
    state,
    source,
    next_due_date:   nextDueDate,
    next_due_hours:  dueHours,
    hours_remaining: remaining,
    days_until_due:  days,
    label,
  }
}
