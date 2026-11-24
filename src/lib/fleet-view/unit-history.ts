// SERVER-ONLY. THE FLEET-VIEW LAYER - the one module every fleet-facing surface reads
// through. A caller builds a FleetScope (lib/fleet-view/access) and calls one of the
// readers below; it never selects from hd_* itself.
//
// ─── TWO TIERS, ONE PLACE ────────────────────────────────────────────────────
// Both tiers grow from ONE money-free record of each visit (RecordVisit), built from
// selects that do not even name a money column.
//
//   1. CUSTOMER  - getCustomerUnitHistory. The fleet manager IS the customer (Brock,
//      Nov 23 revision). He sees EXACTLY what was printed on the invoice he already
//      received, and nothing that was never on that paper: the record, the work order
//      and invoice numbers, and per invoice its printed lines and money rows - built by
//      lib/hd/invoice-print, the same rule the customer copy renders from. A completed
//      job that was never invoiced shows no money: no paper ever carried a figure for it.
//
//   2. OUTSIDE TECH - getOutsideTechUnitRecord. For the coming unit QR page: an outside
//      tech who is NOT the customer. NO MONEY AT ALL: unit, make, model, serial, year,
//      and per visit the date, the hours / miles at it, the repair comments and the
//      parts used by number and quantity only.
//
// WHY THE STRIPPED TIER CANNOT INHERIT A MONEY FIELD
//   * Its reader never fetches a money column: the invoice money is a SEPARATE select
//     (HD_INVOICE_PRINT_COLUMNS) made only by the customer reader.
//   * It is built field by field from the money-free RecordVisit, never from a
//     CustomerVisit - copying named fields, never spreading.
//   * assertOutsideTechSafe walks the finished output and throws on every money name
//     and pattern (MONEY_FIELD_NAMES / MONEY_FIELD_PATTERNS) before it leaves.
//
// WHAT NEITHER TIER EVER CARRIES (MARGIN_FIELD_NAMES / MARGIN_FIELD_PATTERNS, asserted
// on both): what the shop paid its supplier (parts_cost, unit_cost_base, any *cost*),
// markup in any form, internal_notes, the unit's dollar value, the customer's contact
// details, and owner / customer / fleet identities. "Cost" is resolved one way only:
// on an invoice line `unit_cost` is the price the CUSTOMER was charged, and it leaves
// here renamed `unit_price`; the supplier cost is never read out of the line.
//
// ─── SCOPE ───────────────────────────────────────────────────────────────────
// Units: user_id = scope.shopUserId AND fleet_account_id = scope.fleetAccountId.
// Documents: that shop, one of those units, AND the document's own fleet is this fleet
// or blank - a unit that changed fleets does not carry the previous fleet's work.
//
// ─── THE DEMO ACCOUNT ────────────────────────────────────────────────────────
// Nothing here aggregates or learns: every read is one fleet's own records, shown back
// to that fleet. Anything built on top that DOES aggregate across fleets or shops must
// drop EXCLUDED_FROM_AGGREGATES first (CLAUDE.md, "Learning from completed work"). The
// demo account is the smoke suite's owner, so its fleets must still display - that is
// how the suite proves this layer.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRowsForIds } from '@/lib/fleet-pro/fetch-scoped'
import { pmDueOf, type PmDue } from '@/lib/hd/pm-due'
import { hdInvoiceSummaryRows, HD_INVOICE_PRINT_COLUMNS } from '@/lib/hd/invoice-print'
import { invoiceJobGroups } from '@/lib/hd/work-order-jobs'
import type { FleetScope } from '@/lib/fleet-view/access'

/** Brock's permanent smoke / demo account. Excluded from anything that aggregates or learns. */
export const EXCLUDED_FROM_AGGREGATES: readonly string[] = ['4a8c046f-7db3-42bb-8422-fd47efb7678c']

// ── the money-free selects (both tiers) ──────────────────────────────────────
const UNIT_COLUMNS = 'id, unit_number, manufacturer, model, serial_number, year, total_hours, engine_hours, current_odometer, next_pm_due_hours, last_pm_date, last_pm_type'
const WO_COLUMNS = 'id, unit_id, fleet_account_id, work_order_number, status, completed_at, scheduled_at, created_at, unit_hours, vehicle_odometer, service_requests, comments'
const WO_LINE_COLUMNS = 'id, work_order_id, type, part_number, description, quantity, sort_order'
// line_items is the one value that carries money and must still be read here (it holds
// the parts list). Only part_number, description and quantity are copied out of it.
const INVOICE_RECORD_COLUMNS = 'id, unit_id, fleet_account_id, work_order_id, invoice_number, created_at, unit_hours, vehicle_odometer, complaint, diagnosis, line_items'
const PM_COLUMNS = 'id, unit_id, work_order_id, invoice_id, pm_type, completed_at'
const DOT_COLUMNS = 'id, unit_id, fleet_account_id, work_order_id, invoice_id, inspection_date, overall_result'

/** A work order is history once the work is done. Open and scheduled jobs are not. */
const DONE_STATUSES = ['completed', 'invoiced']

// ── the record: money-free, the root of both tiers ───────────────────────────
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

export interface RecordVisit {
  /** Opaque key for lists. */
  key: string
  /** YYYY-MM-DD, or null when nothing dated it. */
  service_date: string | null
  /** The work order and invoice numbers: how he names the repair when he calls. */
  work_order_number: string | null
  invoice_number: string | null
  /** The unit's hours and the vehicle's miles as recorded on THIS visit. */
  hours_at_visit: number | null
  miles_at_visit: number | null
  /** The complaint (work order service request / invoice complaint). */
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

// ── tier 1: the customer (the fleet manager) ─────────────────────────────────
export interface PrintedLaborLine { description: string | null; hours: number | null; rate: number | null; amount: number }
export interface PrintedPartLine { part_number: string | null; description: string | null; quantity: number | null; unit_price: number | null; amount: number }
export interface PrintedGroup { label: string | null; labor: PrintedLaborLine[]; parts: PrintedPartLine[]; subtotal: number | null }
/** One invoice exactly as its customer copy prints it. */
export interface PrintedInvoice {
  invoice_number: string | null
  work_order_number: string | null
  date: string | null
  voided: boolean
  groups: PrintedGroup[]
  /** Subtotals, fees, travel / mileage / shop supplies, discount, tax - print order. */
  summary: Array<{ label: string; amount: number }>
  total: number
}
export interface CustomerVisit extends RecordVisit { invoice: PrintedInvoice | null }
export interface CustomerUnitHistory { unit: SafeUnit; visits: CustomerVisit[] }

// ── tier 2: the outside tech (the unit QR page) - no money ───────────────────
export interface OutsideTechPart { part_number: string | null; quantity: number | null }
export interface OutsideTechVisit {
  service_date: string | null
  hours_at_visit: number | null
  miles_at_visit: number | null
  comments: string | null
  final_comments: string | null
  parts: OutsideTechPart[]
}
export interface OutsideTechUnit {
  unit_number: string | null; manufacturer: string | null; model: string | null; serial_number: string | null; year: number | null
}
export interface OutsideTechRecord { unit: OutsideTechUnit; visits: OutsideTechVisit[] }

// ── the walls ────────────────────────────────────────────────────────────────
/**
 * Never in EITHER tier: never on the customer's paper. The smoke flow Fm checks each
 * BY NAME against the deployed JSON; assertCustomerSafe checks them at runtime.
 */
export const MARGIN_FIELD_NAMES: readonly string[] = [
  // what the shop paid its supplier
  'parts_cost', 'unit_cost', 'unit_cost_base', 'cost', 'cost_basis', 'total_cost', 'parts_sell',
  // markup, and anything derived from it
  'markup', 'markup_percent', 'parts_markup_percent', 'margin', 'profit',
  'internal_notes',
  // the unit's dollar value
  'estimated_value',
  // the customer's contact details
  'customer_name', 'customer_phone', 'customer_email', 'contact_name', 'contact_phone', 'contact_email',
  'address', 'address_line1', 'address_line2', 'city', 'state', 'zip', 'corp_address_line1', 'carrier_address',
  // identities: whose row it is, and any other customer's
  'customer_id', 'user_id', 'fleet_account_id', 'public_token',
]
export const MARGIN_FIELD_PATTERNS: readonly RegExp[] = [/cost/i, /markup/i, /margin/i, /profit/i, /internal/i, /phone/i, /email/i]

/** Also never in the outside-tech tier: any money at all, and the document numbers. */
export const MONEY_FIELD_NAMES: readonly string[] = [
  'labor_rate', 'labor_hours', 'subtotal', 'subtotal_labor', 'subtotal_parts', 'parts_subtotal', 'labor_subtotal',
  'tax_rate', 'tax_percent', 'tax_amount', 'tax_breakdown', 'discount',
  'diagnostic_fee', 'road_call_fee', 'service_call_fee', 'shop_supplies_fee', 'late_fee_amount',
  'travel_rate', 'travel_amount', 'travel_hours', 'mileage_rate', 'mileage_amount', 'mileage_miles',
  'total', 'total_amount', 'grand_total', 'amount', 'amount_max', 'unit_price', 'sell_price', 'price', 'rate',
  'summary', 'invoice', 'groups', 'invoice_number', 'work_order_number',
]
export const MONEY_FIELD_PATTERNS: readonly RegExp[] = [/fee/i, /price/i, /amount/i, /rate$/i, /total/i, /tax/i, /discount/i, /subtotal/i]

function keysMatching(value: unknown, names: readonly string[], patterns: readonly RegExp[], path = ''): string[] {
  const hits: string[] = []
  if (Array.isArray(value)) value.forEach((v, i) => hits.push(...keysMatching(v, names, patterns, `${path}[${i}]`)))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (names.includes(k) || patterns.some(p => p.test(k))) hits.push(`${path}.${k}`)
      hits.push(...keysMatching(v, names, patterns, `${path}.${k}`))
    }
  }
  return hits
}
/** Every key the CUSTOMER tier must not carry, with its path. Empty means clean. */
export function marginKeysIn(value: unknown): string[] { return keysMatching(value, MARGIN_FIELD_NAMES, MARGIN_FIELD_PATTERNS) }
/** Every key the OUTSIDE-TECH tier must not carry: margin AND money. Empty means clean. */
export function moneyKeysIn(value: unknown): string[] {
  return [...marginKeysIn(value), ...keysMatching(value, MONEY_FIELD_NAMES, MONEY_FIELD_PATTERNS)]
}
export function assertCustomerSafe<T>(value: T): T {
  const hits = marginKeysIn(value)
  if (hits.length) throw new Error(`fleet-view (customer): forbidden field(s) in output: ${hits.slice(0, 5).join(', ')}`)
  return value
}
export function assertOutsideTechSafe<T>(value: T): T {
  const hits = moneyKeysIn(value)
  if (hits.length) throw new Error(`fleet-view (outside tech): money or forbidden field(s) in output: ${hits.slice(0, 5).join(', ')}`)
  return value
}

// ── projection: raw row -> safe shape. Exported for scripts/verify-fleet-unit-history.ts ──
type Row = Record<string, unknown>
const txt = (v: unknown): string | null => { const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim(); return s ? s : null }
const num = (v: unknown): number | null => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null }
const money = (v: unknown): number => num(v) ?? 0
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
 * One invoice exactly as its customer copy prints it (components/hd/PublicInvoicePay):
 * the lines it prints - labor as hours x the invoice's rate, parts as quantity x the
 * price charged - grouped by job when there are two or more, then the shared summary
 * rows and the total. Built field by field; nothing of the raw row is passed through.
 */
export function printedInvoice(inv: Row): PrintedInvoice {
  const items = (Array.isArray(inv.line_items) ? inv.line_items : []) as Row[]
  const groups = invoiceJobGroups(items) ?? [{ job: null, label: null, lines: items, subtotal: 0 }]
  const multi = groups.length > 1 || groups[0]?.label != null
  const rate = num(inv.labor_rate)
  return {
    invoice_number: txt(inv.invoice_number),
    work_order_number: txt(inv.work_order_number),
    date: day(inv.created_at),
    voided: inv.status === 'void',
    groups: groups.map(g => ({
      label: g.label,
      // The customer copy prints exactly these two types; so does this.
      labor: g.lines.filter(l => l.type === 'labor').map(l => ({
        description: txt(l.description), hours: num(l.mobile_hours), rate, amount: money(l.amount),
      })),
      parts: g.lines.filter(l => l.type === 'parts').map(l => ({
        part_number: txt(l.part_number), description: txt(l.description), quantity: num(l.quantity),
        // unit_cost on an INVOICE line is the price the customer was charged (see header).
        unit_price: num(l.unit_cost), amount: money(l.amount),
      })),
      subtotal: multi && g.label ? g.subtotal : null,
    })),
    summary: hdInvoiceSummaryRows(inv).map(r => ({ label: r.label, amount: r.amount })),
    total: money(inv.total),
  }
}

/**
 * The visits of one or more units, newest first. Pure: hand it the rows the money-free
 * selects return, and it returns only RecordVisit shapes. Each visit also says which
 * invoice (if any) is its paper, for the customer tier to attach.
 */
export function buildVisits(input: {
  workOrders: Row[]; woLines: Row[]; invoices: Row[]; pmSheets: Row[]; dotSheets: Row[]
}): Array<RecordVisit & { unit_id: string; invoice_id: string | null }> {
  const sheetsFor = (woId: string | null, invIds: string[]) => {
    const pm = input.pmSheets.filter(p => (woId && p.work_order_id === woId) || (p.invoice_id && invIds.includes(String(p.invoice_id))))
    const dot = input.dotSheets.filter(d => (woId && d.work_order_id === woId) || (d.invoice_id && invIds.includes(String(d.invoice_id))))
    return { pm, dot, sheets: [...pm.map(safePmSheet), ...dot.map(safeDotSheet)] }
  }
  const used = new Set<string>()
  const visits: Array<RecordVisit & { unit_id: string; invoice_id: string | null }> = []
  const doneWoIds = new Set<string>()
  const blank = { work_order_number: null, invoice_number: null, hours_at_visit: null, miles_at_visit: null, requested: null, comments: null, final_comments: null, parts: [] }

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
      invoice_id: inv ? String(inv.id) : null,
      key: `wo:${woId}`,
      service_date: day(wo.completed_at) ?? day(wo.scheduled_at) ?? day(wo.created_at),
      work_order_number: txt(wo.work_order_number),
      invoice_number: txt(inv?.invoice_number),
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
      invoice_id: invId,
      key: `inv:${invId}`,
      service_date: day(inv.created_at),
      work_order_number: null,
      invoice_number: txt(inv.invoice_number),
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
    visits.push({ unit_id: String(p.unit_id), invoice_id: null, key: `pm:${p.id}`, service_date: day(p.completed_at), ...blank, sheets: [safePmSheet(p)] })
  }
  for (const d of input.dotSheets) {
    if (used.has(String(d.id))) continue
    visits.push({ unit_id: String(d.unit_id), invoice_id: null, key: `dot:${d.id}`, service_date: day(d.inspection_date), ...blank, sheets: [safeDotSheet(d)] })
  }
  return visits.sort((a, b) => String(b.service_date ?? '').localeCompare(String(a.service_date ?? '')) || a.key.localeCompare(b.key))
}

/** A RecordVisit, copied field by field (drops unit_id / invoice_id and anything else). */
function recordOf(v: RecordVisit): RecordVisit {
  return {
    key: v.key, service_date: v.service_date, work_order_number: v.work_order_number, invoice_number: v.invoice_number,
    hours_at_visit: v.hours_at_visit, miles_at_visit: v.miles_at_visit, requested: v.requested, comments: v.comments,
    final_comments: v.final_comments, parts: v.parts.map(p => ({ part_number: p.part_number, description: p.description, quantity: p.quantity })),
    sheets: v.sheets.map(s => ({ kind: s.kind, id: s.id, label: s.label, date: s.date, result: s.result })),
  }
}

/** The customer tier of one visit: the record, plus its invoice as printed (or null). */
export function customerVisit(v: RecordVisit, invoice: PrintedInvoice | null): CustomerVisit {
  return { ...recordOf(v), invoice }
}

/** The outside-tech tier. Takes the money-free record ONLY, and copies named fields. */
export function outsideTechVisit(v: RecordVisit): OutsideTechVisit {
  return {
    service_date: v.service_date,
    hours_at_visit: v.hours_at_visit,
    miles_at_visit: v.miles_at_visit,
    comments: v.comments,
    final_comments: v.final_comments,
    parts: v.parts.map(p => ({ part_number: p.part_number, quantity: p.quantity })),
  }
}
export function outsideTechUnit(u: SafeUnit): OutsideTechUnit {
  return { unit_number: u.unit_number, manufacturer: u.manufacturer, model: u.model, serial_number: u.serial_number, year: u.year }
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

/** The money-free rows behind the record. Both tiers read through this and nothing else. */
async function recordRows(svc: SupabaseClient, scope: FleetScope, unitIds: string[]) {
  const shop = scope.shopUserId
  const [workOrders, invoices, pmSheets, dotSheets] = await Promise.all([
    fetchAllRowsForIds<Row, string>(unitIds, (ids, from, to) => svc.from('hd_work_orders').select(WO_COLUMNS)
      .eq('user_id', shop).in('unit_id', ids).in('status', DONE_STATUSES).order('id', { ascending: true }).range(from, to) as never),
    fetchAllRowsForIds<Row, string>(unitIds, (ids, from, to) => svc.from('hd_invoices').select(INVOICE_RECORD_COLUMNS)
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

/** CUSTOMER TIER ONLY: the printed money of these invoices (already scoped by recordRows). */
async function printedInvoices(svc: SupabaseClient, scope: FleetScope, invoiceIds: string[]): Promise<Map<string, PrintedInvoice>> {
  const rows = await fetchAllRowsForIds<Row, string>(invoiceIds, (ids, from, to) => svc.from('hd_invoices').select(HD_INVOICE_PRINT_COLUMNS)
    .eq('user_id', scope.shopUserId).in('id', ids).order('id', { ascending: true }).range(from, to) as never)
  return new Map(rows.map(r => [String(r.id), printedInvoice(r)]))
}

/** The newest reading recorded on any visit, per unit. */
function latestReadings(visits: Array<RecordVisit & { unit_id: string }>) {
  const out = new Map<string, { hours: number | null; miles: number | null }>()
  for (const v of visits) {          // newest first
    const cur = out.get(v.unit_id) ?? { hours: null, miles: null }
    out.set(v.unit_id, { hours: cur.hours ?? v.hours_at_visit, miles: cur.miles ?? v.miles_at_visit })
  }
  return out
}

async function unitAndVisits(svc: SupabaseClient, scope: FleetScope, unitId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(unitId)) return null
  const [u] = await fleetUnitRows(svc, scope, unitId)
  if (!u) return null
  const visits = buildVisits(await recordRows(svc, scope, [unitId]))
  return { unit: safeUnit(u, latestReadings(visits).get(unitId)), visits }
}

/** Every unit on the fleet, with its latest reading and PM due. No money in either tier. */
export async function listFleetUnits(svc: SupabaseClient, scope: FleetScope): Promise<SafeUnit[]> {
  const units = await fleetUnitRows(svc, scope)
  const visits = units.length ? buildVisits(await recordRows(svc, scope, units.map(u => String(u.id)))) : []
  const latest = latestReadings(visits)
  return assertOutsideTechSafe(units.map(u => safeUnit(u, latest.get(String(u.id)))))
}

/**
 * TIER 1 - the fleet manager. One unit and its history, newest first, each invoiced
 * visit carrying its invoice as printed - or null when the unit is not on this fleet.
 */
export async function getCustomerUnitHistory(svc: SupabaseClient, scope: FleetScope, unitId: string): Promise<CustomerUnitHistory | null> {
  const base = await unitAndVisits(svc, scope, unitId)
  if (!base) return null
  const ids = base.visits.map(v => v.invoice_id).filter((x): x is string => !!x)
  const printed = ids.length ? await printedInvoices(svc, scope, ids) : new Map<string, PrintedInvoice>()
  return assertCustomerSafe({
    unit: base.unit,
    visits: base.visits.map(v => customerVisit(v, v.invoice_id ? printed.get(v.invoice_id) ?? null : null)),
  })
}

/**
 * TIER 2 - an outside tech (the unit QR page). No money at all: it never fetches a
 * money column, it is built from the money-free record, and it is asserted money-free.
 */
export async function getOutsideTechUnitRecord(svc: SupabaseClient, scope: FleetScope, unitId: string): Promise<OutsideTechRecord | null> {
  const base = await unitAndVisits(svc, scope, unitId)
  if (!base) return null
  return assertOutsideTechSafe({
    unit: outsideTechUnit(base.unit),
    visits: base.visits.filter(v => v.key.startsWith('wo:') || v.key.startsWith('inv:')).map(outsideTechVisit),
  })
}
