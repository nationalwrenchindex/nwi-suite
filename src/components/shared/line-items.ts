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

/**
 * A row as the editor holds it.
 *
 * PART rows: `quantity` is the count and `unit_price` is the BASE price (pre-markup).
 * LABOR rows: `quantity` is hours and `unit_price` is the hourly rate. Labor carries no
 * markup, so nothing is divided out of it or multiplied into it.
 *
 * `kind` is absent on every part row built before labour lines existed, and absent
 * still means part.
 */
export interface EditItem {
  _id:         string
  description: string
  quantity:    number
  unit_price:  number
  /** The manufacturer's part number. Empty string when the tech has not typed one. */
  part_number: string
  kind?:              LineKind
  /** Spec 2.5: what the work involves. Printed indented under the description. */
  detail?:            string
  /** Prints "included" in the rate column. Charges nothing. */
  included?:          boolean
  /** A part the customer supplied. Prints at $0.00. Parts only. */
  customer_supplied?: boolean
  /**
   * THE NO-OP GUARANTEE. The row exactly as it was stored, the editable fields as they
   * were loaded, and the markup it was loaded under. While all three still match, the
   * stored row is written back VERBATIM - so opening and saving a document cannot move
   * a cent through a divide-out and multiply-back, and cannot strip keys this editor
   * does not know about (QuickWrench's unit_cost, a segment number).
   */
  _stored?:       LineItem
  _loadedKey?:    string
  _loadedMarkup?: number
}

export type LineKind = 'part' | 'labor'

export function isLaborEdit(li: EditItem): boolean {
  return li.kind === 'labor'
}

/** Included lines and customer-supplied parts are on the document and charge nothing. */
export function chargesNothing(li: EditItem): boolean {
  return !!li.included || (!isLaborEdit(li) && !!li.customer_supplied)
}

/** Everything the tech can change on a row, in one comparable string. */
export function editKey(li: EditItem): string {
  return JSON.stringify([
    li.kind ?? 'part', li.description, li.quantity, li.unit_price, li.part_number ?? '',
    li.detail ?? '', !!li.included, !!li.customer_supplied,
  ])
}

/** True while a loaded row still holds exactly what was loaded, under the same markup. */
export function isUntouched(li: EditItem, markupPct: number): boolean {
  if (!li._stored || li._loadedKey !== editKey(li)) return false
  return isLaborEdit(li) || li._loadedMarkup === markupPct
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
  /**
   * Keep labour rows, in their stored order, as `kind: 'labor'` items. Off by default:
   * a caller that still holds labour as one hours x rate pair must not get it twice.
   * The multi-line editors (quote, work order) pass true and keep labor_hours at 0.
   */
  opts: { withLabor?: boolean } = {},
): EditItem[] {
  return (lineItems ?? [])
    .filter(li => opts.withLabor || !isLaborItem(li))
    .filter(li => !(skipDescription && li.description?.trim() === skipDescription))
    .map((li, i) => {
      const labor = !!opts.withLabor && isLaborItem(li)
      const item: EditItem = {
        _id:         `li-${i}`,
        description: li.description,
        quantity:    li.quantity,
        part_number: li.part_number ?? '',
        unit_price:  !labor && markupPct > 0
          ? round2(li.unit_price / (1 + markupPct / 100))
          : li.unit_price,
        ...(labor ? { kind: 'labor' as const } : {}),
        ...(li.detail ? { detail: li.detail } : {}),
        ...(li.is_included ? { included: true } : {}),
        ...(li.customer_supplied ? { customer_supplied: true } : {}),
      }
      // The no-op guarantee only on the multi-line path, whose callers save through
      // the same toLineItems that honours it.
      return opts.withLabor
        ? { ...item, _stored: li, _loadedKey: editKey(item), _loadedMarkup: markupPct }
        : item
    })
}

/** One part row as stored: post-markup unit price, and the spec 2.5 fields when set. */
function partRow(li: EditItem, markup: number): LineItem {
  const free = chargesNothing(li)
  return {
    description: li.description,
    quantity:    li.quantity,
    unit_price:  free ? 0 : round2(li.unit_price * (1 + markup)),
    total:       free ? 0 : round2(li.quantity * li.unit_price * (1 + markup)),
    // Written on every new row from here on, so no reader ever has to guess
    // again. part_number is omitted rather than stored as '' when empty —
    // an absent key reads as "not captured", a '' would read as "no part
    // number exists", and only the first of those is true.
    type:        'parts' as const,
    ...(li.part_number?.trim() ? { part_number: li.part_number.trim() } : {}),
    ...specFields(li),
  }
}

/** One labour row as stored: hours in quantity, the rate in unit_price. */
function laborRow(li: EditItem): LineItem {
  const free = chargesNothing(li)
  return {
    description: li.description,
    quantity:    li.quantity,
    unit_price:  free ? 0 : li.unit_price,
    total:       free ? 0 : round2(li.quantity * li.unit_price),
    type:        'labor' as const,
    ...specFields(li),
  }
}

/** Absent unless set, so a row without them stores exactly what it always did. */
function specFields(li: EditItem): Partial<LineItem> {
  const detail = li.detail?.trim()
  return {
    ...(detail ? { detail } : {}),
    ...(li.included ? { is_included: true } : {}),
    ...(!isLaborEdit(li) && li.customer_supplied ? { customer_supplied: true } : {}),
  }
}

/** Editor rows -> stored line_items, in the order the tech arranged them: applies the
 *  markup to parts and appends the legacy single labour row when there are hours.
 *  Labour is appended only when there are hours, so a parts-only job does not carry a
 *  $0 Labor line into the customer's document. */
export function toLineItems({
  items, markupPct, laborHours, laborRate,
}: Omit<LineInputs, 'taxPct'>): LineItem[] {
  const markup = markupPct / 100
  return [
    ...items.map(li =>
      isUntouched(li, markupPct) ? li._stored!
        : isLaborEdit(li) ? laborRow(li)
        : partRow(li, markup)),
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
  const factor        = 1 + markupPct / 100
  // An untouched row contributes what it STORED - the figure the customer was shown -
  // so a no-op save cannot drift a cent through rounding the base back out.
  const partsBase     = items.filter(li => !isLaborEdit(li)).reduce((s, li) =>
    s + (chargesNothing(li) ? 0
      : isUntouched(li, markupPct) ? Number(li._stored!.total) / factor
      : li.quantity * li.unit_price), 0)
  const markupAmt     = partsBase * (markupPct / 100)
  const partsTotal    = partsBase + markupAmt
  const laborSubtotal = (laborHours || 0) * (laborRate || 0) +
    items.filter(isLaborEdit).reduce((s, li) =>
      s + (chargesNothing(li) ? 0
        : isUntouched(li, markupPct) ? Number(li._stored!.total)
        : li.quantity * li.unit_price), 0)
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

/**
 * labor_hours on the document: the legacy single pair plus every labour line's hours.
 * labor_rate stays the document's own rate - the default a new labour line starts at.
 */
export function totalLaborHours({ items, laborHours }: Pick<LineInputs, 'items' | 'laborHours'>): number {
  const lines = items.filter(isLaborEdit).reduce((s, li) => s + (Number(li.quantity) || 0), 0)
  return Math.round(((laborHours || 0) + lines) * 10000) / 10000
}

/** The money columns quotes, work orders and invoices all persist. */
export function lineMoneyColumns(inputs: LineInputs) {
  const t = computeTotals(inputs)
  return {
    line_items:           toLineItems(inputs),
    labor_hours:          totalLaborHours(inputs),
    labor_rate:           inputs.laborRate,
    parts_subtotal:       round2(t.partsBase),
    parts_markup_percent: inputs.markupPct,
    labor_subtotal:       round2(t.laborSubtotal),
    tax_percent:          inputs.taxPct,
    tax_amount:           round2(t.taxAmount),
    grand_total:          round2(t.grandTotal),
  }
}
