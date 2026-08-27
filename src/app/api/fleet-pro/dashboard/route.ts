import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { computePmStatus, PM_UNIT_COLUMNS } from '@/lib/fleet-pro/pm-status'
import type { PmSource } from '@/lib/fleet-pro/pm-status'
import { computeRegistrationState, daysUntilExpiration, registrationNeedsAttention } from '@/lib/fleet-pro/registration'
import type { RegistrationState } from '@/types/fleet-pro-registration'
import { canViewCosts } from '@/types/fleet-pro'
import type { FleetProDashboard, FleetProUnitRow, PmState } from '@/types/fleet-pro'

export const dynamic = 'force-dynamic'

// ─── Row shapes as they come back from PostgREST ──────────────────────────────

interface UnitRecord {
  id:                   string
  unit_number:          string | null
  truck_trailer_number: string | null
  manufacturer:         string | null
  model:                string | null
  serial_number:        string | null
  year:                 number | null
  unit_type:            string | null
  status:               string | null
  total_hours:          number | null
  // The hours-based PM figures the shop actually maintains. Without these the
  // dashboard was reading an empty date table and calling every unit unscheduled.
  next_pm_due_hours:    number | string | null
  last_pm_date:         string | null
  last_pm_type:         string | null
}

// Fields the PM fix adds to the wire. Kept local because src/types/fleet-pro.ts is
// owned elsewhere; see the report for what should be promoted into it.
interface DashboardUnitRow extends FleetProUnitRow {
  registration_state:        RegistrationState
  registration_expires_on:   string | null
  registration_days_until:   number | null
  license_plate:             string | null
  jurisdiction:              string | null
  pm_source:       PmSource
  pm_label:        string
  next_due_hours:  number | null
  hours_remaining: number | null
  last_pm_date:    string | null
  last_pm_type:    string | null
}

interface RegistrationRecord { unit_id: string; license_plate: string | null; jurisdiction: string | null; expires_on: string | null }
interface PmRecord         { unit_id: string; interval_days: number | null; next_due_date: string | null }
interface WorkOrderRecord  { unit_id: string | null; completed_at: string | null; created_at: string | null }
interface InspectionRecord { unit_id: string | null; inspection_date: string | null; overall_result: string | null }
interface InvoiceRecord    { unit_id: string | null; total: number | null; status: string | null; created_at: string | null }

// Overdue units are what a fleet manager opened this page for, so they sort to the
// top rather than being buried alphabetically halfway down a 60-unit list.
const PM_RANK: Record<PmState, number> = { overdue: 0, due_soon: 1, unscheduled: 2, scheduled: 3 }

// PostgREST caps an unbounded select at its own default; ask for a ceiling high
// enough that a large municipal fleet's history is not silently truncated.
const ROW_CEILING = 20_000

function dateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Keep whichever ISO date/timestamp is later; both arrive as sortable strings. */
function later(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

// GET /api/fleet-pro/dashboard — every unit in the caller's fleet with its PM
// state, inspection standing and spend. Costs are stripped server-side for viewers.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProMember(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { membership } = gate
  const fleetId  = membership.fleet_account_id
  const showCost = canViewCosts(membership.role)

  // Service client from here down: RLS on these tables routes through
  // fleet_pro_account_ids(), and every query is scoped to the resolved fleet id
  // instead — never to anything supplied by the request.
  const svc = createServiceClient()

  const now        = new Date()
  const today      = dateKey(now)
  const monthStart = dateKey(new Date(now.getFullYear(), now.getMonth(), 1))
  const yearStart  = `${now.getFullYear()}-01-01`

  const { data: unitData, error: unitError } = await svc
    .from('hd_units')
    .select(`id, unit_number, truck_trailer_number, manufacturer, model, serial_number, year, unit_type, status, ${PM_UNIT_COLUMNS}`)
    .eq('fleet_account_id', fleetId)
    .eq('active', true)
    .order('unit_number', { ascending: true })
    .limit(ROW_CEILING)

  if (unitError) {
    console.error('[fleet-pro/dashboard units]', unitError)
    return NextResponse.json({ error: unitError.message }, { status: 500 })
  }

  const units   = (unitData ?? []) as UnitRecord[]
  const unitIds = units.map(u => u.id)

  const empty: FleetProDashboard = {
    fleet_account_id: fleetId,
    fleet_name:       membership.fleet_name,
    role:             membership.role,
    can_view_costs:   showCost,
    unit_count:       0,
    overdue_count:    0,
    due_soon_count:   0,
    failed_inspection_count: 0,
    registration_alert_count: 0,
    spend_mtd:        showCost ? 0 : null,
    spend_ytd:        showCost ? 0 : null,
    units:            [],
  }

  if (unitIds.length === 0) return NextResponse.json({ dashboard: empty })

  const [pmRes, woRes, dotRes, aerialRes, equipRes, invRes, regRes] = await Promise.all([
    svc.from('fleet_pro_pm_schedules')
      .select('unit_id, interval_days, next_due_date')
      .eq('fleet_account_id', fleetId)
      .in('unit_id', unitIds),

    svc.from('hd_work_orders')
      .select('unit_id, completed_at, created_at')
      .eq('fleet_account_id', fleetId)
      .in('unit_id', unitIds)
      .limit(ROW_CEILING),

    svc.from('hd_dot_inspections')
      .select('unit_id, inspection_date, overall_result')
      .eq('fleet_account_id', fleetId)
      .in('unit_id', unitIds)
      .limit(ROW_CEILING),

    svc.from('hd_aerial_inspections')
      .select('unit_id, inspection_date, overall_result')
      .eq('fleet_account_id', fleetId)
      .in('unit_id', unitIds)
      .limit(ROW_CEILING),

    svc.from('hd_equipment_inspections')
      .select('unit_id, inspection_date, overall_result')
      .eq('fleet_account_id', fleetId)
      .in('unit_id', unitIds)
      .limit(ROW_CEILING),

    // hd_invoices has no invoice_date; created_at is the billing timestamp.
    svc.from('hd_invoices')
      .select('unit_id, total, status, created_at')
      .eq('fleet_account_id', fleetId)
      .in('unit_id', unitIds)
      .gte('created_at', yearStart)
      .limit(ROW_CEILING),

    svc.from('fleet_pro_unit_registration')
      .select('unit_id, license_plate, jurisdiction, expires_on')
      .eq('fleet_account_id', fleetId)
      .in('unit_id', unitIds),
  ])

  const failed = [pmRes, woRes, dotRes, aerialRes, equipRes, invRes, regRes].find(r => r.error)
  if (failed?.error) {
    console.error('[fleet-pro/dashboard]', failed.error)
    return NextResponse.json({ error: failed.error.message }, { status: 500 })
  }

  // Units with no registration row still classify — as 'missing', which is red, the
  // same as expired. A truck with no plate on file is not a truck that is compliant.
  const regByUnit = new Map<string, RegistrationRecord>()
  for (const row of (regRes.data ?? []) as RegistrationRecord[]) regByUnit.set(row.unit_id, row)

  const pmByUnit = new Map<string, PmRecord>()
  for (const row of (pmRes.data ?? []) as PmRecord[]) pmByUnit.set(row.unit_id, row)

  const lastServiceByUnit = new Map<string, string>()
  for (const wo of (woRes.data ?? []) as WorkOrderRecord[]) {
    if (!wo.unit_id) continue
    const when = wo.completed_at ?? wo.created_at
    if (!when) continue
    const best = later(lastServiceByUnit.get(wo.unit_id) ?? null, when)
    if (best) lastServiceByUnit.set(wo.unit_id, best)
  }

  const lastInspectionByUnit = new Map<string, string>()
  const failedUnits = new Set<string>()
  const inspections = [
    ...(dotRes.data ?? []),
    ...(aerialRes.data ?? []),
    ...(equipRes.data ?? []),
  ] as InspectionRecord[]

  for (const insp of inspections) {
    if (!insp.unit_id) continue
    if (insp.overall_result === 'fail') failedUnits.add(insp.unit_id)
    if (!insp.inspection_date) continue
    const best = later(lastInspectionByUnit.get(insp.unit_id) ?? null, insp.inspection_date)
    if (best) lastInspectionByUnit.set(insp.unit_id, best)
  }

  const mtdByUnit = new Map<string, number>()
  const ytdByUnit = new Map<string, number>()
  for (const inv of (invRes.data ?? []) as InvoiceRecord[]) {
    // Filtered here rather than with .neq() because PostgREST's neq also drops
    // NULL statuses, which are real unpaid invoices.
    if (!inv.unit_id || inv.status === 'void' || !inv.created_at) continue
    const amount = Number(inv.total ?? 0)
    if (!Number.isFinite(amount)) continue
    ytdByUnit.set(inv.unit_id, (ytdByUnit.get(inv.unit_id) ?? 0) + amount)
    if (inv.created_at >= monthStart) mtdByUnit.set(inv.unit_id, (mtdByUnit.get(inv.unit_id) ?? 0) + amount)
  }

  let overdueCount = 0
  let dueSoonCount = 0
  // Expired, missing and expiring-within-60-days all count: a plate a manager cannot
  // produce is as much of a roadside problem as one that lapsed last week.
  let registrationAlertCount = 0
  let fleetMtd = 0
  let fleetYtd = 0

  const rows: DashboardUnitRow[] = units.map(u => {
    const pm = pmByUnit.get(u.id) ?? null
    // One calculator for every Fleet Pro surface: a manager-set date wins, hd_units
    // meter hours come next, and only a unit with neither reads "unscheduled".
    const status = computePmStatus(u, pm, today)
    if (status.state === 'overdue')  overdueCount++
    if (status.state === 'due_soon') dueSoonCount++

    const mtd = mtdByUnit.get(u.id) ?? 0
    const ytd = ytdByUnit.get(u.id) ?? 0
    fleetMtd += mtd
    fleetYtd += ytd

    const reg      = regByUnit.get(u.id) ?? null
    const regState = computeRegistrationState(reg?.expires_on ?? null, today)
    if (registrationNeedsAttention(regState)) registrationAlertCount++

    const lastService = lastServiceByUnit.get(u.id) ?? null

    return {
      id:                   u.id,
      unit_number:          u.unit_number ?? '',
      truck_trailer_number: u.truck_trailer_number,
      manufacturer:         u.manufacturer,
      model:                u.model,
      serial_number:        u.serial_number,
      year:                 u.year,
      unit_type:            u.unit_type,
      status:               u.status,
      total_hours:          u.total_hours === null ? null : Number(u.total_hours),

      last_service_date: lastService ? lastService.slice(0, 10) : null,
      next_due_date:     status.next_due_date,
      interval_days:     pm?.interval_days ?? null,
      pm_state:          status.state,
      days_until_due:    status.days_until_due,

      pm_source:         status.source,
      pm_label:          status.label,
      next_due_hours:    status.next_due_hours,
      hours_remaining:   status.hours_remaining,
      last_pm_date:      status.last_pm_date,
      last_pm_type:      status.last_pm_type,

      registration_state:      regState,
      registration_expires_on: reg?.expires_on ?? null,
      registration_days_until: daysUntilExpiration(reg?.expires_on ?? null, today),
      license_plate:           reg?.license_plate ?? null,
      jurisdiction:            reg?.jurisdiction ?? null,

      open_inspection_issue: failedUnits.has(u.id),
      last_inspection_date:  lastInspectionByUnit.get(u.id)?.slice(0, 10) ?? null,

      spend_mtd: showCost ? mtd : null,
      spend_ytd: showCost ? ytd : null,
    }
  })

  rows.sort((a, b) =>
    PM_RANK[a.pm_state] - PM_RANK[b.pm_state] ||
    a.unit_number.localeCompare(b.unit_number, 'en', { numeric: true }),
  )

  const dashboard: FleetProDashboard = {
    ...empty,
    unit_count:              rows.length,
    overdue_count:           overdueCount,
    due_soon_count:          dueSoonCount,
    failed_inspection_count: rows.filter(r => r.open_inspection_issue).length,
    registration_alert_count: registrationAlertCount,
    spend_mtd:               showCost ? fleetMtd : null,
    spend_ytd:               showCost ? fleetYtd : null,
    units:                   rows,
  }

  return NextResponse.json({ dashboard })
}
