/**
 * Shared shape for the fleet-units list.
 *
 * Lives outside route.ts because Next rejects any export from a route file that
 * is not a handler or a route-segment config.
 */

// `year` is here for the HD quote form, which fills Unit Year from the picked unit.
// Without it the pick left the field empty, its "2018" placeholder read as a value,
// and the work order then showed the unit's real year - so the two looked like they
// disagreed when the quote had recorded no year at all (Q-2026-0010 / WO-2026-1563).
export const FLEET_UNIT_LIST_SELECT = `
  id, unit_number, manufacturer, model, year, serial_number, bm_number,
  total_hours, next_pm_due_hours, status,
  fleet_account:hd_fleet_accounts(fleet_name)
`

export const FLEET_UNIT_PAGE_SIZE = 50

export interface FleetUnitListRow {
  id:                string
  unit_number:       string
  manufacturer:      string
  model:             string
  year:              number | null
  serial_number:     string | null
  bm_number:         string | null
  total_hours:       number | null
  next_pm_due_hours: number | null
  status:            string
  fleet_account:     { fleet_name: string } | null
}
