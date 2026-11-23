// ─── PM due: the ONE rule behind the Intel Hub PM alerts ──────────────────────
//
// Moved out of src/app/hd/intel/page.tsx unchanged (Nov 23, 2026) so the fleet
// manager dashboard reads PM due from the same rule Intel Hub counts its alerts with,
// rather than a second PM engine. Two signals, either one raises the alert:
//
//   HOURS  hd_units.next_pm_due_hours - hd_units.total_hours.
//          <= 0 is overdue, <= 200 is due soon.
//   DATE   hd_units.last_pm_date + 180 days (approximate TK/Carrier interval).
//          past it is overdue, within 30 days is due soon.
//
// Interval data per unit loads later; when it does, it changes the inputs here, not
// the callers.

/** Approximate TK/Carrier PM interval: 180 days. */
export const PM_INTERVAL_DAYS = 180
/** Hours before next_pm_due_hours that count as due soon. */
export const PM_DUE_SOON_HOURS = 200
/** Days before the date interval runs out that count as due soon. */
export const PM_DUE_SOON_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export function getPMDateStatus(lastPmDate: string | null, now: number = Date.now()): 'overdue' | 'due_soon' | null {
  if (!lastPmDate) return null
  const last     = new Date(lastPmDate)
  const nextDue  = new Date(last.getTime() + PM_INTERVAL_DAYS * DAY_MS)
  const daysLeft = Math.floor((nextDue.getTime() - now) / DAY_MS)
  if (daysLeft < 0) return 'overdue'
  if (daysLeft <= PM_DUE_SOON_DAYS) return 'due_soon'
  return null
}

/** The fields the rule reads off an hd_units row. */
export interface PmUnitFields {
  next_pm_due_hours: unknown
  total_hours: unknown
  last_pm_date: unknown
}

export function pmHoursUntil(u: PmUnitFields): number | null {
  return u.next_pm_due_hours !== null && u.next_pm_due_hours !== undefined && u.total_hours !== null && u.total_hours !== undefined
    ? Number(u.next_pm_due_hours) - Number(u.total_hours)
    : null
}

export interface PmDue {
  status: 'overdue' | 'due_soon' | null
  /** Hours left to next_pm_due_hours; negative is past it. Null when either is unknown. */
  hoursUntil: number | null
  /** last_pm_date + PM_INTERVAL_DAYS, as YYYY-MM-DD. Null with no last PM date. */
  nextDueDate: string | null
}

/** The badge Intel Hub shows: PM OVERDUE, PM DUE SOON, or nothing. */
export function pmDueOf(u: PmUnitFields, now: number = Date.now()): PmDue {
  const hoursUntil = pmHoursUntil(u)
  const last = typeof u.last_pm_date === 'string' && u.last_pm_date ? u.last_pm_date : null
  const dateStatus = getPMDateStatus(last, now)
  const overdue = (hoursUntil !== null && hoursUntil <= 0) || dateStatus === 'overdue'
  const dueSoon = !overdue && ((hoursUntil !== null && hoursUntil <= PM_DUE_SOON_HOURS) || dateStatus === 'due_soon')
  const nextDueDate = last ? new Date(new Date(last).getTime() + PM_INTERVAL_DAYS * DAY_MS).toISOString().slice(0, 10) : null
  return { status: overdue ? 'overdue' : dueSoon ? 'due_soon' : null, hoursUntil, nextDueDate }
}

/** True when the unit counts toward the Intel Hub "N PM alerts" figure. */
export function isPmAlert(u: PmUnitFields, now: number = Date.now()): boolean {
  return pmDueOf(u, now).status !== null
}
