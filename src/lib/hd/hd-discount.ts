// ─── A discount on an HD quote, work order or invoice ─────────────────────────
//
// The engine is LD's (lib/document-discount): the same split, the same tax rule, the
// same stored shape (migration 168). This file adds only what HD needs on top.
//
// THE DISCOUNTABLE BASE is the labor LINES and the parts LINES. Travel, mileage, shop
// supplies and the diagnostic and road call fees are never discounted - the caller
// passes them inside `subtotal` and outside laborLines / partsLines.
//
// THE ONE HD DIFFERENCE: A DOCUMENT WITH NO TAX SPLIT. 13 of the 27 HD invoices
// predate migration 140 and store one tax_amount with no breakdown. The shared engine
// re-taxes such a document as (subtotal - discount) x rate, which would newly tax
// mileage on an old invoice and re-derive tax the customer already agreed to. HD
// instead CARRIES the stored tax and takes off only the discount's share:
//
//     tax after = stored tax - round2(discount x the rate this document recorded)
//
// A missing rate is never read as zero. No rate and no tax charged: nothing comes off,
// and the screen says so. No rate but tax charged: refused, with the reason, until the
// rate is entered.

import { applyDiscount, discountForWrite, type ApplyDiscountResult, type DiscountInput } from '@/lib/document-discount'
import { parseTermsSnapshot } from '@/lib/document-terms'
import { round2 } from '@/lib/shared/markup'
import type { TaxBreakdown } from '@/lib/tax'

const usd = (n: number) => `$${n.toFixed(2)}`

export interface HdDiscountInput {
  discount:   DiscountInput | null
  /** Pre-discount labor LINE total and parts LINE total (sell, post-markup). */
  laborLines: number
  partsLines: number
  /** Pre-discount subtotal: lines, fees and extras. */
  subtotal:   number
  /** The pre-discount tax split, or null for a document that recorded none. */
  breakdown:  TaxBreakdown | null
  /** The pre-discount tax. */
  taxAmount:  number
  /** The single rate the document recorded, percent. NULL when it recorded none. Read
   *  only when breakdown is null. */
  taxRatePct: number | null
}

export type HdDiscountResult = ApplyDiscountResult & {
  /** Shown beside the discount when the document recorded no tax rate. */
  notice?: string | null
}

/** The rate a column holds, or null for none recorded. Never NaN, never a silent 0. */
export function recordedRate(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function hdApplyDiscount(i: HdDiscountInput): HdDiscountResult {
  // A split document, or no discount: the shared engine exactly.
  if (i.breakdown || !i.discount) {
    return applyDiscount({ ...i, taxPct: 0 })
  }

  const tax  = round2(i.taxAmount)
  const rate = i.taxRatePct
  if (tax > 0 && (rate == null || rate <= 0)) {
    return {
      ok: false,
      error: rate == null
        ? `This document charges ${usd(tax)} tax but recorded no tax rate, so the tax on a discount cannot be worked out. Enter its tax rate first.`
        : `This document charges ${usd(tax)} tax at a recorded rate of 0%, so the tax on a discount cannot be worked out. Enter its tax rate first.`,
    }
  }

  // The record, the split and the subtotal from the shared engine. Its tax figure is
  // the re-taxed one this function exists to avoid, so it is replaced below.
  const r = applyDiscount({ ...i, taxPct: 0 })
  if (!r.ok || !r.discount) return r

  const off = tax > 0 ? round2(r.discount.amount * (rate! / 100)) : 0
  if (off > tax) {
    return { ok: false, error: `The tax on this discount (${usd(off)}) is more than the tax this document charges (${usd(tax)}).` }
  }
  const taxAmount = round2(tax - off)
  return {
    ...r,
    taxAmount,
    grandTotal: round2(r.subtotalAfter + taxAmount),
    notice: rate == null
      ? 'No tax rate is recorded on this document and it charges no tax, so the discount takes no tax off.'
      : null,
  }
}

/**
 * A request body's `discount`, checked before it is stored (discountForWrite: the
 * record must be well formed and its parts must add up). Mutates `row` so what is
 * written is the cleaned record. Returns the reason when it must be refused.
 */
export function checkDiscountWrite(row: Record<string, unknown>): string | null {
  if (!('discount' in row)) return null
  const w = discountForWrite(row.discount)
  if ('error' in w) return w.error
  if (w.skip) delete row.discount
  else row.discount = w.value
  return null
}

/**
 * A request body's `terms_snapshot` on a NEW document - one carried from the quote by
 * way of the work order. Re-read through the one parser so a pay link is re-checked;
 * anything malformed is dropped rather than stored. An edit never sets it: terms are
 * recorded once, at send.
 */
export function checkTermsSnapshotWrite(row: Record<string, unknown>): void {
  if (!('terms_snapshot' in row)) return
  const snap = parseTermsSnapshot(row.terms_snapshot)
  if (snap) row.terms_snapshot = snap
  else delete row.terms_snapshot
}
