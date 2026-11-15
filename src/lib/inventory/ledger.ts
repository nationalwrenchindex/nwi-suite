// The stock ledger. ONE implementation, used by LD and HD.
//
// ===========================================================================
// THE RULES, AND WHERE EACH ONE IS ENFORCED
// ===========================================================================
//
//   on_hand only ever moves via a movement row      migration 151 trigger
//                                                   guard_inventory_on_hand refuses
//                                                   any other write
//   an invoice cannot deduct twice                  migration 151 partial unique index
//                                                   stock_movement_one_use_per_source,
//                                                   caught here as 23505
//   the cost on the invoice is the cost at use      stock_movement.unit_cost, copied at
//                                                   deduction and never recomputed
//   open work order = ALLOCATED, not deducted       stock_allocation; on_hand untouched
//   available = on_hand - allocated                 view inventory_position
//   negative stock is allowed but flagged           no CHECK on on_hand; the view
//                                                   exposes `negative`
//   per location                                    every row carries location_id
//
// WHY ONE FILE FOR BOTH PRODUCTS
//
// LD keeps work-order lines in work_orders.line_items (JSONB) and HD keeps them in
// hd_work_order_line_items (rows), but BOTH invoices store lines as a line_items JSONB
// array. So the two shapes are normalized to one `StockLine[]` at the edge and
// everything after that is shared. Two implementations of a deduction is how the two
// products end up disagreeing about what is on the shelf.

import { createServiceClient } from '@/lib/supabase/service'
import { normalizePartNumber } from '@/lib/parts/search'

export type MovementReason =
  | 'received' | 'used' | 'adjusted'
  | 'transferred_in' | 'transferred_out' | 'returned' | 'opening'
  // Migration 189. The customer refused the repair and the parts came back, on an
  // invoice whose money is frozen. Distinct from 'returned' (a refresh billing fewer,
  // or a deleted draft) so a refresh can refuse an invoice carrying one.
  | 'customer_returned'

export const CUSTOMER_RETURN_REASON = 'customer_returned' as const

/** A part this movement left below zero. Warned about, never blocked. */
export interface NegativeStock {
  partId: string
  partNumber: string
  onHand: number
  locationName: string | null
}

export type WorkOrderKind = 'ld' | 'hd'

/** A part line, normalized from whichever shape the caller had. */
export interface StockLine {
  partNumber: string
  quantity: number
  /** What the tech paid. Null means unknown - NOT zero. */
  unitCost: number | null
}

export interface LedgerResult {
  /** Movements actually written. */
  written: number
  /** Lines whose part number is not in the catalog, so no stock could move. */
  unmatched: string[]
  /** Already deducted - the ledger refused a duplicate. Not an error. */
  alreadyApplied: string[]
  errors: string[]
  /**
   * Parts a deduction here left below zero, with the count they now stand at. A
   * warning for the screen, never a refusal: the tech is at the truck and the job is
   * real. Absent on a call that took nothing off the shelf.
   */
  negative?: NegativeStock[]
}

type Supabase = ReturnType<typeof createServiceClient>

// ── reading lines out of the two shapes ─────────────────────────────────────

/**
 * Pull part lines out of a line_items JSONB array.
 *
 * Both invoices and LD work orders store this shape. A line counts as a part when it
 * has a part number; labour has none. `type` is checked loosely because LD writes
 * 'parts' and HD writes 'part'.
 */
export function partLinesFromJson(lineItems: unknown): StockLine[] {
  if (!Array.isArray(lineItems)) return []
  const out: StockLine[] = []
  for (const raw of lineItems) {
    if (!raw || typeof raw !== 'object') continue
    const li = raw as Record<string, unknown>
    const type = String(li.type ?? '').toLowerCase()
    if (type === 'labor' || type === 'labour') continue

    const partNumber = typeof li.part_number === 'string' ? li.part_number.trim() : ''
    if (!partNumber) continue

    const qty = Number(li.quantity ?? 1)
    if (!Number.isFinite(qty) || qty <= 0) continue

    // THE COST IS unit_cost_base, NEVER unit_cost. On an HD invoice line unit_cost is
    // the SELL price and unit_cost_base is what the shop paid (the Oct 14 column trap),
    // and reading unit_cost wrote the sell price into the ledger as cost: a part bought
    // at $12.34 and billed at $16.04 left a "used" movement at $16.04. LD invoice lines
    // carry no cost at all (unit_price only). A line with no unit_cost_base - a part
    // priced by hand with no cost entered - records an UNKNOWN cost, not its sell price.
    const cost = li.unit_cost_base == null || li.unit_cost_base === '' ? null : Number(li.unit_cost_base)
    out.push({
      partNumber,
      quantity: Math.round(qty),
      unitCost: Number.isFinite(cost as number) ? (cost as number) : null,
    })
  }
  return out
}

/** HD work-order lines, which live in their own table rather than a JSONB column. */
export function partLinesFromRows(rows: Array<Record<string, unknown>>): StockLine[] {
  const out: StockLine[] = []
  for (const r of rows) {
    if (String(r.type ?? '').toLowerCase() !== 'part') continue
    const partNumber = typeof r.part_number === 'string' ? r.part_number.trim() : ''
    if (!partNumber) continue
    const qty = Number(r.quantity ?? 1)
    if (!Number.isFinite(qty) || qty <= 0) continue
    const cost = r.unit_cost == null ? null : Number(r.unit_cost)
    out.push({
      partNumber,
      quantity: Math.round(qty),
      unitCost: Number.isFinite(cost as number) ? (cost as number) : null,
    })
  }
  return out
}

/**
 * Collapse lines to one entry per part.
 *
 * REQUIRED by the double-deduction index, which allows one 'used' movement per
 * (document, part, location). An invoice with the same filter on two lines must
 * produce one movement for the total, not two that collide.
 *
 * The cost carried forward is the first NON-NULL cost seen. Averaging would invent a
 * number that appears on no line of the invoice.
 */
export function aggregateLines(lines: StockLine[]): StockLine[] {
  const byPart = new Map<string, StockLine>()
  for (const l of lines) {
    const key = normalizePartNumber(l.partNumber)
    const cur = byPart.get(key)
    if (!cur) { byPart.set(key, { ...l }); continue }
    cur.quantity += l.quantity
    if (cur.unitCost == null && l.unitCost != null) cur.unitCost = l.unitCost
  }
  return [...byPart.values()]
}

// ── catalog and location resolution ─────────────────────────────────────────

/**
 * Part numbers to catalog ids, matched on the NORMALIZED number so 78-1341 and 781341
 * resolve to the same part.
 */
export async function resolvePartIds(
  supabase: Supabase,
  partNumbers: string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(partNumbers.map(normalizePartNumber))].filter(Boolean)
  if (!wanted.length) return new Map()

  const { data, error } = await supabase
    .from('parts')
    .select('id, part_number_normalized')
    .in('part_number_normalized', wanted)

  if (error) {
    console.error('[ledger] part resolution failed:', error.message)
    return new Map()
  }
  return new Map((data ?? []).map(p => [String(p.part_number_normalized), String(p.id)]))
}

/**
 * The location a movement defaults to.
 *
 * Creates the shop as the default on first use, so a subscriber who has never opened
 * the inventory screens still gets a working deduction instead of a crash. A
 * technician who IS at a truck passes that location explicitly.
 */
export async function defaultLocationId(
  supabase: Supabase,
  userId: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('stock_location')
    .select('id')
    .eq('user_id', userId)
    .eq('is_default', true)
    .maybeSingle()
  if (existing?.id) return String(existing.id)

  const { data: anyLoc } = await supabase
    .from('stock_location')
    .select('id')
    .eq('user_id', userId)
    .eq('active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (anyLoc?.id) return String(anyLoc.id)

  const { data: made, error } = await supabase
    .from('stock_location')
    .insert({ user_id: userId, name: 'Shop', kind: 'shop', is_default: true })
    .select('id')
    .single()
  if (error) {
    console.error('[ledger] could not create a default location:', error.message)
    return null
  }
  return String(made.id)
}

// ── the movement writer ─────────────────────────────────────────────────────

interface MovementInput {
  userId: string
  partId: string
  locationId: string
  delta: number
  reason: MovementReason
  unitCost?: number | null
  sourceType?: string | null
  sourceId?: string | null
  sourceRef?: string | null
  transferId?: string | null
  note?: string | null
  createdBy?: string | null
}

/** Postgres unique violation - here it means "this document already moved this part". */
const UNIQUE_VIOLATION = '23505'

async function writeMovement(
  supabase: Supabase,
  m: MovementInput,
): Promise<{ ok: boolean; duplicate: boolean; error?: string }> {
  if (m.delta === 0) return { ok: true, duplicate: false }

  const { error } = await supabase.from('stock_movement').insert({
    user_id:     m.userId,
    part_id:     m.partId,
    location_id: m.locationId,
    delta:       m.delta,
    reason:      m.reason,
    unit_cost:   m.unitCost ?? null,
    source_type: m.sourceType ?? null,
    source_id:   m.sourceId ?? null,
    source_ref:  m.sourceRef ?? null,
    transfer_id: m.transferId ?? null,
    note:        m.note ?? null,
    created_by:  m.createdBy ?? null,
  })

  if (!error) return { ok: true, duplicate: false }
  if (error.code === UNIQUE_VIOLATION) {
    // The ledger refused a second 'used' movement for this document. That is the
    // re-finalize guard working, not a failure.
    return { ok: true, duplicate: true }
  }
  return { ok: false, duplicate: false, error: error.message }
}

// ── deduct on finalize ──────────────────────────────────────────────────────

/**
 * Deduct the parts on a FINALIZED invoice.
 *
 * Called from invoice finalize for both products. Safe to call repeatedly: the unique
 * index means a second call writes nothing and reports the parts as alreadyApplied.
 *
 * The cost written onto each movement is the cost ON THE INVOICE LINE - the figure the
 * customer was billed against - not inventory.last_cost. Receiving the same part at a
 * new price tomorrow changes last_cost and must not touch this.
 */
export async function deductForInvoice(opts: {
  userId: string
  invoiceKind: 'ld' | 'hd'
  invoiceId: string
  invoiceRef?: string | null
  lineItems: unknown
  locationId?: string | null
  createdBy?: string | null
}): Promise<LedgerResult> {
  const supabase = createServiceClient()
  const result: LedgerResult = { written: 0, unmatched: [], alreadyApplied: [], errors: [] }

  const lines = aggregateLines(partLinesFromJson(opts.lineItems))
  if (!lines.length) return result

  const locationId = opts.locationId ?? await defaultLocationId(supabase, opts.userId)
  if (!locationId) {
    result.errors.push('No stock location available, so nothing could be deducted.')
    return result
  }

  const ids = await resolvePartIds(supabase, lines.map(l => l.partNumber))
  const deducted: string[] = []

  for (const line of lines) {
    const partId = ids.get(normalizePartNumber(line.partNumber))
    if (!partId) {
      // Not in the catalog. Reported rather than silently skipped - an invoice billing
      // a part we do not stock is a real thing, and the counter should not pretend the
      // shelf changed.
      result.unmatched.push(line.partNumber)
      continue
    }

    const res = await writeMovement(supabase, {
      userId: opts.userId,
      partId,
      locationId,
      delta: -line.quantity,
      reason: 'used',
      unitCost: line.unitCost,
      sourceType: opts.invoiceKind === 'ld' ? 'invoice' : 'hd_invoice',
      sourceId: opts.invoiceId,
      sourceRef: opts.invoiceRef ?? null,
      createdBy: opts.createdBy ?? null,
      note: `Billed on ${opts.invoiceRef ?? opts.invoiceId}`,
    })

    if (res.duplicate) result.alreadyApplied.push(line.partNumber)
    else if (res.ok) { result.written++; deducted.push(partId) }
    else result.errors.push(`${line.partNumber}: ${res.error}`)
  }

  result.negative = await negativeStock(supabase, opts.userId, deducted)
  return result
}

// ── re-bill an existing invoice: move the DIFFERENCE ───────────────────────

/** One movement this document already wrote. */
export interface DocMovement { partId: string; locationId: string; delta: number; reason: string; unitCost?: number | null }
/** One part the refreshed document now bills, already resolved to the catalog. */
export interface TargetPart { partId: string; partNumber: string; quantity: number; unitCost: number | null }
export interface PlannedMovement {
  partId: string; partNumber: string; locationId: string
  delta: number; reason: 'used' | 'adjusted' | 'returned'; unitCost: number | null
  was: number; now: number
}

/**
 * The movements that bring what an invoice has taken off the shelf to what it now
 * bills. Pure.
 *
 * The invoice's net use of a part is minus the sum of every movement it wrote for that
 * part, at every location. The plan writes only the gap:
 *   nothing taken yet          'used' for the whole quantity (what creation would write)
 *   bills more than it took    'adjusted', minus the extra
 *   bills less (or none)       'returned', plus the surplus
 * A second 'used' row is never planned - the migration 151 index refuses one per
 * (document, part, location), which is what makes a repeat refresh a no-op rather than
 * a second deduction. The movement goes to the location the invoice already took that
 * part from, else the default.
 */
export function planInvoiceStockDiff(
  existing: DocMovement[],
  target: TargetPart[],
  defaultLocationId: string,
  partNumberOf: (partId: string) => string = id => id,
): PlannedMovement[] {
  const taken = new Map<string, number>()
  const where = new Map<string, Map<string, number>>()
  const usedAt = new Set<string>()
  // The cost the invoice took each part at, so a return carries what was paid for it.
  const costOf = new Map<string, number>()
  for (const m of existing) {
    taken.set(m.partId, (taken.get(m.partId) ?? 0) - m.delta)
    const locs = where.get(m.partId) ?? new Map<string, number>()
    locs.set(m.locationId, (locs.get(m.locationId) ?? 0) - m.delta)
    where.set(m.partId, locs)
    if (m.reason === 'used') usedAt.add(`${m.partId}|${m.locationId}`)
    if (m.unitCost != null && !costOf.has(m.partId)) costOf.set(m.partId, m.unitCost)
  }
  const want = new Map<string, TargetPart>()
  for (const t of target) {
    const cur = want.get(t.partId)
    if (cur) { cur.quantity += t.quantity; if (cur.unitCost == null) cur.unitCost = t.unitCost }
    else want.set(t.partId, { ...t })
  }
  const out: PlannedMovement[] = []
  for (const partId of new Set([...taken.keys(), ...want.keys()])) {
    const was = taken.get(partId) ?? 0
    const t = want.get(partId)
    const now = t?.quantity ?? 0
    const gap = now - was
    if (gap === 0) continue
    const locs = [...(where.get(partId) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1])
    const locationId = locs[0]?.[0] ?? defaultLocationId
    const reason: PlannedMovement['reason'] = gap < 0 ? 'returned'
      : usedAt.has(`${partId}|${locationId}`) || was !== 0 ? 'adjusted' : 'used'
    out.push({
      partId, partNumber: t?.partNumber ?? partNumberOf(partId), locationId,
      delta: -gap, reason, unitCost: t?.unitCost ?? costOf.get(partId) ?? null, was, now,
    })
  }
  return out
}

/**
 * Bring an existing invoice's stock use to its current lines - the refresh path.
 *
 * deductForInvoice is for creation: a second call writes nothing, so a re-billed
 * invoice whose parts changed would keep the old deduction. Deleting and re-creating
 * the invoice was the only way round it, and every new invoice deducted again while
 * the deleted one's movements stayed (the ledger outlives the document): WO-2026-1576
 * was billed three times and took its parts off the shelf three times.
 */
export async function reconcileInvoiceStock(opts: {
  userId: string
  invoiceKind: 'ld' | 'hd'
  invoiceId: string
  invoiceRef?: string | null
  lineItems: unknown
  createdBy?: string | null
}): Promise<LedgerResult & { changes: PlannedMovement[] }> {
  const supabase = createServiceClient()
  const result: LedgerResult & { changes: PlannedMovement[] } = { written: 0, unmatched: [], alreadyApplied: [], errors: [], changes: [] }
  const sourceType = opts.invoiceKind === 'ld' ? 'invoice' : 'hd_invoice'

  const { data: rows, error } = await supabase
    .from('stock_movement')
    .select('part_id, location_id, delta, reason, unit_cost')
    .eq('user_id', opts.userId)
    .eq('source_type', sourceType)
    .eq('source_id', opts.invoiceId)
  if (error) { result.errors.push(`could not read this invoice's stock movements: ${error.message}`); return result }
  const existing: DocMovement[] = (rows ?? []).map(r => ({
    partId: String(r.part_id), locationId: String(r.location_id), delta: Number(r.delta), reason: String(r.reason),
    unitCost: r.unit_cost == null ? null : Number(r.unit_cost),
  }))

  const lines = aggregateLines(partLinesFromJson(opts.lineItems))
  const ids = await resolvePartIds(supabase, lines.map(l => l.partNumber))
  const target: TargetPart[] = []
  for (const l of lines) {
    const partId = ids.get(normalizePartNumber(l.partNumber))
    if (!partId) { result.unmatched.push(l.partNumber); continue }
    target.push({ partId, partNumber: l.partNumber, quantity: l.quantity, unitCost: l.unitCost })
  }

  const needsDefault = target.some(t => !existing.some(m => m.partId === t.partId))
  const locationId = needsDefault ? await defaultLocationId(supabase, opts.userId) : (existing[0]?.locationId ?? null)
  if (!locationId && target.length) {
    result.errors.push('No stock location available, so nothing could be moved.')
    return result
  }

  // A part taken off the invoice has no line to name it: read its number.
  const gone = [...new Set(existing.map(m => m.partId))].filter(pid => !target.some(t => t.partId === pid))
  const names = new Map<string, string>()
  if (gone.length) {
    const { data: ps } = await supabase.from('parts').select('id, part_number').in('id', gone)
    for (const p of ps ?? []) names.set(String(p.id), String(p.part_number))
  }

  const plan = planInvoiceStockDiff(existing, target, locationId ?? '', pid => names.get(pid) ?? pid)
  for (const p of plan) {
    const res = await writeMovement(supabase, {
      userId: opts.userId, partId: p.partId, locationId: p.locationId, delta: p.delta, reason: p.reason,
      unitCost: p.unitCost, sourceType, sourceId: opts.invoiceId, sourceRef: opts.invoiceRef ?? null,
      createdBy: opts.createdBy ?? null,
      note: `Refreshed ${opts.invoiceRef ?? opts.invoiceId} from its work order: billed ${p.was} -> ${p.now}`,
    })
    if (res.duplicate) result.alreadyApplied.push(p.partNumber)
    else if (res.ok) { result.written++; result.changes.push(p) }
    else result.errors.push(`${p.partNumber}: ${res.error}`)
  }
  // Read after the plan is written, and only for parts this refresh took MORE of:
  // the warning is about a deduction, not about a part already negative before.
  result.negative = await negativeStock(supabase, opts.userId, result.changes.filter(c => c.delta < 0).map(c => c.partId))
  return result
}

// ── what the ledger holds for an invoice, per part ─────────────────────────

/** One movement an invoice wrote, with what the screen shows of it. */
export interface InvoiceMovement extends DocMovement {
  id: string
  note: string | null
  createdBy: string | null
  createdAt: string
}

/** What the ledger holds for one part on one invoice, right now. */
export interface InvoicePartStock {
  partId: string
  partNumber: string
  /** Net off the shelf for this invoice now: minus the sum of every movement it wrote
   *  for the part - the first 'used', every refresh, every customer return. */
  taken: number
  /** How many came back by customer return so far (migration 189). */
  customerReturned: number
  /** Net taken per location, largest first - where a return goes back to. */
  byLocation: Array<{ locationId: string; taken: number }>
  /** The cost the invoice took it at (its first movement carrying one). */
  unitCost: number | null
}

/**
 * Group an invoice's movements by part. Pure.
 *
 * READ FROM THE LEDGER, never from the invoice's lines: after a refresh the lines say
 * what is billed, but only the ledger says what is off the shelf for this document.
 */
export function summarizeInvoiceStock(
  movements: DocMovement[],
  partNumberOf: (partId: string) => string = id => id,
): InvoicePartStock[] {
  const by = new Map<string, InvoicePartStock & { locs: Map<string, number> }>()
  for (const m of movements) {
    let s = by.get(m.partId)
    if (!s) {
      s = { partId: m.partId, partNumber: partNumberOf(m.partId), taken: 0, customerReturned: 0, byLocation: [], unitCost: null, locs: new Map() }
      by.set(m.partId, s)
    }
    s.taken -= m.delta
    s.locs.set(m.locationId, (s.locs.get(m.locationId) ?? 0) - m.delta)
    if (m.reason === CUSTOMER_RETURN_REASON) s.customerReturned += m.delta
    if (s.unitCost == null && m.unitCost != null) s.unitCost = m.unitCost
  }
  return [...by.values()]
    .map(({ locs, ...s }) => ({ ...s, byLocation: [...locs.entries()].map(([locationId, taken]) => ({ locationId, taken })).sort((a, b) => b.taken - a.taken) }))
    .sort((a, b) => a.partNumber.localeCompare(b.partNumber))
}

/** One movement a return or a reversal will write. */
export interface PlannedReturn {
  partId: string; partNumber: string; locationId: string
  delta: number; reason: 'customer_returned' | 'returned' | 'adjusted'; unitCost: number | null
}

/**
 * A customer return, checked against what the ledger holds. Pure.
 *
 * Per PART, with a quantity - one refused repair out of three is the normal case. It
 * can never put back more than this invoice has off the shelf for that part now
 * (after every refresh and every earlier return); asking for more refuses the whole
 * request, so nothing is half-returned. Goes back to the locations it was taken from,
 * the largest first, at the cost it was taken at.
 */
export function planCustomerReturn(
  stock: InvoicePartStock[],
  requests: Array<{ partId: string; quantity: number }>,
): { ok: true; movements: PlannedReturn[] } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const asked = new Map<string, number>()
  for (const r of requests) {
    if (!Number.isInteger(r.quantity) || r.quantity < 0) { errors.push('Each quantity must be a whole number, zero or more.'); continue }
    if (r.quantity === 0) continue
    asked.set(r.partId, (asked.get(r.partId) ?? 0) + r.quantity)
  }
  if (!errors.length && asked.size === 0) errors.push('Enter how many of at least one part came back.')
  const movements: PlannedReturn[] = []
  for (const [partId, qty] of asked) {
    const s = stock.find(x => x.partId === partId)
    if (!s) { errors.push('That part was never taken off the shelf for this invoice, so it cannot be returned to stock from it.'); continue }
    if (qty > s.taken) {
      errors.push(s.taken <= 0
        ? `${s.partNumber}: nothing is left to return - this invoice has none of it off the shelf now.`
        : `${s.partNumber}: you asked to return ${qty}, but this invoice has only ${s.taken} off the shelf now (after refreshes and earlier returns). Return ${s.taken} or fewer.`)
      continue
    }
    let left = qty
    for (const loc of s.byLocation) {
      if (left === 0) break
      if (loc.taken <= 0) continue
      const n = Math.min(left, loc.taken)
      movements.push({ partId, partNumber: s.partNumber, locationId: loc.locationId, delta: n, reason: CUSTOMER_RETURN_REASON, unitCost: s.unitCost })
      left -= n
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, movements }
}

/**
 * Put back everything an invoice has off the shelf - a deleted draft. Pure.
 *
 * Per part and location, the exact net the ledger holds, so after it the document's
 * movements sum to zero: nothing it ever took stays taken, however many refreshes ran.
 */
export function planInvoiceReversal(stock: InvoicePartStock[]): PlannedReturn[] {
  const out: PlannedReturn[] = []
  for (const s of stock) {
    for (const loc of s.byLocation) {
      if (loc.taken === 0) continue
      out.push({
        partId: s.partId, partNumber: s.partNumber, locationId: loc.locationId,
        delta: loc.taken, reason: loc.taken > 0 ? 'returned' : 'adjusted', unitCost: s.unitCost,
      })
    }
  }
  return out
}

/** Every movement an invoice wrote, oldest first. */
export async function readInvoiceMovements(
  supabase: Supabase, userId: string, invoiceKind: 'ld' | 'hd', invoiceId: string,
): Promise<{ movements: InvoiceMovement[]; partNumbers: Map<string, string>; error?: string }> {
  const { data, error } = await supabase
    .from('stock_movement')
    .select('id, part_id, location_id, delta, reason, unit_cost, note, created_by, created_at')
    .eq('user_id', userId)
    .eq('source_type', invoiceKind === 'ld' ? 'invoice' : 'hd_invoice')
    .eq('source_id', invoiceId)
    .order('created_at', { ascending: true })
  if (error) return { movements: [], partNumbers: new Map(), error: error.message }
  const movements: InvoiceMovement[] = (data ?? []).map(r => ({
    id: String(r.id), partId: String(r.part_id), locationId: String(r.location_id), delta: Number(r.delta),
    reason: String(r.reason), unitCost: r.unit_cost == null ? null : Number(r.unit_cost),
    note: r.note == null ? null : String(r.note), createdBy: r.created_by == null ? null : String(r.created_by),
    createdAt: String(r.created_at),
  }))
  const partNumbers = new Map<string, string>()
  const ids = [...new Set(movements.map(m => m.partId))]
  if (ids.length) {
    const { data: ps } = await supabase.from('parts').select('id, part_number').in('id', ids)
    for (const p of ps ?? []) partNumbers.set(String(p.id), String(p.part_number))
  }
  return { movements, partNumbers }
}

/** Does this invoice carry a customer return? Refresh refuses one that does. */
export function hasCustomerReturn(movements: Array<{ reason: string }>): boolean {
  return movements.some(m => m.reason === CUSTOMER_RETURN_REASON)
}

/** A check violation on reason: migration 189 is not applied. */
function isMissingCustomerReturnReason(message: string | undefined): boolean {
  return !!message && /stock_movement_reason_check|violates check constraint/i.test(message)
}

/**
 * Return parts to stock from a permanent invoice. STOCK ONLY: writes new
 * 'customer_returned' movements against the invoice and touches nothing else - not
 * the invoice, its lines, its money, its number, its pay link or its status. The
 * original deduction rows are never edited or deleted.
 */
export async function returnInvoiceStock(opts: {
  userId: string
  invoiceId: string
  invoiceRef: string | null
  requests: Array<{ partId: string; quantity: number }>
  note: string
  createdBy: string
}): Promise<{ ok: true; written: PlannedReturn[] } | { ok: false; status: number; errors: string[]; written: PlannedReturn[] }> {
  const supabase = createServiceClient()
  const read = await readInvoiceMovements(supabase, opts.userId, 'hd', opts.invoiceId)
  if (read.error) return { ok: false, status: 500, errors: [`Could not read this invoice's stock: ${read.error}`], written: [] }
  const stock = summarizeInvoiceStock(read.movements, id => read.partNumbers.get(id) ?? id)
  const plan = planCustomerReturn(stock, opts.requests)
  if (!plan.ok) return { ok: false, status: 409, errors: plan.errors, written: [] }

  const written: PlannedReturn[] = []
  for (const p of plan.movements) {
    const res = await writeMovement(supabase, {
      userId: opts.userId, partId: p.partId, locationId: p.locationId, delta: p.delta, reason: p.reason,
      unitCost: p.unitCost, sourceType: 'hd_invoice', sourceId: opts.invoiceId, sourceRef: opts.invoiceRef,
      createdBy: opts.createdBy,
      note: `Returned to stock from ${opts.invoiceRef ?? opts.invoiceId}: ${opts.note}`,
    })
    if (!res.ok) {
      if (!written.length && isMissingCustomerReturnReason(res.error)) {
        return { ok: false, status: 409, errors: ['Returning parts to stock needs migration 189, which is not applied yet. Nothing was returned.'], written }
      }
      return { ok: false, status: 500, errors: [`${p.partNumber}: ${res.error}`], written }
    }
    written.push(p)
  }
  return { ok: true, written }
}

/**
 * Put back everything a deleted draft took. Written BEFORE the delete; if any row
 * fails the delete must not go ahead.
 */
export async function reverseInvoiceStock(opts: {
  userId: string
  invoiceId: string
  invoiceRef: string | null
  createdBy: string
}): Promise<{ ok: boolean; written: PlannedReturn[]; errors: string[] }> {
  const supabase = createServiceClient()
  const read = await readInvoiceMovements(supabase, opts.userId, 'hd', opts.invoiceId)
  if (read.error) return { ok: false, written: [], errors: [`Could not read this invoice's stock: ${read.error}`] }
  const plan = planInvoiceReversal(summarizeInvoiceStock(read.movements, id => read.partNumbers.get(id) ?? id))
  const written: PlannedReturn[] = []
  for (const p of plan) {
    const res = await writeMovement(supabase, {
      userId: opts.userId, partId: p.partId, locationId: p.locationId, delta: p.delta, reason: p.reason,
      unitCost: p.unitCost, sourceType: 'hd_invoice', sourceId: opts.invoiceId, sourceRef: opts.invoiceRef,
      createdBy: opts.createdBy,
      note: `Draft ${opts.invoiceRef ?? opts.invoiceId} deleted before it was sent: its parts back on the shelf`,
    })
    if (!res.ok) return { ok: false, written, errors: [`${p.partNumber}: ${res.error}`] }
    written.push(p)
  }
  return { ok: true, written, errors: [] }
}

/** The parts among these now below zero, with the count, at any location. */
export async function negativeStock(supabase: Supabase, userId: string, partIds: string[]): Promise<NegativeStock[]> {
  const ids = [...new Set(partIds)]
  if (!ids.length) return []
  const { data, error } = await supabase
    .from('inventory')
    .select('part_id, on_hand, location_name')
    .eq('user_id', userId)
    .in('part_id', ids)
    .lt('on_hand', 0)
  if (error || !data?.length) return []
  const { data: ps } = await supabase.from('parts').select('id, part_number').in('id', [...new Set(data.map(r => String(r.part_id)))])
  const num = new Map((ps ?? []).map(p => [String(p.id), String(p.part_number)]))
  return data.map(r => ({
    partId: String(r.part_id), partNumber: num.get(String(r.part_id)) ?? String(r.part_id),
    onHand: Number(r.on_hand), locationName: r.location_name == null ? null : String(r.location_name),
  })).sort((a, b) => a.partNumber.localeCompare(b.partNumber))
}

/** "33-2805 is now at -3 on hand." - one sentence per part, for any screen. */
export function negativeStockWarning(neg: NegativeStock[] | undefined | null): string | null {
  if (!neg?.length) return null
  const parts = neg.map(n => `${n.partNumber} is now at ${n.onHand} on hand${n.locationName ? ` (${n.locationName})` : ''}`)
  return `Stock below zero: ${parts.join('; ')}. The invoice went through - count or receive these parts.`
}

// ── allocate on an open work order ──────────────────────────────────────────

/**
 * Commit parts to an open work order WITHOUT touching on_hand.
 *
 * Replaces the whole live allocation set for that work order, because a work order is
 * edited all week: a part removed from the job must stop being allocated, and the only
 * honest way to express "these are the parts now" is to set it, not add to it.
 */
export async function allocateForWorkOrder(opts: {
  userId: string
  kind: WorkOrderKind
  workOrderId: string
  lines: StockLine[]
  locationId?: string | null
}): Promise<LedgerResult> {
  const supabase = createServiceClient()
  const result: LedgerResult = { written: 0, unmatched: [], alreadyApplied: [], errors: [] }

  const lines = aggregateLines(opts.lines)
  const locationId = opts.locationId ?? await defaultLocationId(supabase, opts.userId)
  if (!locationId) {
    result.errors.push('No stock location available, so nothing could be allocated.')
    return result
  }

  const ids = await resolvePartIds(supabase, lines.map(l => l.partNumber))
  const keep = new Set<string>()

  for (const line of lines) {
    const partId = ids.get(normalizePartNumber(line.partNumber))
    if (!partId) { result.unmatched.push(line.partNumber); continue }
    keep.add(partId)

    // Upsert on the live-allocation key. Partial unique indexes cannot be used as a
    // PostgREST on_conflict target, so this is an explicit select-then-write.
    const { data: live } = await supabase
      .from('stock_allocation')
      .select('id, quantity')
      .eq('work_order_kind', opts.kind)
      .eq('work_order_id', opts.workOrderId)
      .eq('part_id', partId)
      .eq('location_id', locationId)
      .is('released_at', null)
      .maybeSingle()

    if (live?.id) {
      if (Number(live.quantity) === line.quantity) { result.alreadyApplied.push(line.partNumber); continue }
      const { error } = await supabase
        .from('stock_allocation')
        .update({ quantity: line.quantity, updated_at: new Date().toISOString() })
        .eq('id', live.id)
      if (error) result.errors.push(`${line.partNumber}: ${error.message}`)
      else result.written++
    } else {
      const { error } = await supabase.from('stock_allocation').insert({
        user_id: opts.userId,
        part_id: partId,
        location_id: locationId,
        work_order_kind: opts.kind,
        work_order_id: opts.workOrderId,
        quantity: line.quantity,
      })
      if (error) result.errors.push(`${line.partNumber}: ${error.message}`)
      else result.written++
    }
  }

  // Anything still allocated to this job but no longer on it gets released.
  const { data: stale } = await supabase
    .from('stock_allocation')
    .select('id, part_id')
    .eq('work_order_kind', opts.kind)
    .eq('work_order_id', opts.workOrderId)
    .is('released_at', null)

  for (const row of stale ?? []) {
    if (keep.has(String(row.part_id))) continue
    await supabase
      .from('stock_allocation')
      .update({ released_at: new Date().toISOString(), released_reason: 'removed_from_work_order' })
      .eq('id', row.id)
  }

  return result
}

/**
 * Release every live allocation for a work order.
 *
 * Called when its invoice finalizes - the parts are deducted for real at that point, so
 * holding them allocated as well would count them twice against available.
 */
export async function releaseAllocations(
  userId: string,
  kind: WorkOrderKind,
  workOrderId: string,
  reason = 'invoiced',
): Promise<number> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('stock_allocation')
    .update({ released_at: new Date().toISOString(), released_reason: reason })
    .eq('work_order_kind', kind)
    .eq('work_order_id', workOrderId)
    .eq('user_id', userId)
    .is('released_at', null)
    .select('id')
  if (error) {
    console.error('[ledger] releaseAllocations failed:', error.message)
    return 0
  }
  return (data ?? []).length
}

// ── receive, count, transfer ────────────────────────────────────────────────

/** Receive stock from a vendor. Updates last_cost via the migration 151 trigger. */
export async function receiveStock(opts: {
  userId: string
  locationId: string
  vendor?: string | null
  reference?: string | null
  createdBy?: string | null
  lines: Array<{ partId: string; quantity: number; unitCost: number | null }>
}): Promise<LedgerResult & { costChanges: Array<{ partId: string; was: number | null; now: number | null }> }> {
  const supabase = createServiceClient()
  const result: LedgerResult & { costChanges: Array<{ partId: string; was: number | null; now: number | null }> } =
    { written: 0, unmatched: [], alreadyApplied: [], errors: [], costChanges: [] }

  for (const line of opts.lines) {
    if (line.quantity <= 0) { result.errors.push(`${line.partId}: quantity must be positive`); continue }

    // Read the cost BEFORE the movement, so the screen can show "was" and "now"
    // honestly rather than reporting the value it just wrote.
    const { data: before } = await supabase
      .from('inventory')
      .select('last_cost')
      .eq('user_id', opts.userId)
      .eq('part_id', line.partId)
      .eq('location_id', opts.locationId)
      .maybeSingle()
    const was = before?.last_cost == null ? null : Number(before.last_cost)

    const res = await writeMovement(supabase, {
      userId: opts.userId,
      partId: line.partId,
      locationId: opts.locationId,
      delta: line.quantity,
      reason: 'received',
      unitCost: line.unitCost,
      sourceType: 'receipt',
      sourceRef: opts.reference ?? null,
      note: opts.vendor ? `Received from ${opts.vendor}` : 'Received',
      createdBy: opts.createdBy ?? null,
    })
    if (!res.ok) { result.errors.push(`${line.partId}: ${res.error}`); continue }
    result.written++
    if (line.unitCost != null && was !== line.unitCost) {
      result.costChanges.push({ partId: line.partId, was, now: line.unitCost })
    }
  }
  return result
}

/**
 * A physical count. Writes the DIFFERENCE, never the total.
 *
 * "I counted 4" with 6 on the books writes -2 with a reason, so the ledger says what
 * happened and the old figure is still there. Overwriting on_hand to 4 would destroy
 * the only evidence that two went missing - and the trigger in 151 refuses it anyway.
 */
export async function adjustToCount(opts: {
  userId: string
  locationId: string
  createdBy?: string | null
  reason?: string | null
  counts: Array<{ partId: string; counted: number }>
}): Promise<LedgerResult & { adjustments: Array<{ partId: string; was: number; counted: number; delta: number }> }> {
  const supabase = createServiceClient()
  const out: LedgerResult & { adjustments: Array<{ partId: string; was: number; counted: number; delta: number }> } =
    { written: 0, unmatched: [], alreadyApplied: [], errors: [], adjustments: [] }

  for (const c of opts.counts) {
    const { data: row } = await supabase
      .from('inventory')
      .select('on_hand')
      .eq('user_id', opts.userId)
      .eq('part_id', c.partId)
      .eq('location_id', opts.locationId)
      .maybeSingle()

    const was = row?.on_hand == null ? 0 : Number(row.on_hand)
    const delta = c.counted - was
    if (delta === 0) continue

    const res = await writeMovement(supabase, {
      userId: opts.userId,
      partId: c.partId,
      locationId: opts.locationId,
      delta,
      reason: 'adjusted',
      sourceType: 'count',
      note: opts.reason ?? `Physical count: books ${was}, counted ${c.counted}`,
      createdBy: opts.createdBy ?? null,
    })
    if (!res.ok) { out.errors.push(`${c.partId}: ${res.error}`); continue }
    out.written++
    out.adjustments.push({ partId: c.partId, was, counted: c.counted, delta })
  }
  return out
}

/** Move stock between two locations: two movements sharing one transfer_id. */
export async function transferStock(opts: {
  userId: string
  fromLocationId: string
  toLocationId: string
  createdBy?: string | null
  note?: string | null
  lines: Array<{ partId: string; quantity: number }>
}): Promise<LedgerResult & { transferId: string }> {
  const supabase = createServiceClient()
  const transferId = crypto.randomUUID()
  const out: LedgerResult & { transferId: string } =
    { written: 0, unmatched: [], alreadyApplied: [], errors: [], transferId }

  if (opts.fromLocationId === opts.toLocationId) {
    out.errors.push('A transfer needs two different locations.')
    return out
  }

  for (const line of opts.lines) {
    if (line.quantity <= 0) { out.errors.push(`${line.partId}: quantity must be positive`); continue }

    // The cost travels with the part, so the receiving location does not forget what
    // was paid for it. Read from the sending location.
    const { data: src } = await supabase
      .from('inventory')
      .select('last_cost')
      .eq('user_id', opts.userId)
      .eq('part_id', line.partId)
      .eq('location_id', opts.fromLocationId)
      .maybeSingle()
    const cost = src?.last_cost == null ? null : Number(src.last_cost)

    const outRes = await writeMovement(supabase, {
      userId: opts.userId, partId: line.partId, locationId: opts.fromLocationId,
      delta: -line.quantity, reason: 'transferred_out', unitCost: cost,
      sourceType: 'transfer', transferId, note: opts.note ?? null, createdBy: opts.createdBy ?? null,
    })
    if (!outRes.ok) { out.errors.push(`${line.partId} out: ${outRes.error}`); continue }

    const inRes = await writeMovement(supabase, {
      userId: opts.userId, partId: line.partId, locationId: opts.toLocationId,
      delta: line.quantity, reason: 'transferred_in', unitCost: cost,
      sourceType: 'transfer', transferId, note: opts.note ?? null, createdBy: opts.createdBy ?? null,
    })
    if (!inRes.ok) {
      // The outbound half landed and the inbound did not. Compensate rather than leave
      // stock vanished - a ledger is corrected by another movement, never by editing.
      await writeMovement(supabase, {
        userId: opts.userId, partId: line.partId, locationId: opts.fromLocationId,
        delta: line.quantity, reason: 'returned', unitCost: cost,
        sourceType: 'transfer', transferId,
        note: 'Reversing a transfer whose inbound half failed', createdBy: opts.createdBy ?? null,
      })
      out.errors.push(`${line.partId} in: ${inRes.error} (outbound reversed)`)
      continue
    }
    out.written += 2
  }
  out.negative = await negativeStock(supabase, opts.userId, opts.lines.map(l => l.partId))
  return out
}
