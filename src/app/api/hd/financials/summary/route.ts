import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { marginPct } from '@/lib/hd/invoice-costing'

export const dynamic = 'force-dynamic'

function pad2(n: number) { return String(n).padStart(2, '0') }

// Every month between two YYYY-MM-DD dates, inclusive, so a month with no invoices
// still appears as a zero row instead of collapsing out of the table and making the
// period look shorter than it was.
function monthsBetween(fromDate: string, toDate: string): string[] {
  const out: string[] = []
  const [fy, fm] = fromDate.split('-').map(Number)
  const [ty, tm] = toDate.split('-').map(Number)
  let y = fy, m = fm
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${pad2(m)}`)
    if (++m > 12) { m = 1; y++ }
  }
  return out
}

// The day after `date`, in UTC, as YYYY-MM-DD. The upper bound of the range is an
// exclusive `< nextDay T00:00:00Z` rather than `<= to T23:59:59.999Z`, so an invoice
// created in the last millisecond of the final day cannot fall through the gap.
function nextDayUTC(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

interface Bucket {
  revenue:       number
  parts_revenue: number
  labor_revenue: number
  tax_collected: number
  cogs_total:    number
  // Revenue from the invoices whose cost we actually know. Gross profit is computed
  // against THIS, not against total revenue — see the honesty note below.
  known_revenue: number
  cogs_known:    number
  cogs_unknown:  number
  invoice_count: number
}

function emptyBucket(): Bucket {
  return {
    revenue: 0, parts_revenue: 0, labor_revenue: 0, tax_collected: 0,
    cogs_total: 0, known_revenue: 0, cogs_known: 0, cogs_unknown: 0, invoice_count: 0,
  }
}

// ─── GET /api/hd/financials/summary ───────────────────────────────────────────
// Query params:
//   from_date + to_date (YYYY-MM-DD) — defaults to Jan 1 of the current year → today
//
// Returns revenue split into parts and labor, cost of goods sold, gross profit and
// gross margin, plus a per-month breakdown. Vocabulary (cogs_total, gross_profit,
// gross_margin) deliberately matches /api/financials/overview so the LD and HD
// suites report in the same language — but the numbers are derived from HD's own
// data. LD gets COGS from auto_invoice expense rows; HD has no expense automation,
// so HD cost comes off the invoice itself (migration 119).
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const sp  = request.nextUrl.searchParams
  const now = new Date()
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`

  const fromDate = sp.get('from_date') ?? `${now.getFullYear()}-01-01`
  const toDate   = sp.get('to_date')   ?? today

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return NextResponse.json({ error: 'from_date and to_date must be YYYY-MM-DD' }, { status: 400 })
  }
  if (fromDate > toDate) {
    return NextResponse.json({ error: 'from_date must not be after to_date' }, { status: 400 })
  }

  // hd_invoices has no invoice_date column — created_at is the issue date, the same
  // substitution /api/financials/tax-summary makes.
  const { data, error } = await supabase
    .from('hd_invoices')
    .select('id, status, total, tax_amount, subtotal_parts, subtotal_labor, diagnostic_fee, road_call_fee, parts_cost, parts_sell, created_at')
    .eq('user_id', user.id)
    .gte('created_at', `${fromDate}T00:00:00.000Z`)
    .lt('created_at',  `${nextDayUTC(toDate)}T00:00:00.000Z`)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Voids are dropped HERE, in JS, and not with `.neq('status', 'void')`. PostgREST
  // renders neq as SQL `<>`, which is NULL-propagating: a row whose status is NULL
  // evaluates to NULL, not true, and is filtered out along with the voids. Those NULL
  // rows are real unpaid invoices, and dropping them silently understates revenue.
  // Same reasoning as the LD status handling in /api/financials/tax-summary.
  const invoices = (data ?? []).filter(inv => inv.status !== 'void')

  const months = monthsBetween(fromDate, toDate)
  const monthMap = new Map<string, Bucket>()
  for (const m of months) monthMap.set(m, emptyBucket())

  const period = emptyBucket()

  for (const inv of invoices) {
    const revenue = Number(inv.total ?? 0)

    // parts_sell is the authoritative parts revenue, but it is NULL on any invoice
    // written before migration 119 backfilled it. subtotal_parts is the same figure
    // as recorded by the invoice form, so it is a safe fallback — unlike cost, parts
    // revenue is never actually unknown.
    const partsRevenue = inv.parts_sell != null ? Number(inv.parts_sell) : Number(inv.subtotal_parts ?? 0)

    // Diagnostic and road-call fees are billed labor and sit inside `total`, so they
    // belong on the labor side; omitting them makes parts + labor fail to add up to
    // the invoice.
    const laborRevenue = Number(inv.subtotal_labor ?? 0)
                       + Number(inv.diagnostic_fee ?? 0)
                       + Number(inv.road_call_fee  ?? 0)

    // NULL parts_cost means "we do not know what these parts cost", NOT zero. It is
    // counted as unknown rather than folded in as free parts.
    const cost = inv.parts_cost != null ? Number(inv.parts_cost) : null

    const targets = [period, monthMap.get(String(inv.created_at).slice(0, 7))]
    for (const b of targets) {
      if (!b) continue
      b.invoice_count++
      b.revenue       += revenue
      b.parts_revenue += partsRevenue
      b.labor_revenue += laborRevenue
      b.tax_collected += Number(inv.tax_amount ?? 0)
      if (cost === null) {
        b.cogs_unknown++
      } else {
        b.cogs_known++
        b.cogs_total    += cost
        b.known_revenue += revenue
      }
    }
  }

  // HONESTY RULE: gross profit and gross margin are computed over ONLY the invoices
  // whose cost is known — cogs_total against known_revenue, never against total
  // revenue. Subtracting a partial COGS from the full revenue would report the
  // unknown-cost invoices as pure profit and overstate margin, and this is the number
  // a subscriber sets their prices from. When cogs_unknown > 0 the response says so
  // explicitly (cogs_partial, cogs_known, cogs_unknown, revenue_with_known_cost) so
  // the UI can qualify the figure as "based on N of M invoices" rather than printing
  // a bare percentage that looks like it covers everything.
  function shape(b: Bucket, key: { month: string } | { from_date: string; to_date: string }) {
    return {
      ...key,
      total_revenue:            round2(b.revenue),
      parts_revenue:            round2(b.parts_revenue),
      labor_revenue:            round2(b.labor_revenue),
      tax_collected:            round2(b.tax_collected),
      cogs_total:               b.cogs_known > 0 ? round2(b.cogs_total) : null,
      cogs_known:               b.cogs_known,
      cogs_unknown:             b.cogs_unknown,
      cogs_partial:             b.cogs_unknown > 0,
      revenue_with_known_cost:  round2(b.known_revenue),
      gross_profit:             b.cogs_known > 0 ? round2(b.known_revenue - b.cogs_total) : null,
      gross_margin:             b.cogs_known > 0 ? marginPct(b.known_revenue, b.cogs_total) : null,
      invoice_count:            b.invoice_count,
    }
  }

  return NextResponse.json({
    summary: {
      ...shape(period, { from_date: fromDate, to_date: toDate }),
      monthly_breakdown: months.map(m => shape(monthMap.get(m) ?? emptyBucket(), { month: m })),
    },
  })
}
