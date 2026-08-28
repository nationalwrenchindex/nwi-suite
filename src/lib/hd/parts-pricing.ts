// Parts markup math for the HD quote/invoice forms. Pure — no React, no fetch —
// so the same numbers can be reproduced anywhere (server, tests, a future PDF).
//
// The tech enters what the part COST them; the customer is billed the SELL price.
// Every HD form runs cost through here rather than doing its own arithmetic, so
// a quote and the invoice it converts into cannot disagree by a rounding step.
//
// NOTE ON THE DEFAULT: 30 is the HD brief's number, but profiles already carries
// `default_parts_markup_percent` (numeric, default 20) and the LD financials side
// bills from it. The forms read the profile value when it is present and only
// fall back to 30, so a subscriber who has set a markup gets one markup across
// both suites instead of two different ones depending on which form they opened.
export const DEFAULT_HD_PARTS_MARKUP = 30

// Money is rounded once, at the point it becomes a dollar figure. Doing it on
// each intermediate step is what makes a line total drift off the sum of its parts.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// What the customer pays for one unit, given what it cost the tech.
export function sellPrice(unitCost: number, markupPercent: number): number {
  const cost   = Number.isFinite(unitCost) ? Math.max(0, unitCost) : 0
  const markup = Number.isFinite(markupPercent) ? Math.max(0, markupPercent) : 0
  return round2(cost * (1 + markup / 100))
}

// The billable amount for a parts line. Driven by the SELL price, never the cost.
export function lineAmount(quantity: number, unitCost: number, markupPercent: number): number {
  const qty = Number.isFinite(quantity) ? Math.max(0, quantity) : 0
  return round2(qty * sellPrice(unitCost, markupPercent))
}
