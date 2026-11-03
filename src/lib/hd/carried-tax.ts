// ─── Tax that was agreed, plus only what changed since ───────────────────────
//
// The settled rule: tax is rounded per bucket where it is first agreed, then carried,
// never recomputed. When something is added to a document that already carries a tax
// figure - drive time typed on a work order approved from a quote, shop supplies
// refigured on the parts actually billed - the carried tax moves by exactly the tax on
// the change: tax(after) - tax(before), per bucket. The same method the HD invoice
// editor uses (src/lib/hd/invoice-edit-save.ts), so an unchanged save adds zero.

import { round2 } from '@/lib/billable-extras'
import { computeTax, parseBreakdown, type TaxableBase, type TaxBreakdown, type TaxBucket, type TaxSettings } from '@/lib/tax'

/** The rates a document taxed at, off its own stored split; the shop's for a bucket it has none of. */
export function recordedTaxSettings(breakdown: unknown, fallback: TaxSettings): TaxSettings {
  const bd = parseBreakdown(breakdown)
  return {
    tax_parts:      bd?.parts ? bd.parts.taxed : fallback.tax_parts,
    tax_rate_parts: bd?.parts ? bd.parts.rate  : fallback.tax_rate_parts,
    tax_labor:      bd?.labor ? bd.labor.taxed : fallback.tax_labor,
    tax_rate_labor: bd?.labor ? bd.labor.rate  : fallback.tax_rate_labor,
  }
}

function shiftBucket(stored: TaxBucket | undefined, before: TaxBucket | undefined, after: TaxBucket | undefined): TaxBucket | null {
  const base   = round2((stored?.base ?? 0)   + (after?.base ?? 0)   - (before?.base ?? 0))
  const amount = round2((stored?.amount ?? 0) + (after?.amount ?? 0) - (before?.amount ?? 0))
  if (base === 0 && amount === 0) return null
  return { base, rate: after?.rate ?? stored?.rate ?? 0, amount, taxed: after?.taxed ?? stored?.taxed ?? false }
}

/**
 * The carried tax moved by the tax on (after - before). A carried split stays a split
 * that sums to the tax; a document with no split keeps none.
 */
export function shiftCarriedTax(
  carried: { taxAmount: number; breakdown: TaxBreakdown | null },
  before: TaxableBase,
  after: TaxableBase,
  settings: TaxSettings,
): { taxAmount: number; breakdown: TaxBreakdown | null } {
  const b = computeTax(before, settings)
  const a = computeTax(after, settings)
  const taxAmount = round2(carried.taxAmount + a.taxAmount - b.taxAmount)
  if (!carried.breakdown) return { taxAmount, breakdown: null }
  const breakdown: TaxBreakdown = { version: 1 }
  for (const k of ['parts', 'labor', 'services'] as const) {
    const s = shiftBucket(carried.breakdown[k], b.breakdown[k], a.breakdown[k])
    if (s) breakdown[k] = s
  }
  return { taxAmount, breakdown }
}
