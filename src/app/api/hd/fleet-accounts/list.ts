/**
 * Shared shape for the fleet-accounts list.
 *
 * Lives outside route.ts because Next rejects any export from a route file that
 * is not a handler or a route-segment config.
 */

export const FLEET_ACCOUNT_LIST_SELECT =
  'id, fleet_name, contact_name, contact_phone, contact_email, address'

export const FLEET_ACCOUNT_PAGE_SIZE = 50

export interface FleetAccountListRow {
  id:            string
  fleet_name:    string
  contact_name:  string | null
  contact_phone: string | null
  contact_email: string | null
  address:       string | null
}
