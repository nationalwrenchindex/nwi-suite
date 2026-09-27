// Parts markup math. Pure — no React, no fetch — so the same numbers can be
// reproduced anywhere: server, browser, a test, a future PDF.
//
// The tech enters what the part COST them; the customer is billed the SELL price.
// Every form runs cost through here rather than doing its own arithmetic, so a quote
// and the invoice it converts into cannot disagree by a rounding step.
//
// Moved here from lib/hd/parts-pricing when work order segments needed it on both
// products. The functions were never HD-specific — only the DEFAULT markup is, and
// that stayed behind in parts-pricing where it belongs (HD bills 30%, LD bills 20%,
// and those two numbers must not be allowed to leak into each other).

// Money is rounded once, at the point it becomes a dollar figure. Doing it on each
// intermediate step is what makes a line total drift off the sum of its parts.
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** What the customer pays for one unit, given what it cost the tech. */
export function sellPrice(unitCost: number, markupPercent: number): number {
  const cost   = Number.isFinite(unitCost) ? Math.max(0, unitCost) : 0
  const markup = Number.isFinite(markupPercent) ? Math.max(0, markupPercent) : 0
  return round2(cost * (1 + markup / 100))
}

/** The billable amount for a parts line. Driven by the SELL price, never the cost. */
export function lineAmount(quantity: number, unitCost: number, markupPercent: number): number {
  const qty = Number.isFinite(quantity) ? Math.max(0, quantity) : 0
  return round2(qty * sellPrice(unitCost, markupPercent))
}
