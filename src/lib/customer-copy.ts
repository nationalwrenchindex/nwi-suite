// ─── What a customer's copy may carry ─────────────────────────────────────────
//
// The customer sees the marked-up price. Never the shop's cost, never its markup
// percentage - not printed, and not shipped to the browser in a page payload or a
// public JSON response either, where "view source" reads it just the same.
//
// THE COLUMN-NAME TRAP (CLAUDE.md): `unit_cost` means opposite things by table.
//   * work-order lines and LD invoice additional parts: unit_cost is the shop's COST
//   * hd_quotes / hd_invoices line_items:               unit_cost is the SELL price,
//                                                       unit_cost_base is the cost
// So the caller says which it has, and this strips accordingly.

/** Keys that are cost or markup on every table that has them. */
const ALWAYS_COST = ['unit_cost_base', 'markup_percent', 'cost', 'cost_each'] as const

/**
 * A line array with cost and markup removed.
 *
 * `unitCostIsCost` is true where `unit_cost` is what the shop paid (work-order lines,
 * LD quote and invoice lines from QuickWrench, LD additional parts) and false where it
 * is the sell price (HD quotes and invoices).
 */
export function customerLines<T>(lines: T[] | null | undefined, unitCostIsCost: boolean): T[] {
  if (!Array.isArray(lines)) return []
  return lines.map(l => {
    if (!l || typeof l !== 'object') return l
    const out = { ...(l as Record<string, unknown>) }
    for (const k of ALWAYS_COST) delete out[k]
    if (unitCostIsCost) delete out.unit_cost
    return out as T
  })
}

/** The per-unit price a customer reads for a line: what they pay divided by how many. */
export function customerUnitPrice(total: number | null | undefined, qty: number | null | undefined): number | null {
  const t = Number(total), q = Number(qty)
  if (!Number.isFinite(t) || !Number.isFinite(q) || q <= 0 || t <= 0) return null
  return Math.round((t / q) * 100) / 100
}

interface PricedRecord {
  line_items?: unknown
  parts_subtotal?: unknown
  parts_markup_percent?: unknown
}

/**
 * A segment (or segment option) as the customer's approval page may hold it: lines
 * without cost or markup, and no pre-markup parts subtotal or markup percentage.
 * Segment lines are work-order lines, so `unit_cost` is cost.
 */
export function customerPriced<T extends PricedRecord>(rec: T): T {
  const out = { ...rec } as T & Record<string, unknown>
  out.line_items = customerLines(rec.line_items as unknown[] | null | undefined, true)
  delete out.parts_subtotal
  delete out.parts_markup_percent
  return out
}

export function customerSegments<T extends PricedRecord & { options?: PricedRecord[] }>(segments: T[]): T[] {
  return segments.map(s => {
    const seg = customerPriced(s)
    if (Array.isArray(s.options)) (seg as { options?: PricedRecord[] }).options = s.options.map(customerPriced)
    return seg
  })
}
