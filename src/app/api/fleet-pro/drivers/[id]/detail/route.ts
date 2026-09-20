// GET /api/fleet-pro/drivers/[id]/detail
//
// Everything the driver detail page renders, in one round trip: the driver row, their
// pre-trip history, their fuel history, their incident log and the computed scorecard.
//
// A nested route rather than a branch inside ../route.ts, because that file is the
// roster's PATCH/DELETE surface and Next type-checks a route file's whole export
// surface — a GET added there would also have to answer for the manager-only gate
// those two handlers share, which this one deliberately does not have.
//
// AUTHORITY. The page component only checks that the caller has a live membership;
// this route is what checks that THIS DRIVER belongs to THEIR fleet. Every query is
// double-scoped — the id from the URL and the fleet id from the resolved membership —
// so a driver id from another department reads as 404, never as somebody else's data.
//
// DEGRADES BY DESIGN. Migrations 133 (fuel log, and driver_id on pre-trips) and 134
// (incidents) are applied BY HAND by the operator and will not both be live the moment
// this deploys. Every query below that depends on them is wrapped so a missing table
// or a missing column turns into an empty panel with an explanation, not a 500 on the
// whole page. See `missingRelation`.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { canEditUnits } from '@/types/fleet-pro'
import {
  computeAvgMpg,
  computeInspectionRate,
  monthLabel,
} from '@/lib/fleet-pro/scorecard'
import type {
  DriverDetailPayload,
  DriverFuelRow,
  DriverIncident,
  DriverInspectionRow,
  IncidentType,
} from '@/types/fleet-pro-drivers'
import { DRIVER_COLUMNS, toDriver, type DriverRow } from '../../shared'

export const dynamic = 'force-dynamic'

// Explicit caps on every list. PostgREST silently truncates at 1000 with no error, so
// an unbounded select here would quietly become "the first 1000 rows" and the MPG
// average computed from it would be wrong in a way nothing surfaces. These are the
// page's display limits, chosen deliberately and stated to the user in the UI.
const INSPECTION_LIMIT = 200
const FUEL_LIMIT       = 200
const INCIDENT_LIMIT   = 200
// The fleet MPG baseline samples wider than one driver but still bounded.
const FLEET_FUEL_LIMIT = 1000

/**
 * True when a PostgREST error means "this relation or column is not there yet"
 * rather than "the query is wrong".
 *
 *   42P01  undefined_table       — migration not applied
 *   42703  undefined_column      — driver_id before 133
 *   PGRST205 / PGRST204          — schema cache has no such table / column
 *
 * Matched on code first and message second: the codes are stable, the prose is not.
 */
function missingRelation(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false
  const code = error.code ?? ''
  if (['42P01', '42703', 'PGRST205', 'PGRST204'].includes(code)) return true
  const msg = (error.message ?? '').toLowerCase()
  return msg.includes('does not exist') || msg.includes('could not find')
}

/** Normalized name key for the legacy fallback match. Lowercased, whitespace
 *  collapsed — the least-bad join available for rows written before 133. */
function nameKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function dayOf(value: unknown): string | null {
  if (!value) return null
  const s = String(value)
  return s.length >= 10 ? s.slice(0, 10) : null
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProMember(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership } = gate

  const svc = createServiceClient()

  // ── 1. The driver, scoped to the caller's fleet ─────────────────────────────
  const { data: driverRow, error: driverErr } = await svc
    .from('fleet_pro_drivers')
    .select(DRIVER_COLUMNS)
    .eq('id', id)
    .eq('fleet_account_id', membership.fleet_account_id)
    .maybeSingle()

  if (driverErr) {
    console.error('[fleet-pro/drivers/detail] driver load failed:', driverErr.message)
    return NextResponse.json({ error: driverErr.message }, { status: 500 })
  }
  if (!driverRow) return NextResponse.json({ error: 'Driver not found' }, { status: 404 })

  const driver = toDriver(driverRow as DriverRow, membership.role)
  const key    = nameKey(driver.full_name)

  // ── 2. Pre-trip inspections ─────────────────────────────────────────────────
  // Two passes, because one query cannot express it. Rows written after 133 carry
  // driver_id; every row written before it has driver_id NULL and can only be reached
  // by name. An .or() across both would still miss nothing, but it would also give no
  // way to tell the two apart — and the UI has to mark the fuzzy ones.
  let inspections: DriverInspectionRow[] = []
  let inspectionsByName = false

  const byId = await svc
    .from('fleet_pro_pretrip_inspections')
    .select('id, unit_id, inspection_date, overall_result, defects, odometer')
    .eq('fleet_account_id', membership.fleet_account_id)
    .eq('driver_id', id)
    .order('inspection_date', { ascending: false })
    .limit(INSPECTION_LIMIT)

  const driverIdColumnExists = !missingRelation(byId.error)

  if (byId.error && driverIdColumnExists) {
    console.error('[fleet-pro/drivers/detail] inspections by id failed:', byId.error.message)
  }

  const idRows = (byId.data ?? []) as Record<string, unknown>[]

  // Name pass. Runs whether or not 133 is applied: before it, this is the only source;
  // after it, it still catches the backlog, which is never backfilled.
  //
  // Filtered SERVER-side with ilike rather than pulled fleet-wide and matched in
  // memory. The in-memory version silently lost rows: it could only afford to fetch a
  // bounded slice of the whole fleet's inspections, so on any fleet busier than that
  // slice a driver's own history would just be absent with nothing to indicate it.
  // ilike is a case-insensitive exact match, which covers the realistic drift ("mike
  // alvarez" vs "Mike Alvarez"); interior whitespace differences are the one case it
  // still misses, and those rows are why the banner exists.
  const byName = key === ''
    ? { data: [] as Record<string, unknown>[], error: null }
    : await svc
        .from('fleet_pro_pretrip_inspections')
        .select('id, unit_id, inspection_date, overall_result, defects, odometer, driver_name')
        .eq('fleet_account_id', membership.fleet_account_id)
        .ilike('driver_name', driver.full_name.trim())
        .order('inspection_date', { ascending: false })
        .limit(INSPECTION_LIMIT)

  if (byName.error) {
    console.error('[fleet-pro/drivers/detail] inspections by name failed:', byName.error.message)
  }

  const seen = new Set(idRows.map(r => String(r.id)))
  // nameKey() re-checked in memory even though ilike already matched: ilike treats _
  // and % in the stored value as wildcards, so a driver literally named "A_B" could
  // otherwise drag in rows belonging to "AxB".
  const nameRows = ((byName.data ?? []) as Record<string, unknown>[])
    .filter(r => !seen.has(String(r.id)) && nameKey(r.driver_name as string | null) === key)

  inspectionsByName = nameRows.length > 0

  inspections = [...idRows.map(r => ({ row: r, matched: true })), ...nameRows.map(r => ({ row: r, matched: false }))]
    .map(({ row, matched }) => ({
      id:              String(row.id),
      unit_id:         String(row.unit_id),
      unit_number:     null as string | null,
      inspection_date: dayOf(row.inspection_date) ?? '',
      overall_result:  (row.overall_result as string | null) ?? 'pass',
      defect_count:    Array.isArray(row.defects) ? row.defects.length : 0,
      odometer:        num(row.odometer),
      matched_by_id:   matched,
    }))
    .sort((a, b) => b.inspection_date.localeCompare(a.inspection_date))
    .slice(0, INSPECTION_LIMIT)

  // ── 3. Fuel log (migration 133, Agent 1) ────────────────────────────────────
  const FUEL_COLUMNS = 'id, unit_id, fuel_date, gallons, total_cost, price_per_gallon, miles_driven, mpg, driver_id, driver_name'

  function toFuelRow(row: Record<string, unknown>, matchedById: boolean): DriverFuelRow {
    return {
      id:               String(row.id),
      unit_id:          String(row.unit_id),
      unit_number:      null,
      fuel_date:        dayOf(row.fuel_date) ?? '',
      gallons:          num(row.gallons),
      total_cost:       num(row.total_cost),
      price_per_gallon: num(row.price_per_gallon),
      miles_driven:     num(row.miles_driven),
      mpg:              num(row.mpg),
      matched_by_id:    matchedById,
    }
  }

  // TWO queries, not one fleet-wide read split in memory, because the two have
  // different accuracy requirements. This driver's own list must be COMPLETE — it is
  // the history a manager reads — so it is filtered server-side. The fleet baseline
  // only has to be REPRESENTATIVE, so it is a bounded recent sample and says so.
  const mineRes = await svc
    .from('fleet_pro_fuel_log')
    .select(FUEL_COLUMNS)
    .eq('fleet_account_id', membership.fleet_account_id)
    .eq('driver_id', id)
    .order('fuel_date', { ascending: false })
    .limit(FUEL_LIMIT)

  const fuelLogAvailable = !missingRelation(mineRes.error)
  if (mineRes.error && fuelLogAvailable) {
    console.error('[fleet-pro/drivers/detail] fuel load failed:', mineRes.error.message)
  }

  const mineRows = ((mineRes.data ?? []) as Record<string, unknown>[]).map(r => toFuelRow(r, true))

  // Legacy arm, same shape as the inspection one: rows written before the roster
  // picker existed carry a typed name and no driver_id.
  const mineByNameRes = !fuelLogAvailable || key === ''
    ? { data: [] as Record<string, unknown>[], error: null }
    : await svc
        .from('fleet_pro_fuel_log')
        .select(FUEL_COLUMNS)
        .eq('fleet_account_id', membership.fleet_account_id)
        .is('driver_id', null)
        .ilike('driver_name', driver.full_name.trim())
        .order('fuel_date', { ascending: false })
        .limit(FUEL_LIMIT)

  const mineByName = ((mineByNameRes.data ?? []) as Record<string, unknown>[])
    .filter(r => nameKey(r.driver_name as string | null) === key)
    .map(r => toFuelRow(r, false))

  const fuel = [...mineRows, ...mineByName]
    .sort((a, b) => b.fuel_date.localeCompare(a.fuel_date))
    .slice(0, FUEL_LIMIT)

  const fuelByName = mineByName.length > 0

  // The baseline. Bounded sample of recent fill-ups across the roster — computeAvgMpg
  // applies its own minimum before it will compare anything against this.
  const fleetRes = fuelLogAvailable
    ? await svc
        .from('fleet_pro_fuel_log')
        .select('id, unit_id, fuel_date, gallons, total_cost, price_per_gallon, miles_driven, mpg')
        .eq('fleet_account_id', membership.fleet_account_id)
        .order('fuel_date', { ascending: false })
        .limit(FLEET_FUEL_LIMIT)
    : { data: [] as Record<string, unknown>[], error: null }

  const fleetFuel = ((fleetRes.data ?? []) as Record<string, unknown>[]).map(r => toFuelRow(r, false))

  // ── 4. Incident log (migration 134) ─────────────────────────────────────────
  const incidentRes = await svc
    .from('fleet_pro_driver_incidents')
    .select('id, driver_id, incident_date, incident_type, description, resolved, resolution_notes, created_at, updated_at')
    .eq('driver_id', id)
    .eq('fleet_account_id', membership.fleet_account_id)
    .order('incident_date', { ascending: false })
    .limit(INCIDENT_LIMIT)

  if (incidentRes.error && !missingRelation(incidentRes.error)) {
    console.error('[fleet-pro/drivers/detail] incidents load failed:', incidentRes.error.message)
  }

  const incidents: DriverIncident[] = ((incidentRes.data ?? []) as Record<string, unknown>[]).map(row => ({
    id:               String(row.id),
    driver_id:        String(row.driver_id),
    incident_date:    dayOf(row.incident_date) ?? '',
    incident_type:    row.incident_type as IncidentType,
    description:      (row.description as string | null) ?? '',
    resolved:         row.resolved === true,
    resolution_notes: (row.resolution_notes as string | null) ?? null,
    created_at:       (row.created_at as string | null) ?? null,
    updated_at:       (row.updated_at as string | null) ?? null,
  }))

  // ── 5. Unit numbers for both history lists ──────────────────────────────────
  // One lookup for the union of unit ids, rather than a join on each query: the two
  // histories overlap heavily (same trucks) and hd_units is already scoped by fleet.
  const unitIds = [...new Set([...inspections.map(r => r.unit_id), ...fuel.map(r => r.unit_id)])].filter(Boolean)

  if (unitIds.length > 0) {
    const { data: unitRows, error: unitErr } = await svc
      .from('hd_units')
      .select('id, unit_number')
      .in('id', unitIds)
      .limit(unitIds.length)

    if (unitErr) {
      console.error('[fleet-pro/drivers/detail] unit lookup failed:', unitErr.message)
    }

    const names = new Map<string, string | null>()
    for (const u of (unitRows ?? []) as Record<string, unknown>[]) {
      names.set(String(u.id), (u.unit_number as string | null) ?? null)
    }
    for (const row of inspections) row.unit_number = names.get(row.unit_id) ?? null
    for (const row of fuel)        row.unit_number = names.get(row.unit_id) ?? null
  }

  // ── 6. Most recently operated unit ──────────────────────────────────────────
  // NOT an assignment — no such relation exists in the schema. The newest of the two
  // histories wins; the UI labels it as "most recently operated".
  const newestInspection = inspections[0] ?? null
  const newestFuel       = fuel[0] ?? null
  let recentUnit: DriverDetailPayload['recent_unit'] = null

  if (newestInspection || newestFuel) {
    const useFuel = !newestInspection
      || (!!newestFuel && newestFuel.fuel_date > newestInspection.inspection_date)
    recentUnit = useFuel && newestFuel
      ? { id: newestFuel.unit_id,       unit_number: newestFuel.unit_number,       on: newestFuel.fuel_date }
      : newestInspection
        ? { id: newestInspection.unit_id, unit_number: newestInspection.unit_number, on: newestInspection.inspection_date }
        : null
  }

  // ── 7. Scorecard ────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)

  const payload: DriverDetailPayload = {
    driver,
    recent_unit: recentUnit,
    inspections,
    fuel,
    incidents,
    scorecard: {
      inspection_rate: computeInspectionRate(inspections, today),
      avg_mpg:         fuelLogAvailable
        ? computeAvgMpg(fuel, fleetFuel)
        : { available: false, reason: 'Fuel logging is not set up on this fleet yet.' },
      open_incidents:  incidents.filter(i => !i.resolved).length,
      month_label:     monthLabel(today),
    },
    can_edit:              canEditUnits(membership.role),
    has_name_matched_rows: inspectionsByName || fuelByName,
    fuel_log_available:    fuelLogAvailable,
  }

  return NextResponse.json(payload)
}
