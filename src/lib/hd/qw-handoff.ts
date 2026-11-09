// HD QuickWrench -> quote / new invoice / work-order calendar: the CUSTOMER and UNIT half
// of the hd_guided_diagnostic_prefill hand-off (Brock, Nov 9, 2026).
//
// HD QuickWrench had nowhere to enter a customer or pick a unit, so every push landed on
// a form with the customer empty and the unit retyped. Now the shared block above the
// tabs (components/hd/QuickWrenchCustomer) holds both, and this is what travels.
//
// ONLY WHAT WAS FILLED. A key is present only when it has a value - an alarm-code lookup
// with no customer sends no customer keys at all, so a destination never overwrites a
// field with ''. Both halves are optional.
//
// The unit's hours never ride here: the reading at this service is QuickWrench's own
// Engine Hours box (typed only), and the unit's last known hours go as
// unit_hours_last_known, offered under the destination's reading box - never in it.
//
// PURE: no React, no fetch, so the smoke suite tests the exact rule the page runs.

export interface QwCustomer {
  /** The fleet / business / customer name - hd_fleet_accounts.fleet_name when saved. */
  name:           string
  contactName:    string
  phone:          string
  email:          string
  /** One line, as hd_fleet_accounts stores it. Destinations split it (parseAddress). */
  address:        string
  /** A picked `customers` row (LD Intel Hub). Never created from QuickWrench. */
  customerId:     string | null
  /** A picked fleet account, or the one this block created. */
  fleetAccountId: string | null
}

export const EMPTY_QW_CUSTOMER: QwCustomer = {
  name: '', contactName: '', phone: '', email: '', address: '', customerId: null, fleetAccountId: null,
}

/** A unit picked from HD Intel Hub (GET /api/hd/fleet-units). */
export interface QwUnit {
  id:               string
  fleet_account_id: string | null
  unit_number:      string | null
  serial_number:    string | null
  manufacturer:     string | null
  model:            string | null
  year:             number | null
  bm_number:        string | null
  total_hours:      number | string | null
  fleet_account?:   { fleet_name: string } | null
}

/** QuickWrench's reefer manufacturer toggle has two values; a unit record may spell them out. */
export function qwManufacturer(m: string | null | undefined): 'Thermo King' | 'Carrier Transicold' | null {
  const s = String(m ?? '').toLowerCase()
  if (/thermo\s*king|^tk$/.test(s)) return 'Thermo King'
  if (/carrier/.test(s)) return 'Carrier Transicold'
  return null
}

const filled = (v: string | null | undefined): string | null => {
  const t = String(v ?? '').trim()
  return t ? t : null
}

/**
 * The customer + unit keys for the hand-off, present only when filled.
 *
 * customer_name is the name on the block (the fleet's, or a picked customer's);
 * company_name is the same name when it is a fleet account - the quote form does
 * exactly that when a fleet account is picked on it. unit_id is sent only for a unit
 * picked from Intel Hub; unit_number is whatever the reefer tab's box holds.
 */
export function customerHandoff(c: QwCustomer, unit: { id: string } | null, unitNumber: string): Record<string, string> {
  const out: Record<string, string> = {}
  const name = filled(c.name) ?? filled(c.contactName)
  if (name) out.customer_name = name
  if (c.fleetAccountId && filled(c.name)) out.company_name = c.name.trim()
  const phone = filled(c.phone);   if (phone) out.customer_phone = phone
  const email = filled(c.email);   if (email) out.customer_email = email
  const addr  = filled(c.address); if (addr)  out.customer_address = addr
  if (c.customerId)     out.customer_id      = c.customerId
  if (c.fleetAccountId) out.fleet_account_id = c.fleetAccountId
  if (unit?.id)         out.unit_id          = unit.id
  const num = filled(unitNumber);  if (num)   out.unit_number = num
  return out
}

/** The same keys read back by a destination: only strings that are there. */
export interface HandoffCustomer {
  customer_name?: string; company_name?: string; customer_phone?: string; customer_email?: string
  customer_address?: string; customer_id?: string; fleet_account_id?: string; unit_id?: string; unit_number?: string
}

export function readHandoffCustomer(p: Record<string, unknown>): HandoffCustomer {
  const out: HandoffCustomer = {}
  for (const k of ['customer_name', 'company_name', 'customer_phone', 'customer_email', 'customer_address',
                   'customer_id', 'fleet_account_id', 'unit_id', 'unit_number'] as const) {
    const v = p[k]
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return out
}
