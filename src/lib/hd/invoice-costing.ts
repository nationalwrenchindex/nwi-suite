// Cost-of-goods and margin math for HD invoices. Pure — no React, no fetch, no
// server imports — so the write paths (POST /api/hd/invoices, PUT on one invoice)
// and the read path (/api/hd/financials/summary) all run the SAME definition of
// what a part cost. Two implementations of this would drift, and the first symptom
// would be a gross margin that changes depending on which screen you opened.
//
// The single rule this file exists to enforce: an unknown cost stays unknown.
// It is never quietly rounded to zero, because zero means "the parts were free"
// and produces a fabricated ~100% margin on every invoice written before markup
// tracking existed. See migration 119 for the column-level version of this rule.

// A parts line carries both prices. `unit_cost` is the SELL price the customer is
// billed (it is printed on the invoice document); `unit_cost_base` is what the tech
// actually paid. Older rows predate markup tracking and have no unit_cost_base at
// all — hence every field being optional here.
export interface HDLineItem {
  type?:           string | null
  quantity?:       number | string | null
  unit_cost?:      number | string | null
  unit_cost_base?: number | string | null
  markup_percent?: number | string | null
  amount?:         number | string | null
}

export interface InvoiceCosting {
  // null = cost unknown. Callers must carry the null through, not coalesce it.
  parts_cost:    number | null
  parts_sell:    number
  labor_revenue: number
}

export interface CostingOptions {
  // Both are billed labor: they land in the invoice `total` alongside the labor
  // lines, so leaving them out makes labor revenue fail to reconcile to the total.
  diagnostic_fee?: number | string | null
  road_call_fee?:  number | string | null
  // Optional cross-check, mirroring migration 119. An invoice that billed parts
  // revenue without any parts line item to explain it has a real, unrecorded cost —
  // reporting that as a known zero would be the same lie the NULL exists to prevent.
  subtotal_parts?: number | string | null
}

// Money is rounded once, where it becomes a dollar figure. Rounding each
// intermediate step is what makes a total drift off the sum of its lines.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// Returns null rather than 0 for anything unusable, so "absent" stays
// distinguishable from "zero" all the way up the call chain.
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function costingFromLineItems(
  lineItems: unknown,
  opts: CostingOptions = {},
): InvoiceCosting {
  const rows: HDLineItem[] = Array.isArray(lineItems)
    ? lineItems.filter((r): r is HDLineItem => typeof r === 'object' && r !== null)
    : []

  let partsCost   = 0
  let partsSell   = 0
  let laborAmount = 0
  let partsRows   = 0
  let costKnown   = true

  for (const row of rows) {
    if (row.type === 'parts') {
      partsRows++
      const qty  = num(row.quantity)
      const sell = num(row.unit_cost)
      const base = num(row.unit_cost_base)
      const amt  = num(row.amount)

      // ALL-OR-NOTHING: one parts line without a recorded cost makes the whole
      // invoice's cost unknown. A partial sum understates cost and overstates
      // margin while looking like a complete answer.
      if (qty === null || base === null) costKnown = false
      else partsCost += qty * base

      // Sell falls back to the stored line `amount` — that is the figure the
      // customer was actually billed, so it is the more authoritative of the two.
      if (qty !== null && sell !== null) partsSell += qty * sell
      else if (amt !== null) partsSell += amt
    } else {
      // Everything that is not a part is billed time or service, and its amount is
      // inside the invoice total. Counting only rows typed exactly 'labor' would
      // silently drop any other row type out of labor revenue and break the
      // reconciliation labor + parts + fees + tax = total.
      const amt = num(row.amount)
      if (amt !== null) laborAmount += amt
    }
  }

  // No parts lines at all is a KNOWN zero, not an unknown: a labor-only invoice
  // genuinely cost nothing in parts and its margin is real. The exception is an
  // invoice that billed parts revenue with nothing itemizing it — those parts
  // existed and we have no idea what they cost.
  if (partsRows === 0) {
    const billedParts = num(opts.subtotal_parts) ?? 0
    costKnown = billedParts === 0
  }

  const diagnostic = num(opts.diagnostic_fee) ?? 0
  const roadCall   = num(opts.road_call_fee)  ?? 0

  return {
    parts_cost:    costKnown ? round2(partsCost) : null,
    parts_sell:    round2(partsSell),
    labor_revenue: round2(laborAmount + diagnostic + roadCall),
  }
}

// Gross margin as a percentage, or null when it cannot honestly be stated.
//
// Returns null — never 0, never 100 — when cogs is unknown, so the UI is forced to
// print "unknown" instead of a number the subscriber would price their work off.
// Also null when there is no revenue to divide by: a margin on zero revenue is
// undefined, and rendering it as 0% reads as a real, terrible margin.
export function marginPct(revenue: number, cogs: number | null): number | null {
  if (cogs === null) return null
  if (!Number.isFinite(revenue) || revenue <= 0) return null
  return round2(((revenue - cogs) / revenue) * 100)
}

// True when a Supabase/PostgREST error is "this database has not run migration 119".
//
// Migrations in this project are applied by hand in the Supabase console, so the
// deploy can land before the ALTER TABLE does. Writing parts_cost unconditionally
// in that window would 500 every HD invoice save — the tech loses the invoice they
// just typed because of a reporting column. The write paths use this to retry
// without the costing fields: degraded reporting is recoverable, a lost invoice
// is not.
export function isMissingCostingColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase()
  return (
    (message.includes('parts_cost') || message.includes('parts_sell')) &&
    (message.includes('does not exist') || message.includes('could not find') || message.includes('schema cache'))
  )
}
