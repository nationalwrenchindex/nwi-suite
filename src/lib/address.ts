// ─── One address shape, shared by both products ───────────────────────────────
// The five service-address columns exist on `customers`, `hd_quotes`, `hd_invoices`
// and `hd_work_orders`, and every form that collects them uses this shape. Kept
// product-neutral (not under lib/hd) because the LD scheduler reads it too.

export interface Address {
  address_line1: string
  address_line2: string
  city:          string
  state:         string
  zip:           string
}

export const EMPTY_ADDRESS: Address = {
  address_line1: '', address_line2: '', city: '', state: '', zip: '',
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Pull the five columns off any record that carries them, coercing null to ''. */
export function addressFrom(record: unknown): Address {
  const r = (record ?? {}) as Record<string, unknown>
  return {
    address_line1: str(r.address_line1),
    address_line2: str(r.address_line2),
    city:          str(r.city),
    state:         str(r.state),
    zip:           str(r.zip),
  }
}

/** True when there is nothing worth carrying forward. */
export function isAddressEmpty(a: Address): boolean {
  return !a.address_line1 && !a.address_line2 && !a.city && !a.state && !a.zip
}

/**
 * The five fields as one readable line, for the places that store a single
 * free-text address (the scheduler's jobs.location_address, hd_fleet_accounts.address).
 *
 * "12 Mill Rd, Suite 4, Akron, OH 44301" — comma-separated, with state and zip
 * joined by a space rather than a comma so it reads the way an address is written.
 */
export function formatAddressLine(a: Address): string {
  const stateZip = [a.state, a.zip].filter(Boolean).join(' ')
  return [a.address_line1, a.address_line2, a.city, stateZip].filter(Boolean).join(', ')
}
