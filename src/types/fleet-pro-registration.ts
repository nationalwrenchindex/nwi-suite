// ─── NWI Fleet Pro — registration / plate tracking types ──────────────────────
// Client-safe. No Supabase or Stripe imports.
//
// The classification itself lives in src/lib/fleet-pro/registration.ts (also pure
// and client-safe); RegistrationState is re-exported here so a consumer needs one
// import rather than two.

import type { RegistrationState } from '@/lib/fleet-pro/registration'

export type { RegistrationState }

/** One row of fleet_pro_unit_registration, as the API returns it. */
export interface UnitRegistration {
  id:               string
  unit_id:          string
  fleet_account_id: string | null
  license_plate:    string | null
  /** State / province / IRP base. 2–8 chars, not a fixed enum. */
  jurisdiction:     string | null
  /** YYYY-MM-DD, or null when the manager recorded a plate but no expiry yet. */
  expires_on:       string | null
  annual_cost:      number | null
  notes:            string | null
  updated_at:       string | null
}

/**
 * GET/PUT response. `registration` is null when the unit has no row at all — which
 * is a real answer, not an error: state comes back 'missing' and the section renders
 * its empty state rather than disappearing.
 */
export interface UnitRegistrationPayload {
  registration:          UnitRegistration | null
  state:                 RegistrationState
  /** "expired 12 days ago" / "expires in 43 days" — from registrationLabel(). */
  label:                 string
  days_until_expiration: number | null
  /** Server's answer, and the authoritative one. The UI hint is only a hint. */
  can_edit:              boolean
}

/** Accepted PUT body. Every field is optional; omitted fields are left untouched. */
export interface UnitRegistrationInput {
  license_plate?: string | null
  jurisdiction?:  string | null
  expires_on?:    string | null
  annual_cost?:   number | string | null
  notes?:         string | null
}

/** Field limits, shared by the route's validator and the form's maxLength. */
export const REGISTRATION_LIMITS = {
  license_plate: 20,
  jurisdiction:  8,
  notes:         1000,
} as const

/**
 * The shape the dashboard unit list and the alerts feed should select and carry
 * per unit. Flat rather than nested so it can be spread onto FleetProUnitRow
 * without a second lookup.
 */
export interface UnitRegistrationSummary {
  unit_id:               string
  license_plate:         string | null
  jurisdiction:          string | null
  expires_on:            string | null
  registration_state:    RegistrationState
  days_until_expiration: number | null
}
