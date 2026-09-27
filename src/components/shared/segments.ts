// ─── Segment money: pricing one segment, and rolling a work order up ──────────
// Pure module. Used by the LD and HD API routes, the tech-facing editor and the
// customer approval page, so the number the customer approves is the number the
// server writes and the number the invoice bills.
//
// Line pricing is NOT reimplemented here — it comes from
// src/lib/shared/work-order-lines, the same module HD's parent line items use. This
// file adds only the two things that did not exist: tax per segment, and the
// authorized-only rollup.

import {
  sumLines, normalizeLine, MAX_WORK_ORDER_LINES,
  type WorkOrderLineInput,
} from '@/lib/shared/work-order-lines'
import { round2 } from '@/lib/shared/markup'
import {
  isBillable, SEGMENT_STATUSES,
  type SegmentLine, type SegmentRollup, type SegmentStatus, type WorkOrderSegment,
} from '@/types/segments'

/** The money columns one segment persists. */
export interface SegmentMoney {
  line_items:           SegmentLine[]
  labor_hours:          number
  labor_rate:           number | null
  parts_subtotal:       number
  parts_markup_percent: number | null
  labor_subtotal:       number
  tax_percent:          number
  tax_amount:           number
  grand_total:          number
}

/**
 * Price one segment from its lines.
 *
 * `labor_hours` is DERIVED as the sum of the quantity on labor lines — on this model
 * a labor line's quantity IS its hours and its unit_price is the rate, so a separate
 * hours field could only ever disagree with the lines. `parts_markup_percent` is
 * likewise derived and reported, not applied: markup is already per line, and
 * re-applying a record-level percentage on top would double-charge it. It is stored
 * only so a reader can see what rate the lines were priced at when they are uniform.
 */
export function priceSegment(lines: SegmentLine[], taxPercent: number): SegmentMoney {
  const totals = sumLines(lines)

  const laborHours = round2(
    lines.reduce((s, l) => s + (l.type === 'labor' ? Number(l.quantity ?? 0) : 0), 0),
  )

  // One rate if every labor line agrees, otherwise null — a single number cannot
  // honestly describe lines billed at different rates.
  const laborRates = [...new Set(
    lines.filter(l => l.type === 'labor' && l.unit_price != null).map(l => Number(l.unit_price)),
  )]
  const laborRate = laborRates.length === 1 ? laborRates[0] : null

  const markups = [...new Set(
    lines.filter(l => l.type === 'part' && l.markup_percent != null).map(l => Number(l.markup_percent)),
  )]
  const markupPercent = markups.length === 1 ? markups[0] : null

  // Tax applies to parts and labour both, matching the LD quote and the HD invoice.
  const taxable   = totals.parts + totals.labor
  const taxAmount = round2(taxable * ((taxPercent || 0) / 100))

  return {
    line_items:           lines,
    labor_hours:          laborHours,
    labor_rate:           laborRate,
    parts_subtotal:       totals.parts,
    parts_markup_percent: markupPercent,
    labor_subtotal:       totals.labor,
    tax_percent:          taxPercent || 0,
    tax_amount:           taxAmount,
    grand_total:          round2(taxable + taxAmount),
  }
}

/**
 * Untrusted client rows -> storable, priced segment lines.
 *
 * Every derived figure is recomputed here; a total that arrived in the request body
 * is a number nobody verified, and on a billing record that is a hole. Rows that
 * cannot be normalised are dropped rather than stored half-valid.
 */
export function normalizeSegmentLines(raw: unknown): SegmentLine[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, MAX_WORK_ORDER_LINES)
    .map((row, i) => normalizeLine(row as WorkOrderLineInput, i))
    .filter((l): l is SegmentLine => l !== null)
}

/** Which money a segment is priced by: the selected option if there is one, else the
 *  segment itself. One line, and it is the whole of the forward compatibility for
 *  Good/Better/Best — when options ship, nothing else in the rollup changes. */
function pricedBy(seg: WorkOrderSegment): {
  grand_total: number | null
  line_items:  SegmentLine[]
} {
  if (seg.selected_option_id && seg.options?.length) {
    const chosen = seg.options.find(o => o.id === seg.selected_option_id)
    if (chosen) return { grand_total: chosen.grand_total, line_items: chosen.line_items ?? [] }
  }
  return { grand_total: seg.grand_total, line_items: seg.line_items ?? [] }
}

/**
 * Roll a work order up from its segments.
 *
 * ONLY authorized and complete segments are billed. Pending is reported separately
 * rather than folded in, so a tech can tell a customer "there is $1,240 waiting on
 * your OK" without that money ever appearing in a total. Declined is reported too,
 * because a shop wants to know what it lost and the row is a follow-up lead.
 *
 * ROUNDING: each segment's grand_total is already a rounded, authoritative figure —
 * it is what the customer approved — so these sums add the rounded segment totals.
 * That is the correct choice HERE and the wrong one one level down: within a segment,
 * priceSegment sums raw line amounts and rounds once. Summing figures that were
 * rounded for a screen is how a report drifts; summing figures that were rounded
 * because someone agreed to them is how it reconciles.
 */
export function rollupSegments(segments: WorkOrderSegment[]): SegmentRollup {
  const counts = SEGMENT_STATUSES.reduce(
    (acc, s) => { acc[s] = 0; return acc },
    {} as Record<SegmentStatus, number>,
  )

  let authorizedTotal = 0
  let pendingTotal    = 0
  let declinedTotal   = 0
  let billablePartsCost = 0

  for (const seg of segments) {
    counts[seg.status] = (counts[seg.status] ?? 0) + 1
    const { grand_total, line_items } = pricedBy(seg)
    const total = Number(grand_total ?? 0)

    if (isBillable(seg.status)) {
      authorizedTotal   += total
      billablePartsCost += sumLines(line_items).partsCost
    } else if (seg.status === 'pending')  {
      pendingTotal  += total
    } else if (seg.status === 'declined') {
      declinedTotal += total
    }
  }

  return {
    authorizedTotal:   round2(authorizedTotal),
    pendingTotal:      round2(pendingTotal),
    declinedTotal:     round2(declinedTotal),
    billablePartsCost: round2(billablePartsCost),
    counts,
    segmentCount:      segments.length,
  }
}

/**
 * What a work order's total IS, whichever way it is priced.
 *
 * A work order is parent-priced OR segment-priced and never both — the API refuses to
 * add a segment to a record that already has parent line_items or has been invoiced.
 * So this is a branch, not a merge: with segments, the total is the authorized
 * rollup; without, it is the parent's own grand_total, untouched and computed exactly
 * as it was before segments existed.
 */
export function workOrderTotal(
  parentGrandTotal: number | null | undefined,
  segments: WorkOrderSegment[],
): number {
  if (segments.length === 0) return round2(Number(parentGrandTotal ?? 0))
  return rollupSegments(segments).authorizedTotal
}

/** True when this record is priced by its own parent columns — a legacy work order,
 *  or any work order created before segments were used on it. */
export function isParentPriced(
  parentLineItems: unknown,
  segments: WorkOrderSegment[],
): boolean {
  if (segments.length > 0) return false
  return Array.isArray(parentLineItems) && parentLineItems.length > 0
}
