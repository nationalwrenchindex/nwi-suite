// ─── NWI Fleet Pro — DOT & compliance calendar types ─────────────────────────
// Client-safe. No Supabase or Stripe imports.
//
// The classification itself lives in src/lib/fleet-pro/compliance.ts (also pure and
// client-safe); its state/type unions are re-exported here so a consumer needs one
// import rather than two. Same arrangement fleet-pro-registration.ts uses.

import type {
  ComplianceState,
  ComplianceItemType,
  ComplianceSubject,
} from '@/lib/fleet-pro/compliance'

export type { ComplianceState, ComplianceItemType, ComplianceSubject }

// ─── Drivers ──────────────────────────────────────────────────────────────────

/** One row of fleet_pro_drivers, as the API returns it. */
export interface FleetProDriver {
  id:                      string
  fleet_account_id:        string
  full_name:               string
  /**
   * MASKED FOR VIEWERS. A read-only viewer receives the last four characters only
   * ("•••• 8821"); managers and supervisors get the whole number. The masking is
   * done server-side in /api/fleet-pro/drivers — this field is never the full number
   * unless the caller's role earned it. See `cdl_masked`.
   */
  cdl_number:              string | null
  /** True when `cdl_number` above has been reduced for this caller's role. */
  cdl_masked:              boolean
  cdl_state:               string | null
  cdl_expires_on:          string | null
  medical_card_expires_on: string | null
  phone:                   string | null
  email:                   string | null
  active:                  boolean
  notes:                   string | null
  created_at:              string | null
  updated_at:              string | null
}

/** Accepted POST/PATCH body for a driver. Every field optional on PATCH. */
export interface FleetProDriverInput {
  full_name?:               string
  cdl_number?:              string | null
  cdl_state?:               string | null
  cdl_expires_on?:          string | null
  medical_card_expires_on?: string | null
  phone?:                   string | null
  email?:                   string | null
  active?:                  boolean
  notes?:                   string | null
}

export interface DriversPayload {
  drivers:  FleetProDriver[]
  can_edit: boolean
  role:     string
}

// ─── Documents ────────────────────────────────────────────────────────────────

/** One row of fleet_pro_compliance_docs. Exactly one of unit_id / driver_id is set. */
export interface ComplianceDoc {
  id:               string
  fleet_account_id: string
  unit_id:          string | null
  driver_id:        string | null
  doc_type:         ComplianceItemType | 'other'
  issued_on:        string | null
  expires_on:       string | null
  /** Storage path inside the private bucket — NOT a URL. See `signed_url`. */
  file_url:         string | null
  file_name:        string | null
  /**
   * A short-lived signed URL minted at read time, or null when the row carries no
   * file. Never persisted: these documents are CDL and medical-card scans and the
   * bucket is private, so the link has to expire.
   */
  signed_url:       string | null
  notes:            string | null
  created_at:       string | null
  updated_at:       string | null
}

/** Accepted POST body for a document. Exactly one subject id must be supplied. */
export interface ComplianceDocInput {
  unit_id?:    string | null
  driver_id?:  string | null
  doc_type:    ComplianceItemType | 'other'
  issued_on?:  string | null
  expires_on?: string | null
  notes?:      string | null
}

// ─── Carrier-level record ─────────────────────────────────────────────────────

export interface FleetComplianceRecord {
  insurance_carrier:       string | null
  insurance_policy_number: string | null
  insurance_expires_on:    string | null
  insurance_doc_url:       string | null
  insurance_doc_name:      string | null
  /** Short-lived signed URL for the COI scan, minted at read time. */
  insurance_signed_url:    string | null
  ifta_account_number:     string | null
  ifta_filed_through:      string | null
  hut_2290_filed_for_year: number | null
  notes:                   string | null
  updated_at:              string | null
}

export interface FleetComplianceInput {
  insurance_carrier?:       string | null
  insurance_policy_number?: string | null
  insurance_expires_on?:    string | null
  ifta_account_number?:     string | null
  ifta_filed_through?:      string | null
  hut_2290_filed_for_year?: number | string | null
  notes?:                   string | null
}

// ─── The calendar itself ──────────────────────────────────────────────────────

/**
 * Where a calendar row's date came from. Shown in the UI because the trust level
 * differs: a date somebody typed onto a document is a claim, a date derived from an
 * inspection record in this system is a fact, and a fixed federal deadline is
 * neither — it is simply the calendar.
 */
export type ComplianceItemSource =
  | 'document'      // a fleet_pro_compliance_docs row
  | 'driver'        // a column on fleet_pro_drivers
  | 'registration'  // fleet_pro_unit_registration (migration 114)
  | 'inspection'    // derived from the newest hd_dot_inspections row + 12 months
  | 'fleet'         // fleet_pro_fleet_compliance (insurance)
  | 'statutory'     // a fixed federal date — IFTA quarter end, 2290 Aug 31

/**
 * One line on the calendar. Flat on purpose: the page filters, sorts and groups this
 * array directly, and a nested shape would mean re-deriving the subject label in
 * three places.
 */
export interface ComplianceItem {
  /** Stable across reloads — `${type}:${subject_id ?? 'fleet'}`. Used as the React key. */
  key:                   string
  type:                  ComplianceItemType
  type_label:            string
  subject:               ComplianceSubject
  /** Unit id / driver id, or null for a carrier-level item. */
  subject_id:            string | null
  /** Unit number / driver name / fleet name — whatever the row should read as. */
  subject_label:         string
  expires_on:            string | null
  state:                 ComplianceState
  days_until_expiration: number | null
  /** "expires in 43 days" / "expired 12 days ago". */
  label:                 string
  color:                 string
  source:                ComplianceItemSource
  /** Extra context for the row: IFTA quarter, filing deadline, plate number. */
  detail:                string | null
  /** The backing document row, when one exists — the upload/replace target. */
  doc_id:                string | null
  has_document:          boolean
  signed_url:            string | null
}

export interface ComplianceCalendar {
  fleet_account_id: string
  fleet_name:       string
  role:             string
  can_edit:         boolean
  /** Today as the server sees it, so the client classifies against the same day. */
  today:            string
  items:            ComplianceItem[]
  /** Counts by state, for the header cards. */
  expired_count:    number
  missing_count:    number
  due_soon_count:   number
  upcoming_count:   number
  /** Filter sources — the page builds its dropdowns from these, not from items. */
  units:            { id: string; unit_number: string }[]
  drivers:          { id: string; full_name: string }[]
  fleet_record:     FleetComplianceRecord | null
}

// ─── Shared limits ────────────────────────────────────────────────────────────
// Used by both the route validators and the form maxLength attributes, so the field
// that the UI accepts and the field the API accepts can never drift.
export const COMPLIANCE_LIMITS = {
  full_name:               120,
  cdl_number:              32,
  cdl_state:               8,
  phone:                   32,
  email:                   254,
  notes:                   2000,
  file_name:               255,
  insurance_carrier:       120,
  insurance_policy_number: 64,
  ifta_account_number:     64,
} as const

/**
 * Upload ceiling for a compliance scan. 10 MB is generous for a phone photo of a
 * medical card or a two-page COI PDF, and small enough that a stuck upload fails
 * fast on a yard connection instead of hanging.
 */
export const COMPLIANCE_FILE_MAX_BYTES = 10 * 1024 * 1024

/**
 * Accepted upload types. Deliberately a short allow-list rather than a block-list:
 * this bucket holds licence scans, and the only things that ever legitimately land
 * in it are a photo or a PDF.
 */
export const COMPLIANCE_FILE_TYPES: readonly string[] = [
  'image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf',
]

/** Signed-URL lifetime, matching the hour the HD work-order photos use. */
export const COMPLIANCE_SIGNED_URL_TTL_SECONDS = 3600

/** The private Supabase storage bucket. Must be created by hand — see the migration. */
export const COMPLIANCE_BUCKET = 'fleet-pro-compliance-docs'
