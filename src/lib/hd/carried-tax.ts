// ─── Tax that was agreed, plus only what changed since ───────────────────────
//
// The settled rule: tax is rounded per bucket where it is first agreed, then carried,
// never recomputed. When something is added to a document that already carries a tax
// figure - drive time typed on a work order approved from a quote, shop supplies
// refigured on the parts actually billed - each bucket the change touches is taxed ONCE
// on its summed base (its stored base plus the change), and the carried figure moves by
// that less the tax on the stored base. An unchanged save adds zero, and a split that
// matches its base lands exactly where one rounding of the new base puts it.
//
// Taxing the change on its own and adding it rounded each bucket twice, a cent from one
// rounding of the same base (verify-hd-extras: $297.50 of drive time and service call
// on a $1,500.75 labor bucket at 7.75%).

import { round2 } from '@/lib/billable-extras'
import { computeTax, parseBreakdown, type TaxableBase, type TaxBreakdown, type TaxCategory, type TaxSettings } from '@/lib/tax'

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

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** One bucket taxed once on one base, through the one calculator. 0 for no base. */
function bucketTax(k: TaxCategory, base: number, settings: TaxSettings) {
  return computeTax({ [k]: base }, settings).breakdown[k]
}

/** The rate and taxed flag a bucket is figured at. */
function sameTerms(k: TaxCategory, a: TaxSettings, b: TaxSettings): boolean {
  if (k === 'labor') return a.tax_labor === b.tax_labor && a.tax_rate_labor === b.tax_rate_labor
  if (k === 'parts') return a.tax_parts === b.tax_parts && a.tax_rate_parts === b.tax_rate_parts
  return a.tax_rate_parts === b.tax_rate_parts
}

/**
 * The carried tax moved by what changed between `before` and `after`, each bucket that
 * changed taxed once on (its stored base + the change). `afterSettings` is for an
 * editor whose rate box was changed; it defaults to `settings`. A carried split stays a
 * split that sums to the tax. A document with no split has no stored base to add onto,
 * so it moves by tax(after) - tax(before) and keeps no split.
 */
export function shiftCarriedTax(
  carried: { taxAmount: number; breakdown: TaxBreakdown | null },
  before: TaxableBase,
  after: TaxableBase,
  settings: TaxSettings,
  afterSettings: TaxSettings = settings,
): { taxAmount: number; breakdown: TaxBreakdown | null } {
  if (!carried.breakdown) {
    const b = computeTax(before, settings)
    const a = computeTax(after, afterSettings)
    return { taxAmount: round2(carried.taxAmount + a.taxAmount - b.taxAmount), breakdown: null }
  }
  const breakdown: TaxBreakdown = { version: 1 }
  let moved = 0
  for (const k of ['parts', 'labor', 'services'] as const) {
    const stored = carried.breakdown[k]
    const change = round2(num(after[k]) - num(before[k]))
    if (change === 0 && sameTerms(k, settings, afterSettings)) {
      if (stored) breakdown[k] = stored
      continue
    }
    const storedBase = stored?.base ?? 0
    const base = round2(storedBase + change)
    const was = bucketTax(k, storedBase, settings)
    const now = bucketTax(k, base, afterSettings)
    const delta = round2((now?.amount ?? 0) - (was?.amount ?? 0))
    moved = round2(moved + delta)
    const amount = round2((stored?.amount ?? 0) + delta)
    if (base === 0 && amount === 0) continue
    breakdown[k] = { base, rate: now?.rate ?? stored?.rate ?? 0, amount, taxed: now?.taxed ?? stored?.taxed ?? false }
  }
  return { taxAmount: round2(carried.taxAmount + moved), breakdown }
}
