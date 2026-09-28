// ─── The only place tax is calculated ─────────────────────────────────────────
// LD and HD, quotes, work orders, segments and invoices all come through here.
// Before this existed the same arithmetic lived in sixteen files, which is how a
// shop ended up over-collecting on every invoice without anything looking broken.
//
// RATE UNIT: PERCENT, everywhere. 7.75 means 7.75%. Six of the seven document
// tables already stored percent (hd_quotes, hd_invoices, quotes, work_orders,
// work_order_segments, work_order_segment_options) and so does the profile setting
// this replaces. The lone exception is invoices.tax_rate, declared numeric(6,4) and
// holding a FRACTION (0.0775) -- that column keeps its meaning, because rewriting it
// would be rewriting invoices customers have already been sent. Convert at that
// boundary with fractionToPercent/percentToFraction and nowhere else.
//
// WHAT COUNTS AS WHAT
//   parts    parts lines, parts markup, shop supplies, disposal and environmental
//            fees -- anything that is goods or a goods-like surcharge
//   labor    labor lines, and in HD the diagnostic fee and the road call fee. Those
//            two follow tax_labor. Leaving them on the parts side would have moved
//            the bug rather than fixed it.
//   services SEAM ONLY, see TaxableBase.services.

import { round2 } from '@/lib/shared/markup'

export type TaxCategory = 'parts' | 'labor' | 'services'

function num(v: unknown): number {
  // Supabase returns NUMERIC as a string, so every rate and base arrives as text
  // at least some of the time.
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function round4(n: number): number { return Math.round(n * 10_000) / 10_000 }

/** Percent in, percent out. invoices.tax_rate is the only fraction in the system. */
export function fractionToPercent(f: number | string | null | undefined): number {
  return round4(num(f) * 100)
}
export function percentToFraction(p: number | string | null | undefined): number {
  return round4(num(p) / 100)
}

/** The per-business settings, as stored on profiles by migration 140. */
export interface TaxSettings {
  tax_parts:      boolean
  tax_labor:      boolean
  /** Percent. */
  tax_rate_parts: number
  /** Percent. Only applied when tax_labor is true. */
  tax_rate_labor: number
}

/**
 * What a document is charging for, split by category. Omit or pass 0 for a
 * category the document has none of.
 *
 * `services` IS THE SEAM. Detailer service_lines and adjustments go here. They are
 * unconditionally taxed at the parts rate, which reproduces today's detailer totals
 * to the cent -- detailers were explicitly left out of this change, and "left out"
 * means nothing moves, not that their taxable base shrinks. There is deliberately no
 * tax_services setting yet; when one is wanted it is two profile columns and a
 * checkbox, with no document migration and no backfill, because the bucket is
 * already being written.
 */
export interface TaxableBase {
  parts?:    number
  labor?:    number
  services?: number
}

export interface TaxBucket {
  /** The amount in this category that tax was assessed against. */
  base:   number
  /** Percent actually applied -- 0 when this category is not taxed. */
  rate:   number
  amount: number
  /** False means "present on this document but exempt", which the customer's copy
   *  states explicitly rather than leaving the customer to infer it. */
  taxed:  boolean
}

/** Stored as the tax_breakdown jsonb column. Absent key = none of that category. */
export interface TaxBreakdown {
  parts?:    TaxBucket
  labor?:    TaxBucket
  services?: TaxBucket
  version:   1
}

export interface TaxResult {
  breakdown: TaxBreakdown
  /** The figure that goes in tax_amount. Unchanged in meaning: the total. */
  taxAmount: number
  /** Sum of every base, taxed or not -- the document's pre-tax subtotal. */
  subtotal:  number
}

function bucket(base: number, ratePercent: number, taxed: boolean): TaxBucket {
  const b    = round2(base)
  const rate = taxed ? num(ratePercent) : 0
  return { base: b, rate, amount: taxed ? round2(b * (rate / 100)) : 0, taxed }
}

/**
 * The calculation. Every caller in both products uses this.
 *
 * ROUNDING: each category's tax is rounded to the cent independently and the total
 * is their sum. That is deliberate -- these are separately-stated tax figures the
 * customer reads on their invoice, so the lines they can see have to add up to the
 * total they are asked to pay. Rounding once over a combined base would sit a cent
 * away from the printed lines often enough to cause a phone call.
 */
export function computeTax(base: TaxableBase, settings: TaxSettings): TaxResult {
  const breakdown: TaxBreakdown = { version: 1 }

  const parts    = round2(num(base.parts))
  const labor    = round2(num(base.labor))
  const services = round2(num(base.services))

  // A bucket is emitted only when the document actually has that category, so an
  // invoice with no labor does not display "Labor - not taxable" against nothing.
  if (parts    !== 0) breakdown.parts    = bucket(parts,    settings.tax_rate_parts, !!settings.tax_parts)
  if (labor    !== 0) breakdown.labor    = bucket(labor,    settings.tax_rate_labor, !!settings.tax_labor)
  // Always taxed, at the parts rate. See TaxableBase.services.
  if (services !== 0) breakdown.services = bucket(services, settings.tax_rate_parts, true)

  const taxAmount = round2(
    (breakdown.parts?.amount    ?? 0) +
    (breakdown.labor?.amount    ?? 0) +
    (breakdown.services?.amount ?? 0),
  )

  return { breakdown, taxAmount, subtotal: round2(parts + labor + services) }
}

/**
 * The effective single rate, for the legacy tax_percent / tax_rate columns that
 * every existing reader still expects. Reported as tax over taxable rather than as
 * one of the two configured rates, so the stored figure stays truthful on a document
 * where only one category was taxed.
 */
export function effectiveRatePercent(result: TaxResult): number {
  return result.subtotal > 0 ? round4((result.taxAmount / result.subtotal) * 100) : 0
}

/** Settings straight off a profiles row, tolerating strings and missing columns. */
export function taxSettingsFrom(profile: unknown): TaxSettings {
  const p = (profile ?? {}) as Record<string, unknown>
  // Pre-140 rows, and any caller that forgot to select the columns, fall back to
  // default_tax_percent with labor taxed -- which is what the code did before this
  // module existed. Never silently drop to a 0% rate: that would under-collect, and
  // under-collected tax is money the shop owes out of its own pocket.
  const legacy = num(p.default_tax_percent)
  const hasNew = p.tax_rate_parts !== undefined && p.tax_rate_parts !== null
  return {
    tax_parts:      p.tax_parts === undefined || p.tax_parts === null ? true : !!p.tax_parts,
    tax_labor:      p.tax_labor === undefined || p.tax_labor === null ? true : !!p.tax_labor,
    tax_rate_parts: hasNew ? num(p.tax_rate_parts) : legacy,
    tax_rate_labor: hasNew ? num(p.tax_rate_labor) : legacy,
  }
}

/** Columns a caller must select for taxSettingsFrom to work. */
export const TAX_SETTINGS_SELECT =
  'tax_parts, tax_labor, tax_rate_parts, tax_rate_labor, default_tax_percent'

/**
 * Read a stored breakdown back for display.
 *
 * NULL means the document predates migration 140 and was taxed on its whole
 * subtotal. Returning null rather than an empty breakdown is the point: a caller
 * must show the single stored tax_amount for those and must not claim a split it
 * does not have. That is what keeps an already-sent invoice reading exactly as the
 * customer received it.
 */
export function parseBreakdown(value: unknown): TaxBreakdown | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  const out: TaxBreakdown = { version: 1 }
  let found = false
  for (const key of ['parts', 'labor', 'services'] as const) {
    const b = v[key]
    if (!b || typeof b !== 'object') continue
    const r = b as Record<string, unknown>
    out[key] = { base: num(r.base), rate: num(r.rate), amount: num(r.amount), taxed: !!r.taxed }
    found = true
  }
  return found ? out : null
}

/**
 * True when a write failed only because migration 140 has not been applied yet.
 *
 * Migrations here are applied by hand, and a preview deploy runs against the same
 * database, so there is a real window where the code writes tax_breakdown and the
 * column does not exist. An insert that fails costs the tech the invoice they just
 * typed, which is not a price worth paying for a display field -- every write path
 * retries without it. Mirrors isMissingCostingColumn() in lib/hd/invoice-costing.ts,
 * which exists for exactly the same reason.
 */
export function isMissingTaxBreakdownColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const m = String((error as { message?: unknown }).message ?? '').toLowerCase()
  return m.includes('tax_breakdown') &&
    (m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache'))
}

/** Drop the column from a row so a write can be retried without it. */
export function withoutTaxBreakdown<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row }
  delete copy.tax_breakdown
  return copy
}

/** Display order and labels, so every surface words it the same way. */
export const TAX_CATEGORY_LABEL: Record<TaxCategory, string> = {
  parts:    'Parts',
  labor:    'Labor',
  services: 'Services',
}

export const TAX_CATEGORY_ORDER: TaxCategory[] = ['parts', 'labor', 'services']

/**
 * The rows a customer-facing document shows under its subtotal, including the
 * exempt ones. A customer who is not charged tax on labor should be able to SEE
 * that, rather than having to work out why the tax looks low.
 */
export interface TaxDisplayRow {
  category: TaxCategory
  label:    string
  base:     number
  rate:     number
  amount:   number
  taxed:    boolean
  /** e.g. "Tax on parts (7.75%)" or "Labor - not taxable". */
  text:     string
}

export function taxDisplayRows(breakdown: TaxBreakdown | null): TaxDisplayRow[] {
  if (!breakdown) return []
  const rows: TaxDisplayRow[] = []
  for (const category of TAX_CATEGORY_ORDER) {
    const b = breakdown[category]
    if (!b) continue
    const label = TAX_CATEGORY_LABEL[category]
    rows.push({
      category, label,
      base: b.base, rate: b.rate, amount: b.amount, taxed: b.taxed,
      text: b.taxed ? `Tax on ${label.toLowerCase()} (${b.rate}%)` : `${label} — not taxable`,
    })
  }
  return rows
}
