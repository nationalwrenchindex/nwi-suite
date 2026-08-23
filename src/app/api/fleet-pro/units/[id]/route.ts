// GET /api/fleet-pro/units/[id] — one unit plus its full service history.
//
// The fleet customer sees seven different record types produced against this unit —
// work orders, invoices, PM checklists, three flavors of inspection, and the driver's
// daily pre-trips — merged into a single chronological timeline. Seven tables, one
// story. Alongside it rides the meter trend and, for anyone allowed to see money,
// the twelve-month cost curve.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { getPartner, partnerOwnsAccount } from '@/lib/fleet-pro/partner-access'
import { canViewCosts, canEditUnits, pmStateFor } from '@/types/fleet-pro'
import type { FleetProUnitDetail, FleetProUnitRow, ServiceEvent, ServiceEventKind } from '@/types/fleet-pro'
import { canSeeCostBasis } from '@/types/fleet-pro-partner'
import type { MeterReading, UnitMonthCost, FleetProViewerKind } from '@/types/fleet-pro-partner'

export const dynamic = 'force-dynamic'


interface UnitServiceEvent extends Omit<ServiceEvent, 'kind'> {
  kind:    ServiceEventKind
  /** Printable document for the inspection kinds; null for everything else. */
  pdf_url: string | null
}

interface UnitDetailPayload extends Omit<FleetProUnitDetail, 'events'> {
  events:         UnitServiceEvent[]
  meter_readings: MeterReading[]
  /** Null — not zeroed — for viewers, same rule as every other cost figure. */
  cost_by_month:  UnitMonthCost[] | null
  viewer_kind:    FleetProViewerKind
}

/** Who got in, and what that buys them. */
interface UnitAccess {
  kind:      FleetProViewerKind
  fleetId:   string
  showCosts: boolean
  canEdit:   boolean
}

// Only the columns FleetProUnitRow carries. hd_units.notes exists but has no home
// in the shared type, so it is deliberately not fetched.
const UNIT_COLUMNS =
  'id, unit_number, truck_trailer_number, manufacturer, model, serial_number, year, unit_type, status, total_hours, bm_number'

// ── helpers ───────────────────────────────────────────────────────────────────

/** timestamptz or date -> YYYY-MM-DD. */
function dayOf(value: unknown): string | null {
  if (!value) return null
  const s = String(value)
  return s.length >= 10 ? s.slice(0, 10) : null
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function isFail(result: unknown): boolean {
  return String(result ?? '').toLowerCase() === 'fail'
}

/** Newest first. Undated rows sink to the bottom rather than corrupting the order. */
function byDateDesc(a: UnitServiceEvent, b: UnitServiceEvent): number {
  return b.date.localeCompare(a.date)
}

/** The last `count` calendar months ending with the month of `today`, oldest first. */
function monthWindow(today: string, count: number): string[] {
  const year  = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const out: string[] = []
  for (let back = count - 1; back >= 0; back--) {
    const d = new Date(Date.UTC(year, month - 1 - back, 1))
    out.push(d.toISOString().slice(0, 7))
  }
  return out
}

interface Row { [key: string]: unknown }

// ── route ─────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: unitId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProMember(user?.id ?? null)

  const svc = createServiceClient()

  let access:  UnitAccess | null = null
  let unitRow: Row | null = null

  // THE tenant check. Scoping by id alone would let a member of one department
  // read another department's unit by guessing a uuid; every query below inherits
  // its safety from this one, so nothing else runs until it passes.
  if (gate.ok) {
    const { membership } = gate
    const { data } = await svc
      .from('hd_units')
      .select(UNIT_COLUMNS)
      .eq('id', unitId)
      .eq('fleet_account_id', membership.fleet_account_id)
      .maybeSingle()

    if (data) {
      unitRow = data as Row
      access  = {
        kind:      'member',
        fleetId:   membership.fleet_account_id,
        showCosts: canViewCosts(membership.role),
        canEdit:   canEditUnits(membership.role),
      }
    }
  }

  // PARTNER FALLBACK. The reseller is deliberately not a member of his customers'
  // fleets — that separation is what keeps his cost basis out of their portal — so
  // requireFleetProMember turns him away from a page about his own customer's unit.
  // The equivalent tenant check for him is partnerOwnsAccount against the unit's
  // own fleet_account_id, which is read here rather than trusted from the caller.
  if (!access && user) {
    const partner = await getPartner(user.id)
    if (partner) {
      const { data } = await svc
        .from('hd_units')
        .select(`${UNIT_COLUMNS}, fleet_account_id`)
        .eq('id', unitId)
        .maybeSingle()

      const ownerFleetId = (data as Row | null)?.fleet_account_id as string | null | undefined
      if (data && ownerFleetId && await partnerOwnsAccount(partner.id, ownerFleetId)) {
        unitRow = data as Row
        access  = {
          kind:      'partner',
          fleetId:   ownerFleetId,
          showCosts: canSeeCostBasis('partner'),
          // Editing a unit routes through requireFleetProManager, which a partner is
          // not. He reads his customer's unit; he does not mutate it from here.
          canEdit:   false,
        }
      }
    }
  }

  if (!access || !unitRow) {
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
    return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
  }

  const fleetId = access.fleetId

  const [
    { data: workOrders },
    { data: invoices },
    { data: pmChecklists },
    { data: dotInspections },
    { data: aerialInspections },
    { data: equipmentInspections },
    { data: pmSchedule },
    { data: pretrips },
    { data: meterRows },
  ] = await Promise.all([
    svc.from('hd_work_orders')
      .select('id, work_order_number, service_type, status, total_amount, tech_name, labor_hours, completed_at, created_at')
      .eq('unit_id', unitId).eq('fleet_account_id', fleetId),

    svc.from('hd_invoices')
      .select('id, invoice_number, total, status, created_at, complaint, diagnosis')
      .eq('unit_id', unitId).eq('fleet_account_id', fleetId),

    // hd_pm_checklists has no fleet_account_id column — the unit ownership check
    // above is what scopes this one to the caller's fleet.
    svc.from('hd_pm_checklists')
      .select('id, pm_type, completed_at, created_at, tech_name, invoice_id')
      .eq('unit_id', unitId),

    svc.from('hd_dot_inspections')
      .select('id, inspection_date, overall_result, inspector_name, inspection_id, invoice_id, violations')
      .eq('unit_id', unitId).eq('fleet_account_id', fleetId),

    svc.from('hd_aerial_inspections')
      .select('id, inspection_date, inspection_type, overall_result, inspector_name, inspection_id, invoice_id, deficiencies, removed_from_service')
      .eq('unit_id', unitId).eq('fleet_account_id', fleetId),

    svc.from('hd_equipment_inspections')
      .select('id, inspection_date, equipment_type, overall_result, inspector_name, inspection_id, invoice_id, deficiencies')
      .eq('unit_id', unitId).eq('fleet_account_id', fleetId),

    svc.from('fleet_pro_pm_schedules')
      .select('interval_days, last_service_date, next_due_date')
      .eq('unit_id', unitId).eq('fleet_account_id', fleetId)
      .maybeSingle(),

    // Pre-trips and meter readings carry a NULLABLE fleet_account_id (106) — a
    // driver submitting from a QR sticker has no session to resolve it from. Adding
    // .eq('fleet_account_id', ...) here would silently drop exactly those rows, so
    // these two are scoped by unit_id and inherit the ownership check above, the
    // same concession hd_pm_checklists makes.
    svc.from('fleet_pro_pretrip_inspections')
      .select('id, driver_name, inspection_date, odometer, reefer_hours, overall_result, defects, submitted_at')
      .eq('unit_id', unitId)
      .order('inspection_date', { ascending: false })
      .limit(200),

    svc.from('fleet_pro_unit_meter_readings')
      .select('reading_date, odometer, engine_hours, source')
      .eq('unit_id', unitId)
      .order('reading_date', { ascending: false })
      .limit(24),
  ])

  // ── work orders ─────────────────────────────────────────────────────────────
  const woRows = (workOrders ?? []) as Row[]
  const woEvents: UnitServiceEvent[] = woRows.map(r => {
    const hours = r.labor_hours == null ? null : `${num(r.labor_hours)} hrs`
    const detail = [r.tech_name as string | null, hours].filter(Boolean).join(' · ')
    return {
      id:         String(r.id),
      kind:       'work_order',
      date:       dayOf(r.completed_at) ?? dayOf(r.created_at) ?? '',
      title:      (r.service_type as string | null) ?? 'Work Order',
      detail:     detail || null,
      status:     (r.status as string | null) ?? null,
      result:     null,
      cost:       r.total_amount == null ? null : num(r.total_amount),
      reference:  (r.work_order_number as string | null) ?? null,
      invoice_id: null,
      pdf_url:    null,
    }
  })

  // ── invoices ────────────────────────────────────────────────────────────────
  // Voided invoices never happened as far as the customer is concerned, and they
  // must not reach the spend math below.
  const invRows = ((invoices ?? []) as Row[]).filter(r => String(r.status ?? '') !== 'void')
  const invEvents: UnitServiceEvent[] = invRows.map(r => ({
    id:         String(r.id),
    kind:       'invoice',
    date:       dayOf(r.created_at) ?? '',
    title:      'Invoice',
    detail:     ((r.complaint as string | null) || (r.diagnosis as string | null)) ?? null,
    status:     (r.status as string | null) ?? null,
    result:     null,
    cost:       r.total == null ? null : num(r.total),
    reference:  (r.invoice_number as string | null) ?? null,
    invoice_id: String(r.id),
    pdf_url:    null,
  }))

  // ── PM checklists ───────────────────────────────────────────────────────────
  const pmEvents: UnitServiceEvent[] = ((pmChecklists ?? []) as Row[]).map(r => ({
    id:         String(r.id),
    kind:       'pm_checklist',
    date:       dayOf(r.completed_at) ?? dayOf(r.created_at) ?? '',
    title:      (r.pm_type as string | null) ?? 'PM Service',
    detail:     (r.tech_name as string | null) ?? null,
    status:     null,
    result:     null,
    cost:       null,   // the PM is billed on its invoice, not here
    reference:  null,
    invoice_id: (r.invoice_id as string | null) ?? null,
    pdf_url:    null,
  }))

  // ── inspections ─────────────────────────────────────────────────────────────
  const dotRows    = (dotInspections ?? []) as Row[]
  const aerialRows = (aerialInspections ?? []) as Row[]
  const equipRows  = (equipmentInspections ?? []) as Row[]

  const dotEvents: UnitServiceEvent[] = dotRows.map(r => {
    const v = countOf(r.violations)
    return {
      id:         String(r.id),
      kind:       'dot_inspection',
      date:       dayOf(r.inspection_date) ?? '',
      title:      'DOT Inspection',
      detail:     [r.inspector_name as string | null, v > 0 ? `${v} violation${v === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || null,
      status:     null,
      result:     (r.overall_result as string | null) ?? null,
      cost:       null,
      reference:  (r.inspection_id as string | null) ?? null,
      invoice_id: (r.invoice_id as string | null) ?? null,
      pdf_url:    `/api/hd/dot-inspections/${String(r.id)}/pdf`,
    }
  })

  const aerialEvents: UnitServiceEvent[] = aerialRows.map(r => {
    const d = countOf(r.deficiencies)
    const bits = [
      r.inspector_name as string | null,
      d > 0 ? `${d} deficienc${d === 1 ? 'y' : 'ies'}` : null,
      r.removed_from_service ? 'Removed from service' : null,
    ].filter(Boolean)
    return {
      id:         String(r.id),
      kind:       'aerial_inspection',
      date:       dayOf(r.inspection_date) ?? '',
      title:      `Aerial Inspection — ${(r.inspection_type as string | null) ?? 'inspection'}`,
      detail:     bits.join(' · ') || null,
      status:     null,
      result:     (r.overall_result as string | null) ?? null,
      cost:       null,
      reference:  (r.inspection_id as string | null) ?? null,
      invoice_id: (r.invoice_id as string | null) ?? null,
      pdf_url:    `/api/hd/aerial-inspections/${String(r.id)}/pdf`,
    }
  })

  const equipEvents: UnitServiceEvent[] = equipRows.map(r => {
    const d = countOf(r.deficiencies)
    return {
      id:         String(r.id),
      kind:       'equipment_inspection',
      date:       dayOf(r.inspection_date) ?? '',
      title:      `Equipment Inspection — ${(r.equipment_type as string | null) ?? 'equipment'}`,
      detail:     [r.inspector_name as string | null, d > 0 ? `${d} deficienc${d === 1 ? 'y' : 'ies'}` : null].filter(Boolean).join(' · ') || null,
      status:     null,
      result:     (r.overall_result as string | null) ?? null,
      cost:       null,
      reference:  (r.inspection_id as string | null) ?? null,
      invoice_id: (r.invoice_id as string | null) ?? null,
      // Equipment inspections have no printable route of their own yet.
      pdf_url:    null,
    }
  })

  // ── driver pre-trips ────────────────────────────────────────────────────────
  // The defect count is what a fleet manager scans for, so it rides in the detail
  // line next to the driver who signed the record.
  const pretripEvents: UnitServiceEvent[] = ((pretrips ?? []) as Row[]).map(r => {
    const d = countOf(r.defects)
    return {
      id:         String(r.id),
      kind:       'pretrip',
      date:       dayOf(r.inspection_date) ?? dayOf(r.submitted_at) ?? '',
      title:      'Pre-Trip Inspection',
      detail:     [
                    (r.driver_name as string | null) || 'Driver not named',
                    d > 0 ? `${d} defect${d === 1 ? '' : 's'}` : null,
                  ].filter(Boolean).join(' · ') || null,
      status:     null,
      result:     (r.overall_result as string | null) ?? null,
      cost:       null,
      reference:  null,
      invoice_id: null,
      pdf_url:    null,
    }
  })

  const events: UnitServiceEvent[] = [
    ...woEvents, ...invEvents, ...pmEvents, ...dotEvents, ...aerialEvents, ...equipEvents,
    ...pretripEvents,
  ].sort(byDateDesc)

  // ── meter history ───────────────────────────────────────────────────────────
  // Fetched newest-first so the LIMIT keeps the most recent 24, then reversed: a
  // trend line only reads correctly oldest to newest.
  const meterReadings: MeterReading[] = ((meterRows ?? []) as Row[]).map(r => ({
    reading_date: dayOf(r.reading_date) ?? '',
    odometer:     r.odometer == null ? null : num(r.odometer),
    engine_hours: r.engine_hours == null ? null : num(r.engine_hours),
    source:       ((r.source as MeterReading['source'] | null) ?? 'manual'),
  })).reverse()

  // ── money ───────────────────────────────────────────────────────────────────
  // DOUBLE-COUNT GUARD: a work order and the invoice raised from it both carry a
  // total for the same labor and parts. Spend is therefore summed from invoices
  // only — the work orders still show their figure on their own row, but they
  // never contribute to total_spend, spend_mtd or spend_ytd.
  const today     = new Date().toISOString().slice(0, 10)
  const monthPfx  = today.slice(0, 7)
  const yearPfx   = today.slice(0, 4)

  let totalSpend = 0
  let spendMtd   = 0
  let spendYtd   = 0
  for (const r of invRows) {
    const amount = num(r.total)
    const day    = dayOf(r.created_at) ?? ''
    totalSpend += amount
    if (day.startsWith(monthPfx)) spendMtd += amount
    if (day.startsWith(yearPfx))  spendYtd += amount
  }

  // Twelve-month cost curve, from the same void-free invoice rows the totals use.
  // Months with no invoices are emitted as zeros rather than skipped — a gap in a
  // trend has to look like a gap, not like a month that never existed.
  const costMonths = monthWindow(today, 12)
  const costBuckets = new Map<string, { cost: number; invoice_count: number }>(
    costMonths.map(m => [m, { cost: 0, invoice_count: 0 }]),
  )
  for (const r of invRows) {
    const bucket = costBuckets.get((dayOf(r.created_at) ?? '').slice(0, 7))
    if (!bucket) continue
    bucket.cost += num(r.total)
    bucket.invoice_count += 1
  }
  const costByMonth: UnitMonthCost[] = costMonths.map(month => {
    const bucket = costBuckets.get(month) ?? { cost: 0, invoice_count: 0 }
    return { month, cost: bucket.cost, invoice_count: bucket.invoice_count }
  })

  // ── unit header figures ─────────────────────────────────────────────────────
  const serviceDates = [...woEvents, ...invEvents].map(e => e.date).filter(Boolean).sort()
  const lastServiceDate = serviceDates.length ? serviceDates[serviceDates.length - 1] : null

  const inspectionEvents  = [...dotEvents, ...aerialEvents, ...equipEvents]
  const inspectionDates   = inspectionEvents.map(e => e.date).filter(Boolean).sort()
  const lastInspectionDate = inspectionDates.length ? inspectionDates[inspectionDates.length - 1] : null
  const openInspectionIssue = inspectionEvents.some(e => isFail(e.result))

  const sched = (pmSchedule ?? null) as Row | null
  const nextDueDate = sched ? dayOf(sched.next_due_date) : null
  const { state: pmState, daysUntilDue } = pmStateFor(nextDueDate, today)

  const showCosts = access.showCosts

  const unit: FleetProUnitRow = {
    id:                   String(unitRow.id),
    unit_number:          (unitRow.unit_number as string | null) ?? '',
    truck_trailer_number: (unitRow.truck_trailer_number as string | null) ?? null,
    manufacturer:         (unitRow.manufacturer as string | null) ?? null,
    model:                (unitRow.model as string | null) ?? null,
    serial_number:        (unitRow.serial_number as string | null) ?? null,
    bm_number:            (unitRow.bm_number as string | null) ?? null,
    year:                 unitRow.year == null ? null : num(unitRow.year),
    unit_type:            (unitRow.unit_type as string | null) ?? null,
    status:               (unitRow.status as string | null) ?? null,
    total_hours:          unitRow.total_hours == null ? null : num(unitRow.total_hours),

    last_service_date:    lastServiceDate,
    next_due_date:        nextDueDate,
    interval_days:        sched?.interval_days == null ? null : num(sched.interval_days),
    pm_state:             pmState,
    days_until_due:       daysUntilDue,

    open_inspection_issue: openInspectionIssue,
    last_inspection_date:  lastInspectionDate,

    spend_mtd:            showCosts ? spendMtd : null,
    spend_ytd:            showCosts ? spendYtd : null,
  }

  // COST WITHHOLDING: viewers are not merely shown a blank column — the figures
  // never leave the server, so there is nothing to read out of the network tab.
  const safeEvents = showCosts ? events : events.map(e => ({ ...e, cost: null }))

  const detail: UnitDetailPayload = {
    unit,
    events:         safeEvents,
    total_spend:    showCosts ? totalSpend : null,
    event_count:    events.length,
    can_view_costs: showCosts,
    can_edit:       access.canEdit,
    meter_readings: meterReadings,
    // Withheld the same way as every other figure — the month-by-month breakdown
    // would otherwise hand a viewer the total spend one subtraction later.
    cost_by_month:  showCosts ? costByMonth : null,
    viewer_kind:    access.kind,
  }

  return NextResponse.json({ detail })
}
