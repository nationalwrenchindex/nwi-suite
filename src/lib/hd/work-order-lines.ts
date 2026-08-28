// Shared shape + math for HD work-order line items (migration 120).
//
// Pure module: no React, no fetch. The API route and the editor card both import
// from here so a line total the tech watched add up in the browser is the same
// number the server writes — the server recomputes rather than trusting the client,
// and this is the one place that arithmetic is written down.
//
// The markup math itself is NOT reimplemented here. It lives in parts-pricing and is
// shared with the quote and invoice forms, because a part quoted at one price and
// then billed at another off a rounding difference is a customer dispute.

import { lineAmount, sellPrice } from '@/lib/hd/parts-pricing'

// 'part' (singular) matches the DB CHECK constraint. The invoice form's in-memory
// type uses 'parts' — that is a different, un-persisted shape, so they do not have
// to agree, but do not assume one can be assigned to the other.
export type WorkOrderLineType = 'labor' | 'part'

export interface WorkOrderLine {
  id: string
  work_order_id: string
  type: WorkOrderLineType
  description: string | null
  part_number: string | null
  quantity: number
  // What the tech paid. Null means unknown, which is not zero — a zero here would
  // report the job as pure profit on that line.
  unit_cost: number | null
  // What the customer is charged per unit. For a part this is cost + markup; for
  // labor it is the hourly rate, and quantity is hours.
  unit_price: number | null
  markup_percent: number | null
  total: number | null
  sort_order: number
}

// A row as it arrives from the client on PUT. Everything is optional/loose because
// it is untrusted input; normalizeLine is what turns it into something storable.
export interface WorkOrderLineInput {
  type?: unknown
  description?: unknown
  part_number?: unknown
  quantity?: unknown
  unit_cost?: unknown
  unit_price?: unknown
  markup_percent?: unknown
}

// A work order is one job, not a purchase order. The cap exists so a malformed or
// hostile PUT cannot push thousands of rows through in a single request.
export const MAX_WORK_ORDER_LINES = 200

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// Non-negative finite number or null. Used for the money columns, where a missing
// value and a zero mean genuinely different things.
export function toMoney(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  if (!Number.isFinite(n)) return null
  return round2(Math.max(0, n))
}

// Quantity always resolves to a number — a line with no quantity is a line with no
// amount, so 0 is the honest reading rather than null.
export function toQuantity(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  if (!Number.isFinite(n)) return 0
  return round2(Math.max(0, n))
}

export function isLineType(v: unknown): v is WorkOrderLineType {
  return v === 'labor' || v === 'part'
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

// The billable amount for a line, always quantity × the SELL price.
//
// A part derives its sell price from cost + markup via parts-pricing, so it stays in
// step with the quote and invoice forms even if the markup rule there changes. Labor
// has no markup — the rate the tech charges is already the sell price — so it
// multiplies directly.
export function lineTotal(line: {
  type: WorkOrderLineType
  quantity: number
  unit_cost: number | null
  unit_price: number | null
  markup_percent: number | null
}): number {
  if (line.type === 'part' && line.unit_cost != null && line.markup_percent != null) {
    return lineAmount(line.quantity, line.unit_cost, line.markup_percent)
  }
  return round2(line.quantity * (line.unit_price ?? 0))
}

// The sell price for one unit of a part. Thin wrapper so callers do not each decide
// what to do when the cost is unknown.
export function lineUnitPrice(unitCost: number | null, markupPercent: number | null): number {
  return sellPrice(unitCost ?? 0, markupPercent ?? 0)
}

// Turn one untrusted client row into a storable one. unit_price and total are both
// DERIVED here rather than copied from the request — a client that sends a total is
// sending a number nobody verified, and on a billing record that is a hole.
export function normalizeLine(raw: WorkOrderLineInput, sortOrder: number): Omit<WorkOrderLine, 'id' | 'work_order_id'> | null {
  if (!isLineType(raw.type)) return null

  const type     = raw.type
  const quantity = toQuantity(raw.quantity)
  const unitCost = toMoney(raw.unit_cost)
  const markup   = type === 'part' ? toMoney(raw.markup_percent) : null

  // A part with a known cost prices itself off the markup; anything else (labor, or
  // a part the tech priced by hand without entering a cost) uses the sent price.
  const unitPrice = type === 'part' && unitCost != null && markup != null
    ? lineUnitPrice(unitCost, markup)
    : toMoney(raw.unit_price)

  const line = {
    type,
    description:    text(raw.description),
    part_number:    type === 'part' ? text(raw.part_number) : null,
    quantity,
    unit_cost:      unitCost,
    unit_price:     unitPrice,
    markup_percent: markup,
    sort_order:     sortOrder,
  }

  return { ...line, total: lineTotal({ ...line, unit_price: unitPrice }) }
}

export interface WorkOrderLineTotals {
  labor: number
  parts: number
  /** What the tech paid for the parts, for margin — never shown to a customer. */
  partsCost: number
  total: number
}

export function sumLines(lines: Array<Pick<WorkOrderLine, 'type' | 'quantity' | 'unit_cost' | 'total'>>): WorkOrderLineTotals {
  let labor = 0
  let parts = 0
  let partsCost = 0
  for (const l of lines) {
    const amount = Number(l.total ?? 0)
    if (l.type === 'labor') {
      labor += amount
    } else {
      parts += amount
      partsCost += Number(l.quantity ?? 0) * Number(l.unit_cost ?? 0)
    }
  }
  return {
    labor:     round2(labor),
    parts:     round2(parts),
    partsCost: round2(partsCost),
    total:     round2(labor + parts),
  }
}
