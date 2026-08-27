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
 * Resolution order:
 *   1. An explicit fleet_pro_pm_schedules row with a next_due_date wins — a fleet
 *      manager sat down and set that date, and an override that loses to a derived
 *      figure is not an override.
 *   2. Otherwise hd_units.next_pm_due_hours, the meter-based figure the shop
 *      actually maintains.
 *   3. Only when neither exists is the unit genuinely unscheduled.
 *
 * A unit carrying next_pm_due_hours must NEVER come back 'unscheduled' — that was
 * the bug this file was written to kill.
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

  // ── 1. Manager-set calendar date ────────────────────────────────────────────
  const nextDueDate = dayOf(schedule?.next_due_date)
  if (nextDueDate) {
    const days = daysBetween(nextDueDate, today)
    if (days !== null) {
      const state: PmState =
        days < 0                   ? 'overdue'
        : days <= PM_DUE_SOON_DAYS ? 'due_soon'
        : 'scheduled'

      return {
        ...base,
        state,
        source:         'date',
        next_due_date:  nextDueDate,
        days_until_due: days,
        label:          dayLabel(days),
      }
    }
  }

  // ── 2. Meter hours off hd_units ─────────────────────────────────────────────
  const dueHours = toNum(unit?.next_pm_due_hours)
  if (dueHours !== null) {
    // A unit with a due-hours target but no meter reading yet has run zero hours,
    // not unknown hours — the PM is still scheduled, just a long way off.
    const totalHours = toNum(unit?.total_hours) ?? 0
    const remaining  = dueHours - totalHours

    const state: PmState =
      remaining <= 0                    ? 'overdue'
      : remaining <= PM_DUE_SOON_HOURS  ? 'due_soon'
      : 'scheduled'

    return {
      ...base,
      state,
      source:          'hours',
      next_due_hours:  dueHours,
      hours_remaining: remaining,
      label:           remaining <= 0
                         ? `${hrs(remaining)} hrs overdue`
                         : `${hrs(remaining)} hrs remaining`,
    }
  }

  // ── 3. Nothing to go on ─────────────────────────────────────────────────────
  return { ...base, state: 'unscheduled', source: 'none', label: 'No PM scheduled' }
}
