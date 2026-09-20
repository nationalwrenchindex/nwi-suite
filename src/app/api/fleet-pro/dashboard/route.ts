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
import { loadFleetCosts, fleetCostPerMile, fleetCostPerHour } from '@/lib/fleet-pro/cost'
import { emptyBreakdown } from '@/types/fleet-pro-cost'
import { loadMpgAlerts } from '@/lib/fleet-pro/fuel'
import type { FuelAlert } from '@/types/fleet-pro-fuel'

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
// The cost fields that used to be planned for here now live on FleetProUnitRow
// itself — three surfaces read them, so a local interface was the wrong home.
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
    // A fleet with no miles on file has no cost per mile. Null, not 0 — "$0.00/mi"
    // reads as free when it means unknown.
    fleet_cost_per_mile: null,
    fleet_cost_per_hour: null,
    fleet_cost_12mo:     showCost ? 0 : null,
    units_with_mileage:  0,
    units:            [],
  }

  // fuel_alerts rides as its own top-level key rather than a field on
  // FleetProDashboard: src/types/fleet-pro.ts is shared with other work in flight, and
  // this route already carries several fields the same way (see DashboardUnitRow).
  if (unitIds.length === 0) {
    return NextResponse.json({ dashboard: empty, fuel_alerts: [] as FuelAlert[] })
  }

  const [pmRes, woRes, dotRes, aerialRes, equipRes, invRes, regRes, costRes, fuelAlerts] = await Promise.all([
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

    // The rolling twelve-month cost basis — invoices, outside vendor entries and the
    // meter series, summed per unit in one place (src/lib/fleet-pro/cost.ts). Loaded
    // for EVERY caller, including viewers: the role gate strips the figures on the
    // way out at the bottom of this file, and branching the query on role would give
    // two code paths where the withholding rule has to be remembered twice.
    //
    // Caught rather than thrown. Cost is one panel of this page; a manager whose PMs
    // are overdue still needs the PM list even if the cost engine trips over a
    // malformed invoice, so a failure degrades this page to no-cost instead of 500ing
    // the whole dashboard.
    loadFleetCosts(svc, fleetId, unitIds, now).catch(err => {
      console.error('[fleet-pro/dashboard costs]', err)
      return null
    }),

    // Fuel economy alerts. Loaded for EVERY caller including viewers, and NOT gated on
    // showCost below: MPG is a use figure, not a money figure. A yard supervisor who
    // can see that unit 12 is down 20% is exactly the person who catches a dragging
    // brake before it becomes a tow. The fillup's dollar cost is never on this wire.
    //
    // Caught rather than thrown, same rule as the cost engine: the PM list is what
    // this page is for, and a fuel table problem must not 500 it.
    loadMpgAlerts(svc, fleetId, unitIds, new Map(units.map(u => [u.id, u.unit_number ?? '']))).catch(err => {
      console.error('[fleet-pro/dashboard fuel]', err)
      return [] as FuelAlert[]
    }),
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

  // When the cost engine was caught above, every unit falls back to a zeroed
  // breakdown so the row shape on the wire never varies with the engine's health.
  const costBreakdowns = units.map(u => costRes?.get(u.id) ?? emptyBreakdown(u.id))
  const costByUnit = new Map(costBreakdowns.map(c => [c.unit_id, c]))

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
    const cost = costByUnit.get(u.id) ?? emptyBreakdown(u.id)

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

      // SAME WITHHOLDING RULE AS spend_mtd/spend_ytd, applied field by field: a
      // viewer's payload carries nulls, not zeros, so there is nothing to read out
      // of the network tab and nothing that looks like a real $0 figure.
      cost_12mo:     showCost ? cost.total_cost  : null,
      cost_parts:    showCost ? cost.parts_cost  : null,
      cost_labor:    showCost ? cost.labor_cost  : null,
      cost_other:    showCost ? cost.other_cost  : null,
      cost_vendor:   showCost ? cost.vendor_cost : null,
      cost_per_mile: showCost ? cost.cost_per_mile : null,
      cost_per_hour: showCost ? cost.cost_per_hour : null,
      cost_months:   showCost ? cost.months : null,

      // Use, not money. A viewer sees how hard the asset has been worked — that is
      // the portal doing its job — and no spend figure can be derived from it.
      miles_driven:  cost.miles_driven,
      hours_run:     cost.hours_run,
      repair_events: cost.repair_events,
    }
  })

  rows.sort((a, b) =>
    PM_RANK[a.pm_state] - PM_RANK[b.pm_state] ||
    a.unit_number.localeCompare(b.unit_number, 'en', { numeric: true }),
  )

  // Fleet-wide, from the breakdowns rather than from the rows: the rows have already
  // been nulled for viewers, and the aggregate has to be computed from the real
  // figures and then withheld once, not summed from a column of nulls.
  const fleetCostTotal = costBreakdowns.reduce((sum, c) => sum + c.total_cost, 0)

  const dashboard: FleetProDashboard = {
    ...empty,
    fleet_cost_per_mile: showCost ? fleetCostPerMile(costBreakdowns) : null,
    fleet_cost_per_hour: showCost ? fleetCostPerHour(costBreakdowns) : null,
    fleet_cost_12mo:     showCost ? fleetCostTotal : null,
    // Not withheld: it is a count of units, not money, and it is what tells a manager
    // the fleet average is drawn from 4 of his 60 trucks and should not be trusted yet.
    units_with_mileage:  costBreakdowns.filter(c => c.miles_driven !== null && c.miles_driven > 0).length,
    unit_count:              rows.length,
    overdue_count:           overdueCount,
    due_soon_count:          dueSoonCount,
    failed_inspection_count: rows.filter(r => r.open_inspection_issue).length,
    registration_alert_count: registrationAlertCount,
    spend_mtd:               showCost ? fleetMtd : null,
    spend_ytd:               showCost ? fleetYtd : null,
    units:                   rows,
  }

  return NextResponse.json({ dashboard, fuel_alerts: fuelAlerts })
}
