// ─── Fleet Pro — the rolling-window cost engine ───────────────────────────────
// SERVER-ONLY (takes a service-role client). This is the ONE place per-asset
// money is computed. Cost per mile, the fleet average, the trend chart and the
// replacement engine all read from here; none of them re-sum invoices themselves.
//
// ── WHY DERIVED AND NOT STORED ───────────────────────────────────────────────
// Voiding an invoice or correcting a tech's mistyped entry must change the unit's
// cost history retroactively, because it changes what the unit actually cost. A
// materialized total would be wrong from that moment until someone remembered to
// recompute it, and nobody ever remembers.
//
// ── THE TWO SOURCES ──────────────────────────────────────────────────────────
//   hd_invoices               the fleet's own shop billing the unit. Carries a
//                             real parts/labor split (subtotal_parts/_labor).
//   fleet_pro_service_entries an outside vendor's invoice, photographed at the
//                             unit by a tech through the QR page (migration 115).
//
// Voided invoices are excluded. Entries have no void state — a wrong one is
// corrected in place — so all of them count.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  COST_WINDOW_MONTHS,
  emptyBreakdown,
  perUnitOfUse,
  type MonthlyCost,
  type UnitCostBreakdown,
} from '@/types/fleet-pro-cost'

// Matches the ceiling the dashboard route already uses; a large municipal fleet's
// twelve-month history must not be silently truncated by PostgREST's default.
const ROW_CEILING = 20_000

interface InvoiceRow {
  unit_id:        string | null
  total:          number | string | null
  subtotal_parts: number | string | null
  subtotal_labor: number | string | null
  status:         string | null
  created_at:     string | null
}

interface ServiceEntryRow {
  unit_id:      string | null
  total:        number | string | null
  parts_cost:   number | string | null
  labor_cost:   number | string | null
  vendor_name:  string | null
  service_date: string | null
}

interface MeterRow {
  unit_id:      string
  odometer:     number | string | null
  engine_hours: number | string | null
  reading_date: string | null
}

/** PostgREST returns NUMERIC as a string. Anything unparseable is 0, not NaN. */
function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Same, but preserves "absent" so a missing meter reading stays unknown. */
function numOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

/** The window start, anchored to the first of the month N months back. */
export function windowStart(now: Date = new Date(), months = COST_WINDOW_MONTHS): Date {
  return new Date(now.getFullYear(), now.getMonth() - (months - 1), 1)
}

function isoDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Twelve 'YYYY-MM' keys, oldest first, so a quiet month renders as a real zero. */
function monthSkeleton(now: Date, months = COST_WINDOW_MONTHS): string[] {
  const out: string[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/**
 * Load the rolling-window cost breakdown for every given unit.
 *
 * Returns a Map keyed by unit_id containing an entry for EVERY id passed in —
 * units with no spend come back as a zeroed breakdown rather than being absent,
 * so callers never have to distinguish "no data" from "not loaded".
 *
 * @param svc      service-role client; every query below is scoped to `fleetId`
 *                 explicitly, never to anything supplied by the request.
 * @param fleetId  the resolved fleet account id from requireFleetProMember.
 */
export async function loadFleetCosts(
  svc:     SupabaseClient,
  fleetId: string,
  unitIds: string[],
  now:     Date = new Date(),
): Promise<Map<string, UnitCostBreakdown>> {
  const out = new Map<string, UnitCostBreakdown>()
  for (const id of unitIds) out.set(id, emptyBreakdown(id))
  if (unitIds.length === 0) return out

  const start    = isoDate(windowStart(now))
  const skeleton = monthSkeleton(now)

  // ── A NOTE ON SCOPING, BECAUSE THE THREE QUERIES BELOW DIFFER ──────────────
  // `unitIds` is already fleet-scoped by the caller: every id came out of a query
  // filtered on this same fleetId. So `.in('unit_id', unitIds)` is by itself a
  // complete tenant boundary, and the extra `.eq('fleet_account_id', fleetId)` is
  // defense in depth rather than the thing doing the work.
  //
  // On two of these tables that extra filter is actively WRONG. fleet_account_id
  // is NULLABLE on both fleet_pro_service_entries (115) and
  // fleet_pro_unit_meter_readings (106) because both are written by the service
  // role on behalf of someone with no session — a driver or a tech at a QR
  // sticker — and the denormalized fleet id is copied from the unit row on a best
  // effort. Any row that landed with a null silently vanishes from the equality
  // filter. For cost that understates spend; for the meter series it SHORTENS THE
  // MILEAGE SPAN, which inflates cost per mile — the headline number on the
  // dashboard — with no error anywhere. The unit detail route already dropped
  // this filter on the same two tables for the same reason.
  //
  // hd_invoices keeps the filter: it is written in-session by the mechanic, its
  // fleet id is always populated, and matching the dashboard's existing spend
  // rule exactly matters more here than the hypothetical null.
  const [invRes, entryRes, meterRes] = await Promise.all([
    svc.from('hd_invoices')
      .select('unit_id, total, subtotal_parts, subtotal_labor, status, created_at')
      .eq('fleet_account_id', fleetId)
      .in('unit_id', unitIds)
      .gte('created_at', start)
      .limit(ROW_CEILING),

    svc.from('fleet_pro_service_entries')
      .select('unit_id, total, parts_cost, labor_cost, vendor_name, service_date')
      .in('unit_id', unitIds)
      .gte('service_date', start)
      .limit(ROW_CEILING),

    svc.from('fleet_pro_unit_meter_readings')
      .select('unit_id, odometer, engine_hours, reading_date')
      .in('unit_id', unitIds)
      .gte('reading_date', start)
      .order('reading_date', { ascending: true })
      .limit(ROW_CEILING),
  ])

  const failed = [invRes, entryRes, meterRes].find(r => r.error)
  if (failed?.error) throw new Error(`fleet cost load: ${failed.error.message}`)

  const monthly = new Map<string, Map<string, number>>()
  for (const id of unitIds) monthly.set(id, new Map(skeleton.map(m => [m, 0])))

  function addMonth(unitId: string, iso: string, amount: number) {
    const m = monthly.get(unitId)
    if (!m) return
    const key = monthKey(iso)
    if (!m.has(key)) return   // outside the skeleton (clock skew) — ignore, don't grow it
    m.set(key, (m.get(key) ?? 0) + amount)
  }

  // ── In-house invoices ──────────────────────────────────────────────────────
  for (const inv of (invRes.data ?? []) as InvoiceRow[]) {
    if (!inv.unit_id || !inv.created_at) continue
    // Matches the dashboard's existing rule: void is excluded, a NULL status is a
    // real unpaid invoice and counts.
    if (inv.status === 'void') continue
    const row = out.get(inv.unit_id)
    if (!row) continue

    const total = num(inv.total)
    const parts = num(inv.subtotal_parts)
    const labor = num(inv.subtotal_labor)

    row.parts_cost += parts
    row.labor_cost += labor
    // Fees and tax. Clamped at zero: a hand-edited invoice whose subtotals exceed
    // its total must not push a negative into the bucket and make the three stop
    // reconciling against total_cost.
    row.other_cost += Math.max(0, total - parts - labor)
    row.total_cost += total
    row.repair_events += 1

    addMonth(inv.unit_id, inv.created_at, total)
  }

  // ── Outside vendor entries ─────────────────────────────────────────────────
  for (const e of (entryRes.data ?? []) as ServiceEntryRow[]) {
    if (!e.unit_id || !e.service_date) continue
    const row = out.get(e.unit_id)
    if (!row) continue

    const total = num(e.total)
    const parts = num(e.parts_cost)
    const labor = num(e.labor_cost)

    row.parts_cost += parts
    row.labor_cost += labor
    row.other_cost += Math.max(0, total - parts - labor)
    row.total_cost += total
    row.repair_events += 1
    // A tech entry with no vendor name is still an outside invoice — the QR page
    // exists to capture third-party work — so the whole entry counts as vendor
    // spend and the name is only a label.
    row.vendor_cost += total

    addMonth(e.unit_id, e.service_date, total)
  }

  // ── Distance and hours: span of the meter series inside the window ─────────
  // A DIFFERENCE, not a latest value. Rows arrive date-ascending, so first and
  // last are the ends of the span. A negative span (ECU replaced and the count
  // reset mid-window) yields null rather than a nonsense negative denominator.
  const firstOdo = new Map<string, number>(), lastOdo = new Map<string, number>()
  const firstHrs = new Map<string, number>(), lastHrs = new Map<string, number>()

  for (const m of (meterRes.data ?? []) as MeterRow[]) {
    const odo = numOrNull(m.odometer)
    if (odo !== null) {
      if (!firstOdo.has(m.unit_id)) firstOdo.set(m.unit_id, odo)
      lastOdo.set(m.unit_id, odo)
    }
    const hrs = numOrNull(m.engine_hours)
    if (hrs !== null) {
      if (!firstHrs.has(m.unit_id)) firstHrs.set(m.unit_id, hrs)
      lastHrs.set(m.unit_id, hrs)
    }
  }

  function span(first: Map<string, number>, last: Map<string, number>, id: string): number | null {
    const a = first.get(id), b = last.get(id)
    if (a === undefined || b === undefined) return null
    const d = b - a
    return d > 0 ? d : null
  }

  for (const id of unitIds) {
    const row = out.get(id)
    if (!row) continue
    row.miles_driven = span(firstOdo, lastOdo, id)
    row.hours_run    = span(firstHrs, lastHrs, id)
    row.cost_per_mile = perUnitOfUse(row.total_cost, row.miles_driven)
    row.cost_per_hour = perUnitOfUse(row.total_cost, row.hours_run)

    const m = monthly.get(id)
    row.months = skeleton.map<MonthlyCost>(k => ({ month: k, cost: m?.get(k) ?? 0 }))
  }

  return out
}

/**
 * Fleet-wide cost per mile. Deliberately a RATIO OF SUMS — total fleet spend over
 * total fleet miles — and not the mean of each unit's cost per mile. Averaging the
 * per-unit ratios lets a trailer that moved 200 miles swing the fleet number as
 * hard as a tractor that ran 120,000, which is how a fleet average ends up saying
 * something no manager recognizes.
 *
 * Units with unknown mileage are excluded from BOTH sides, so they neither inflate
 * the numerator nor get counted as free miles.
 */
export function fleetCostPerMile(rows: Iterable<UnitCostBreakdown>): number | null {
  let cost = 0, miles = 0
  for (const r of rows) {
    if (r.miles_driven === null || r.miles_driven <= 0) continue
    cost  += r.total_cost
    miles += r.miles_driven
  }
  return perUnitOfUse(cost, miles || null)
}

export function fleetCostPerHour(rows: Iterable<UnitCostBreakdown>): number | null {
  let cost = 0, hours = 0
  for (const r of rows) {
    if (r.hours_run === null || r.hours_run <= 0) continue
    cost  += r.total_cost
    hours += r.hours_run
  }
  return perUnitOfUse(cost, hours || null)
}
