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
// `category_id` is for the units list's Category column; the name comes from the shop's
// category list on the client, so a rename shows without re-reading every unit.
export const FLEET_UNIT_LIST_SELECT = `
  id, fleet_account_id, unit_number, manufacturer, model, year, serial_number, bm_number,
  total_hours, next_pm_due_hours, status, category_id,
  fleet_account:hd_fleet_accounts(fleet_name)
`

export const FLEET_UNIT_PAGE_SIZE = 50

export interface FleetUnitListRow {
  id:                string
  // For pickers that link a work order to a unit: the unit's fleet comes with it.
  fleet_account_id:  string | null
  unit_number:       string
  manufacturer:      string
  model:             string
  year:              number | null
  serial_number:     string | null
  bm_number:         string | null
  total_hours:       number | null
  next_pm_due_hours: number | null
  status:            string
  category_id:       string | null
  fleet_account:     { fleet_name: string } | null
}
