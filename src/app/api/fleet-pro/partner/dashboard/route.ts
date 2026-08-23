import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requirePartner, getPartnerFleetIds } from '@/lib/fleet-pro/partner-access'
import { FLEET_PRO_MONTHLY_CENTS } from '@/types/fleet-pro-partner'
import type {
  PartnerDashboard,
  PartnerFleetRow,
  PartnerActivityRow,
  PartnerPmAlert,
} from '@/types/fleet-pro-partner'

export const dynamic = 'force-dynamic'

// ─── Row shapes as they come back from PostgREST ──────────────────────────────

interface AccountRecord {
  id:                              string
  fleet_name:                      string | null
  fleet_pro_enabled:               boolean | null
  fleet_pro_status:                string | null
  fleet_pro_stripe_subscription_id: string | null
}

interface ResellerRecord { fleet_account_id: string; brand_name: string | null; brand_logo_url: string | null }
interface UnitRecord     { id: string; fleet_account_id: string | null; unit_number: string | null; active: boolean | null }
interface MemberRecord   { fleet_account_id: string | null }
interface PmRecord       { fleet_account_id: string | null; unit_id: string | null; next_due_date: string | null }

interface WorkOrderRecord {
  fleet_account_id:  string | null
  unit_id:           string | null
  work_order_number: string | null
  service_type:      string | null
  status:            string | null
  total_amount:      number | null
  completed_at:      string | null
  created_at:        string | null
}

interface InvoiceRecord {
  fleet_account_id: string | null
  unit_id:          string | null
  invoice_number:   string | null
  total:            number | null
  status:           string | null
  created_at:       string | null
}

interface PretripRecord {
  fleet_account_id: string | null
  unit_id:          string | null
  driver_name:      string | null
  inspection_date:  string | null
  overall_result:   string | null
  defects:          unknown
}

interface InspectionRecord {
  fleet_account_id: string | null
  unit_id:          string | null
  inspection_date:  string | null
  overall_result:   string | null
}

// PostgREST caps an unbounded select at its own default; ask for a ceiling high
// enough that a partner running nine fleets does not get silently truncated.
const ROW_CEILING   = 20_000
const ACTIVITY_CAP  = 25
const PM_ALERT_CAP  = 25
const DUE_SOON_DAYS = 30

function dateKey(d: Date): string {
  const m   = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Whole days from `today` to `due`, both YYYY-MM-DD. Midday pins it clear of DST. */
function daysUntil(due: string, today: string): number {
  const a = Date.parse(`${due.slice(0, 10)}T12:00:00Z`)
  const b = Date.parse(`${today}T12:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((a - b) / 86_400_000)
}

/** Keep whichever ISO date/timestamp is later; both arrive as sortable strings. */
function later(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

function money(n: number): number {
  return Math.round(n * 100) / 100
}

// GET /api/fleet-pro/partner/dashboard — every fleet this partner resells, rolled
// up: units, members, PM standing, open defects, revenue and recent activity.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requirePartner(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { partner } = gate

  // The ONLY source of fleet ids. Never read one from the request — this resolved
  // list is what stands between one partner and another partner's customers.
  const fleetIds = await getPartnerFleetIds(partner.id)

  const empty: PartnerDashboard = {
    partner_name:      partner.partner_name,
    fleet_count:       0,
    total_units:       0,
    revenue_mtd:       0,
    revenue_ytd:       0,
    overdue_pm_total:  0,
    due_soon_pm_total: 0,
    monthly_cost:      0,
    fleets:            [],
    recent_activity:   [],
    pm_alerts:         [],
  }

  // A partner with no accounts yet is a normal state, not an error — the dashboard
  // renders its "add your first" empty state off this.
  if (fleetIds.length === 0) return NextResponse.json({ dashboard: empty })

  const svc = createServiceClient()

  const now        = new Date()
  const today      = dateKey(now)
  const monthStart = dateKey(new Date(now.getFullYear(), now.getMonth(), 1))
  const yearStart  = `${now.getFullYear()}-01-01`

  const [accountRes, brandRes, unitRes, memberRes, pmRes, woRes, invRes, pretripRes, dotRes, aerialRes] =
    await Promise.all([
      svc.from('hd_fleet_accounts')
        .select('id, fleet_name, fleet_pro_enabled, fleet_pro_status, fleet_pro_stripe_subscription_id')
        .in('id', fleetIds),

      svc.from('fleet_pro_reseller_accounts')
        .select('fleet_account_id, brand_name, brand_logo_url')
        .eq('partner_id', partner.id),

      svc.from('hd_units')
        .select('id, fleet_account_id, unit_number, active')
        .in('fleet_account_id', fleetIds)
        .limit(ROW_CEILING),

      svc.from('fleet_pro_members')
        .select('fleet_account_id')
        .in('fleet_account_id', fleetIds)
        .eq('status', 'active')
        .limit(ROW_CEILING),

      svc.from('fleet_pro_pm_schedules')
        .select('fleet_account_id, unit_id, next_due_date')
        .in('fleet_account_id', fleetIds)
        .limit(ROW_CEILING),

      svc.from('hd_work_orders')
        .select('fleet_account_id, unit_id, work_order_number, service_type, status, total_amount, completed_at, created_at')
        .in('fleet_account_id', fleetIds)
        .order('created_at', { ascending: false })
        .limit(ROW_CEILING),

      // hd_invoices has no invoice_date; created_at is the billing timestamp. Held
      // to the current year because that is the widest window either revenue figure
      // needs, and the activity feed only ever shows the newest 25 anyway.
      svc.from('hd_invoices')
        .select('fleet_account_id, unit_id, invoice_number, total, status, created_at')
        .in('fleet_account_id', fleetIds)
        .gte('created_at', yearStart)
        .order('created_at', { ascending: false })
        .limit(ROW_CEILING),

      svc.from('fleet_pro_pretrip_inspections')
        .select('fleet_account_id, unit_id, driver_name, inspection_date, overall_result, defects')
        .in('fleet_account_id', fleetIds)
        .order('inspection_date', { ascending: false })
        .limit(ROW_CEILING),

      svc.from('hd_dot_inspections')
        .select('fleet_account_id, unit_id, inspection_date, overall_result')
        .in('fleet_account_id', fleetIds)
        .order('inspection_date', { ascending: false })
        .limit(ACTIVITY_CAP),

      svc.from('hd_aerial_inspections')
        .select('fleet_account_id, unit_id, inspection_date, overall_result')
        .in('fleet_account_id', fleetIds)
        .order('inspection_date', { ascending: false })
        .limit(ACTIVITY_CAP),
    ])

  const failed = [accountRes, brandRes, unitRes, memberRes, pmRes, woRes, invRes, pretripRes, dotRes, aerialRes]
    .find(r => r.error)
  if (failed?.error) {
    console.error('[fleet-pro/partner/dashboard]', failed.error)
    return NextResponse.json({ error: failed.error.message }, { status: 500 })
  }

  const accounts = (accountRes.data ?? []) as AccountRecord[]

  // Branding and fleet name, resolved once so every row and every activity entry
  // reads with the same label the customer sees on their own portal.
  const brandByFleet = new Map<string, ResellerRecord>()
  for (const r of (brandRes.data ?? []) as ResellerRecord[]) brandByFleet.set(r.fleet_account_id, r)

  const nameByFleet = new Map<string, string>()
  for (const a of accounts) {
    nameByFleet.set(a.id, brandByFleet.get(a.id)?.brand_name ?? a.fleet_name ?? 'Fleet account')
  }

  // ─── Units ──────────────────────────────────────────────────────────────────
  const units       = (unitRes.data ?? []) as UnitRecord[]
  const unitNumbers = new Map<string, string>()
  const unitCounts  = new Map<string, number>()
  for (const u of units) {
    unitNumbers.set(u.id, u.unit_number ?? 'Unit')
    // Retired units keep their name in the lookup (old invoices still point at them)
    // but must not inflate the count the partner is billing against.
    if (u.active === false) continue
    if (!u.fleet_account_id) continue
    unitCounts.set(u.fleet_account_id, (unitCounts.get(u.fleet_account_id) ?? 0) + 1)
  }

  const memberCounts = new Map<string, number>()
  for (const m of (memberRes.data ?? []) as MemberRecord[]) {
    if (!m.fleet_account_id) continue
    memberCounts.set(m.fleet_account_id, (memberCounts.get(m.fleet_account_id) ?? 0) + 1)
  }

  // ─── PM standing ────────────────────────────────────────────────────────────
  const overdueCounts  = new Map<string, number>()
  const dueSoonCounts  = new Map<string, number>()
  const pmAlerts: PartnerPmAlert[] = []

  for (const pm of (pmRes.data ?? []) as PmRecord[]) {
    if (!pm.fleet_account_id || !pm.unit_id || !pm.next_due_date) continue
    const days = daysUntil(pm.next_due_date, today)
    if (days > DUE_SOON_DAYS) continue

    const overdue = days < 0
    const bucket  = overdue ? overdueCounts : dueSoonCounts
    bucket.set(pm.fleet_account_id, (bucket.get(pm.fleet_account_id) ?? 0) + 1)

    pmAlerts.push({
      fleet_account_id: pm.fleet_account_id,
      fleet_name:       nameByFleet.get(pm.fleet_account_id) ?? 'Fleet account',
      unit_id:          pm.unit_id,
      unit_number:      unitNumbers.get(pm.unit_id) ?? 'Unit',
      next_due_date:    pm.next_due_date.slice(0, 10),
      days_until_due:   days,
      overdue,
    })
  }

  // Most overdue first: the whole point of the panel is triage.
  pmAlerts.sort((a, b) => a.days_until_due - b.days_until_due)

  // ─── Revenue and last service ───────────────────────────────────────────────
  const mtdByFleet         = new Map<string, number>()
  const ytdByFleet         = new Map<string, number>()
  const lastServiceByFleet = new Map<string, string>()

  for (const wo of (woRes.data ?? []) as WorkOrderRecord[]) {
    if (!wo.fleet_account_id) continue
    const when = wo.completed_at ?? wo.created_at
    if (!when) continue
    const best = later(lastServiceByFleet.get(wo.fleet_account_id) ?? null, when)
    if (best) lastServiceByFleet.set(wo.fleet_account_id, best)
  }

  const invoices = (invRes.data ?? []) as InvoiceRecord[]
  for (const inv of invoices) {
    // Filtered here rather than with .neq() because PostgREST's neq also drops NULL
    // statuses, which are real unpaid invoices.
    if (!inv.fleet_account_id || inv.status === 'void' || !inv.created_at) continue
    const amount = Number(inv.total ?? 0)
    if (!Number.isFinite(amount)) continue
    ytdByFleet.set(inv.fleet_account_id, (ytdByFleet.get(inv.fleet_account_id) ?? 0) + amount)
    if (inv.created_at >= monthStart) {
      mtdByFleet.set(inv.fleet_account_id, (mtdByFleet.get(inv.fleet_account_id) ?? 0) + amount)
    }
  }

  // ─── Open defects ───────────────────────────────────────────────────────────
  const pretrips     = (pretripRes.data ?? []) as PretripRecord[]
  const defectCounts = new Map<string, number>()
  for (const p of pretrips) {
    if (!p.fleet_account_id || p.overall_result !== 'fail') continue
    defectCounts.set(p.fleet_account_id, (defectCounts.get(p.fleet_account_id) ?? 0) + 1)
  }

  // ─── Fleet rows ─────────────────────────────────────────────────────────────
  const fleets: PartnerFleetRow[] = accounts.map(a => {
    const brand = brandByFleet.get(a.id)
    const last  = lastServiceByFleet.get(a.id) ?? null
    return {
      fleet_account_id:  a.id,
      fleet_name:        a.fleet_name ?? 'Fleet account',
      brand_name:        brand?.brand_name ?? a.fleet_name ?? 'Fleet account',
      brand_logo_url:    brand?.brand_logo_url ?? null,
      fleet_pro_enabled: a.fleet_pro_enabled === true,
      fleet_pro_status:  a.fleet_pro_status ?? null,
      has_subscription:  !!a.fleet_pro_stripe_subscription_id,

      unit_count:        unitCounts.get(a.id)    ?? 0,
      member_count:      memberCounts.get(a.id)  ?? 0,
      overdue_pm_count:  overdueCounts.get(a.id) ?? 0,
      due_soon_pm_count: dueSoonCounts.get(a.id) ?? 0,
      open_defect_count: defectCounts.get(a.id)  ?? 0,

      revenue_mtd:       money(mtdByFleet.get(a.id) ?? 0),
      revenue_ytd:       money(ytdByFleet.get(a.id) ?? 0),
      last_service_date: last ? last.slice(0, 10) : null,
    }
  })

  // Fleets in trouble sort to the top; the rest alphabetically by the brand the
  // partner actually calls them.
  fleets.sort((a, b) =>
    b.overdue_pm_count - a.overdue_pm_count ||
    b.open_defect_count - a.open_defect_count ||
    a.brand_name.localeCompare(b.brand_name, 'en', { numeric: true }),
  )

  // ─── Recent activity ────────────────────────────────────────────────────────
  // Every stream carries fleet_name and unit_number so a row reads as "which fleet,
  // which truck" without the client having to join anything back together.
  const activity: { sort: string; row: PartnerActivityRow }[] = []

  function push(
    fleetId: string | null,
    unitId: string | null,
    when: string | null,
    kind: PartnerActivityRow['kind'],
    title: string,
    amount: number | null,
    result: string | null,
  ) {
    if (!fleetId || !when) return
    activity.push({
      sort: when,
      row: {
        fleet_account_id: fleetId,
        fleet_name:       nameByFleet.get(fleetId) ?? 'Fleet account',
        unit_id:          unitId,
        unit_number:      unitId ? unitNumbers.get(unitId) ?? null : null,
        kind,
        date:             when.slice(0, 10),
        title,
        amount,
        result,
      },
    })
  }

  for (const wo of (woRes.data ?? []) as WorkOrderRecord[]) {
    const amount = Number(wo.total_amount ?? 0)
    const label  = wo.service_type || 'Work order'
    push(
      wo.fleet_account_id,
      wo.unit_id,
      wo.completed_at ?? wo.created_at,
      'work_order',
      wo.work_order_number ? `${label} #${wo.work_order_number}` : label,
      Number.isFinite(amount) && amount > 0 ? money(amount) : null,
      wo.status ?? null,
    )
  }

  for (const inv of invoices) {
    if (inv.status === 'void') continue
    const amount = Number(inv.total ?? 0)
    push(
      inv.fleet_account_id,
      inv.unit_id,
      inv.created_at,
      'invoice',
      inv.invoice_number ? `Invoice ${inv.invoice_number}` : 'Invoice',
      Number.isFinite(amount) ? money(amount) : null,
      inv.status ?? null,
    )
  }

  for (const p of pretrips) {
    const defectCount = Array.isArray(p.defects) ? p.defects.length : 0
    push(
      p.fleet_account_id,
      p.unit_id,
      p.inspection_date,
      'pretrip',
      p.driver_name ? `Pre-trip — ${p.driver_name}` : 'Pre-trip inspection',
      null,
      p.overall_result === 'fail' ? `fail (${defectCount})` : (p.overall_result ?? null),
    )
  }

  for (const d of (dotRes.data ?? []) as InspectionRecord[]) {
    push(d.fleet_account_id, d.unit_id, d.inspection_date, 'dot_inspection', 'DOT inspection', null, d.overall_result ?? null)
  }

  for (const a of (aerialRes.data ?? []) as InspectionRecord[]) {
    push(a.fleet_account_id, a.unit_id, a.inspection_date, 'aerial_inspection', 'Aerial inspection', null, a.overall_result ?? null)
  }

  activity.sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0))

  // ─── Totals ─────────────────────────────────────────────────────────────────
  const billedFleets = fleets.filter(f => f.fleet_pro_enabled).length

  const dashboard: PartnerDashboard = {
    partner_name:      partner.partner_name,
    fleet_count:       fleets.length,
    total_units:       fleets.reduce((n, f) => n + f.unit_count, 0),
    revenue_mtd:       money(fleets.reduce((n, f) => n + f.revenue_mtd, 0)),
    revenue_ytd:       money(fleets.reduce((n, f) => n + f.revenue_ytd, 0)),
    overdue_pm_total:  fleets.reduce((n, f) => n + f.overdue_pm_count, 0),
    due_soon_pm_total: fleets.reduce((n, f) => n + f.due_soon_pm_count, 0),
    monthly_cost:      money((billedFleets * FLEET_PRO_MONTHLY_CENTS) / 100),
    fleets,
    recent_activity:   activity.slice(0, ACTIVITY_CAP).map(a => a.row),
    pm_alerts:         pmAlerts.slice(0, PM_ALERT_CAP),
  }

  return NextResponse.json({ dashboard })
}
