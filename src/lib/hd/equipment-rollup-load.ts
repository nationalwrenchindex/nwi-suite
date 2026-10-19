// Reads the rows the equipment rollup needs, for ONE account.
//
// Kept apart from equipment-rollup.ts so the arithmetic stays pure and testable. Two
// layers of scoping, on purpose: the caller passes the SIGNED-IN user's Supabase client,
// so RLS applies to every read, AND every query filters on user_id - a service client
// handed in by mistake still cannot read another shop's rows.
//
// Everything is read paged: PostgREST returns at most 1,000 rows, and one account
// already has 1,564 work orders.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { fetchAllRowsForIds } from '@/lib/fleet-pro/fetch-scoped'
import type {
  RollupInput, DateRange, CategoryRow, FleetRow, UnitRow, InvoiceRow, WorkOrderRow, WorkOrderLineRow,
} from './equipment-rollup'

const UNIT_COLS = 'id, user_id, unit_number, manufacturer, model, year, serial_number, category_id, fleet_account_id, active, estimated_value'
const INVOICE_COLS = 'id, user_id, invoice_number, work_order_id, unit_id, status, created_at, total, subtotal_labor, subtotal_parts, tax_amount, diagnostic_fee, road_call_fee, travel_amount, mileage_amount, shop_supplies_fee, line_items'
const WO_COLS = 'id, user_id, work_order_number, unit_id, status, service_type, total_amount, labor_hours, tax_amount, diagnostic_fee, road_call_fee, travel_amount, mileage_amount, shop_supplies_fee, created_at, started_at, arrived_at, completed_at, authorized_at'

export async function loadRollupInput(
  supabase: SupabaseClient,
  userId: string,
  range: DateRange,
  timeZone: string,
): Promise<RollupInput> {
  const [categories, fleets, units, invoices, workOrders] = await Promise.all([
    fetchAllRows<CategoryRow>((from, to) => supabase
      .from('hd_equipment_categories').select('id, user_id, name, sort_order, is_active')
      .eq('user_id', userId).order('sort_order').order('id').range(from, to)),
    fetchAllRows<FleetRow>((from, to) => supabase
      .from('hd_fleet_accounts').select('id, user_id, fleet_name')
      .eq('user_id', userId).order('id').range(from, to)),
    fetchAllRows<UnitRow>((from, to) => supabase
      .from('hd_units').select(UNIT_COLS)
      .eq('user_id', userId).order('id').range(from, to)),
    // ALL the account's invoices, not only the range's: a work order billed outside the
    // range must still be known as billed, or it would count again as a work-order job.
    fetchAllRows<InvoiceRow>((from, to) => supabase
      .from('hd_invoices').select(INVOICE_COLS)
      .eq('user_id', userId).order('id').range(from, to)),
    // All work orders too: possession spans can open before the range starts.
    fetchAllRows<WorkOrderRow>((from, to) => supabase
      .from('hd_work_orders').select(WO_COLS)
      .eq('user_id', userId).order('id').range(from, to)),
  ])

  // Line items only for the work orders that can be jobs on their own: closed, with a
  // recorded total, and no invoice. Everything else is billed through its invoice.
  const billed = new Set(invoices.map(i => i.work_order_id).filter(Boolean))
  const lineIds = workOrders
    .filter(w => !billed.has(w.id) && ['completed', 'invoiced'].includes(String(w.status ?? '')) && w.total_amount != null)
    .map(w => w.id)
  const workOrderLines = await fetchAllRowsForIds<WorkOrderLineRow, string>(lineIds, (ids, from, to) => supabase
    .from('hd_work_order_line_items').select('work_order_id, type, quantity, total')
    .in('work_order_id', ids).order('id').range(from, to))

  return { userId, range, timeZone, categories, fleets, units, invoices, workOrders, workOrderLines }
}
