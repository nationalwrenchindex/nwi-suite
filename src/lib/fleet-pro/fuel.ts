// Fuel economy: the MPG calculation, the per-unit rolling average, and the rule that
// decides when a fillup is bad enough to put on the manager's dashboard.
//
// Kept out of the route handlers because three callers need the same answer — the
// write path (which stamps mpg onto the row), the dashboard sweep, and the driver
// scorecard — and an MPG that is computed differently in two places is worse than no
// MPG at all.
//
// THE CENTRAL RULE OF THIS FILE: a figure that cannot be computed is null, never a
// zero and never a guess. Zero MPG is a truck that burned fuel and did not move,
// which is a real and different thing from "we do not know yet". The dashboard styles
// those two cases differently and the average must not contain either.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MAX_PLAUSIBLE_MPG,
  MPG_DROP_ALERT_PCT,
  MPG_MIN_SAMPLE,
  roundMpg,
  type FuelAlert,
} from '@/types/fleet-pro-fuel'

/** Ceiling on rows pulled per sweep. PostgREST silently truncates an unbounded select
 *  at its own default, which on a fleet with a year of daily fillups would quietly
 *  drop the oldest history and shift every average. Asked for explicitly so the cap
 *  is a number in this file rather than a surprise in the database's config. */
const FUEL_ROW_CEILING = 20_000

export interface FuelLogRow {
  unit_id:      string
  fuel_date:    string | null
  gallons:      number | string | null
  mpg:          number | string | null
  driver_name:  string | null
}

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Miles per gallon for one fillup, or null when the question cannot be answered.
 *
 * Returns null — rather than throwing or clamping — in every one of these cases, and
 * each is a real situation rather than a defensive flourish:
 *
 *   * no previous odometer  → the unit's first fillup. There is no span.
 *   * gallons missing or 0  → the model could not read the pump and the driver left
 *                             it blank. Dividing by it is undefined.
 *   * odometer went backward → a typo, or the driver read the trip meter. The row is
 *                             still saved with its cost; it just has no MPG.
 *   * result past the ceiling → a mis-keyed odometer that would poison the average.
 *
 * The caller stores null and the fillup still counts for cost. It simply does not
 * vote on fuel economy.
 */
export function computeMpg(
  odometerStart: number | null,
  odometerEnd:   number | null,
  gallons:       number | null,
): { miles: number | null; mpg: number | null } {
  if (odometerStart === null || odometerEnd === null) return { miles: null, mpg: null }
  const miles = odometerEnd - odometerStart
  if (!Number.isFinite(miles) || miles < 0) return { miles: null, mpg: null }

  // Miles are worth keeping even with no gallons — the meter span is real and feeds
  // cost per mile. Only the MPG half is unanswerable.
  const milesRounded = Math.round(miles * 10) / 10
  if (gallons === null || gallons <= 0) return { miles: milesRounded, mpg: null }

  const mpg = roundMpg(miles / gallons)
  if (!Number.isFinite(mpg) || mpg <= 0) return { miles: milesRounded, mpg: null }
  // Past the physical ceiling this is not a fuel economy figure, it is a data-entry
  // error wearing one. Miles are kept; the MPG is refused.
  if (mpg > MAX_PLAUSIBLE_MPG) return { miles: milesRounded, mpg: null }

  return { miles: milesRounded, mpg }
}

/**
 * Mean MPG over prior fillups.
 *
 * A plain mean of per-fillup MPGs, NOT total miles over total gallons. The two differ,
 * and the plain mean is the right one here specifically because this average exists to
 * judge a single fillup: each fillup is one observation of how the truck behaved over
 * one tank, and weighting a 300-mile tank more heavily than a 200-mile one would let a
 * couple of long hauls define "normal" for a truck that mostly runs short.
 *
 * (Fleet-wide cost per mile in cost.ts makes the opposite call — a ratio of sums —
 * because there the question is what the fleet actually spent, not how a typical trip
 * went. Different question, different mean; noted here because the inconsistency looks
 * like a bug until you know why.)
 */
export function rollingAverageMpg(values: number[]): number | null {
  const usable = values.filter(v => Number.isFinite(v) && v > 0)
  if (usable.length === 0) return null
  return roundMpg(usable.reduce((sum, v) => sum + v, 0) / usable.length)
}

/**
 * Is this fillup far enough below the unit's own history to be worth saying so?
 *
 * Compared against the unit's OWN average rather than the fleet's, because a day-cab
 * doing city work and a sleeper running interstate have nothing to say to each other
 * about fuel economy — a fleet-wide comparison would flag every light truck as a
 * problem and never flag a tractor that lost 20%.
 *
 * Requires MPG_MIN_SAMPLE prior readings. Below that the "average" is one or two
 * tanks, and a single bad one becomes the baseline that makes every normal fillup
 * afterwards look like a failure.
 */
export function isMpgDrop(latest: number, average: number, sampleSize: number): boolean {
  if (sampleSize < MPG_MIN_SAMPLE) return false
  if (!Number.isFinite(latest) || !Number.isFinite(average) || average <= 0) return false
  return dropPct(latest, average) > MPG_DROP_ALERT_PCT
}

/** How far below average, as a positive percentage. Negative when the fillup was
 *  BETTER than average, which the caller ignores — nobody needs an alert for a truck
 *  that improved. */
export function dropPct(latest: number, average: number): number {
  if (average <= 0) return 0
  return Math.round(((average - latest) / average) * 1000) / 10
}

/**
 * Sweep a fleet's fuel history and return the units whose most recent fillup came in
 * more than MPG_DROP_ALERT_PCT below their own rolling average.
 *
 * One query for the whole fleet, grouped in memory. The alternative — a query per unit
 * — is 60 round trips on a 60-truck fleet for a panel that is usually empty.
 *
 * Returns [] rather than throwing on a database error: this is one card on a dashboard
 * whose main job is the PM list, and a fleet manager with overdue PMs still needs to
 * see them even if the fuel table is unavailable. The caller logs.
 */
export async function loadMpgAlerts(
  svc:        SupabaseClient,
  fleetId:    string,
  unitIds:    string[],
  unitNumbers: Map<string, string>,
): Promise<FuelAlert[]> {
  if (unitIds.length === 0) return []

  const { data, error } = await svc
    .from('fleet_pro_fuel_log')
    .select('unit_id, fuel_date, gallons, mpg, driver_name')
    .eq('fleet_account_id', fleetId)
    .in('unit_id', unitIds)
    .not('mpg', 'is', null)
    .order('fuel_date', { ascending: false })
    .limit(FUEL_ROW_CEILING)

  if (error) {
    console.error('[fleet-pro/fuel] alert sweep failed:', error.message)
    return []
  }

  // Newest first from the query, so the first row seen per unit is its latest fillup.
  const byUnit = new Map<string, FuelLogRow[]>()
  for (const row of (data ?? []) as FuelLogRow[]) {
    if (!row.unit_id) continue
    const list = byUnit.get(row.unit_id)
    if (list) list.push(row)
    else byUnit.set(row.unit_id, [row])
  }

  const alerts: FuelAlert[] = []

  for (const [unitId, rows] of byUnit) {
    const [latest, ...priorRows] = rows
    const latestMpg = num(latest?.mpg)
    if (latestMpg === null) continue

    // The average excludes the fillup being judged. Including it would drag the
    // baseline toward the very reading under test and shrink every drop it measures.
    const prior = priorRows
      .map(r => num(r.mpg))
      .filter((v): v is number => v !== null && v > 0)

    const average = rollingAverageMpg(prior)
    if (average === null) continue
    if (!isMpgDrop(latestMpg, average, prior.length)) continue

    alerts.push({
      unit_id:     unitId,
      unit_number: unitNumbers.get(unitId) ?? '',
      latest_mpg:  latestMpg,
      average_mpg: average,
      drop_pct:    dropPct(latestMpg, average),
      sample_size: prior.length,
      fuel_date:   (latest?.fuel_date ?? '').slice(0, 10),
      driver_name: latest?.driver_name ?? null,
    })
  }

  // Worst drop first: the manager reads the top of this list and stops.
  alerts.sort((a, b) => b.drop_pct - a.drop_pct || a.unit_number.localeCompare(b.unit_number, 'en', { numeric: true }))

  return alerts
}

/**
 * The most recent odometer this unit has on record, from EITHER meter source.
 *
 * Two tables carry odometers and neither is authoritative on its own:
 * fleet_pro_unit_meter_readings gets one from every pre-trip, and fleet_pro_fuel_log
 * gets one from every fillup. Taking only the meter table would pre-populate the
 * driver's screen with a reading from before the last two fillups and silently
 * compute MPG over a span that already had fuel put into it.
 *
 * Ordered by date and then by created_at, because a unit can legitimately have two
 * readings on the same calendar day — a 5am pre-trip and a 2pm fillup — and the later
 * of the two is the one a driver at the pump should see.
 */
export async function lastKnownOdometer(
  svc:    SupabaseClient,
  unitId: string,
): Promise<number | null> {
  const [meterRes, fuelRes] = await Promise.all([
    svc.from('fleet_pro_unit_meter_readings')
      .select('odometer, reading_date, created_at')
      .eq('unit_id', unitId)
      .not('odometer', 'is', null)
      .order('reading_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),

    svc.from('fleet_pro_fuel_log')
      .select('odometer_end, fuel_date, created_at')
      .eq('unit_id', unitId)
      .not('odometer_end', 'is', null)
      .order('fuel_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const candidates: number[] = []
  const meter = num(meterRes.data?.odometer as number | string | null | undefined)
  const fuel  = num(fuelRes.data?.odometer_end as number | string | null | undefined)
  if (meter !== null) candidates.push(meter)
  if (fuel  !== null) candidates.push(fuel)

  if (candidates.length === 0) return null
  // The HIGHER of the two, not the more recently dated. An odometer only goes
  // forward, so the largest number anyone has recorded is the best floor for the next
  // reading — and it is robust to a row whose date was mistyped.
  return Math.max(...candidates)
}
