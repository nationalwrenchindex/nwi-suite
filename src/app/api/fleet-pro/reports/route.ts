import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { canViewCosts } from '@/types/fleet-pro'
import type { FleetProReport, MonthTotal } from '@/types/fleet-pro'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

export const dynamic = 'force-dynamic'

// ─── Row shapes as they come back from PostgREST ──────────────────────────────

interface UnitRecord    { id: string; unit_number: string | null }
interface InvoiceRecord { unit_id: string | null; total: number | null; status: string | null; created_at: string | null }

// NO ROW CEILING. This is a budget submission: PostgREST stops at 1,000 rows and
// still answers 200, so a `.limit(20_000)` did not widen anything — it just made the
// truncation look intentional. A county past 1,000 invoices in the window was being
// handed a grand total short of what it actually spent. Both queries page instead.

// Invoices billed before migration 102 linked work orders to units have unit_id NULL
// and cannot be attributed to any truck. They are still real money the county spent,
// so they land in this bucket instead of being dropped: a budget report that quietly
// loses spend is worse than one that shows it as unassigned.
const UNASSIGNED_ID    = '__unassigned__'
const UNASSIGNED_LABEL = 'Unassigned'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True only for a real calendar date in YYYY-MM-DD form (rejects 2026-02-31). */
function isValidDate(s: string | null): s is string {
  if (!s || !DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** The day after `s`, in YYYY-MM-DD — used as an exclusive upper bound. */
function nextDay(s: string): string {
  const d = new Date(`${s}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function dateKey(d: Date): string {
  const m   = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Every YYYY-MM from `from` through `to` inclusive, so zero-spend months still get a column. */
function monthsBetween(from: string, to: string): string[] {
  const out = new Set<string>()
  let year  = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))
  const endYear  = Number(to.slice(0, 4))
  const endMonth = Number(to.slice(5, 7))

  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.add(`${year}-${String(month).padStart(2, '0')}`)
    month++
    if (month > 12) { month = 1; year++ }
  }
  return [...out]
}

const round2 = (n: number) => Math.round(n * 100) / 100

// GET /api/fleet-pro/reports?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
//
// Per-unit spend by month for county budget submissions. The whole payload is cost
// data, so read-only viewers are refused outright rather than handed a redacted copy.
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProMember(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { membership } = gate
  if (!canViewCosts(membership.role)) {
    return NextResponse.json(
      { error: 'Cost reporting requires supervisor or manager access' },
      { status: 403 },
    )
  }

  const fleetId = membership.fleet_account_id

  // Default window: Jan 1 of the current year through today.
  const now       = new Date()
  const params    = new URL(request.url).searchParams
  const rawFrom   = params.get('from_date')
  const rawTo     = params.get('to_date')
  const fromDate  = rawFrom ?? `${now.getFullYear()}-01-01`
  const toDate    = rawTo   ?? dateKey(now)

  if (!isValidDate(fromDate) || !isValidDate(toDate)) {
    return NextResponse.json({ error: 'from_date and to_date must be YYYY-MM-DD' }, { status: 400 })
  }
  if (fromDate > toDate) {
    return NextResponse.json({ error: 'from_date must be on or before to_date' }, { status: 400 })
  }

  // Service client from here down: RLS on hd_invoices routes through
  // fleet_pro_account_ids(), so every query is scoped to the resolved fleet id
  // instead — never to anything supplied by the request.
  const svc = createServiceClient()

  // `id` is the ORDER BY on both: range paging is a LIMIT/OFFSET window and needs a
  // total order, neither query had a sort worth preserving, and the report does its
  // own sorting in memory further down.
  let units: UnitRecord[], invoiceRows: InvoiceRecord[]

  try {
    [units, invoiceRows] = await Promise.all([
      fetchAllRows<UnitRecord>((from, to) =>
        svc.from('hd_units')
          .select('id, unit_number')
          .eq('fleet_account_id', fleetId)
          .order('id', { ascending: true })
          .range(from, to)),

      // hd_invoices has no invoice_date column; created_at is the billing timestamp.
      // to_date is inclusive, so the bound is an exclusive `< the following midnight`
      // rather than a lte on 23:59:59, which would drop the final second of the range.
      fetchAllRows<InvoiceRecord>((from, to) =>
        svc.from('hd_invoices')
          .select('unit_id, total, status, created_at')
          .eq('fleet_account_id', fleetId)
          .gte('created_at', `${fromDate}T00:00:00Z`)
          .lt('created_at', `${nextDay(toDate)}T00:00:00Z`)
          .order('id', { ascending: true })
          .range(from, to)),
    ])
  } catch (err) {
    // The same 500 the error check used to produce: the pager throws rather than
    // returning the short list that made this report under-report spend.
    console.error('[fleet-pro/reports]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to build the report' },
      { status: 500 },
    )
  }

  const unitNumbers = new Map<string, string>()
  for (const u of units) {
    unitNumbers.set(u.id, u.unit_number ?? '(no number)')
  }

  const months    = monthsBetween(fromDate, toDate)
  const monthSet  = new Set(months)

  const byUnit       = new Map<string, Map<string, number>>()
  const unitTotals   = new Map<string, number>()
  const monthCost    = new Map<string, number>()
  const monthCount   = new Map<string, number>()
  let grandTotal     = 0
  let invoiceCount   = 0

  for (const inv of invoiceRows) {
    // Voids are filtered here rather than with .neq() because PostgREST's neq also
    // drops NULL statuses, which are real unpaid invoices.
    if (inv.status === 'void' || !inv.created_at) continue
    const month = inv.created_at.slice(0, 7)
    if (!monthSet.has(month)) continue

    const amount = Number(inv.total ?? 0)
    if (!Number.isFinite(amount)) continue

    const key = inv.unit_id ?? UNASSIGNED_ID

    let row = byUnit.get(key)
    if (!row) { row = new Map<string, number>(); byUnit.set(key, row) }
    row.set(month, (row.get(month) ?? 0) + amount)

    unitTotals.set(key, (unitTotals.get(key) ?? 0) + amount)
    monthCost.set(month, (monthCost.get(month) ?? 0) + amount)
    monthCount.set(month, (monthCount.get(month) ?? 0) + 1)
    grandTotal += amount
    invoiceCount++
  }

  const perUnit = [...byUnit.entries()].map(([unitId, row]) => {
    const by_month: Record<string, number> = {}
    for (const month of months) by_month[month] = round2(row.get(month) ?? 0)
    return {
      unit_id:     unitId,
      unit_number: unitId === UNASSIGNED_ID
        ? UNASSIGNED_LABEL
        : unitNumbers.get(unitId) ?? '(unknown unit)',
      by_month,
      total:       round2(unitTotals.get(unitId) ?? 0),
    }
  })

  // Units sort naturally; the Unassigned bucket sinks to the bottom of the matrix
  // so it reads as a footnote rather than as a truck.
  perUnit.sort((a, b) => {
    if (a.unit_id === UNASSIGNED_ID) return 1
    if (b.unit_id === UNASSIGNED_ID) return -1
    return a.unit_number.localeCompare(b.unit_number, 'en', { numeric: true })
  })

  const by_month: MonthTotal[] = months.map(month => ({
    month,
    invoice_count: monthCount.get(month) ?? 0,
    cost:          round2(monthCost.get(month) ?? 0),
  }))

  const report: FleetProReport = {
    from_date:  fromDate,
    to_date:    toDate,
    fleet_name: membership.fleet_name,
    months,
    per_unit:   perUnit,
    by_month,
    grand_total: round2(grandTotal),
    invoice_count: invoiceCount,
  }

  return NextResponse.json({ report })
}
