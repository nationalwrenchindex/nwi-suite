/**
 * Shared shape for the fleet-units list.
 *
 * Lives outside route.ts because Next rejects any export from a route file that
 * is not a handler or a route-segment config.
 */

export const FLEET_UNIT_LIST_SELECT = `
  id, unit_number, manufacturer, model, serial_number, bm_number,
  total_hours, next_pm_due_hours, status,
  fleet_account:hd_fleet_accounts(fleet_name)
`

export const FLEET_UNIT_PAGE_SIZE = 50

export interface FleetUnitListRow {
  id:                string
  unit_number:       string
  manufacturer:      string
  model:             string
  serial_number:     string | null
  bm_number:         string | null
  total_hours:       number | null
  next_pm_due_hours: number | null
  status:            string
  fleet_account:     { fleet_name: string } | null
}
