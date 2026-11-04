// ─── An HD quote's or new invoice's tax: each bucket's summed base, taxed once ─────
//
// The lines, the fees, the drive time and the shop supplies are added into their bucket
// FIRST, and each bucket is taxed and rounded once (computeTax). The quote and
// new-invoice forms used to tax the lines and fees in one call and the drive time and
// supplies in another, then add the two rounded figures - two roundings per bucket,
// a cent away from one rounding of the same base.
//
// A SAVED document is never re-derived: its stored tax is carried and moves only by the
// tax on what the edit changed (lib/hd/carried-tax), so opening and saving it unchanged
// writes the figure it already has.

import { round2 } from '@/lib/billable-extras'
import { parseDiscount } from '@/lib/document-discount'
import { hdTaxableFees } from '@/lib/hd/hd-extras'
import { shiftCarriedTax } from '@/lib/hd/carried-tax'
import { computeTax, parseBreakdown, type TaxBreakdown, type TaxSettings } from '@/lib/tax'

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Shop supplies is parts; the taxed fees and drive time are labor; mileage is in neither. */
export function hdTaxableBase(p: {
  partsLines: number; laborLines: number; taxedFees: number; travel: number; supplies: number
}): { parts: number; labor: number } {
  return {
    parts: round2(p.partsLines + p.supplies),
    labor: round2(p.laborLines + p.taxedFees + p.travel),
  }
}

export interface SavedDocumentTax {
  /** The stored tax and split BEFORE any discount - what a discount is applied from. */
  carried: { taxAmount: number; breakdown: TaxBreakdown | null }
  /** The base they were figured on, off the document's own stored columns. */
  base: { parts: number; labor: number }
  /** The rates and flags it was taxed at, as the form opens them. */
  settings: TaxSettings
}

/**
 * What a saved quote carries. NULL when it has no stored split to carry: a pre-140
 * quote, which the form has always re-priced from its lines and still does (none of
 * those has drive time or supplies, so both roundings give the same figure).
 */
export function savedDocumentTax(doc: Record<string, unknown> | null): SavedDocumentTax | null {
  if (!doc || doc.tax_amount == null) return null
  const d = parseDiscount(doc.discount)
  const breakdown = d ? d.pre_tax_breakdown : parseBreakdown(doc.tax_breakdown)
  if (!breakdown) return null
  const stored = parseBreakdown(doc.tax_breakdown)
  // The form opens hd_quotes.tax_rate as the parts rate and the stored labor rate (or
  // the single rate on a quote with no labor bucket) as the labor rate.
  const settings: TaxSettings = {
    tax_parts:      stored?.parts ? stored.parts.taxed : true,
    tax_labor:      stored?.labor ? stored.labor.taxed : true,
    tax_rate_parts: num(doc.tax_rate),
    tax_rate_labor: stored?.labor?.rate ?? num(doc.tax_rate),
  }
  return {
    carried: { taxAmount: d ? d.tax_before : round2(num(doc.tax_amount)), breakdown },
    base: hdTaxableBase({
      partsLines: num(doc.subtotal_parts),
      laborLines: num(doc.subtotal_labor),
      taxedFees:  hdTaxableFees(doc),
      travel:     num(doc.travel_amount),
      supplies:   num(doc.shop_supplies_fee),
    }),
    settings,
  }
}

/** The document's tax before any discount: carried when saved, one rounding per bucket when new. */
export function hdDocumentTax(
  base: { parts: number; labor: number },
  settings: TaxSettings,
  saved: SavedDocumentTax | null = null,
): { taxAmount: number; breakdown: TaxBreakdown | null } {
  if (saved) return shiftCarriedTax(saved.carried, saved.base, base, saved.settings, settings)
  const t = computeTax(base, settings)
  return { taxAmount: t.taxAmount, breakdown: t.breakdown }
}
