// SERVER-ONLY. THE SAFE UNIT-HISTORY LAYER - the one module every fleet-facing surface
// reads through: the fleet manager dashboard now, the unit QR page later. A new caller
// builds a FleetScope (lib/fleet-view/access) and calls listFleetUnits /
// getUnitHistory; it never selects from hd_* itself.
//
// ─── WHITELIST, NEVER BLACKLIST ──────────────────────────────────────────────
// Two walls, both whitelists:
//   1. THE SELECT. Every query names its columns (the *_COLUMNS constants below). No
//      select('*') anywhere in this file, so a column added to a table later is never
//      even fetched.
//   2. THE OUTPUT. Every object leaving this module is built field by field into the
//      Safe* types. A raw row is never spread or returned. hd_invoices.line_items is
//      the one money-carrying value that has to be READ (it holds the parts list);
//      only part_number, description and quantity are copied out of it.
// Then assertFleetSafe walks the finished output and throws on any key in
// FORBIDDEN_FIELD_NAMES - a third check that the first two held.
//
// ALLOWED (Brock, Nov 23, 2026), and nothing else: unit number, manufacturer, model,
// serial, year; hours / miles AS RECORDED AT EACH VISIT; service date; work order
// comments (the request and the tech's comments); final comments (the invoice's
// "Work Done / Diagnosis"); parts used - part number, description, quantity ONLY; the
// PM and DOT sheets attached to the job. Plus PM due, from lib/hd/pm-due - the same
// rule as the Intel Hub alerts.
//
// NOT HERE, ON PURPOSE: any money (rates, subtotals, tax, discount, fees, totals,
// cost, markup, sell); customer contact details; document numbers; internal notes;
// technician names; status; any other fleet's rows.
//
// ─── SCOPE ───────────────────────────────────────────────────────────────────
// Units: user_id = scope.shopUserId AND fleet_account_id = scope.fleetAccountId.
// Documents: that shop, one of those units, AND the document's own fleet is this fleet
// or blank - a unit that changed fleets does not carry the previous fleet's work.
//
// ─── THE DEMO ACCOUNT ────────────────────────────────────────────────────────
// Nothing here aggregates or learns: every read is one fleet's own records, shown
// back to that fleet. Anything built on top that DOES aggregate across fleets or
// shops must drop EXCLUDED_FROM_AGGREGATES first (CLAUDE.md, "Learning from completed
// work"). The demo account is the smoke suite's owner, so its fleets must still
// display - that is how the suite proves this layer.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRowsForIds } from '@/lib/fleet-pro/fetch-scoped'
import { pmDueOf, type PmDue } from '@/lib/hd/pm-due'
import type { FleetScope } from '@/lib/fleet-view/access'

/** Brock's permanent smoke / demo account. Excluded from anything that aggregates or learns. */
export const EXCLUDED_FROM_AGGREGATES: readonly string[] = ['4a8c046f-7db3-42bb-8422-fd47efb7678c']

// ── wall 1: the columns fetched ──────────────────────────────────────────────
const UNIT_COLUMNS = 'id, unit_number, manufacturer, model, serial_number, year, total_hours, engine_hours, current_odometer, next_pm_due_hours, last_pm_date, last_pm_type'
const WO_COLUMNS = 'id, unit_id, fleet_account_id, status, completed_at, scheduled_at, created_at, unit_hours, vehicle_odometer, service_requests, comments'
const WO_LINE_COLUMNS = 'id, work_order_id, type, part_number, description, quantity, sort_order'
const INVOICE_COLUMNS = 'id, unit_id, fleet_account_id, work_order_id, created_at, unit_hours, vehicle_odometer, complaint, diagnosis, line_items'
const PM_COLUMNS = 'id, unit_id, work_order_id, invoice_id, pm_type, completed_at'
const DOT_COLUMNS = 'id, unit_id, fleet_account_id, work_order_id, invoice_id, inspection_date, overall_result'

/** A work order is history once the work is done. Open and scheduled jobs are not. */
const DONE_STATUSES = ['completed', 'invoiced']

// ── wall 2: the only shapes that leave ───────────────────────────────────────
export interface SafePart { part_number: string | null; description: string | null; quantity: number | null }

export interface SafeSheet {
  kind: 'pm' | 'dot'
  id: string
  /** "A PM", "DOT annual inspection". */
  label: string
  date: string | null
  /** DOT only: pass / fail as recorded. */
  result: string | null
}

export interface SafeVisit {
  /** Opaque key for lists. */
  key: string
  /** YYYY-MM-DD, or null when nothing dated it. */
  service_date: string | null
  /** The unit's hours and the vehicle's miles as recorded on THIS visit. */
  hours_at_visit: number | null
  miles_at_visit: number | null
  /** What the customer asked for (work order service request / invoice complaint). */
  requested: string | null
  /** The tech's work order comments. */
  comments: string | null
  /** The invoice's "Work Done / Diagnosis". */
  final_comments: string | null
  parts: SafePart[]
  sheets: SafeSheet[]
}

export interface SafeUnit {
  id: string
  unit_number: string | null
  manufacturer: string | null
  model: string | null
  serial_number: string | null
  year: number | null
  latest_hours: number | null
  latest_miles: number | null
  pm_due: PmDue
  last_pm_date: string | null
  last_pm_type: string | null
}

export interface UnitHistory { unit: SafeUnit; visits: SafeVisit[] }

/**
 * Field names that must never appear in anything this layer returns. The smoke flow
 * Fm checks every one BY NAME against the deployed JSON; assertFleetSafe checks them
 * at runtime. Matching is exact, plus the patterns in FORBIDDEN_FIELD_PATTERNS.
 */
export const FORBIDDEN_FIELD_NAMES: readonly string[] = [
  // labor rate and labor/parts subtotals
  'labor_rate', 'labor_hours', 'labor_minutes', 'subtotal', 'subtotal_labor', 'subtotal_parts', 'parts_subtotal', 'labor_subtotal',
  // tax and discount
  'tax_rate', 'tax_percent', 'tax_amount', 'tax_breakdown', 'discount',
  // fees
  'diagnostic_fee', 'road_call_fee', 'service_call_fee', 'service_call_tax', 'shop_supplies_fee', 'shop_supplies_percent_applied',
  'shop_supplies_cap_applied', 'late_fee_amount', 'late_fee_percentage', 'travel_rate', 'travel_amount', 'travel_hours',
  'mileage_rate', 'mileage_amount', 'mileage_miles',
  // totals
  'total', 'total_amount', 'grand_total', 'amount', 'amount_max',
  // part cost, markup, sell
  'unit_cost', 'unit_cost_base', 'unit_price', 'parts_cost', 'parts_sell', 'markup_percent', 'parts_markup_percent', 'sell_price', 'price', 'cost',
  // the unit's dollar value
  'estimated_value',
  // customer contact details
  'customer_name', 'customer_phone', 'customer_email', 'contact_name', 'contact_phone', 'contact_email',
  'address', 'address_line1', 'address_line2', 'city', 'state', 'zip', 'corp_address_line1', 'carrier_address',
  // other identities and shop-internal fields
  'customer_id', 'user_id', 'fleet_account_id', 'internal_notes', 'public_token', 'payment_terms', 'terms_snapshot',
]
/** Any key matching one of these is forbidden too: a future *_fee, *_price, *_cost, *_rate, *_total. */
export const FORBIDDEN_FIELD_PATTERNS: readonly RegExp[] = [/fee/i, /price/i, /cost/i, /markup/i, /_rate$/i, /total/i, /tax/i, /discount/i, /subtotal/i, /phone/i, /email/i]

/** Every forbidden key found anywhere in a value, with its path. Empty means clean. */
export function forbiddenKeysIn(value: unknown, path = ''): string[] {
  const hits: string[] = []
  if (Array.isArray(value)) value.forEach((v, i) => hits.push(...forbiddenKeysIn(v, `${path}[${i}]`)))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_FIELD_NAMES.includes(k) || FORBIDDEN_FIELD_PATTERNS.some(p => p.test(k))) hits.push(`${path}.${k}`)
      hits.push(...forbiddenKeysIn(v, `${path}.${k}`))
    }
  }
  return hits
}

/** Throws if anything forbidden made it into the output. Called on every return. */
export function assertFleetSafe<T>(value: T): T {
  const hits = forbiddenKeysIn(value)
  if (hits.length) throw new Error(`fleet-view: forbidden field(s) in output: ${hits.slice(0, 5).join(', ')}`)
  return value
}

// ── projection: raw row -> safe shape. Exported for scripts/verify-fleet-unit-history.ts ──
type Row = Record<string, unknown>
const txt = (v: unknown): string | null => { const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim(); return s ? s : null }
const num = (v: unknown): number | null => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null }
const day = (v: unknown): string | null => { const s = txt(v); return s ? s.slice(0, 10) : null }

export function safePart(line: Row): SafePart {
  return { part_number: txt(line.part_number), description: txt(line.description), quantity: num(line.quantity) }
}
/** Parts only - labor lines are not parts used. hd_work_order_line_items says 'part', invoice line_items say 'parts'. */
export function isPartLine(line: Row): boolean {
  return line.type === 'part' || line.type === 'parts'
}
export function safeUnit(u: Row, latestVisit: { hours: number | null; miles: number | null } = { hours: null, miles: null }, now = Date.now()): SafeUnit {
  return {
    id: String(u.id),
    unit_number: txt(u.unit_number),
    manufacturer: txt(u.manufacturer),
    model: txt(u.model),
    serial_number: txt(u.serial_number),
    year: num(u.year),
    latest_hours: num(u.total_hours) ?? num(u.engine_hours) ?? latestVisit.hours,
    latest_miles: num(u.current_odometer) ?? latestVisit.miles,
    pm_due: pmDueOf({ next_pm_due_hours: u.next_pm_due_hours ?? null, total_hours: u.total_hours ?? null, last_pm_date: u.last_pm_date ?? null }, now),
    last_pm_date: day(u.last_pm_date),
    last_pm_type: txt(u.last_pm_type),
  }
}
export function safePmSheet(p: Row): SafeSheet {
  const t = txt(p.pm_type)
  return { kind: 'pm', id: String(p.id), label: t ? `${t.replace(/_/g, ' ')} PM` : 'PM', date: day(p.completed_at), result: null }
}
export function safeDotSheet(d: Row): SafeSheet {
  return { kind: 'dot', id: String(d.id), label: 'DOT annual inspection', date: day(d.inspection_date), result: txt(d.overall_result) }
}

/**
 * The visits of one or more units, newest first. Pure: hand it the rows the selects
 * above return, and it returns only Safe* shapes.
 */
export function buildVisits(input: {
  workOrders: Row[]; woLines: Row[]; invoices: Row[]; pmSheets: Row[]; dotSheets: Row[]
}): Array<SafeVisit & { unit_id: string }> {
  const sheetsFor = (woId: string | null, invIds: string[]) => {
    const pm = input.pmSheets.filter(p => (woId && p.work_order_id === woId) || (p.invoice_id && invIds.includes(String(p.invoice_id))))
    const dot = input.dotSheets.filter(d => (woId && d.work_order_id === woId) || (d.invoice_id && invIds.includes(String(d.invoice_id))))
    return { pm, dot, sheets: [...pm.map(safePmSheet), ...dot.map(safeDotSheet)] }
  }
  const used = new Set<string>()
  const visits: Array<SafeVisit & { unit_id: string }> = []
  const doneWoIds = new Set<string>()

  for (const wo of input.workOrders) {
    if (!DONE_STATUSES.includes(String(wo.status))) continue
    const woId = String(wo.id)
    doneWoIds.add(woId)
    const invs = input.invoices.filter(i => i.work_order_id === woId)
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    const inv = invs[0] ?? null
    // The invoice is the final record of what went on the unit; before it, the work order lines.
    const parts = inv
      ? (Array.isArray(inv.line_items) ? inv.line_items as Row[] : []).filter(isPartLine).map(safePart)
      : input.woLines.filter(l => l.work_order_id === woId && isPartLine(l))
          .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)).map(safePart)
    const s = sheetsFor(woId, invs.map(i => String(i.id)))
    for (const p of [...s.pm, ...s.dot]) used.add(String(p.id))
    visits.push({
      unit_id: String(wo.unit_id),
      key: `wo:${woId}`,
      service_date: day(wo.completed_at) ?? day(wo.scheduled_at) ?? day(wo.created_at),
      hours_at_visit: num(wo.unit_hours) ?? num(inv?.unit_hours),
      miles_at_visit: num(wo.vehicle_odometer) ?? num(inv?.vehicle_odometer),
      requested: txt(wo.service_requests),
      comments: txt(wo.comments),
      final_comments: txt(inv?.diagnosis),
      parts,
      sheets: s.sheets,
    })
  }
  // An invoice billed straight from a quote (or from a work order that is not in the
  // done set) is a visit of its own.
  for (const inv of input.invoices) {
    if (inv.work_order_id && doneWoIds.has(String(inv.work_order_id))) continue
    const invId = String(inv.id)
    const s = sheetsFor(null, [invId])
    for (const p of [...s.pm, ...s.dot]) used.add(String(p.id))
    visits.push({
      unit_id: String(inv.unit_id),
      key: `inv:${invId}`,
      service_date: day(inv.created_at),
      hours_at_visit: num(inv.unit_hours),
      miles_at_visit: num(inv.vehicle_odometer),
      requested: txt(inv.complaint),
      comments: null,
      final_comments: txt(inv.diagnosis),
      parts: (Array.isArray(inv.line_items) ? inv.line_items as Row[] : []).filter(isPartLine).map(safePart),
      sheets: s.sheets,
    })
  }
  // A PM or DOT sheet on the unit with no job behind it is still a visit to the unit.
  for (const p of input.pmSheets) {
    if (used.has(String(p.id))) continue
    visits.push({ unit_id: String(p.unit_id), key: `pm:${p.id}`, service_date: day(p.completed_at), hours_at_visit: null, miles_at_visit: null,
      requested: null, comments: null, final_comments: null, parts: [], sheets: [safePmSheet(p)] })
  }
  for (const d of input.dotSheets) {
    if (used.has(String(d.id))) continue
    visits.push({ unit_id: String(d.unit_id), key: `dot:${d.id}`, service_date: day(d.inspection_date), hours_at_visit: null, miles_at_visit: null,
      requested: null, comments: null, final_comments: null, parts: [], sheets: [safeDotSheet(d)] })
  }
  return visits.sort((a, b) => String(b.service_date ?? '').localeCompare(String(a.service_date ?? '')) || a.key.localeCompare(b.key))
}

// ── the reads ────────────────────────────────────────────────────────────────

async function fleetUnitRows(svc: SupabaseClient, scope: FleetScope, unitId?: string): Promise<Row[]> {
  let q = svc.from('hd_units').select(UNIT_COLUMNS)
    .eq('user_id', scope.shopUserId).eq('fleet_account_id', scope.fleetAccountId)
  if (unitId) q = q.eq('id', unitId)
  const { data, error } = await q.order('unit_number', { ascending: true }).order('id', { ascending: true }).limit(1000)
  if (error) throw new Error(`fleet-view units: ${error.message}`)
  return (data ?? []) as unknown as Row[]
}

/** A document of this shop on one of these units, whose own fleet is this one or blank. */
const onThisFleet = (scope: FleetScope) => (r: Row) => r.fleet_account_id == null || r.fleet_account_id === scope.fleetAccountId

async function documentRows(svc: SupabaseClient, scope: FleetScope, unitIds: string[]) {
  const shop = scope.shopUserId
  const [workOrders, invoices, pmSheets, dotSheets] = await Promise.all([
    fetchAllRowsForIds<Row, string>(unitIds, (ids, from, to) => svc.from('hd_work_orders').select(WO_COLUMNS)
      .eq('user_id', shop).in('unit_id', ids).in('status', DONE_STATUSES).order('id', { ascending: true }).range(from, to) as never),
    fetchAllRowsForIds<Row, string>(unitIds, (ids, from, to) => svc.from('hd_invoices').select(INVOICE_COLUMNS)
      .eq('user_id', shop).in('unit_id', ids).order('id', { ascending: true }).range(from, to) as never),
    fetchAllRowsForIds<Row, string>(unitIds, (ids, from, to) => svc.from('hd_pm_checklists').select(PM_COLUMNS)
      .eq('user_id', shop).in('unit_id', ids).not('completed_at', 'is', null).order('id', { ascending: true }).range(from, to) as never),
    fetchAllRowsForIds<Row, string>(unitIds, (ids, from, to) => svc.from('hd_dot_inspections').select(DOT_COLUMNS)
      .eq('user_id', shop).in('unit_id', ids).order('id', { ascending: true }).range(from, to) as never),
  ])
  const wos = workOrders.filter(onThisFleet(scope))
  const woLines = await fetchAllRowsForIds<Row, string>(wos.map(w => String(w.id)), (ids, from, to) => svc.from('hd_work_order_line_items')
    .select(WO_LINE_COLUMNS).in('work_order_id', ids).order('id', { ascending: true }).range(from, to) as never)
  return { workOrders: wos, woLines, invoices: invoices.filter(onThisFleet(scope)), pmSheets, dotSheets: dotSheets.filter(onThisFleet(scope)) }
}

/** The newest reading recorded on any visit, per unit. */
function latestReadings(visits: Array<SafeVisit & { unit_id: string }>) {
  const out = new Map<string, { hours: number | null; miles: number | null }>()
  for (const v of visits) {          // newest first
    const cur = out.get(v.unit_id) ?? { hours: null, miles: null }
    out.set(v.unit_id, { hours: cur.hours ?? v.hours_at_visit, miles: cur.miles ?? v.miles_at_visit })
  }
  return out
}

/** Every unit on the fleet, with its latest reading and PM due. */
export async function listFleetUnits(svc: SupabaseClient, scope: FleetScope): Promise<SafeUnit[]> {
  const units = await fleetUnitRows(svc, scope)
  const visits = units.length ? buildVisits(await documentRows(svc, scope, units.map(u => String(u.id)))) : []
  const latest = latestReadings(visits)
  return assertFleetSafe(units.map(u => safeUnit(u, latest.get(String(u.id)))))
}

/** One unit and its history, newest first - or null when the unit is not on this fleet. */
export async function getUnitHistory(svc: SupabaseClient, scope: FleetScope, unitId: string): Promise<UnitHistory | null> {
  if (!/^[0-9a-f-]{36}$/i.test(unitId)) return null
  const [u] = await fleetUnitRows(svc, scope, unitId)
  if (!u) return null
  const visits = buildVisits(await documentRows(svc, scope, [unitId]))
  const latest = latestReadings(visits).get(unitId)
  return assertFleetSafe({
    unit: safeUnit(u, latest),
    visits: visits.map(({ unit_id: _u, ...v }) => { void _u; return v }),
  })
}
