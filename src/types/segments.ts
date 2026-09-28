// ─── Work order segments ──────────────────────────────────────────────────────
// Migration 137. A work order stops being one job.
//
// "Truck here, crank no start, I troubleshot and found the PCM is bad. Segment 2 —
// customer states truck needs new clutch." The PCM is billed, the clutch is declined,
// and neither contaminates the other's total.
//
// ONE table serves both products (ld_work_order_id / hd_work_order_id, exactly one
// set). These types are therefore product-neutral: the only per-product thing is
// which parent id gets written, and the API route decides that, not the caller.

import type { WorkOrderLine } from '@/lib/shared/work-order-lines'

export type SegmentStatus = 'pending' | 'authorized' | 'declined' | 'complete'

export const SEGMENT_STATUSES: SegmentStatus[] = ['pending', 'authorized', 'declined', 'complete']

/** Only these two are billable. Everything downstream — the rollup, the invoice —
 *  asks this rather than listing statuses again, so adding a status later cannot
 *  silently change what gets billed. */
export const BILLABLE_STATUSES: SegmentStatus[] = ['authorized', 'complete']

export function isBillable(status: SegmentStatus): boolean {
  return BILLABLE_STATUSES.includes(status)
}

/**
 * A segment's line item, stored in the segment's `line_items` JSONB.
 *
 * This is the CANONICAL per-line shape — the same one hd_work_order_line_items uses
 * and src/lib/shared/work-order-lines prices. `id` and `work_order_id` are dropped
 * because these rows live inside their segment and nothing else references them;
 * `sort_order` is kept because display order is the tech's, not the array's.
 *
 * NOTE: this is deliberately NOT the shape of LD's parent `work_orders.line_items`,
 * which is the older `{description, quantity, unit_price, total}` with one
 * record-level markup. Those records are invoiced; their shape and their math stay
 * exactly as they are. See components/shared/line-items.
 */
export type SegmentLine = Omit<WorkOrderLine, 'id' | 'work_order_id'>

export const SEGMENT_STATUS_META: Record<SegmentStatus, { label: string; bg: string; text: string }> = {
  pending:    { label: 'Pending',    bg: '#6b7280', text: '#ffffff' },
  authorized: { label: 'Authorized', bg: '#2969B0', text: '#ffffff' },
  declined:   { label: 'Declined',   bg: '#ef4444', text: '#ffffff' },
  complete:   { label: 'Complete',   bg: '#10b981', text: '#ffffff' },
}

/** Good/Better/Best, for later. The table exists empty from 137 so the feature is
 *  additive: a segment with no options prices from its own line_items, a segment
 *  with options prices from the one the customer selected. */
export interface SegmentOption {
  id:                   string
  segment_id:           string
  tier:                 string
  label:               string | null
  sort_order:           number
  line_items:           SegmentLine[]
  labor_hours:          number | null
  labor_rate:           number | null
  parts_subtotal:       number | null
  parts_markup_percent: number | null
  labor_subtotal:       number | null
  tax_percent:          number | null
  tax_amount:           number | null
  grand_total:          number | null
  /** jsonb, migration 140. NULL on anything priced before that shipped. */
  tax_breakdown:        unknown
  created_at:           string
  updated_at:           string
}

export interface WorkOrderSegment {
  id:               string
  user_id:          string
  /** Exactly one of these is set. The API writes the right one; readers should not
   *  need to care which, and nothing in the shared components branches on it. */
  ld_work_order_id: string | null
  hd_work_order_id: string | null

  sequence:   number
  complaint:  string | null
  cause:      string | null
  correction: string | null
  status:     SegmentStatus

  line_items:           SegmentLine[]
  labor_hours:          number | null
  labor_rate:           number | null
  parts_subtotal:       number | null
  parts_markup_percent: number | null
  labor_subtotal:       number | null
  tax_percent:          number | null
  tax_amount:           number | null
  grand_total:          number | null
  /** jsonb, migration 140. NULL on anything priced before that shipped. */
  tax_breakdown:        unknown

  authorized_at:        string | null
  declined_at:          string | null
  authorization_method: string | null
  customer_note:        string | null

  followup_due_on:    string | null
  followup_closed_at: string | null

  selected_option_id: string | null
  /** Present only where a route joins them. Empty or absent means "priced by this
   *  segment's own line_items", which is every segment until options ship. */
  options?: SegmentOption[]

  created_at: string
  updated_at: string
}

export interface SegmentsResponse {
  segments: WorkOrderSegment[]
  rollup:   SegmentRollup
}

export interface SegmentResponse {
  segment: WorkOrderSegment
}

/** What the parent's tiles read. See components/shared/segments for the derivation
 *  and for why pending is reported separately rather than folded in. */
export interface SegmentRollup {
  authorizedTotal: number
  pendingTotal:    number
  declinedTotal:   number
  /** Parts cost across billable segments only — for margin, never shown to a customer. */
  billablePartsCost: number
  counts: Record<SegmentStatus, number>
  segmentCount: number
}
