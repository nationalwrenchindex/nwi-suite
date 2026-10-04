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
import { mergeBreakdowns, parseBreakdown, type TaxBreakdown } from '@/lib/tax'

/**
 * One itemised line on the invoice.
 *
 * The first four fields are LD's long-standing invoice line shape and every reader
 * expects them. The rest are additive, so an invoice converted before they existed
 * still renders: see segmentedLine() in lib/invoice-document.ts.
 *
 * WHAT IS DELIBERATELY NOT HERE: unit_cost and markup_percent. A segment line
 * carries both, and /invoice/[token] ships line_items to the CUSTOMER'S browser.
 * What the shop paid for the part has no business travelling there, for the same
 * reason internal_notes does not. The invoice's own parts_markup_percent column
 * already feeds the shop-side "your cost ... plus 30%" display.
 */
export interface InvoiceLine {
  description: string
  quantity:    number
  unit_price:  number
  total:       number
  /**
   * 'parts' | 'labor', in the INVOICE vocabulary.
   *
   * Segments store 'part' SINGULAR to match their DB CHECK constraint; invoice lines
   * use 'parts' PLURAL, which is what isLaborLine() tests. Translated here on purpose
   * - passing 'part' straight through would make every parts line fall through to
   * description-sniffing and get described as though nobody knew what it was.
   */
  type?:          'parts' | 'labor'
  /** Lets a customer re-order the part or check it against a warranty claim. */
  part_number?:   string | null
  /** The segment this line belonged to, so the document can group under a heading. */
  segment?:       number
  /** That segment's complaint, in the customer's own words. */
  segment_label?: string | null
}

export interface InvoiceMoney {
  line_items: InvoiceLine[]
  subtotal:   number
  tax_amount: number
  tax_rate:   number
  total:      number
  /** The billed segments' breakdowns combined. Null when none carried one. */
  tax_breakdown: TaxBreakdown | null
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
      const labor = l.type === 'labor'
      line_items.push({
        // The line's OWN description. The segment it belonged to travels in `segment`
        // rather than glued to the front of this text, so the document groups three
        // parts and two labour entries under one heading instead of printing
        // "Segment 2 - " five times.
        description: (l.description ?? '').trim(),
        quantity:    qty,
        unit_price:  unit,
        total:       Number(l.total ?? round2(qty * unit)),
        type:        labor ? 'labor' : 'parts',
        // Only a part has one, and an empty string is not a part number.
        part_number: labor ? null : (l.part_number?.trim() || null),
        segment:       seg.sequence,
        segment_label: seg.complaint?.trim() || null,
      })
    }

    const t = sumLines(lines)
    subtotal  += t.parts + t.labor
    taxAmount += Number(seg.tax_amount  ?? 0)
    total     += Number(seg.grand_total ?? 0)
  }

  const roundedSubtotal = round2(subtotal)
  const roundedTax      = round2(taxAmount)

  // Each segment recorded its own parts/labor split; the invoice bills them together,
  // so the customer sees one parts figure and one labor figure rather than four.
  const tax_breakdown = mergeBreakdowns(segments.map(s => parseBreakdown(s.tax_breakdown)))

  return {
    line_items,
    subtotal:   roundedSubtotal,
    tax_amount: roundedTax,
    // Effective rate as a fraction, matching invoices.tax_rate. Zero taxable means
    // zero rate rather than a divide-by-zero NaN reaching a money column.
    tax_rate:   roundedSubtotal > 0 ? round2((roundedTax / roundedSubtotal) * 100) / 100 : 0,
    total:      round2(total),
    tax_breakdown,
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
