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
    else if (res.ok) result.written++
    else result.errors.push(`${line.partNumber}: ${res.error}`)
  }

  return result
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
  return out
}
