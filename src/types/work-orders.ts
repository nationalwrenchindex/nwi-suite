// ─── Work Orders (LD suite) ───────────────────────────────────────────────────
// A work order sits between a quote and an invoice for shops doing fleet or
// commercial work: authorised up front (usually against a PO), worked over days,
// billed once complete. A quote cannot carry that — it has no in-progress state,
// no photos and no tech notes.
//
// Gated per business by profiles.work_orders_enabled. See migration 135.

import type { LineItem } from './financials'

export type WorkOrderStatus = 'open' | 'in_progress' | 'complete'

export const WORK_ORDER_STATUSES: WorkOrderStatus[] = ['open', 'in_progress', 'complete']

/** Forward-only. A tech correcting a misclick can still PATCH the status
 *  directly; this only describes which button the UI offers next. */
export const NEXT_STATUS: Record<WorkOrderStatus, WorkOrderStatus | null> = {
  open:        'in_progress',
  in_progress: 'complete',
  complete:    null,
}

export interface WorkOrder {
  id:                string
  user_id:           string
  work_order_number: string
  status:            WorkOrderStatus

  customer_id:       string | null
  vehicle_id:        string | null
  /** Free text for anything that is not a vehicles row — "boat trailer", "shop
   *  compressor". Set alongside vehicle_id, never instead of a real vehicle. */
  unit_label:        string | null

  job_description:   string | null
  po_number:         string | null

  line_items:           LineItem[]
  labor_hours:          number | null
  labor_rate:           number | null
  parts_subtotal:       number | null
  parts_markup_percent: number | null
  labor_subtotal:       number | null
  tax_percent:          number | null
  tax_amount:           number | null
  grand_total:          number | null

  tech_notes:           string | null

  source:               string | null   // 'manual' | 'quote' | 'quickwrench'
  source_quote_id:      string | null
  converted_invoice_id: string | null

  started_at:           string | null
  completed_at:         string | null
  converted_at:         string | null

  notified_in_progress_at: string | null
  notified_complete_at:    string | null

  created_at: string
  updated_at: string

  customer?: {
    id:         string
    first_name: string
    last_name:  string
    phone:      string | null
    email:      string | null
  } | null
  vehicle?: {
    id:    string
    year:  number | null
    make:  string
    model: string
    vin:   string | null
  } | null
  photos?: WorkOrderPhoto[]
}

export interface WorkOrderPhoto {
  id:            string
  work_order_id: string
  file_url:      string
  caption:       string | null
  created_at:    string
}

export interface WorkOrdersResponse {
  work_orders: WorkOrder[]
  count:       number
}

export interface WorkOrderResponse {
  work_order: WorkOrder
}

export const STATUS_META: Record<WorkOrderStatus, { label: string; bg: string; text: string }> = {
  open:        { label: 'Open',        bg: '#6b7280', text: '#ffffff' },
  in_progress: { label: 'In Progress', bg: '#2969B0', text: '#ffffff' },
  complete:    { label: 'Complete',    bg: '#10b981', text: '#ffffff' },
}

/** What the customer-facing label should read for a unit, preferring a real
 *  vehicle and falling back to the free-text label. */
export function unitLabelFor(wo: Pick<WorkOrder, 'unit_label' | 'vehicle'>): string {
  if (wo.vehicle) {
    return [wo.vehicle.year, wo.vehicle.make, wo.vehicle.model].filter(Boolean).join(' ')
  }
  return wo.unit_label?.trim() || 'Unit'
}
