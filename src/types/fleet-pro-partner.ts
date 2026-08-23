// ─── NWI Fleet Pro — partner / reseller layer ─────────────────────────────────
// Client-safe. No Supabase or Stripe imports.

export interface FleetProPartner {
  id:                 string
  user_id:            string
  partner_name:       string
  contact_email:      string | null
  default_logo_url:   string | null
  stripe_customer_id: string | null
}

/** Per-fleet white-label settings. Falls back to the fleet's own name when unset. */
export interface FleetBranding {
  brand_name:         string
  brand_logo_url:     string | null
  brand_accent_color: string | null
}

// ─── Partner dashboard ────────────────────────────────────────────────────────

export interface PartnerFleetRow {
  fleet_account_id:  string
  fleet_name:        string
  brand_name:        string
  brand_logo_url:    string | null
  fleet_pro_enabled: boolean
  fleet_pro_status:  string | null
  has_subscription:  boolean

  unit_count:        number
  member_count:      number
  overdue_pm_count:  number
  due_soon_pm_count: number
  open_defect_count: number

  revenue_mtd:       number
  revenue_ytd:       number
  last_service_date: string | null
}

export interface PartnerActivityRow {
  fleet_account_id: string
  fleet_name:       string
  unit_id:          string | null
  unit_number:      string | null
  kind:             'work_order' | 'invoice' | 'pretrip' | 'dot_inspection' | 'aerial_inspection'
  date:             string
  title:            string
  amount:           number | null
  result:           string | null
}

export interface PartnerPmAlert {
  fleet_account_id: string
  fleet_name:       string
  unit_id:          string
  unit_number:      string
  next_due_date:    string
  days_until_due:   number
  overdue:          boolean
}

export interface PartnerDashboard {
  partner_name:      string
  fleet_count:       number
  total_units:       number
  revenue_mtd:       number
  revenue_ytd:       number
  overdue_pm_total:  number
  due_soon_pm_total: number
  monthly_cost:      number   // fleets billed x $299
  fleets:            PartnerFleetRow[]
  recent_activity:   PartnerActivityRow[]
  pm_alerts:         PartnerPmAlert[]
}

// ─── Partner billing summary ──────────────────────────────────────────────────

export interface PartnerSubscriptionRow {
  fleet_account_id:       string
  fleet_name:             string
  status:                 string | null
  enabled:                boolean
  stripe_subscription_id: string | null
  current_period_end:     string | null
  monthly_cents:          number
}

export interface PartnerBillingSummary {
  partner_name:        string
  stripe_customer_id:  string | null
  subscriptions:       PartnerSubscriptionRow[]
  active_count:        number
  monthly_total_cents: number
  price_configured:    boolean
}

// ─── Driver pre-trip inspection ───────────────────────────────────────────────

export interface PretripUnitInfo {
  unit_id:      string
  unit_number:  string
  manufacturer: string | null
  model:        string | null
  year:         number | null
  serial_number: string | null
  brand_name:   string
  brand_logo_url: string | null
  last_odometer: number | null
  last_hours:    number | null
}

export interface PretripItem {
  key:      string
  label:    string
  section:  string
  critical: boolean
}

export interface PretripSubmission {
  client_uuid:    string
  unit_id:        string
  driver_name:    string
  odometer:       number | null
  reefer_hours:   number | null
  checklist_data: Record<string, 'pass' | 'fail' | 'na'>
  defects:        { key: string; label: string; note?: string }[]
  signature_data: string | null
  inspection_date: string
  submitted_offline: boolean
}

export interface PretripRecord {
  id:              string
  inspection_date: string
  driver_name:     string | null
  odometer:        number | null
  reefer_hours:    number | null
  overall_result:  'pass' | 'fail'
  defect_count:    number
}

// ─── Unit meter history ───────────────────────────────────────────────────────

export interface MeterReading {
  reading_date: string
  odometer:     number | null
  engine_hours: number | null
  source:       'pretrip' | 'work_order' | 'pm' | 'invoice' | 'manual'
}

export interface UnitMonthCost {
  month: string   // YYYY-MM
  cost:  number
  invoice_count: number
}

// ─── Role resolution across both layers ───────────────────────────────────────

export type FleetProViewerKind = 'partner' | 'member' | 'none'

/**
 * A partner sees cost basis and margin; a fleet member never does, regardless of
 * their fleet-side role. This is the single rule that keeps Kurt's labor rates out
 * of his customer's portal.
 */
export function canSeeCostBasis(kind: FleetProViewerKind): boolean {
  return kind === 'partner'
}

export function canManageFleetAccounts(kind: FleetProViewerKind): boolean {
  return kind === 'partner'
}

export const FLEET_PRO_MONTHLY_CENTS = 29900
