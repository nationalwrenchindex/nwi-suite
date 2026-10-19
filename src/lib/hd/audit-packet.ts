// The audit packet (spec 5.3): one record per work order, assembled from what the
// documents recorded. Nothing new is collected; nothing is recomputed.
//
// PURE. The loader (audit-load.ts) reads the rows; this file decides which work orders
// belong in the packet and what each one says. The PDF and the CSV are both drawn from
// the AuditPacket this returns.
//
// WHICH WORK ORDERS. Opened (created_at, the shop's calendar day) inside the range, not
// cancelled, and not imported history - an imported row records an invoice, not a job
// NWI saw, and has no authorization record to show. The cover says how many were left
// out and why. This is the same population workOrdersMissingAuthorization() checks,
// so the cover's count and the pages always agree.
//
// RECORDED VALUES, AND THE COLUMN TRAP.
//   hd_quotes.line_items     parts unit_cost is the SELL price; unit_cost_base is the
//                            shop's cost and is never read here.
//   hd_invoices.line_items   same as the quote; labor hours are in mobile_hours.
//   hd_work_order_line_items unit_price is SELL, unit_cost is COST. The loader does not
//                            even select unit_cost.
//   The unit on a work order is the work order's own recorded fields first; the linked
//   hd_units row fills only what the document left empty, and the packet says which.
//
// WHO APPROVED IS NOT RECORDED ANYWHERE IN THE DATABASE - no name, identity or IP. The
// packet prints "Not recorded" for it rather than inventing one.

import {
  peakUnitsInPossession, workOrdersMissingAuthorization, isImportedHistory, localDate,
  UNCATEGORIZED, NO_UNIT,
  type RollupInput, type PossessionPeak, type AuthorizationGap,
} from './equipment-rollup'
import { categoryLabel, type AuditLabels } from './audit-labels'
import { toCsv, type CsvValue } from './audit-csv'
import type { ShopHeader } from './audit-schedule'

type Num = number | string | null | undefined
type Txt = string | null | undefined

// ─── Rows, as the loader reads them. Optional: a column a migration has not added
// yet arrives as undefined and reads as not recorded. ────────────────────────

export interface PacketWorkOrderRow {
  id: string; user_id: string
  work_order_number?: Txt; status?: Txt; service_type?: Txt
  created_at: string; completed_at?: Txt
  unit_id?: Txt; fleet_account_id?: Txt; customer_name?: Txt
  unit_number?: Txt; unit_manufacturer?: Txt; unit_model?: Txt; unit_year?: Txt
  unit_serial?: Txt; vin?: Txt; truck_make?: Txt; truck_model?: Txt; truck_year?: Txt
  quote_id?: Txt; tech_name?: Txt; labor_rate?: Num
  authorized_at?: Txt; authorization_method?: Txt; customer_po_number?: Txt
}

export interface PacketQuoteRow {
  id: string; user_id: string
  quote_number?: Txt; status?: Txt; created_at?: Txt
  line_items?: unknown; labor_rate?: Num
  subtotal_labor?: Num; subtotal_parts?: Num
  diagnostic_fee?: Num; road_call_fee?: Num; travel_amount?: Num; mileage_amount?: Num; shop_supplies_fee?: Num
  tax_amount?: Num; total?: Num
  approved_at?: Txt; approval_method?: Txt; customer_response_note?: Txt; customer_po_number?: Txt
}

export interface PacketInvoiceRow {
  id: string; user_id: string
  invoice_number?: Txt; work_order_id?: Txt; status?: Txt; created_at: string
  total?: Num; line_items?: unknown; labor_rate?: Num; tech_name?: Txt
}

/** hd_work_order_line_items, SELL side only: unit_price is sell, total is sell. */
export interface PacketWoLineRow {
  work_order_id: string; type?: Txt; description?: Txt; part_number?: Txt
  quantity?: Num; unit_price?: Num; total?: Num; sort_order?: number | null
}

export interface PacketInput {
  rollup: RollupInput
  workOrders: PacketWorkOrderRow[]
  quotes: PacketQuoteRow[]
  invoices: PacketInvoiceRow[]
  workOrderLines: PacketWoLineRow[]
  /** Columns the loader had to drop because a migration is not applied. */
  missingColumns?: string[]
}

// ─── What one page says ─────────────────────────────────────────────────────

export interface PacketQuoteLine {
  type: string
  description: string | null
  partNumber: string | null
  /** Parts: quantity. Labor: null (hours are in `hours`). */
  quantity: number | null
  /** Labor: mobile_hours as stored. */
  hours: number | null
  /** Parts: the SELL price per unit as stored (quote unit_cost). */
  unitPrice: number | null
  amount: number | null
}

export interface PacketPartLine { description: string | null; partNumber: string | null; quantity: number | null; unitPrice: number | null; amount: number | null }
export interface PacketLaborLine { description: string | null; hours: number | null; rate: number | null; amount: number | null }

export interface PacketEntry {
  workOrderId: string
  workOrderNumber: string | null
  status: string | null
  unit: {
    linked: boolean
    identifier: string | null
    classKey: string
    classLabel: string
    make: string | null
    model: string | null
    year: string | null
    serial: string | null
    vin: string | null
    truck: string | null
    /** Fields the work order left empty and the linked unit record filled. */
    filledFromUnitRecord: string[]
  }
  customer: string | null
  fleetAccount: string | null
  opened: string | null
  closed: string | null
  invoiced: string | null
  authorization: {
    authorizedAt: string | null
    method: string | null
    poNumber: string | null
    quoteApprovedAt: string | null
    quoteApprovalMethod: string | null
    quoteResponseNote: string | null
    /** Always null: NWI records no approver. Kept as a field so it prints, not hides. */
    approvedBy: null
  }
  quote: null | {
    number: string | null
    status: string | null
    laborRate: number | null
    lines: PacketQuoteLine[]
    subtotalLabor: number | null
    subtotalParts: number | null
    diagnosticFee: number | null
    roadCallFee: number | null
    travel: number | null
    mileage: number | null
    shopSupplies: number | null
    tax: number | null
    total: number | null
  }
  /** Where parts and labor were read from. */
  linesSource: 'invoice' | 'work_order' | 'none'
  parts: PacketPartLine[]
  labor: PacketLaborLine[]
  techWorkOrder: string | null
  techInvoice: string | null
  invoice: null | { number: string | null; status: string | null; total: number | null; date: string | null }
}

export interface AuditPacket {
  range: { from: string; to: string }
  timeZone: string
  generatedAt: string
  shop: ShopHeader
  labels: AuditLabels
  entries: PacketEntry[]
  importedExcluded: number
  cancelledExcluded: number
  peak: PossessionPeak
  authorization: AuthorizationGap
  missingColumns: string[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const txt = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s.length ? s : null
}
const DEAD_WO = new Set(['cancelled', 'canceled', 'void'])
const inRange = (d: string | null, r: { from: string; to: string }) => d != null && d >= r.from && d <= r.to

function asLines(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((l): l is Record<string, unknown> => !!l && typeof l === 'object') : []
}
const kindOf = (l: Record<string, unknown>) => String(l.type ?? '').toLowerCase()
const isLabor = (k: string) => k.startsWith('lab')
const isPart = (k: string) => k.startsWith('part')

/** A quote's line as presented: SELL prices only, unit_cost_base never read. */
function quoteLine(l: Record<string, unknown>): PacketQuoteLine {
  const k = kindOf(l)
  const labor = isLabor(k)
  return {
    type: labor ? 'labor' : isPart(k) ? 'parts' : (txt(l.type) ?? 'other'),
    description: txt(l.description),
    partNumber: txt(l.part_number),
    quantity: labor ? null : num(l.quantity),
    hours: labor ? num(l.mobile_hours) : null,
    unitPrice: labor ? null : num(l.unit_cost),
    amount: num(l.amount),
  }
}

/** The invoice to show for a work order: a live one, latest first; a void one only if nothing else. */
function pickInvoice(invs: PacketInvoiceRow[]): PacketInvoiceRow | null {
  if (!invs.length) return null
  const sorted = [...invs].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
  return sorted.find(i => String(i.status ?? '').toLowerCase() !== 'void') ?? sorted[0]
}

// ─── Assembly ───────────────────────────────────────────────────────────────

export function buildAuditPacket(
  input: PacketInput,
  shop: ShopHeader,
  labels: AuditLabels,
  now: Date = new Date(),
): AuditPacket {
  const { rollup } = input
  const me = rollup.userId
  const tz = rollup.timeZone
  const range = rollup.range

  const units = new Map(rollup.units.filter(u => u.user_id === me).map(u => [u.id, u]))
  const cats = new Map(rollup.categories.filter(c => c.user_id === me).map(c => [c.id, c]))
  const fleets = new Map(rollup.fleets.filter(f => f.user_id === me).map(f => [f.id, f]))
  const quotes = new Map(input.quotes.filter(q => q.user_id === me).map(q => [q.id, q]))
  const invByWo = new Map<string, PacketInvoiceRow[]>()
  for (const i of input.invoices) {
    if (i.user_id !== me || !i.work_order_id) continue
    invByWo.set(i.work_order_id, [...(invByWo.get(i.work_order_id) ?? []), i])
  }
  const linesByWo = new Map<string, PacketWoLineRow[]>()
  for (const l of input.workOrderLines) linesByWo.set(l.work_order_id, [...(linesByWo.get(l.work_order_id) ?? []), l])

  let importedExcluded = 0, cancelledExcluded = 0
  const entries: PacketEntry[] = []

  const mine = input.workOrders
    .filter(w => w.user_id === me)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0) ||
      String(a.work_order_number ?? '').localeCompare(String(b.work_order_number ?? ''), 'en', { numeric: true }))

  for (const wo of mine) {
    if (!inRange(localDate(wo.created_at, tz), range)) continue
    if (DEAD_WO.has(String(wo.status ?? '').toLowerCase())) { cancelledExcluded++; continue }
    if (isImportedHistory({ service_type: wo.service_type ?? null })) { importedExcluded++; continue }

    // The unit: the document's own fields, then the linked record for the gaps.
    const u = wo.unit_id ? units.get(wo.unit_id) : undefined
    const filled: string[] = []
    const pick = (field: string, own: unknown, fromUnit: unknown): string | null => {
      const o = txt(own)
      if (o) return o
      const f = txt(fromUnit)
      if (f) filled.push(field)
      return f
    }
    const identifier = pick('unit identifier', wo.unit_number, u?.unit_number)
    const make = pick('make', wo.unit_manufacturer, u?.manufacturer)
    const model = pick('model', wo.unit_model, u?.model)
    const year = pick('year', wo.unit_year, u?.year)
    const serial = pick('serial', wo.unit_serial, u?.serial_number)
    const truck = [txt(wo.truck_year), txt(wo.truck_make), txt(wo.truck_model)].filter(Boolean).join(' ') || null

    const classKey = !u ? NO_UNIT : u.category_id && cats.has(u.category_id) ? u.category_id : UNCATEGORIZED
    const ownClassName = classKey === NO_UNIT ? 'No unit recorded' : classKey === UNCATEGORIZED ? 'Uncategorized' : cats.get(classKey)!.name
    const fleetId = txt(wo.fleet_account_id) ?? u?.fleet_account_id ?? null
    const fleet = fleetId ? fleets.get(fleetId) : undefined

    const q = wo.quote_id ? quotes.get(wo.quote_id) : undefined
    const inv = pickInvoice(invByWo.get(wo.id) ?? [])
    const liveInv = inv && String(inv.status ?? '').toLowerCase() !== 'void' ? inv : null

    let linesSource: PacketEntry['linesSource'] = 'none'
    const parts: PacketPartLine[] = []
    const labor: PacketLaborLine[] = []
    if (liveInv) {
      linesSource = 'invoice'
      const rate = num(liveInv.labor_rate)
      for (const l of asLines(liveInv.line_items)) {
        const k = kindOf(l)
        // Invoice parts: unit_cost is SELL. unit_cost_base (cost) is never read.
        if (isPart(k)) parts.push({ description: txt(l.description), partNumber: txt(l.part_number), quantity: num(l.quantity), unitPrice: num(l.unit_cost), amount: num(l.amount) })
        else if (isLabor(k)) labor.push({ description: txt(l.description), hours: num(l.mobile_hours), rate, amount: num(l.amount) })
      }
    } else {
      const rows = [...(linesByWo.get(wo.id) ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      if (rows.length) linesSource = 'work_order'
      for (const l of rows) {
        const k = String(l.type ?? '').toLowerCase()
        // Work order lines: unit_price is SELL; quantity is hours on a labor line.
        if (isPart(k)) parts.push({ description: txt(l.description), partNumber: txt(l.part_number), quantity: num(l.quantity), unitPrice: num(l.unit_price), amount: num(l.total) })
        else if (isLabor(k)) labor.push({ description: txt(l.description), hours: num(l.quantity), rate: num(l.unit_price) ?? num(wo.labor_rate), amount: num(l.total) })
      }
    }

    entries.push({
      workOrderId: wo.id,
      workOrderNumber: txt(wo.work_order_number),
      status: txt(wo.status),
      unit: {
        linked: !!u, identifier, classKey, classLabel: categoryLabel(labels, classKey, ownClassName),
        make, model, year, serial, vin: txt(wo.vin), truck, filledFromUnitRecord: filled,
      },
      customer: txt(wo.customer_name),
      fleetAccount: txt(fleet?.fleet_name),
      opened: localDate(wo.created_at, tz),
      closed: localDate(wo.completed_at ?? null, tz),
      invoiced: inv ? localDate(inv.created_at, tz) : null,
      authorization: {
        authorizedAt: txt(wo.authorized_at),
        method: txt(wo.authorization_method),
        poNumber: txt(wo.customer_po_number) ?? txt(q?.customer_po_number),
        quoteApprovedAt: txt(q?.approved_at),
        quoteApprovalMethod: txt(q?.approval_method),
        quoteResponseNote: txt(q?.customer_response_note),
        approvedBy: null,
      },
      quote: q ? {
        number: txt(q.quote_number),
        status: txt(q.status),
        laborRate: num(q.labor_rate),
        lines: asLines(q.line_items).map(quoteLine),
        subtotalLabor: num(q.subtotal_labor),
        subtotalParts: num(q.subtotal_parts),
        diagnosticFee: num(q.diagnostic_fee),
        roadCallFee: num(q.road_call_fee),
        travel: num(q.travel_amount),
        mileage: num(q.mileage_amount),
        shopSupplies: num(q.shop_supplies_fee),
        tax: num(q.tax_amount),
        total: num(q.total),
      } : null,
      linesSource,
      parts,
      labor,
      techWorkOrder: txt(wo.tech_name),
      techInvoice: inv ? txt(inv.tech_name) : null,
      invoice: inv ? { number: txt(inv.invoice_number), status: txt(inv.status), total: num(inv.total), date: localDate(inv.created_at, tz) } : null,
    })
  }

  return {
    range: { ...range },
    timeZone: tz,
    generatedAt: now.toISOString(),
    shop,
    labels,
    entries,
    importedExcluded,
    cancelledExcluded,
    peak: peakUnitsInPossession(rollup),
    authorization: workOrdersMissingAuthorization(rollup),
    missingColumns: [...(input.missingColumns ?? [])],
  }
}

// ─── Words for the cover, shared by the PDF and the tests ───────────────────

export const APPROVER_STATEMENT =
  'NWI Suite records no approver name, identity or IP address for a quote approval. ' +
  'The authorization record below is the approval time, the approval method and the ' +
  'customer purchase order number, exactly as stored; "Approved by" reads Not recorded on every page.'

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The peak value exposure sentence. Missing values are never treated as 0. */
export function peakValueStatement(p: PossessionPeak): string {
  if (p.peakUnits === 0) return 'Not applicable - no units were in possession on any day of the period.'
  const withValue = p.peakUnits - p.unitsWithoutValueAtPeak
  if (p.knownValueAtPeak == null || withValue === 0) {
    return `Not recorded - none of the ${p.peakUnits} unit${p.peakUnits === 1 ? '' : 's'} in possession on that day has a recorded value.`
  }
  if (p.unitsWithoutValueAtPeak > 0) {
    return `${usd(p.knownValueAtPeak)} for ${withValue} unit${withValue === 1 ? '' : 's'}; ` +
      `${p.unitsWithoutValueAtPeak} unit${p.unitsWithoutValueAtPeak === 1 ? '' : 's'} in possession ${p.unitsWithoutValueAtPeak === 1 ? 'has' : 'have'} no recorded value, so the true figure is higher.`
  }
  return `${usd(p.knownValueAtPeak)} (every unit in possession that day has a recorded value).`
}

// ─── CSV: one row per work order, the same rows as the PDF pages ────────────

export const PACKET_CSV_HEADER = [
  'work_order_number', 'work_order_status', 'date_opened', 'date_closed', 'date_invoiced',
  'customer', 'fleet_account',
  'unit_identifier', 'equipment_class', 'make', 'model', 'year', 'serial', 'vin', 'truck',
  'unit_fields_from_unit_record',
  'authorized_at', 'authorization_method', 'customer_po_number',
  'quote_number', 'quote_approved_at', 'quote_approval_method', 'quote_customer_response_note',
  'approved_by', 'approved_by_recorded',
  'quote_labor_rate', 'quote_tax', 'quote_total',
  'lines_source', 'parts_installed', 'parts_line_count', 'parts_amount_recorded',
  'labor_line_count', 'labor_hours_recorded', 'labor_lines_without_hours', 'labor_amount_recorded', 'labor_rates_recorded',
  'tech_work_order', 'tech_invoice',
  'invoice_number', 'invoice_status', 'invoice_total',
]

const r2 = (n: number) => Math.round(n * 100) / 100
function sumKnown(xs: Array<number | null>): number | null {
  const k = xs.filter((x): x is number => x != null)
  return k.length ? r2(k.reduce((s, x) => s + x, 0)) : null
}

export function auditPacketCsv(p: AuditPacket): string {
  const rows: CsvValue[][] = p.entries.map(e => {
    const partsList = e.parts.map(l =>
      `${l.quantity ?? '?'} x ${[l.description, l.partNumber ? `(${l.partNumber})` : null].filter(Boolean).join(' ') || 'part'}` +
      (l.unitPrice != null ? ` @ ${l.unitPrice}` : '') + (l.amount != null ? ` = ${l.amount}` : '')).join('; ')
    const rates = [...new Set(e.labor.map(l => l.rate).filter((r): r is number => r != null))].join('; ')
    return [
      e.workOrderNumber, e.status, e.opened, e.closed, e.invoiced,
      e.customer, e.fleetAccount,
      e.unit.identifier, e.unit.classLabel, e.unit.make, e.unit.model, e.unit.year, e.unit.serial, e.unit.vin, e.unit.truck,
      e.unit.filledFromUnitRecord.join('; ') || null,
      e.authorization.authorizedAt, e.authorization.method, e.authorization.poNumber,
      e.quote?.number, e.authorization.quoteApprovedAt, e.authorization.quoteApprovalMethod, e.authorization.quoteResponseNote,
      null, false,
      e.quote?.laborRate, e.quote?.tax, e.quote?.total,
      e.linesSource, partsList || null, e.parts.length, sumKnown(e.parts.map(l => l.amount)),
      e.labor.length, sumKnown(e.labor.map(l => l.hours)), e.labor.filter(l => l.hours == null).length,
      sumKnown(e.labor.map(l => l.amount)), rates || null,
      e.techWorkOrder, e.techInvoice,
      e.invoice?.number, e.invoice?.status, e.invoice?.total,
    ]
  })
  return toCsv(PACKET_CSV_HEADER, rows)
}
