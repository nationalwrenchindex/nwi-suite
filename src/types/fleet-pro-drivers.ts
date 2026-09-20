// Shared shapes for the Fleet Pro driver detail page (migration 134).
//
// CLIENT-SAFE. Imported by DriverDetailClient, so nothing here may touch process.env
// or the service client — the same rule src/types/fleet-pro-compliance.ts follows.
//
// The driver ROSTER shape (FleetProDriver) is not redefined here; it lives in
// fleet-pro-compliance.ts because the compliance calendar owns it, and a second
// declaration would let the roster row and the detail row drift apart.

import type { FleetProDriver } from './fleet-pro-compliance'

// ── Incidents ─────────────────────────────────────────────────────────────────

/** Mirrors the CHECK constraint in migration 134. Adding a value here without adding
 *  it there produces a 23514 at insert time, so the two lists move together. */
export const INCIDENT_TYPES = ['complaint', 'accident', 'policy_violation', 'other'] as const
export type IncidentType = (typeof INCIDENT_TYPES)[number]

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  complaint:        'Complaint',
  accident:         'Accident',
  policy_violation: 'Policy violation',
  other:            'Other',
}

/**
 * Colours are per-severity, not per-brand — an accident has to read differently from
 * a note. Literals rather than imports from brand.tsx for the reason brand.tsx itself
 * gives: status colours stay with the component that owns them so nobody harmonises
 * an alarm into an accent.
 */
export const INCIDENT_TYPE_COLORS: Record<IncidentType, string> = {
  complaint:        '#F59E0B',
  accident:         '#ef4444',
  policy_violation: '#F97316',
  other:            'rgba(255,255,255,0.45)',
}

export function isIncidentType(value: unknown): value is IncidentType {
  return typeof value === 'string' && (INCIDENT_TYPES as readonly string[]).includes(value)
}

/** Matches the CHECK bounds in migration 134 so the API rejects before Postgres does. */
export const INCIDENT_LIMITS = {
  description:      4000,
  resolution_notes: 4000,
} as const

export interface DriverIncident {
  id:               string
  driver_id:        string
  incident_date:    string          // YYYY-MM-DD
  incident_type:    IncidentType
  description:      string
  resolved:         boolean
  resolution_notes: string | null
  created_at:       string | null
  updated_at:       string | null
}

// ── History rows ──────────────────────────────────────────────────────────────

/**
 * One pre-trip inspection as the detail page shows it. There is no post-trip
 * inspection in this product — the QR flow offers Driver Pre-Trip and Technician
 * Service Entry and nothing else — so this is the whole of "inspection history".
 */
export interface DriverInspectionRow {
  id:              string
  unit_id:         string
  unit_number:     string | null
  inspection_date: string           // YYYY-MM-DD
  overall_result:  string
  defect_count:    number
  odometer:        number | null
  /** False when the row was matched by driver_name rather than driver_id — see
   *  MATCHED_BY_NAME_NOTE. The UI marks these so a manager knows the join is fuzzy. */
  matched_by_id:   boolean
}

/** One fuel fill-up. The table is owned by migration 133 (Agent 1); this is the
 *  read shape the detail page needs and nothing more. */
export interface DriverFuelRow {
  id:              string
  unit_id:         string
  unit_number:     string | null
  fuel_date:       string           // YYYY-MM-DD
  gallons:         number | null
  total_cost:      number | null
  price_per_gallon: number | null
  miles_driven:    number | null
  mpg:             number | null
  matched_by_id:   boolean
}

/**
 * Shown next to any history list that contains name-matched rows.
 *
 * Every pre-trip row written before migration 133 has driver_id NULL, because the QR
 * flow was unauthenticated and the driver typed their name. Those rows can only be
 * matched on a normalized name string, which silently splits "Mike" from "Michael S"
 * and silently merges two real people who share a name. Saying so on screen is the
 * only honest option; the alternative is a history list that looks authoritative and
 * is not.
 */
export const MATCHED_BY_NAME_NOTE =
  'Matched by name — recorded before drivers could be selected from the roster, so this may be incomplete.'

// ── Scorecard ─────────────────────────────────────────────────────────────────

/**
 * A metric that knows when it cannot answer.
 *
 * Every table behind this page is empty in production today. A scorecard that renders
 * "0%" or "0.0 MPG" against no data does not read as "no data" — it reads as a bad
 * driver, and a manager may act on it. `available: false` forces the UI to print a
 * reason instead of a number.
 */
export type Metric =
  | { available: true;  value: number; detail: string | null }
  | { available: false; reason: string }

export interface DriverScorecard {
  /** Distinct days this driver filed a pre-trip, over working days elapsed this
   *  month. See computeInspectionRate for why this denominator and not another. */
  inspection_rate:  Metric
  /** This driver's MPG across the sample, plus how the fleet compares in `detail`. */
  avg_mpg:          Metric
  /** Always available — a count of zero genuinely means zero open complaints. */
  open_incidents:   number
  /** Window the rate was computed over, for the caption. */
  month_label:      string
}

// ── Page payload ──────────────────────────────────────────────────────────────

export interface DriverDetailPayload {
  driver:      FleetProDriver
  /**
   * NOT AN ASSIGNMENT. No driver-to-unit assignment exists anywhere in the schema:
   * fleet_pro_drivers has no assigned_unit_id and hd_units has no driver_id. This is
   * derived — the unit on this driver's most recent pre-trip or fuel record — and the
   * UI labels it "most recently operated", never "assigned".
   */
  recent_unit: { id: string; unit_number: string | null; on: string } | null
  inspections: DriverInspectionRow[]
  fuel:        DriverFuelRow[]
  incidents:   DriverIncident[]
  scorecard:   DriverScorecard
  can_edit:    boolean
  /** True when any history row was matched on name rather than driver_id. */
  has_name_matched_rows: boolean
  /** False when migration 133 has not been applied yet — the fuel panel says so
   *  rather than rendering an empty list that looks like "this driver never fuels". */
  fuel_log_available: boolean
}
