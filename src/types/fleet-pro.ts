// ─── NWI Fleet Pro — shared types ─────────────────────────────────────────────
// Client-safe. No Supabase or Stripe imports here.

export type FleetProRole   = 'manager' | 'supervisor' | 'viewer'
export type FleetProStatus = 'invited' | 'active' | 'revoked'

export const FLEET_PRO_ROLES: FleetProRole[] = ['manager', 'supervisor', 'viewer']

export const ROLE_LABELS: Record<FleetProRole, string> = {
  manager:    'Fleet Manager',
  supervisor: 'Supervisor',
  viewer:     'Read-Only Viewer',
}

export const ROLE_DESCRIPTIONS: Record<FleetProRole, string> = {
  manager:    'Full access — edit units, set PM schedules, invite people, see all costs',
  supervisor: 'View everything including costs. Cannot make changes.',
  viewer:     'View units, service history and inspections. Cost figures hidden.',
}

// ─── Membership ───────────────────────────────────────────────────────────────

export interface FleetProMembership {
  member_id:        string
  fleet_account_id: string
  fleet_name:       string
  role:             FleetProRole
  status:           FleetProStatus
  email:            string
  full_name:        string | null
}

export interface FleetProMemberRow {
  id:          string
  email:       string
  full_name:   string | null
  role:        FleetProRole
  status:      FleetProStatus
  invited_at:  string | null
  accepted_at: string | null
  is_self:     boolean
}

// ─── Units + dashboard ────────────────────────────────────────────────────────

export type PmState = 'overdue' | 'due_soon' | 'scheduled' | 'unscheduled'

export interface FleetProUnitRow {
  id:                 string
  unit_number:        string
  truck_trailer_number: string | null
  manufacturer:       string | null
  model:              string | null
  serial_number:      string | null
  year:               number | null
  unit_type:          string | null
  status:             string | null
  total_hours:        number | null
  // Thermo King build number (Carrier's equivalent is the model number). Optional
  // because the dashboard list does not select it; the unit detail page does.
  bm_number?:         string | null

  last_service_date:  string | null   // most recent work order / invoice date
  next_due_date:      string | null   // fleet_pro_pm_schedules
  interval_days:      number | null
  pm_state:           PmState
  days_until_due:     number | null   // negative when overdue

  open_inspection_issue: boolean      // any inspection with overall_result = 'fail'
  last_inspection_date:  string | null

  // Null for viewers — cost is withheld by role, not merely hidden in the UI.
  spend_mtd:          number | null
  spend_ytd:          number | null
}

export interface FleetProDashboard {
  fleet_account_id: string
  fleet_name:       string
  role:             FleetProRole
  can_view_costs:   boolean
  unit_count:       number
  overdue_count:    number
  due_soon_count:   number
  failed_inspection_count: number
  spend_mtd:        number | null
  spend_ytd:        number | null
  units:            FleetProUnitRow[]
}

// ─── Unit detail / service history ────────────────────────────────────────────

export type ServiceEventKind =
  | 'work_order'
  | 'invoice'
  | 'pm_checklist'
  | 'dot_inspection'
  | 'aerial_inspection'
  | 'equipment_inspection'
  // The driver's daily walkaround. Not a service the mechanic performed, but it is
  // a dated record produced against the unit and belongs on the same timeline.
  | 'pretrip'

export interface ServiceEvent {
  id:          string
  kind:        ServiceEventKind
  date:        string          // YYYY-MM-DD
  title:       string
  detail:      string | null
  status:      string | null
  result:      string | null   // pass / fail for inspections
  cost:        number | null   // null for viewers and for non-billable events
  reference:   string | null   // WO number / invoice number / inspection id
  invoice_id:  string | null
}

export interface FleetProUnitDetail {
  unit:          FleetProUnitRow
  events:        ServiceEvent[]
  total_spend:   number | null
  event_count:   number
  can_view_costs: boolean
  can_edit:      boolean
}

// ─── PM scheduling ────────────────────────────────────────────────────────────

export interface PmScheduleRow {
  id:                  string
  unit_id:             string
  unit_number:         string
  interval_days:       number
  last_service_date:   string | null
  next_due_date:       string | null
  service_description: string | null
  pm_state:            PmState
  days_until_due:      number | null
}

// ─── Reporting ────────────────────────────────────────────────────────────────

export interface UnitMonthCost {
  unit_id:      string
  unit_number:  string
  month:        string    // YYYY-MM
  invoice_count: number
  cost:         number
}

export interface MonthTotal {
  month:         string
  invoice_count: number
  cost:          number
}

export interface FleetProReport {
  from_date:    string
  to_date:      string
  fleet_name:   string
  months:       string[]
  per_unit:     { unit_id: string; unit_number: string; by_month: Record<string, number>; total: number }[]
  by_month:     MonthTotal[]
  grand_total:  number
  invoice_count: number
}

// ─── Role helpers (pure, client-safe) ─────────────────────────────────────────

/** Supervisors and managers see money. Read-only viewers do not. */
export function canViewCosts(role: FleetProRole): boolean {
  return role === 'manager' || role === 'supervisor'
}

/** Only the fleet manager mutates anything. */
export function canEditUnits(role: FleetProRole): boolean {
  return role === 'manager'
}

export function canManageMembers(role: FleetProRole): boolean {
  return role === 'manager'
}

export function canManagePmSchedules(role: FleetProRole): boolean {
  return role === 'manager'
}

/** Shared PM classification — overdue is red on every surface. */
export function pmStateFor(nextDueDate: string | null, today: string): { state: PmState; daysUntilDue: number | null } {
  if (!nextDueDate) return { state: 'unscheduled', daysUntilDue: null }
  const due  = new Date(nextDueDate + 'T12:00:00')
  const now  = new Date(today + 'T12:00:00')
  const days = Math.round((due.getTime() - now.getTime()) / 86_400_000)
  if (days < 0)  return { state: 'overdue',  daysUntilDue: days }
  if (days <= 30) return { state: 'due_soon', daysUntilDue: days }
  return { state: 'scheduled', daysUntilDue: days }
}
