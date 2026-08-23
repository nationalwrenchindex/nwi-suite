// GET /api/fleet-pro/partner/accounts/[accountId]/detail
//
// One reseller customer, drilled down: every unit, a merged service timeline, and —
// unlike the member-facing /api/fleet-pro/units/[id] — the cost basis. The partner
// is the one who billed this work, so labor and parts splits are his to see. The
// fleet's own portal must never receive this payload.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requirePartner, partnerOwnsAccount, getFleetBranding } from '@/lib/fleet-pro/partner-access'
import { pmStateFor } from '@/types/fleet-pro'
import type {
  PartnerAccountDetail,
  PartnerAccountEvent,
  PartnerAccountUnitRow,
} from '@/components/fleet-pro/partner/AccountDetailClient'

export const dynamic = 'force-dynamic'

// Enough to fill the activity table without shipping a decade of history.
const EVENT_LIMIT = 50

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
function byDateDesc(a: PartnerAccountEvent, b: PartnerAccountEvent): number {
  return b.date.localeCompare(a.date)
}

function maxDate(dates: (string | null)[]): string | null {
  const clean = dates.filter((d): d is string => !!d).sort()
  return clean.length ? clean[clean.length - 1] : null
}

interface Row { [key: string]: unknown }

// ── route ─────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requirePartner(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { partner } = gate

  // THE tenant check. accountId arrives from the URL, so without this any partner
  // could read any other partner's customer — rates, revenue and all — by pasting a
  // uuid. 404 rather than 403: a partner should not learn that the account exists.
  // Nothing below runs until this passes.
  if (!(await partnerOwnsAccount(partner.id, accountId))) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }

  const svc = createServiceClient()

  const [
    { data: accountRow },
    { data: unitRows },
    { data: workOrders },
    { data: invoices },
    { data: dotInspections },
    { data: aerialInspections },
    { data: equipmentInspections },
    { data: pretrips },
    { data: pmSchedules },
    { count: memberCount },
    branding,
  ] = await Promise.all([
    svc.from('hd_fleet_accounts')
      .select('id, fleet_name, fleet_pro_enabled, fleet_pro_status')
      .eq('id', accountId).maybeSingle(),

    svc.from('hd_units')
      .select('id, unit_number, truck_trailer_number, manufacturer, model, serial_number, bm_number, year, unit_type, status, total_hours')
      .eq('fleet_account_id', accountId),

    svc.from('hd_work_orders')
      .select('id, unit_id, work_order_number, service_type, status, total_amount, labor_hours, labor_rate, tech_name, completed_at, created_at')
      .eq('fleet_account_id', accountId),

    // hd_invoices has no invoice_date — created_at is the billing date on this table.
    svc.from('hd_invoices')
      .select('id, unit_id, invoice_number, total, subtotal_labor, subtotal_parts, labor_rate, status, created_at')
      .eq('fleet_account_id', accountId),

    svc.from('hd_dot_inspections')
      .select('id, unit_id, inspection_date, overall_result, inspector_name, inspection_id')
      .eq('fleet_account_id', accountId),

    svc.from('hd_aerial_inspections')
      .select('id, unit_id, inspection_date, inspection_type, overall_result, inspector_name, inspection_id')
      .eq('fleet_account_id', accountId),

    svc.from('hd_equipment_inspections')
      .select('id, unit_id, inspection_date, equipment_type, overall_result')
      .eq('fleet_account_id', accountId),

    svc.from('fleet_pro_pretrip_inspections')
      .select('id, unit_id, driver_name, inspection_date, odometer, reefer_hours, overall_result, defects')
      .eq('fleet_account_id', accountId),

    svc.from('fleet_pro_pm_schedules')
      .select('unit_id, interval_days, last_service_date, next_due_date')
      .eq('fleet_account_id', accountId),

    svc.from('fleet_pro_members')
      .select('id', { count: 'exact', head: true })
      .eq('fleet_account_id', accountId),

    getFleetBranding(accountId),
  ])

  const units = (unitRows ?? []) as Row[]
  const unitIds = units.map(u => String(u.id))

  // hd_pm_checklists carries no fleet_account_id, so it can only be scoped through
  // the unit ids we just read for this account — which is why it runs second.
  const { data: pmChecklists } = unitIds.length
    ? await svc.from('hd_pm_checklists')
        .select('id, unit_id, pm_type, completed_at')
        .in('unit_id', unitIds)
    : { data: [] as Row[] }

  // ── lookups ─────────────────────────────────────────────────────────────────
  const unitNumberById = new Map<string, string>()
  for (const u of units) unitNumberById.set(String(u.id), (u.unit_number as string | null) ?? '')

  const woRows     = (workOrders ?? []) as Row[]
  // Voided invoices never happened: they are excluded from the timeline and from
  // every revenue figure below.
  const invRows    = ((invoices ?? []) as Row[]).filter(r => String(r.status ?? '') !== 'void')
  const dotRows    = (dotInspections ?? []) as Row[]
  const aerialRows = (aerialInspections ?? []) as Row[]
  const equipRows  = (equipmentInspections ?? []) as Row[]
  const preRows    = (pretrips ?? []) as Row[]
  const pmRows     = (pmChecklists ?? []) as Row[]

  const schedByUnit = new Map<string, Row>()
  for (const s of (pmSchedules ?? []) as Row[]) schedByUnit.set(String(s.unit_id), s)

  const today    = new Date().toISOString().slice(0, 10)
  const monthPfx = today.slice(0, 7)
  const yearPfx  = today.slice(0, 4)

  // ── events ──────────────────────────────────────────────────────────────────

  function unitBits(unitId: unknown): { unit_id: string | null; unit_number: string | null } {
    const id = unitId == null ? null : String(unitId)
    return { unit_id: id, unit_number: id ? (unitNumberById.get(id) ?? null) : null }
  }

  const woEvents: PartnerAccountEvent[] = woRows.map(r => {
    const rate  = r.labor_rate == null ? null : `$${num(r.labor_rate).toFixed(2)}/hr`
    const hours = r.labor_hours == null ? null : `${num(r.labor_hours)} hrs`
    return {
      id:         String(r.id),
      kind:       'work_order',
      date:       dayOf(r.completed_at) ?? dayOf(r.created_at) ?? '',
      title:      (r.service_type as string | null) ?? 'Work Order',
      // The labor rate rides along here: it is the cost basis a partner opens this
      // page for, and it is exactly what the member-side route withholds.
      detail:     [r.tech_name as string | null, hours, rate].filter(Boolean).join(' · ') || null,
      status:     (r.status as string | null) ?? null,
      result:     null,
      cost:       r.total_amount == null ? null : num(r.total_amount),
      reference:  (r.work_order_number as string | null) ?? null,
      invoice_id: null,
      ...unitBits(r.unit_id),
    }
  })

  const invEvents: PartnerAccountEvent[] = invRows.map(r => {
    const labor = r.subtotal_labor == null ? null : `Labor ${num(r.subtotal_labor).toFixed(2)}`
    const parts = r.subtotal_parts == null ? null : `Parts ${num(r.subtotal_parts).toFixed(2)}`
    const rate  = r.labor_rate == null ? null : `@ $${num(r.labor_rate).toFixed(2)}/hr`
    return {
      id:         String(r.id),
      kind:       'invoice',
      date:       dayOf(r.created_at) ?? '',
      title:      'Invoice',
      detail:     [labor, parts, rate].filter(Boolean).join(' · ') || null,
      status:     (r.status as string | null) ?? null,
      result:     null,
      cost:       r.total == null ? null : num(r.total),
      reference:  (r.invoice_number as string | null) ?? null,
      invoice_id: String(r.id),
      ...unitBits(r.unit_id),
    }
  })

  const pmEvents: PartnerAccountEvent[] = pmRows.map(r => ({
    id:         String(r.id),
    kind:       'pm_checklist',
    date:       dayOf(r.completed_at) ?? '',
    title:      (r.pm_type as string | null) ?? 'PM Service',
    detail:     null,
    status:     null,
    result:     null,
    cost:       null,   // the PM is billed on its invoice, not here
    reference:  null,
    invoice_id: null,
    ...unitBits(r.unit_id),
  }))

  const dotEvents: PartnerAccountEvent[] = dotRows.map(r => ({
    id:         String(r.id),
    kind:       'dot_inspection',
    date:       dayOf(r.inspection_date) ?? '',
    title:      'DOT Inspection',
    detail:     (r.inspector_name as string | null) ?? null,
    status:     null,
    result:     (r.overall_result as string | null) ?? null,
    cost:       null,
    reference:  (r.inspection_id as string | null) ?? null,
    invoice_id: null,
    ...unitBits(r.unit_id),
  }))

  const aerialEvents: PartnerAccountEvent[] = aerialRows.map(r => ({
    id:         String(r.id),
    kind:       'aerial_inspection',
    date:       dayOf(r.inspection_date) ?? '',
    title:      `Aerial Inspection — ${(r.inspection_type as string | null) ?? 'inspection'}`,
    detail:     (r.inspector_name as string | null) ?? null,
    status:     null,
    result:     (r.overall_result as string | null) ?? null,
    cost:       null,
    reference:  (r.inspection_id as string | null) ?? null,
    invoice_id: null,
    ...unitBits(r.unit_id),
  }))

  const equipEvents: PartnerAccountEvent[] = equipRows.map(r => ({
    id:         String(r.id),
    kind:       'equipment_inspection',
    date:       dayOf(r.inspection_date) ?? '',
    title:      `Equipment Inspection — ${(r.equipment_type as string | null) ?? 'equipment'}`,
    detail:     null,
    status:     null,
    result:     (r.overall_result as string | null) ?? null,
    cost:       null,
    reference:  null,
    invoice_id: null,
    ...unitBits(r.unit_id),
  }))

  const preEvents: PartnerAccountEvent[] = preRows.map(r => {
    const d = countOf(r.defects)
    const bits = [
      r.driver_name as string | null,
      r.odometer == null ? null : `${num(r.odometer).toLocaleString('en-US')} mi`,
      r.reefer_hours == null ? null : `${num(r.reefer_hours).toLocaleString('en-US')} hrs`,
      d > 0 ? `${d} defect${d === 1 ? '' : 's'}` : null,
    ].filter(Boolean)
    return {
      id:         String(r.id),
      kind:       'pretrip',
      date:       dayOf(r.inspection_date) ?? '',
      title:      'Driver Pre-Trip',
      detail:     bits.join(' · ') || null,
      status:     null,
      result:     (r.overall_result as string | null) ?? null,
      cost:       null,
      reference:  null,
      invoice_id: null,
      ...unitBits(r.unit_id),
    }
  })

  const recentEvents = [
    ...woEvents, ...invEvents, ...pmEvents,
    ...dotEvents, ...aerialEvents, ...equipEvents, ...preEvents,
  ].sort(byDateDesc).slice(0, EVENT_LIMIT)

  // ── money ───────────────────────────────────────────────────────────────────
  // DOUBLE-COUNT GUARD: a work order and the invoice raised from it both carry a
  // total for the same labor and parts. Revenue is therefore summed from invoices
  // only — work orders keep showing their figure on their own timeline row, but
  // never contribute to revenue_mtd, revenue_ytd, lifetime_revenue or per-unit
  // spend. This matches /api/fleet-pro/units/[id] exactly; the two surfaces have to
  // agree or the partner and his customer are reading different numbers.
  let revenueMtd = 0
  let revenueYtd = 0
  let lifetime   = 0
  let laborBilled = 0
  let partsBilled = 0

  const spendByUnit = new Map<string, { mtd: number; ytd: number; life: number }>()

  for (const r of invRows) {
    const amount = num(r.total)
    const day    = dayOf(r.created_at) ?? ''
    const inMtd  = day.startsWith(monthPfx)
    const inYtd  = day.startsWith(yearPfx)

    lifetime    += amount
    laborBilled += num(r.subtotal_labor)
    partsBilled += num(r.subtotal_parts)
    if (inMtd) revenueMtd += amount
    if (inYtd) revenueYtd += amount

    const uid = r.unit_id == null ? null : String(r.unit_id)
    if (!uid) continue   // shop-level invoice with no unit still counts toward account revenue
    const bucket = spendByUnit.get(uid) ?? { mtd: 0, ytd: 0, life: 0 }
    bucket.life += amount
    if (inMtd) bucket.mtd += amount
    if (inYtd) bucket.ytd += amount
    spendByUnit.set(uid, bucket)
  }

  // ── per-unit rollups ────────────────────────────────────────────────────────
  const serviceDatesByUnit    = new Map<string, string[]>()
  const inspectionDatesByUnit = new Map<string, string[]>()
  const failedByUnit          = new Map<string, boolean>()
  const defectsByUnit         = new Map<string, number>()

  function push(map: Map<string, string[]>, unitId: string | null, date: string) {
    if (!unitId || !date) return
    const list = map.get(unitId) ?? []
    list.push(date)
    map.set(unitId, list)
  }

  for (const e of [...woEvents, ...invEvents]) push(serviceDatesByUnit, e.unit_id, e.date)
  for (const e of [...dotEvents, ...aerialEvents, ...equipEvents]) {
    push(inspectionDatesByUnit, e.unit_id, e.date)
    if (e.unit_id && isFail(e.result)) failedByUnit.set(e.unit_id, true)
  }

  // Open defects come from FAILED pre-trips only — a passed pre-trip with a noted
  // item is not something the shop has to answer for. A failed one that carries no
  // defect array still counts as one open item rather than vanishing.
  for (const r of preRows) {
    if (!isFail(r.overall_result)) continue
    const uid = r.unit_id == null ? null : String(r.unit_id)
    if (!uid) continue
    defectsByUnit.set(uid, (defectsByUnit.get(uid) ?? 0) + Math.max(1, countOf(r.defects)))
    failedByUnit.set(uid, true)
  }

  const unitRowsOut: PartnerAccountUnitRow[] = units.map(u => {
    const id    = String(u.id)
    const sched = schedByUnit.get(id) ?? null
    const nextDueDate = sched ? dayOf(sched.next_due_date) : null
    const { state, daysUntilDue } = pmStateFor(nextDueDate, today)
    const spend = spendByUnit.get(id) ?? { mtd: 0, ytd: 0, life: 0 }

    return {
      id,
      unit_number:          (u.unit_number as string | null) ?? '',
      truck_trailer_number: (u.truck_trailer_number as string | null) ?? null,
      manufacturer:         (u.manufacturer as string | null) ?? null,
      model:                (u.model as string | null) ?? null,
      serial_number:        (u.serial_number as string | null) ?? null,
      bm_number:            (u.bm_number as string | null) ?? null,
      year:                 u.year == null ? null : num(u.year),
      unit_type:            (u.unit_type as string | null) ?? null,
      status:               (u.status as string | null) ?? null,
      total_hours:          u.total_hours == null ? null : num(u.total_hours),

      last_service_date:    maxDate(serviceDatesByUnit.get(id) ?? []),
      next_due_date:        nextDueDate,
      interval_days:        sched?.interval_days == null ? null : num(sched.interval_days),
      pm_state:             state,
      days_until_due:       daysUntilDue,

      open_inspection_issue: failedByUnit.get(id) ?? false,
      last_inspection_date:  maxDate(inspectionDatesByUnit.get(id) ?? []),

      spend_mtd:            spend.mtd,
      spend_ytd:            spend.ytd,
      lifetime_spend:       spend.life,
      open_defect_count:    defectsByUnit.get(id) ?? 0,
    }
  })

  // Worst first: an overdue PM or an open defect is why the partner opened this.
  const PM_RANK: Record<string, number> = { overdue: 0, due_soon: 1, scheduled: 2, unscheduled: 3 }
  unitRowsOut.sort((a, b) => {
    const rank = PM_RANK[a.pm_state] - PM_RANK[b.pm_state]
    if (rank !== 0) return rank
    if (b.open_defect_count !== a.open_defect_count) return b.open_defect_count - a.open_defect_count
    return a.unit_number.localeCompare(b.unit_number, 'en', { numeric: true })
  })

  const account = (accountRow ?? {}) as Row

  const detail: PartnerAccountDetail = {
    account: {
      fleet_account_id:  accountId,
      fleet_name:        (account.fleet_name as string | null) ?? branding.brand_name,
      branding,
      unit_count:        units.length,
      member_count:      memberCount ?? 0,
      fleet_pro_enabled: !!account.fleet_pro_enabled,
      fleet_pro_status:  (account.fleet_pro_status as string | null) ?? null,
    },
    units: unitRowsOut,
    recent_events: recentEvents,
    cost_summary: {
      revenue_mtd:      revenueMtd,
      revenue_ytd:      revenueYtd,
      lifetime_revenue: lifetime,
      labor_billed:     laborBilled,
      parts_billed:     partsBilled,
      invoice_count:    invRows.length,
      avg_invoice:      invRows.length ? lifetime / invRows.length : 0,
    },
  }

  return NextResponse.json({ detail })
}
