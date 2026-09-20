/**
 * Shared shape for the work-order list.
 *
 * Lives outside route.ts on purpose: Next rejects any export from a route file
 * that is not a handler or a route-segment config, so the constants the page and
 * the API both need have to sit in a plain module.
 */

/**
 * The columns the list table renders. Used by the server page for the first page
 * and by the API for every "Load More" page, so the two can never drift and
 * render half the table with missing joins.
 */
export const WORK_ORDER_LIST_SELECT = `
  id, work_order_number, status, service_type, created_at,
  tech_name, total_amount, started_at,
  unit:hd_units(unit_number, manufacturer, model),
  fleet:hd_fleet_accounts(fleet_name)
`

export const WORK_ORDER_PAGE_SIZE = 50

export interface WorkOrderListRow {
  id:            string
  work_order_number: string | null
  status:        string
  service_type:  string | null
  tech_name:     string | null
  total_amount:  number | null
  created_at:    string
  unit:  { unit_number: string; manufacturer: string; model: string } | null
  fleet: { fleet_name: string } | null
}
