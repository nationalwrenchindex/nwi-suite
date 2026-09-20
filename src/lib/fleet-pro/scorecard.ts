// Driver scorecard math.
//
// Pure functions over rows the route has already loaded — no Supabase client here, so
// the thresholds below can be reasoned about and changed without touching a query.
//
// THE GOVERNING RULE: every function returns `{ available: false, reason }` rather
// than a number it cannot defend. Each of these metrics is about a named person and a
// manager may act on it. A fabricated 0% is worse than a blank, because a blank reads
// as "no data" and a 0% reads as "bad driver".

import type { DriverFuelRow, DriverInspectionRow, Metric } from '@/types/fleet-pro-drivers'

/**
 * Minimum fill-ups before an MPG average means anything.
 *
 * MPG from a single fill-up is not a driver's fuel economy, it is one tank: a partial
 * fill, a headwind, or a load of gravel moves it 20%. Three is the smallest sample
 * where a trend is distinguishable from a bad afternoon, and it is deliberately stated
 * here as a named constant rather than inlined, because the right number is a product
 * judgement somebody will want to revisit.
 */
export const MIN_MPG_SAMPLE = 3

/**
 * Minimum working days elapsed before an inspection rate is shown.
 *
 * On the 2nd of the month the denominator is 1, so one missed morning reads as 0%.
 * Five working days is the first point at which the fraction has enough resolution to
 * be worth showing at all.
 */
export const MIN_WORKING_DAYS = 5

/** YYYY-MM-DD for a Date, in UTC, matching the date handling in compliance.ts. */
function dayOf(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Working days from the 1st of `today`'s month through `today` inclusive, Mon-Fri.
 *
 * WHY WORKING DAYS AND NOT CALENDAR DAYS — and why this is still an approximation.
 * There is no schedule anywhere in this product that says how many pre-trips a driver
 * OWED this month. 49 CFR 396.11 requires a report per driver per vehicle per day
 * OPERATED, and nothing in the schema records which days a driver was rostered to
 * operate. So the true denominator is unknowable from the data we hold.
 *
 * Of the available approximations:
 *   * calendar days — counts weekends the driver was never expected to work, and
 *     caps a perfect record at about 71%. Unusable.
 *   * days the driver DID submit — always 100%, measures nothing.
 *   * Mon-Fri elapsed — wrong for weekend and rotating shifts, but it is the only
 *     one that can show a genuine miss, and it errs toward under-reporting a driver
 *     rather than flattering one.
 *
 * Mon-Fri elapsed is therefore what this uses, and `detail` on the returned Metric
 * says so on screen so the number is never read as an attendance record. The real fix
 * is a driver schedule table; until that exists this is labelled, not hidden.
 */
export function workingDaysElapsed(today: string): number {
  const end = new Date(`${today}T12:00:00Z`)
  if (Number.isNaN(end.getTime())) return 0

  const year  = end.getUTCFullYear()
  const month = end.getUTCMonth()
  let count = 0

  for (let day = 1; day <= end.getUTCDate(); day++) {
    const d   = new Date(Date.UTC(year, month, day, 12))
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

/** First day of `today`'s month, as YYYY-MM-DD. The history queries window on this. */
export function monthStart(today: string): string {
  const d = new Date(`${today}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return today
  return dayOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12)))
}

/** "September 2026", for the caption under the rate. */
export function monthLabel(today: string): string {
  const d = new Date(`${today}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return today
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' })
}

/**
 * Inspection completion rate for the current month, as a percentage 0-100.
 *
 * Numerator is DISTINCT DAYS with at least one pre-trip, not the row count: a driver
 * who inspects three trucks on Monday had one compliant Monday, and counting three
 * would push them over 100% and hide a missed Tuesday.
 */
export function computeInspectionRate(
  inspections: DriverInspectionRow[],
  today:       string,
): Metric {
  const workingDays = workingDaysElapsed(today)
  if (workingDays < MIN_WORKING_DAYS) {
    return {
      available: false,
      reason:    `Only ${workingDays} working day${workingDays === 1 ? '' : 's'} into the month — not enough to rate.`,
    }
  }

  const start = monthStart(today)
  const days  = new Set<string>()
  for (const row of inspections) {
    if (row.inspection_date >= start && row.inspection_date <= today) days.add(row.inspection_date)
  }

  // Clamped: a driver who filed on a Saturday can exceed the Mon-Fri denominator, and
  // "112%" would advertise the approximation as a bug.
  const pct = Math.min(100, Math.round((days.size / workingDays) * 100))

  return {
    available: true,
    value:     pct,
    detail:    `${days.size} of ${workingDays} working days · Mon-Fri elapsed, not a roster`,
  }
}

/**
 * This driver's average MPG, with the fleet comparison in `detail`.
 *
 * RATIO OF SUMS, not the mean of per-row MPG — the same call src/lib/fleet-pro/cost.ts
 * makes for fleet cost per mile, and for the same reason: averaging ratios lets a
 * 40-mile splash-and-dash swing the number as hard as a 600-mile run.
 */
export function computeAvgMpg(
  driverRows: DriverFuelRow[],
  fleetRows:  DriverFuelRow[],
): Metric {
  const usable = driverRows.filter(r => (r.gallons ?? 0) > 0 && (r.miles_driven ?? 0) > 0)

  if (usable.length < MIN_MPG_SAMPLE) {
    return {
      available: false,
      reason:    `${usable.length} of ${MIN_MPG_SAMPLE} fill-ups needed before an average means anything.`,
    }
  }

  const miles   = usable.reduce((sum, r) => sum + (r.miles_driven ?? 0), 0)
  const gallons = usable.reduce((sum, r) => sum + (r.gallons ?? 0), 0)
  if (gallons <= 0) {
    return { available: false, reason: 'No gallons recorded on this driver’s fill-ups.' }
  }

  const mpg = miles / gallons

  // The fleet baseline gets the same minimum. Without it, one other driver with one
  // fill-up becomes "the fleet average" and this driver is ranked against a single tank.
  const fleetUsable = fleetRows.filter(r => (r.gallons ?? 0) > 0 && (r.miles_driven ?? 0) > 0)
  let detail: string | null = 'No fleet baseline yet — not enough fill-ups across the roster.'

  if (fleetUsable.length >= MIN_MPG_SAMPLE) {
    const fleetMiles   = fleetUsable.reduce((sum, r) => sum + (r.miles_driven ?? 0), 0)
    const fleetGallons = fleetUsable.reduce((sum, r) => sum + (r.gallons ?? 0), 0)
    if (fleetGallons > 0) {
      const fleetMpg = fleetMiles / fleetGallons
      const delta    = mpg - fleetMpg
      const pct      = fleetMpg > 0 ? (delta / fleetMpg) * 100 : 0
      const sign     = delta >= 0 ? '+' : '−'
      detail = `Fleet average ${fleetMpg.toFixed(1)} MPG · ${sign}${Math.abs(pct).toFixed(0)}%`
    }
  }

  return { available: true, value: Number(mpg.toFixed(1)), detail }
}
