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
import { computeTax, type TaxBreakdown, type TaxSettings } from '@/lib/tax'

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ─── THE MARKUP BUG ───────────────────────────────────────────────────────────
//
// Both editors did this when opening an EXISTING record:
//
//   WorkOrderForm:  workOrder?.parts_markup_percent ?? defaults.markup_percent
//   QuotesTab:      initialQuote.parts_markup_percent ?? 0     // for the divide-out
//                   initialQuote.parts_markup_percent ?? 20    // for the editor state
//
// When the stored markup is NULL, the first substitutes TODAY'S SETTINGS VALUE and
// the second uses two different numbers for the same thing. Either way the stored
// post-markup price is divided by one factor and multiplied back by another, so:
//
//   * reopening and saving a document silently re-prices every part on it, and
//   * changing the shop's markup in Settings changes what every old document with
//     no recorded markup bills, the next time anyone opens and saves it.
//
// In QuotesTab the divide-out used 0 and the editor used 20, so a quote with no
// recorded markup had every part marked up 20% on save. On a $272.27 radiator job
// that is $54 appearing out of nothing.
//
// THE RULE: a saved price is never recomputed from a current setting. An existing
// document with no recorded markup is treated as having NO markup — its stored
// prices are already final — and the UI says "markup not recorded" rather than
// showing a number nobody chose.

export interface MarkupOnReopen {
  /** Use this for BOTH the divide-out and the multiply-back. Never Settings. */
  percent:  number
  /** False when the document never recorded one. Show the label, not a number. */
  recorded: boolean
}

/**
 * The markup to use when opening an EXISTING document.
 *
 * `shopDefault` is deliberately NOT a parameter. There is no argument for which a
 * current setting is the right answer here, and taking one would invite the bug
 * straight back in. A NEW document seeds from Settings at its own call site, which
 * is correct — that is the markup in force at entry time, and it is then stored.
 */
export function markupOnReopen(stored: number | null | undefined): MarkupOnReopen {
  if (stored === null || stored === undefined) return { percent: 0, recorded: false }
  const n = Number(stored)
  if (!Number.isFinite(n) || n < 0) return { percent: 0, recorded: false }
  return { percent: n, recorded: true }
}

/** How a markup reads on screen. Never "0%" for an unrecorded one. */
export function markupLabel(m: MarkupOnReopen): string {
  return m.recorded ? `${m.percent}%` : 'markup not recorded'
}

/** Labour rides in line_items as a row called "Labor" rather than its own column,
 *  so it has to be filtered back out when the editor loads.
 *
 *  The explicit `type` wins where it exists. The description test remains the
 *  fallback, because every row written before `type` existed is untyped — and it
 *  is also what mis-classified segment labour ("Segment 2 — replace cat and
 *  sensors") as parts, which is exactly what `type` is here to end. */
export function isLaborItem(li: LineItem): boolean {
  if (li.type === 'labor') return true
  if (li.type === 'parts') return false
  return /^labor/i.test((li.description ?? '').trim())
}

/** A parts row as the editor holds it. `unit_price` is the BASE price. */
export interface EditItem {
  _id:         string
  description: string
  quantity:    number
  unit_price:  number
  /** The manufacturer's part number. Empty string when the tech has not typed one. */
  part_number: string
}

export interface LineTotals {
  partsBase:     number
  markupAmt:     number
  partsTotal:    number
  laborSubtotal: number
  subtotal:      number
  taxAmount:     number
  grandTotal:    number
  /** What was taxed, for storing on the document and showing the customer.
   *  Null when the caller passed no tax settings -- see computeTotals. */
  taxBreakdown:  TaxBreakdown | null
}

export interface LineInputs {
  items:      EditItem[]
  markupPct:  number
  laborHours: number
  laborRate:  number
  taxPct:     number
  /**
   * The shop's parts/labor tax settings.
   *
   * OPTIONAL ON PURPOSE. When omitted, computeTotals behaves exactly as it always
   * did -- taxPct applied to the whole subtotal -- so a caller that has not been
   * migrated yet cannot silently change a total. Callers opt in one at a time.
   */
  taxSettings?: TaxSettings | null
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
      part_number: li.part_number ?? '',
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
      // Written on every new row from here on, so no reader ever has to guess
      // again. part_number is omitted rather than stored as '' when empty —
      // an absent key reads as "not captured", a '' would read as "no part
      // number exists", and only the first of those is true.
      type:        'parts' as const,
      ...(li.part_number?.trim() ? { part_number: li.part_number.trim() } : {}),
    })),
    ...(laborHours > 0 ? [{
      description: 'Labor',
      quantity:    laborHours,
      unit_price:  laborRate,
      total:       round2(laborHours * laborRate),
      type:        'labor' as const,
    }] : []),
  ]
}

/**
 * Only the tax and grand total are rounded, so a long parts list does not
 * accumulate rounding error line by line.
 *
 * TAX: parts-plus-markup is the parts base, hours x rate is the labor base, and the
 * two are taxed according to the shop's settings. Most states tax the first and not
 * the second. Without taxSettings this falls back to the old behaviour -- one rate
 * over the combined subtotal -- so an un-migrated caller keeps producing the totals
 * it always produced.
 */
export function computeTotals({
  items, markupPct, laborHours, laborRate, taxPct, taxSettings,
}: LineInputs): LineTotals {
  const partsBase     = items.reduce((s, li) => s + li.quantity * li.unit_price, 0)
  const markupAmt     = partsBase * (markupPct / 100)
  const partsTotal    = partsBase + markupAmt
  const laborSubtotal = (laborHours || 0) * (laborRate || 0)
  const subtotal      = partsTotal + laborSubtotal

  if (!taxSettings) {
    const taxAmount  = round2(subtotal * ((taxPct || 0) / 100))
    const grandTotal = round2(subtotal + taxAmount)
    return { partsBase, markupAmt, partsTotal, laborSubtotal, subtotal, taxAmount, grandTotal, taxBreakdown: null }
  }

  // The markup rides with parts: it is part of what the customer pays for goods.
  const tax = computeTax({ parts: partsTotal, labor: laborSubtotal }, taxSettings)
  return {
    partsBase, markupAmt, partsTotal, laborSubtotal, subtotal,
    taxAmount:    tax.taxAmount,
    grandTotal:   round2(subtotal + tax.taxAmount),
    taxBreakdown: tax.breakdown,
  }
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
