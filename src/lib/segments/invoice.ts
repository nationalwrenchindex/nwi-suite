// ─── Authorized segments -> one invoice ───────────────────────────────────────
// SERVER ONLY. Used by the LD converter and, in the HD phase, by HD's.
//
// TWO SHAPES MEET HERE, deliberately. A segment's lines are the canonical per-line
// model (cost + markup per row). An invoice's line_items are LD's older
// {description, quantity, unit_price, total} shape, and that is NOT changed — invoices
// are billed history and every reader of them, including the PDF and the customer's
// copy, expects that shape. So this converts, and the conversion is one-way.
//
// What the customer paid is preserved exactly: unit_price here is the SELL price the
// segment already computed, never a cost re-marked-up a second time.

import { round2 } from '@/lib/shared/markup'
import { sumLines } from '@/lib/shared/work-order-lines'
import type { WorkOrderSegment } from '@/types/segments'

export interface InvoiceMoney {
  line_items: Array<{ description: string; quantity: number; unit_price: number; total: number }>
  subtotal:   number
  tax_amount: number
  tax_rate:   number
  total:      number
}

/**
 * Build the invoice money from the billable segments.
 *
 * ROLLUP RULE: each segment's own grand_total is authoritative — it is the figure the
 * customer approved — so the invoice total is the sum of those, and tax is the sum of
 * each segment's own tax_amount rather than one rate applied to a combined subtotal.
 * Segments can legitimately carry different tax_percent (a mobile job crossing a
 * jurisdiction), and re-deriving one blended rate would change what was agreed.
 *
 * `tax_rate` on the invoice is therefore reported as the EFFECTIVE rate — tax over
 * taxable — so the single-rate field that invoices have stays truthful rather than
 * silently claiming the first segment's rate applied to everything.
 */
export function invoiceFromSegments(segments: WorkOrderSegment[]): InvoiceMoney {
  const line_items: InvoiceMoney['line_items'] = []
  let subtotal = 0
  let taxAmount = 0
  let total = 0

  for (const seg of segments) {
    const lines = seg.line_items ?? []

    for (const l of lines) {
      const qty  = Number(l.quantity ?? 0)
      const unit = Number(l.unit_price ?? 0)
      line_items.push({
        // Prefixed so the invoice reads as the job it was: a customer looking at four
        // parts lines needs to know which complaint each belonged to.
        description: `Segment ${seg.sequence}${l.description ? ` — ${l.description}` : ''}`,
        quantity:    qty,
        unit_price:  unit,
        total:       Number(l.total ?? round2(qty * unit)),
      })
    }

    const t = sumLines(lines)
    subtotal  += t.parts + t.labor
    taxAmount += Number(seg.tax_amount  ?? 0)
    total     += Number(seg.grand_total ?? 0)
  }

  const roundedSubtotal = round2(subtotal)
  const roundedTax      = round2(taxAmount)

  return {
    line_items,
    subtotal:   roundedSubtotal,
    tax_amount: roundedTax,
    // Effective rate as a fraction, matching invoices.tax_rate. Zero taxable means
    // zero rate rather than a divide-by-zero NaN reaching a money column.
    tax_rate:   roundedSubtotal > 0 ? round2((roundedTax / roundedSubtotal) * 100) / 100 : 0,
    total:      round2(total),
  }
}

/**
 * The work-done narrative for the invoice's Job Notes, labelled per segment.
 *
 * This is customer-visible — /invoice/[token] renders job_notes — so it is built from
 * `correction` (what was actually done), falling back to `cause` then `complaint` for
 * a segment the tech has not written up yet. A segment with none of the three is
 * skipped rather than printing a bare "Segment 2" heading with nothing under it.
 *
 * Only BILLABLE segments appear. A declined clutch must not be described on an
 * invoice the customer is paying for work they did not authorise.
 *
 * Returns null when there is nothing to say, so the caller stores NULL rather than an
 * empty string — the invoice editor treats those differently.
 */
export function jobNotesFromSegments(segments: WorkOrderSegment[]): string | null {
  const blocks: string[] = []

  for (const seg of segments) {
    const body = seg.correction?.trim() || seg.cause?.trim() || seg.complaint?.trim()
    if (!body) continue
    const heading = seg.complaint?.trim()
      ? `Segment ${seg.sequence} — ${seg.complaint.trim()}`
      : `Segment ${seg.sequence}`
    blocks.push(`${heading}\n${body}`)
  }

  return blocks.length > 0 ? blocks.join('\n\n') : null
}
