// ─── Parts + labour line maths, shared by quotes and work orders ──────────────
// Lifted verbatim out of QuoteDetailModal (components/financials/QuotesTab.tsx),
// which was the only implementation of it. Work orders bill the same way a quote
// quotes, so a second copy would be two screens free to disagree about one job's
// money — which is the failure this module exists to prevent.
//
// THE ONE THING TO UNDERSTAND: a stored line_items row carries the POST-markup
// unit_price, because that is the number the customer agreed to. The editor works
// in PRE-markup base prices, because that is the number the tech sourced at. So
// every read divides the markup out and every write multiplies it back in — see
// fromLineItems / toLineItems. Getting that backwards silently re-marks-up parts
// on every save, compounding a few percent each time the tech opens the record.

import type { LineItem } from '@/types/financials'

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Labour rides in line_items as a row called "Labor" rather than its own column,
 *  so it has to be filtered back out when the editor loads. Matched on the
 *  description because that is the only marker the stored shape has. */
export function isLaborItem(li: LineItem): boolean {
  return /^labor/i.test((li.description ?? '').trim())
}

/** A parts row as the editor holds it. `unit_price` is the BASE price. */
export interface EditItem {
  _id:         string
  description: string
  quantity:    number
  unit_price:  number
}

export interface LineTotals {
  partsBase:     number
  markupAmt:     number
  partsTotal:    number
  laborSubtotal: number
  subtotal:      number
  taxAmount:     number
  grandTotal:    number
}

export interface LineInputs {
  items:      EditItem[]
  markupPct:  number
  laborHours: number
  laborRate:  number
  taxPct:     number
}

/** Stored line_items -> editor rows: drops labour, divides the markup back out.
 *  `skipDescription` exists for the detailer model, whose single "Service" row is
 *  not a part and must not appear in a parts table. */
export function fromLineItems(
  lineItems:       LineItem[] | null | undefined,
  markupPct:       number,
  skipDescription?: string,
): EditItem[] {
  return (lineItems ?? [])
    .filter(li => !isLaborItem(li))
    .filter(li => !(skipDescription && li.description?.trim() === skipDescription))
    .map((li, i) => ({
      _id:         `li-${i}`,
      description: li.description,
      quantity:    li.quantity,
      unit_price:  markupPct > 0
        ? round2(li.unit_price / (1 + markupPct / 100))
        : li.unit_price,
    }))
}

/** Editor rows -> stored line_items: applies the markup and appends the labour
 *  row. Labour is appended only when there are hours, so a parts-only job does
 *  not carry a $0 Labor line into the customer's document. */
export function toLineItems({
  items, markupPct, laborHours, laborRate,
}: Omit<LineInputs, 'taxPct'>): LineItem[] {
  const markup = markupPct / 100
  return [
    ...items.map(li => ({
      description: li.description,
      quantity:    li.quantity,
      unit_price:  round2(li.unit_price * (1 + markup)),
      total:       round2(li.quantity * li.unit_price * (1 + markup)),
    })),
    ...(laborHours > 0 ? [{
      description: 'Labor',
      quantity:    laborHours,
      unit_price:  laborRate,
      total:       round2(laborHours * laborRate),
    }] : []),
  ]
}

/** Tax applies to parts-plus-markup AND labour, matching what the quote has
 *  always done. Only the tax and grand total are rounded, so a long parts list
 *  does not accumulate rounding error line by line. */
export function computeTotals({
  items, markupPct, laborHours, laborRate, taxPct,
}: LineInputs): LineTotals {
  const partsBase     = items.reduce((s, li) => s + li.quantity * li.unit_price, 0)
  const markupAmt     = partsBase * (markupPct / 100)
  const partsTotal    = partsBase + markupAmt
  const laborSubtotal = (laborHours || 0) * (laborRate || 0)
  const subtotal      = partsTotal + laborSubtotal
  const taxAmount     = round2(subtotal * ((taxPct || 0) / 100))
  const grandTotal    = round2(subtotal + taxAmount)
  return { partsBase, markupAmt, partsTotal, laborSubtotal, subtotal, taxAmount, grandTotal }
}

/** The quote's own validation rules, unchanged. Returns a message or null. */
export function validateLines({
  items, laborHours, laborRate, grandTotal,
}: {
  items: EditItem[]; laborHours: number; laborRate: number; grandTotal: number
}): string | null {
  if (grandTotal < 0)
    return 'Grand total cannot be negative.'
  if (items.some(li => li.quantity < 0 || li.unit_price < 0))
    return 'Line items cannot have negative quantity or price.'
  if (laborRate < 0 || laborHours < 0)
    return 'Rate cannot be negative.'
  if (items.length === 0 && (laborHours || 0) <= 0)
    return 'At least one line item or labor time is required.'
  return null
}

/** The money columns quotes, work orders and invoices all persist. */
export function lineMoneyColumns(inputs: LineInputs) {
  const t = computeTotals(inputs)
  return {
    line_items:           toLineItems(inputs),
    labor_hours:          inputs.laborHours,
    labor_rate:           inputs.laborRate,
    parts_subtotal:       round2(t.partsBase),
    parts_markup_percent: inputs.markupPct,
    labor_subtotal:       round2(t.laborSubtotal),
    tax_percent:          inputs.taxPct,
    tax_amount:           round2(t.taxAmount),
    grand_total:          round2(t.grandTotal),
  }
}
