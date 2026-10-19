// Per-equipment financials and the audit figures, as PURE functions.
//
// Spec: docs/KURT-EQUIPMENT-TRACKING-SPEC.md sections 5, 5.1, 5.2 and 5.3. No React, no
// fetch, no Supabase: the loader (equipment-rollup-load.ts) reads the rows, and every
// number on the By Equipment screen and in both audit exports comes from here, so a
// figure cannot differ depending on which of them you opened.
//
// THE RULES THIS FILE HOLDS
//
//   * A JOB is an NWI invoice (not void), OR a closed work order with a recorded
//     total_amount and no invoice. The second kind is how 1,525 imported rows carry
//     their history; each job says which it is (`source`). A work order that has an
//     invoice is counted ONCE, through the invoice. An open work order is intent, not
//     money, and is never a job.
//   * RECORDED VALUES ONLY. Totals, subtotals, fees and hours are summed as the
//     document stored them. Nothing is recomputed from today's rate, markup or tax.
//   * UNKNOWN IS NOT ZERO. An imported row has a total and no hours, no labor/parts
//     split and no payment record. Those come back as null, with a count of the jobs
//     that lacked them, so a screen prints "-" rather than a 0 that reads as "no time
//     spent" or "nothing collected".
//   * INVOICED AND COLLECTED ARE SEPARATE. Collected is the full total of a PAID
//     invoice, 0 for an unpaid or sent one, and unknown for a partial one -
//     hd_invoices records no amount paid, so a partial's figure would be a guess.
//   * NOTHING IS DROPPED. A unit with no category rolls up under "Uncategorized"; a
//     job with no unit at all rolls up under "No unit recorded".
//   * ONE ACCOUNT. Every function takes the user id and ignores rows that are not
//     that user's, on top of RLS in the loader.
//
// COLUMN TRAP, for the record: hd_work_order_line_items.total is the SELL figure the
// line bills (unit_price is sell, unit_cost is cost). Revenue here only ever reads
// totals, never unit_cost.

// ─── Rows, as the loader reads them ─────────────────────────────────────────

type Num = number | string | null | undefined

export interface CategoryRow { id: string; user_id: string; name: string; sort_order: number; is_active: boolean }
export interface FleetRow { id: string; user_id: string; fleet_name: string | null }
export interface UnitRow {
  id: string; user_id: string
  unit_number: string | null; manufacturer: string | null; model: string | null
  year: number | null; serial_number: string | null
  category_id: string | null; fleet_account_id: string | null
  active: boolean | null; estimated_value: Num
}
export interface InvoiceRow {
  id: string; user_id: string; invoice_number: string | null
  work_order_id: string | null; unit_id: string | null
  status: string | null; created_at: string
  total: Num; subtotal_labor: Num; subtotal_parts: Num; tax_amount: Num
  diagnostic_fee: Num; road_call_fee: Num
  travel_amount: Num; mileage_amount: Num; shop_supplies_fee: Num
  line_items: unknown
}
export interface WorkOrderRow {
  id: string; user_id: string; work_order_number: string | null
  unit_id: string | null; status: string | null; service_type: string | null
  total_amount: Num; labor_hours: Num; tax_amount: Num
  diagnostic_fee?: Num; road_call_fee?: Num
  travel_amount: Num; mileage_amount: Num; shop_supplies_fee: Num
  created_at: string; started_at: string | null; arrived_at: string | null; completed_at: string | null
  authorized_at: string | null
}
export interface WorkOrderLineRow { work_order_id: string; type: string | null; quantity: Num; total: Num }

/** Inclusive, shop-local calendar dates, YYYY-MM-DD. */
export interface DateRange { from: string; to: string }

export interface RollupInput {
  userId: string
  range: DateRange
  /** The shop's IANA zone - a job's date is the shop's calendar day, not UTC's. */
  timeZone: string
  categories: CategoryRow[]
  fleets: FleetRow[]
  units: UnitRow[]
  invoices: InvoiceRow[]
  workOrders: WorkOrderRow[]
  workOrderLines: WorkOrderLineRow[]
}

// ─── Small helpers ──────────────────────────────────────────────────────────

const num = (v: Num): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const r2 = (n: number) => Math.round(n * 100) / 100

/** The shop's calendar date for a timestamp. A DATE-only value is returned as is. */
export function localDate(s: string | null | undefined, timeZone: string): string | null {
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

const inRange = (d: string | null, r: DateRange) => d != null && d >= r.from && d <= r.to

/**
 * A figure that may be unknown on some of the jobs it sums.
 *
 * value is null only when NO job had it; otherwise it is the sum of the ones that did,
 * and `missing` says how many did not, so a partial sum is never passed off as whole.
 */
export interface PartialSum { value: number | null; missing: number }
function sumPartial(values: Array<number | null>): PartialSum {
  let total = 0, known = 0, missing = 0
  for (const v of values) { if (v == null) missing++; else { total += v; known++ } }
  return { value: known ? r2(total) : null, missing }
}

/** Work order rows that are imported history, not work NWI saw happen. */
export function isImportedHistory(wo: Pick<WorkOrderRow, 'service_type'>): boolean {
  return wo.service_type === 'Imported Invoice'
}

const CLOSED_WO = new Set(['completed', 'invoiced'])
const DEAD_WO   = new Set(['cancelled', 'canceled', 'void'])

// ─── Jobs ───────────────────────────────────────────────────────────────────

export type JobSource = 'invoice' | 'work_order'

export interface Job {
  source: JobSource
  /** The invoice id for an invoice job, the work order id for a work-order job. */
  id: string
  documentNumber: string | null
  workOrderId: string | null
  unitId: string | null
  date: string
  laborHours: number | null
  laborRevenue: number | null
  partsRevenue: number | null
  /** Fees and extras: diagnostic, road call, travel, mileage, shop supplies. */
  other: number | null
  tax: number | null
  invoiced: number
  collected: number | null
}

function laborHoursFromInvoiceLines(lineItems: unknown): number | null {
  if (!Array.isArray(lineItems)) return null
  const labor = lineItems.filter(l => l && typeof l === 'object' && String((l as Record<string, unknown>).type ?? '').toLowerCase().startsWith('lab'))
  const hours = labor.map(l => num((l as Record<string, unknown>).mobile_hours as Num)).filter((h): h is number => h != null)
  return hours.length ? r2(hours.reduce((s, h) => s + h, 0)) : null
}

function otherFrom(doc: { diagnostic_fee?: Num; road_call_fee?: Num; travel_amount: Num; mileage_amount: Num; shop_supplies_fee: Num }): number | null {
  const parts = [doc.diagnostic_fee, doc.road_call_fee, doc.travel_amount, doc.mileage_amount, doc.shop_supplies_fee].map(num)
  return parts.every(p => p == null) ? null : r2(parts.reduce<number>((s, p) => s + (p ?? 0), 0))
}

/** What was collected on an invoice, or null when the record cannot say. */
export function collectedOn(status: string | null, total: number): number | null {
  const s = String(status ?? '').toLowerCase()
  if (s === 'paid') return total
  if (s === 'partial') return null
  return 0
}

/** Every job in the range, for one account. */
export function jobsFor(input: RollupInput): Job[] {
  const { userId, range, timeZone } = input
  const mineWo = input.workOrders.filter(w => w.user_id === userId)
  const woById = new Map(mineWo.map(w => [w.id, w]))
  const jobs: Job[] = []

  const liveInvoices = input.invoices.filter(i => i.user_id === userId && String(i.status ?? '').toLowerCase() !== 'void')
  const invoicedWo = new Set(liveInvoices.map(i => i.work_order_id).filter((x): x is string => !!x))

  for (const inv of liveInvoices) {
    const date = localDate(inv.created_at, timeZone)
    if (!inRange(date, range)) continue
    const wo = inv.work_order_id ? woById.get(inv.work_order_id) : undefined
    const total = num(inv.total) ?? 0
    jobs.push({
      source: 'invoice',
      id: inv.id,
      documentNumber: inv.invoice_number,
      workOrderId: inv.work_order_id,
      unitId: inv.unit_id ?? wo?.unit_id ?? null,
      date: date!,
      laborHours: laborHoursFromInvoiceLines(inv.line_items),
      laborRevenue: num(inv.subtotal_labor),
      partsRevenue: num(inv.subtotal_parts),
      other: otherFrom(inv),
      tax: num(inv.tax_amount),
      invoiced: total,
      collected: collectedOn(inv.status, total),
    })
  }

  const linesByWo = new Map<string, WorkOrderLineRow[]>()
  for (const l of input.workOrderLines) linesByWo.set(l.work_order_id, [...(linesByWo.get(l.work_order_id) ?? []), l])

  for (const wo of mineWo) {
    if (invoicedWo.has(wo.id)) continue
    if (!CLOSED_WO.has(String(wo.status ?? '').toLowerCase())) continue
    const total = num(wo.total_amount)
    if (total == null) continue
    const date = localDate(wo.completed_at ?? wo.started_at ?? wo.created_at, timeZone)
    if (!inRange(date, range)) continue

    const lines = linesByWo.get(wo.id) ?? []
    const labor = lines.filter(l => String(l.type ?? '').toLowerCase().startsWith('lab'))
    const parts = lines.filter(l => String(l.type ?? '').toLowerCase().startsWith('part'))
    const laborHours = labor.length
      ? r2(labor.reduce((s, l) => s + (num(l.quantity) ?? 0), 0))
      : num(wo.labor_hours)
    jobs.push({
      source: 'work_order',
      id: wo.id,
      documentNumber: wo.work_order_number,
      workOrderId: wo.id,
      unitId: wo.unit_id,
      date: date!,
      laborHours,
      laborRevenue: labor.length ? r2(labor.reduce((s, l) => s + (num(l.total) ?? 0), 0)) : null,
      partsRevenue: parts.length ? r2(parts.reduce((s, l) => s + (num(l.total) ?? 0), 0)) : null,
      other: otherFrom(wo),
      tax: num(wo.tax_amount),
      invoiced: total,
      // A work order records no payment. Unknown, never 0.
      collected: null,
    })
  }

  return jobs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

// ─── Per category, per unit ─────────────────────────────────────────────────

export const UNCATEGORIZED = '__uncategorized__'
export const NO_UNIT = '__no_unit__'

export interface Totals {
  jobs: number
  jobsFromInvoices: number
  jobsFromWorkOrders: number
  laborHours: PartialSum
  laborRevenue: PartialSum
  partsRevenue: PartialSum
  other: PartialSum
  tax: PartialSum
  invoiced: number
  collected: PartialSum
}

function totalsOf(jobs: Job[]): Totals {
  return {
    jobs: jobs.length,
    jobsFromInvoices: jobs.filter(j => j.source === 'invoice').length,
    jobsFromWorkOrders: jobs.filter(j => j.source === 'work_order').length,
    laborHours: sumPartial(jobs.map(j => j.laborHours)),
    laborRevenue: sumPartial(jobs.map(j => j.laborRevenue)),
    partsRevenue: sumPartial(jobs.map(j => j.partsRevenue)),
    other: sumPartial(jobs.map(j => j.other)),
    tax: sumPartial(jobs.map(j => j.tax)),
    invoiced: r2(jobs.reduce((s, j) => s + j.invoiced, 0)),
    collected: sumPartial(jobs.map(j => j.collected)),
  }
}

export interface CategoryRollup extends Totals {
  key: string
  categoryId: string | null
  name: string
  isActive: boolean
  /** Active units the shop has in this class, serviced or not - the audit's "units in class". */
  unitsInClass: number
  unitsServiced: number
}

export interface UnitRollup extends Totals {
  unitId: string
  unitNumber: string | null
  manufacturer: string | null
  model: string | null
  year: number | null
  serial: string | null
  categoryKey: string
  categoryName: string
  fleetAccountId: string | null
  fleetName: string | null
  lastServiceDate: string
}

interface Resolved {
  units: Map<string, UnitRow>
  categories: Map<string, CategoryRow>
  fleets: Map<string, FleetRow>
}

function resolve(input: RollupInput): Resolved {
  const me = input.userId
  return {
    units: new Map(input.units.filter(u => u.user_id === me).map(u => [u.id, u])),
    categories: new Map(input.categories.filter(c => c.user_id === me).map(c => [c.id, c])),
    fleets: new Map(input.fleets.filter(f => f.user_id === me).map(f => [f.id, f])),
  }
}

function categoryKeyOf(unit: UnitRow | undefined, cats: Map<string, CategoryRow>): string {
  if (!unit) return NO_UNIT
  return unit.category_id && cats.has(unit.category_id) ? unit.category_id : UNCATEGORIZED
}

/**
 * One row per category. Every ACTIVE category appears even with no jobs (the audit's
 * "units in class" needs it); an inactive one appears only when it has units or jobs.
 * "Uncategorized" and "No unit recorded" appear whenever they hold anything.
 */
export function rollupByCategory(input: RollupInput, jobs: Job[] = jobsFor(input)): CategoryRollup[] {
  const r = resolve(input)
  const jobsByKey = new Map<string, Job[]>()
  for (const j of jobs) {
    const key = categoryKeyOf(j.unitId ? r.units.get(j.unitId) : undefined, r.categories)
    jobsByKey.set(key, [...(jobsByKey.get(key) ?? []), j])
  }
  const activeUnits = [...r.units.values()].filter(u => u.active !== false)
  const unitsInKey = (key: string) => activeUnits.filter(u => categoryKeyOf(u, r.categories) === key).length

  const rows: CategoryRollup[] = []
  const cats = [...r.categories.values()].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  for (const c of cats) {
    const js = jobsByKey.get(c.id) ?? []
    const inClass = unitsInKey(c.id)
    if (!c.is_active && js.length === 0 && inClass === 0) continue
    rows.push({
      key: c.id, categoryId: c.id, name: c.name, isActive: c.is_active,
      unitsInClass: inClass, unitsServiced: new Set(js.map(j => j.unitId)).size,
      ...totalsOf(js),
    })
  }
  for (const [key, name] of [[UNCATEGORIZED, 'Uncategorized'], [NO_UNIT, 'No unit recorded']] as const) {
    const js = jobsByKey.get(key) ?? []
    const inClass = key === UNCATEGORIZED ? unitsInKey(key) : 0
    if (js.length === 0 && inClass === 0) continue
    rows.push({
      key, categoryId: null, name, isActive: true,
      unitsInClass: inClass,
      unitsServiced: key === NO_UNIT ? 0 : new Set(js.map(j => j.unitId)).size,
      ...totalsOf(js),
    })
  }
  return rows
}

/** One row per unit with at least one job in the range, most jobs first. */
export function rollupByUnit(input: RollupInput, jobs: Job[] = jobsFor(input)): UnitRollup[] {
  const r = resolve(input)
  const byUnit = new Map<string, Job[]>()
  for (const j of jobs) {
    if (!j.unitId || !r.units.has(j.unitId)) continue
    byUnit.set(j.unitId, [...(byUnit.get(j.unitId) ?? []), j])
  }
  const rows: UnitRollup[] = []
  for (const [unitId, js] of byUnit) {
    const u = r.units.get(unitId)!
    const key = categoryKeyOf(u, r.categories)
    const fleet = u.fleet_account_id ? r.fleets.get(u.fleet_account_id) : undefined
    rows.push({
      unitId,
      unitNumber: u.unit_number, manufacturer: u.manufacturer, model: u.model,
      year: u.year, serial: u.serial_number,
      categoryKey: key,
      categoryName: key === UNCATEGORIZED ? 'Uncategorized' : r.categories.get(key)!.name,
      fleetAccountId: u.fleet_account_id, fleetName: fleet?.fleet_name ?? null,
      lastServiceDate: js.reduce((m, j) => (j.date > m ? j.date : m), js[0].date),
      ...totalsOf(js),
    })
  }
  return rows.sort((a, b) => b.jobs - a.jobs || b.invoiced - a.invoiced || String(a.unitNumber).localeCompare(String(b.unitNumber)))
}

// ─── Custody figures for the audit packet cover ─────────────────────────────

export interface PossessionPeak {
  /** Most units open on a work order on any one day, and the first day it happened. */
  peakUnits: number
  peakDate: string | null
  /** Of those, how many are not a recorded unit (a work order with no unit_id). */
  unlinkedAtPeak: number
  /** Sum of estimated_value over the units in possession that day, where recorded. */
  knownValueAtPeak: number | null
  /** Units in possession that day with no estimated_value - the value figure excludes them. */
  unitsWithoutValueAtPeak: number
  /** Work orders left out because they are imported history, with no custody dates. */
  importedExcluded: number
}

function addDays(d: string, n: number): string {
  const t = new Date(`${d}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}

/**
 * Peak concurrent units in possession, from work order open and close dates.
 *
 * A work order holds its unit from the day it opened (arrived_at, else started_at,
 * else created_at) to the day it closed (completed_at). One still open holds it to
 * the end of the range. A unit on two open work orders is ONE unit; a work order with
 * no unit_id is counted as its own unidentified unit, and said so. Imported history
 * is left out: it records an invoice date, not when the unit was in the shop.
 */
export function peakUnitsInPossession(input: RollupInput): PossessionPeak {
  const { userId, range, timeZone } = input
  const r = resolve(input)
  let importedExcluded = 0
  const spans: Array<{ key: string; unitId: string | null; open: string; close: string }> = []

  for (const wo of input.workOrders) {
    if (wo.user_id !== userId) continue
    if (DEAD_WO.has(String(wo.status ?? '').toLowerCase())) continue
    if (isImportedHistory(wo)) { importedExcluded++; continue }
    const open = localDate(wo.arrived_at ?? wo.started_at ?? wo.created_at, timeZone)
    if (!open) continue
    const closed = localDate(wo.completed_at, timeZone)
    const close = closed ?? range.to
    if (close < range.from || open > range.to) continue
    const unitId = wo.unit_id && r.units.has(wo.unit_id) ? wo.unit_id : null
    spans.push({ key: unitId ?? `wo:${wo.id}`, unitId, open, close })
  }

  let best: PossessionPeak = {
    peakUnits: 0, peakDate: null, unlinkedAtPeak: 0,
    knownValueAtPeak: null, unitsWithoutValueAtPeak: 0, importedExcluded,
  }
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    const here = new Map<string, string | null>()
    for (const s of spans) if (s.open <= d && s.close >= d) here.set(s.key, s.unitId)
    if (here.size <= best.peakUnits) continue
    let known = 0, knownCount = 0, unknown = 0, unlinked = 0
    for (const unitId of here.values()) {
      if (!unitId) { unlinked++; unknown++; continue }
      const v = num(r.units.get(unitId)!.estimated_value)
      if (v == null) unknown++
      else { known += v; knownCount++ }
    }
    best = {
      peakUnits: here.size, peakDate: d, unlinkedAtPeak: unlinked,
      knownValueAtPeak: knownCount ? r2(known) : null,
      unitsWithoutValueAtPeak: unknown, importedExcluded,
    }
  }
  return best
}

export interface AuthorizationGap {
  /** Work orders opened in the range with no recorded authorization. Should be 0. */
  missing: number
  workOrderNumbers: string[]
  checked: number
  importedExcluded: number
}

/** Work orders opened in the range with authorized_at empty. Imported history excluded. */
export function workOrdersMissingAuthorization(input: RollupInput): AuthorizationGap {
  const { userId, range, timeZone } = input
  let checked = 0, importedExcluded = 0
  const missing: string[] = []
  for (const wo of input.workOrders) {
    if (wo.user_id !== userId) continue
    if (DEAD_WO.has(String(wo.status ?? '').toLowerCase())) continue
    if (!inRange(localDate(wo.created_at, timeZone), range)) continue
    if (isImportedHistory(wo)) { importedExcluded++; continue }
    checked++
    if (!wo.authorized_at) missing.push(wo.work_order_number ?? wo.id)
  }
  return { missing: missing.length, workOrderNumbers: missing, checked, importedExcluded }
}
