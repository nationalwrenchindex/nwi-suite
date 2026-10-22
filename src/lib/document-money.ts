// ─── The money columns of an LD quote or work order, from its lines ──────────
//
// One function for "these lines, under these terms, store these figures", used by the
// quote editor, the work-order form and the tests. Before it, the quote editor saved
// tax_amount WITHOUT the extras' tax while its grand_total included it, re-taxed an
// existing quote with today's settings, and started travel hours and miles at zero on
// every reopen - so saving a quote that billed travel silently removed the travel.
//
// RECORDED VALUES BEAT CURRENT SETTINGS (CLAUDE.md; docs/NWI-ESTIMATE-DOCUMENT-SPEC.md
// section 6). An EXISTING document is re-totalled under the terms it stored:
//   * markup  - markupOnReopen, never Settings (line-items.ts)
//   * tax     - documentTaxSettings: its own breakdown, or its own single rate
//   * extras  - documentExtras: its own hours, miles and rates; an extra it never
//               recorded stays off, even if the shop bills it today
// A NEW document is priced under the shop's current settings, which it then stores.

import {
  computeTotals, lineMoneyColumns, round2, isUntouched, type EditItem,
} from '@/components/shared/line-items'
import {
  computeExtras, extrasColumns, extrasFromDocument, totalsWithExtras, EXTRAS_OFF,
  type ExtrasInput, type ExtrasResult, type ExtrasSettings,
} from '@/lib/billable-extras'
import { parseBreakdown, type TaxBreakdown, type TaxSettings } from '@/lib/tax'

export interface DocumentMoneyInput {
  items:       EditItem[]
  markupPct:   number
  /** The document's own rate: the default a new labour line starts at. */
  laborRate:   number
  /** Legacy single labour pair. 0 for the multi-line editors, whose labour is in items. */
  laborHours?: number
  /** Percent. Applied over the whole subtotal only when `taxSettings` is null. */
  taxPct:      number
  taxSettings: TaxSettings | null
  extrasSettings: ExtrasSettings
  extras:      ExtrasInput
  /**
   * The document as stored, when re-totalling an existing one. While nothing about it
   * has changed, its own figures are returned untouched - see `unchanged`.
   */
  stored?:     Record<string, unknown> | null
}

/** The money columns a document stores, copied as-is for an unchanged save. */
const STORED_MONEY_COLUMNS = [
  'line_items', 'labor_hours', 'labor_rate', 'parts_subtotal', 'parts_markup_percent',
  'labor_subtotal', 'tax_percent', 'tax_amount', 'grand_total', 'tax_breakdown',
  'travel_hours', 'travel_rate', 'travel_amount', 'mileage_miles', 'mileage_rate', 'mileage_amount',
  'shop_supplies_percent_applied', 'shop_supplies_cap_applied', 'shop_supplies_fee',
] as const

/**
 * THE NO-OP RULE. Every line still exactly as loaded, in the same order, and every
 * term the same: then nothing was edited, and the stored figures ARE the answer.
 *
 * Re-deriving them is not neutral. Real quotes taxed an unrounded parts figure
 * (QT-2026-0001: 299.497 x 7% = 57.71, while its lines read 299.50 -> 57.72), and
 * QuickWrench stored parts_subtotal as COST rather than the pre-markup base. Recomputing
 * either on a save nobody changed anything in moves a total the customer already has.
 */
export function unchanged(input: DocumentMoneyInput): boolean {
  const s = input.stored
  if (!s) return false
  const stored = Array.isArray(s.line_items) ? s.line_items : []
  if (stored.length !== input.items.length || (input.laborHours ?? 0) > 0) return false
  const sameNum = (a: unknown, b: unknown) => Number(a ?? 0) === Number(b ?? 0)
  return input.items.every((it, i) =>
      it._stored === stored[i] && it._loadedKey !== undefined &&
      isUntouched(it, input.markupPct)) &&
    (stored.length === 0 || sameNum(s.parts_markup_percent, input.markupPct) || s.parts_markup_percent == null) &&
    sameNum(s.labor_rate, input.laborRate) &&
    sameNum(s.tax_percent, input.taxPct) &&
    sameNum(s.travel_hours, input.extras.travelHours) &&
    sameNum(s.mileage_miles, input.extras.mileageMiles)
}

export interface DocumentMoney {
  partsBase:     number
  markupAmt:     number
  partsTotal:    number
  laborSubtotal: number
  extras:        ExtrasResult
  subtotal:      number
  taxAmount:     number
  grandTotal:    number
  taxBreakdown:  TaxBreakdown | null
  /** Every money column to write, extras inside the tax and the total. */
  columns:       Record<string, unknown>
}

export function documentMoney(input: DocumentMoneyInput): DocumentMoney {
  const lineInputs = {
    items:       input.items,
    markupPct:   input.markupPct,
    laborHours:  input.laborHours ?? 0,
    laborRate:   input.laborRate,
    taxPct:      input.taxPct,
    taxSettings: input.taxSettings,
  }
  const t = computeTotals(lineInputs)
  // Shop supplies is a percentage of the POST-markup parts total - the figure the
  // customer reads - so a quote and the invoice it becomes agree.
  const extras = computeExtras(t.partsTotal, input.extras, input.extrasSettings, input.laborRate)
  const w = totalsWithExtras(
    { parts: t.partsTotal, labor: t.laborSubtotal }, extras, input.taxSettings, input.taxPct,
  )
  if (unchanged(input)) {
    const s = input.stored!
    const n = (v: unknown) => Number(v ?? 0)
    const storedExtras = extrasFromDocument(s)
    const columns: Record<string, unknown> = {}
    for (const k of STORED_MONEY_COLUMNS) if (k in s) columns[k] = s[k]
    return {
      partsBase:     n(s.parts_subtotal),
      markupAmt:     t.markupAmt,
      partsTotal:    t.partsTotal,
      laborSubtotal: n(s.labor_subtotal),
      extras:        storedExtras,
      subtotal:      round2(n(s.grand_total) - n(s.tax_amount)),
      taxAmount:     n(s.tax_amount),
      grandTotal:    n(s.grand_total),
      taxBreakdown:  parseBreakdown(s.tax_breakdown),
      columns,
    }
  }
  return {
    partsBase:     t.partsBase,
    markupAmt:     t.markupAmt,
    partsTotal:    t.partsTotal,
    laborSubtotal: t.laborSubtotal,
    extras,
    subtotal:      w.subtotal,
    taxAmount:     w.taxAmount,
    grandTotal:    w.grandTotal,
    taxBreakdown:  w.taxBreakdown,
    columns: {
      ...lineMoneyColumns(lineInputs),
      ...extrasColumns(extras),
      tax_amount:    round2(w.taxAmount),
      grand_total:   round2(w.grandTotal),
      tax_breakdown: w.taxBreakdown,
    },
  }
}

/**
 * The extras an EXISTING document carries: its hours and miles, the rates it was priced
 * at, and settings that bill exactly what it recorded and nothing more.
 *
 * A recorded rate already implies the document bills that extra (computeExtras), so the
 * settings here are EXTRAS_OFF: nothing the shop switched on after this document was
 * written can appear on it when a line is edited.
 */
export function documentExtras(doc: Record<string, unknown> | null | undefined): {
  settings: ExtrasSettings
  input:    ExtrasInput
} {
  const d = doc ?? {}
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
  const nn = (v: unknown): number | null =>
    v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
  return {
    settings: EXTRAS_OFF,
    input: {
      travelHours:                 n(d.travel_hours),
      mileageMiles:                n(d.mileage_miles),
      travelRateOverride:          nn(d.travel_rate),
      mileageRateOverride:         nn(d.mileage_rate),
      shopSuppliesPercentOverride: nn(d.shop_supplies_percent_applied),
      shopSuppliesCapOverride:     nn(d.shop_supplies_cap_applied),
    },
  }
}
