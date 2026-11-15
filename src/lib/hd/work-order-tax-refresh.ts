// ─── A work order's own tax, moved when its lines change ────────────────────────
//
// A work order carrying its quote's tax (hd_work_orders.tax_amount set) froze that
// figure at approval. Drive time, mileage and fee saves already move it by the tax on
// what changed (workOrderExtrasUpdate); line saves did not, so after a line was added
// or removed the work order's stored tax - and its quoted total - were stale while the
// invoice, which re-bases at convert, was right (Nov 15, item 20).
//
// ONE PRICING. The figure written is the converter's own (buildInvoicePayload): the
// carried tax moved by exactly the tax on what changed, each bucket taxed once on its
// whole new base, at the rates the document recorded. Its split's base is written with
// it, so the next save shifts from the new base - the shift telescopes (shiftCarriedTax
// is stored + tax(new base) - tax(stored base)), so a chain of saves lands where one
// save from the original would, and an unchanged save writes exactly what is there.
//
// LEFT ALONE: a work order with no tax recorded (the converter taxes it fresh at
// billing, from settings) and a carried tax with no stored split and no discount record
// (no base to move from - the converter handles those as before).

import { buildInvoicePayload, type WorkOrderLineRow } from '@/lib/hd/wo-to-invoice'
import type { WorkOrderJob } from '@/lib/hd/work-order-jobs'
import { parseBreakdown, type TaxSettings } from '@/lib/tax'
import { parseDiscount } from '@/lib/document-discount'

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function workOrderLinesTaxUpdate(
  wo: Record<string, unknown>,
  before: { rows: WorkOrderLineRow[]; jobs: WorkOrderJob[] },
  after: { rows: WorkOrderLineRow[]; jobs: WorkOrderJob[] },
  shop: { laborRate: number | null; taxSettings: TaxSettings },
): Record<string, unknown> | null {
  if (num(wo.tax_amount) == null) return null
  const hasDiscount = !!parseDiscount(wo.discount)
  if (!parseBreakdown(wo.tax_breakdown) && !hasDiscount) return null

  const opts = { laborRate: shop.laborRate, taxSettings: shop.taxSettings }
  const next = buildInvoicePayload({ ...wo }, after.rows, opts, after.jobs)
  if (next.discountError) return null
  const p = next.payload

  const update: Record<string, unknown> = {}
  if (num(p.tax_amount) !== num(wo.tax_amount)) update.tax_amount = p.tax_amount
  if (JSON.stringify(p.tax_breakdown ?? null) !== JSON.stringify(wo.tax_breakdown ?? null)) update.tax_breakdown = p.tax_breakdown ?? null
  if (hasDiscount && JSON.stringify(p.discount ?? null) !== JSON.stringify(wo.discount ?? null)) update.discount = p.discount ?? null

  // The quoted total moves by exactly what the bill moved - the extras save's rule.
  if (num(wo.total_amount) != null) {
    const prev = buildInvoicePayload({ ...wo }, before.rows, opts, before.jobs)
    if (!prev.discountError) {
      const moved = r2((num(p.total) ?? 0) - (num(prev.payload.total) ?? 0))
      if (moved !== 0) update.total_amount = r2((num(wo.total_amount) ?? 0) + moved)
    }
  }
  return Object.keys(update).length ? update : null
}
