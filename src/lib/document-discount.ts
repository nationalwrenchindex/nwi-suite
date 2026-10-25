// ─── A discount on an LD quote, work order or invoice ─────────────────────────
//
// Flat dollars or a percent, scoped to labour, parts or the whole document, with an
// optional printed reason ("fleet customer", "courtesy"). Migration 165.
//
// WHAT IT DISCOUNTS: the labour LINES and the parts LINES (post-markup) - the work
// the customer is buying. The extras are priced exactly as before and never
// discounted: travel and mileage are what getting there cost, and shop supplies stays
// a percentage of the undiscounted parts total (CLAUDE.md money rules).
//
// THE TAX RULE (the brief, verbatim in effect - do not invent an alternative):
//   * labour scope   - reduces the labour side and the labour tax; parts untouched
//   * parts scope    - reduces the parts side and the parts tax; labour untouched
//   * document %     - the percent is applied to each side separately, each rounded
//   * document flat  - split by each side's share of the pre-discount lines, each
//                      rounded to the cent, any remaining cent to labour, so the two
//                      always sum to exactly the amount entered
//   * tax is always computed on the post-discount base, never the original
//
// Only a tax bucket the discount actually touches is re-taxed. A bucket it does not
// touch keeps the amount it carried - the settled rule that agreed tax is summed,
// never recomputed (CLAUDE.md) - and no discount at all changes nothing anywhere.
//
// RECORDED, NOT LOOKED UP. There is no discount setting. The discount lives on the
// document with the amounts it produced and the tax split before it, so an
// in-progress invoice can carry its agreed tax and apply the discount once - never
// twice - and every copy prints the same figures.

import { round2 } from '@/lib/shared/markup'
import { breakdownTaxTotal, parseBreakdown, type TaxBreakdown } from '@/lib/tax'

export type DiscountType  = 'flat' | 'percent'
export type DiscountScope = 'labor' | 'parts' | 'document'

export interface DiscountInput {
  type:   DiscountType
  value:  number
  scope:  DiscountScope
  reason: string | null
}

/** What a document stores in its `discount` column. */
export interface DocumentDiscount extends DiscountInput {
  version:         1
  /** Taken off the labour side / the parts side; amount is their exact sum. */
  labor_amount:    number
  parts_amount:    number
  amount:          number
  /** The document's subtotal before the discount - printed as "Subtotal". */
  subtotal_before: number
  /** The tax as it stood before the discount. */
  tax_before:      number
  /**
   * The tax split before the discount. An in-progress invoice rebuilds its tax from
   * the agreed buckets plus what was added; with a discount stored, the stored
   * tax_breakdown is POST-discount, and rebuilding from it would discount twice.
   */
  pre_tax_breakdown: TaxBreakdown | null
}

export const DISCOUNT_SCOPES: ReadonlyArray<{ value: DiscountScope; label: string }> = [
  { value: 'document', label: 'Whole document' },
  { value: 'labor',    label: 'Labor only' },
  { value: 'parts',    label: 'Parts only' },
]

const REASON_MAX = 200

/**
 * The editor's or the API's discount, cleaned. NULL - no discount at all - for an
 * empty, zero or missing value, so a zero discount can never print a row or touch a
 * figure. Throws nothing: validation that needs the document's figures is in
 * applyDiscount.
 */
export function normalizeDiscount(raw: unknown): DiscountInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const value = Number(o.value)
  if (o.value === '' || o.value === null || o.value === undefined || !Number.isFinite(value) || value === 0) return null
  const type: DiscountType = o.type === 'percent' ? 'percent' : 'flat'
  const scope: DiscountScope = o.scope === 'labor' || o.scope === 'parts' ? o.scope : 'document'
  const reason = typeof o.reason === 'string' && o.reason.trim() ? o.reason.trim().slice(0, REASON_MAX) : null
  return { type, value: type === 'flat' ? round2(value) : Math.round(value * 10_000) / 10_000, scope, reason }
}

/** A stored discount, or null. Never throws; anything malformed reads as none. */
export function parseDiscount(v: unknown): DocumentDiscount | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (o.version !== 1) return null
  const base = normalizeDiscount(o)
  const amount = Number(o.amount)
  if (!base || !Number.isFinite(amount) || amount <= 0) return null
  return {
    ...base,
    version:           1,
    labor_amount:      round2(Number(o.labor_amount) || 0),
    parts_amount:      round2(Number(o.parts_amount) || 0),
    amount:            round2(amount),
    subtotal_before:   round2(Number(o.subtotal_before) || 0),
    tax_before:        round2(Number(o.tax_before) || 0),
    pre_tax_breakdown: parseBreakdown(o.pre_tax_breakdown),
  }
}

const money = (n: number) => `$${n.toFixed(2)}`

/**
 * How much comes off each side. `labor` and `parts` are the pre-discount LINE totals
 * (parts post-markup). Returns a readable error for a discount the document cannot
 * take - never a negative side.
 */
export function discountSplit(
  d: DiscountInput,
  labor: number,
  parts: number,
): { labor: number; parts: number; amount: number } | { error: string } {
  const L = round2(Math.max(0, labor))
  const P = round2(Math.max(0, parts))
  if (d.value < 0) return { error: 'A discount cannot be negative.' }
  if (d.type === 'percent' && d.value > 100) return { error: 'A percent discount cannot be more than 100%.' }

  const side = d.scope === 'labor' ? L : d.scope === 'parts' ? P : round2(L + P)
  const sideName = d.scope === 'labor' ? 'the labor' : d.scope === 'parts' ? 'the parts' : 'the labor and parts'
  if (side <= 0) {
    return { error: `There is no ${d.scope === 'document' ? 'labor or parts' : d.scope} on this document to discount.` }
  }

  if (d.type === 'percent') {
    const pct = d.value / 100
    if (d.scope === 'labor') { const l = round2(L * pct); return { labor: l, parts: 0, amount: l } }
    if (d.scope === 'parts') { const p = round2(P * pct); return { labor: 0, parts: p, amount: p } }
    // Each side separately - each rounds on its own, so there is no remainder.
    const l = round2(L * pct)
    const p = round2(P * pct)
    return { labor: l, parts: p, amount: round2(l + p) }
  }

  const flat = round2(d.value)
  if (flat > side) {
    return { error: `The discount (${money(flat)}) is larger than ${sideName} it applies to (${money(side)}).` }
  }
  if (d.scope === 'labor') return { labor: flat, parts: 0, amount: flat }
  if (d.scope === 'parts') return { labor: 0, parts: flat, amount: flat }
  // Proportional, each rounded to the cent; the remaining cent goes to labour so
  // the two are exactly the amount entered.
  const l = round2(flat * (L / side))
  const p = round2(flat * (P / side))
  const remainder = round2(flat - l - p)
  return { labor: round2(l + remainder), parts: p, amount: flat }
}

export interface ApplyDiscountInput {
  discount:  DiscountInput | null
  /** Pre-discount labour LINE total and parts LINE total (post-markup). */
  laborLines: number
  partsLines: number
  /** The document's pre-discount subtotal, extras included. */
  subtotal:  number
  /** The pre-discount tax split, or null for a single-rate document. */
  breakdown: TaxBreakdown | null
  /** The pre-discount tax. */
  taxAmount: number
  /** Percent, for a single-rate document (breakdown null). */
  taxPct:    number
}

export type ApplyDiscountResult =
  | {
      ok:        true
      /** Null when there is no discount - the caller then stores none. */
      discount:  DocumentDiscount | null
      breakdown: TaxBreakdown | null
      taxAmount: number
      /** subtotal - discount */
      subtotalAfter: number
      grandTotal: number
    }
  | { ok: false; error: string }

/** The discount, applied to a priced document. No discount returns the input untouched. */
export function applyDiscount(input: ApplyDiscountInput): ApplyDiscountResult {
  const subtotal = round2(input.subtotal)
  if (!input.discount) {
    return {
      ok: true, discount: null, breakdown: input.breakdown, taxAmount: round2(input.taxAmount),
      subtotalAfter: subtotal, grandTotal: round2(subtotal + input.taxAmount),
    }
  }
  const split = discountSplit(input.discount, input.laborLines, input.partsLines)
  if ('error' in split) return { ok: false, error: split.error }

  let breakdown: TaxBreakdown | null = null
  let taxAmount: number
  if (input.breakdown) {
    breakdown = JSON.parse(JSON.stringify(input.breakdown)) as TaxBreakdown
    const reduce = (key: 'labor' | 'parts', by: number) => {
      const b = breakdown![key]
      if (!b || by <= 0) return
      const base = round2(b.base - by)
      // Tax on the post-discount base, at the rate this document recorded.
      breakdown![key] = { ...b, base, amount: b.taxed ? round2(base * (b.rate / 100)) : 0 }
    }
    reduce('labor', split.labor)
    reduce('parts', split.parts)
    taxAmount = breakdownTaxTotal(breakdown)
  } else {
    taxAmount = round2(round2(subtotal - split.amount) * (input.taxPct / 100))
  }

  const subtotalAfter = round2(subtotal - split.amount)
  return {
    ok: true,
    discount: {
      ...input.discount,
      version:           1,
      labor_amount:      split.labor,
      parts_amount:      split.parts,
      amount:            split.amount,
      subtotal_before:   subtotal,
      tax_before:        round2(input.taxAmount),
      pre_tax_breakdown: input.breakdown,
    },
    breakdown,
    taxAmount,
    subtotalAfter,
    grandTotal: round2(subtotalAfter + taxAmount),
  }
}

/**
 * The labour LINES on a stored document: typed labour, or an untyped legacy line
 * whose description starts "Labor" - the same test the work-order converter and the
 * parent-extras sync use, so all three agree on what a labour discount comes off.
 */
export function laborFromLines(lines: unknown): number {
  if (!Array.isArray(lines)) return 0
  let n = 0
  for (const raw of lines) {
    if (!raw || typeof raw !== 'object') continue
    const l = raw as Record<string, unknown>
    const isLabor = l.type === 'labor' ||
      (l.type === undefined && typeof l.description === 'string' && /^labor/i.test(l.description.trim()))
    if (isLabor) n += Number(l.total ?? 0)
  }
  return round2(n)
}

/** "10% off labor", "$100.00 off" - the label the customer's copy prints. */
export function discountLabel(d: DiscountInput): string {
  const what = d.type === 'percent' ? `${trimPct(d.value)}%` : money(d.value)
  const on = d.scope === 'labor' ? ' on labor' : d.scope === 'parts' ? ' on parts' : ''
  return `Discount (${what}${on})`
}

/**
 * The printed row label, which states each fact once: a FLAT discount's amount is
 * already in the amount column, so it is not repeated here; a percentage is
 * information the amount does not carry, so it stays. Then the reason, if any.
 *   "Discount - Fleet customer"  "Discount (10%) - Fleet customer"  "Discount on labor"
 * HD prints this. LD still prints discountLabel.
 */
export function discountPrintLabel(d: DiscountInput): string {
  const on = d.scope === 'labor' ? 'on labor' : d.scope === 'parts' ? 'on parts' : ''
  const head = d.type === 'percent'
    ? `Discount (${[`${trimPct(d.value)}%`, on].filter(Boolean).join(' ')})`
    : on ? `Discount ${on}` : 'Discount'
  return d.reason ? `${head} - ${d.reason}` : head
}

function trimPct(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/**
 * A discount a route has been asked to STORE. `undefined` = not sent (leave the
 * column alone), null = clear it, otherwise a well-formed record whose parts add up.
 * The client did the arithmetic; this refuses a record that contradicts itself, so a
 * malformed body can never store a discount bigger than what it came off.
 */
export function discountForWrite(raw: unknown):
  { skip: true } | { skip: false; value: DocumentDiscount | null } | { error: string } {
  if (raw === undefined) return { skip: true }
  if (raw === null) return { skip: false, value: null }
  const d = parseDiscount(raw)
  if (!d) return { error: 'The discount could not be read. Check its amount and try again.' }
  if (round2(d.labor_amount + d.parts_amount) !== d.amount) {
    return { error: 'The discount does not add up. Reopen the document and try again.' }
  }
  if (d.amount > d.subtotal_before) {
    return { error: `The discount (${money(d.amount)}) is larger than the subtotal it applies to (${money(d.subtotal_before)}).` }
  }
  return { skip: false, value: d }
}

/** True when a write failed only because migration 165 is not applied. */
export function isMissing165Column(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const m = String((error as { message?: unknown }).message ?? '').toLowerCase()
  return m.includes('discount') && !m.includes('discount_amount') &&
    (m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache'))
}

export const MIGRATION_165_MESSAGE =
  'Discounts need migration 165 applied first. Nothing was saved.'
