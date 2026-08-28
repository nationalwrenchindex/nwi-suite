import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import HDFinancialsClient from '@/components/hd/HDFinancialsClient'
import QuickBooksExport from '@/components/hd/QuickBooksExport'

export const metadata = { title: 'Financials — NWI HD Suite' }

// Local calendar date as YYYY-MM-DD.
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The day after `date`, at UTC midnight. The period's upper bound is an exclusive
// `< nextDay` rather than an inclusive `<= to 23:59:59.999`, so an invoice written in
// the last millisecond of the final day cannot fall through the gap. Copied from the
// same helper in /api/hd/financials/summary on purpose — see the note on the queries.
function nextDayUTC(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export default async function HDFinancialsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasStarterAccess = await checkHDStarterAccess(user.id)
  if (!hasStarterAccess) redirect('/hd/upgrade')

  const params = await searchParams
  const now    = new Date()

  const periodParam = typeof params.period === 'string' ? params.period : 'mtd'
  let periodStart: Date
  let periodLabel: string
  if (periodParam === 'ytd') {
    periodStart = new Date(now.getFullYear(), 0, 1)
    periodLabel = `YTD ${now.getFullYear()}`
  } else if (periodParam === '90d') {
    periodStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    periodLabel = 'Last 90 Days'
  } else {
    periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
    periodLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  // ── Period bounds ────────────────────────────────────────────────────────────
  // Built from the LOCAL calendar date and then read as UTC, which is exactly what
  // HDFinancialsClient sends as from_date/to_date to /api/hd/financials/summary.
  // periodStart.toISOString() would shift by the timezone offset, and the Revenue
  // card and the COST & MARGIN block would silently cover windows a few hours apart.
  const periodFrom = `${ymd(periodStart)}T00:00:00.000Z`
  const periodTo   = `${nextDayUTC(ymd(now))}T00:00:00.000Z`

  // Effective job date for a work order: completed_at when it is set, created_at when
  // it is not. A bare `.gte('completed_at', …)` renders as SQL `>=`, which is NULL-
  // propagating — a completed work order with no completion timestamp evaluates to
  // NULL, not true, and vanishes from EVERY period including YTD. There is at least
  // one such row in production. Falling back to created_at places the job in a real
  // period instead; the alternative, `completed_at.is.null` with no date test, would
  // count that row in every period at once.
  const jobWindow = `completed_at.gte."${periodFrom}",and(completed_at.is.null,created_at.gte."${periodFrom}")`

  const [
    { data: periodInvoices },
    { data: invoicedWOs },
    { data: allWOs },
    { data: laborRateRow },
    { data: outstandingWOs },
  ] = await Promise.all([
    // BILLING — hd_invoices. This is where the page's revenue number comes from, and
    // it is the SAME table, date column and void rule the summary endpoint uses, so
    // the Revenue card and the COST & MARGIN block below it cannot disagree.
    //
    // It used to be sourced from hd_work_orders.total_amount filtered on completed_at,
    // which is why the page could show $0 revenue next to a $349 cost-and-margin
    // block: 860 invoiced work orders exist but the newest completed_at is months old,
    // while the invoice itself was written this week. An invoice is the billing event;
    // a work order is the job. They are different questions and they get different
    // cards from here on.
    supabase
      .from('hd_invoices')
      .select('id, status, total, tax_amount, created_at')
      .eq('user_id', user.id)
      .gte('created_at', periodFrom)
      .lt('created_at',  periodTo),

    // JOBS — labor hours actually billed out, for the labor-efficiency panel.
    supabase
      .from('hd_work_orders')
      .select('id, total_amount, labor_hours, labor_minutes, service_type, fleet_account_id, completed_at')
      .eq('user_id', user.id)
      .eq('status', 'invoiced')
      .or(jobWindow)
      .order('completed_at', { ascending: false, nullsFirst: false }),

    // JOBS — everything closed in the period, for job counts and the account mix.
    supabase
      .from('hd_work_orders')
      .select('id, total_amount, service_type, fleet_account_id, completed_at')
      .eq('user_id', user.id)
      .in('status', ['completed', 'invoiced'])
      .or(jobWindow),

    supabase
      .from('profiles')
      .select('hd_labor_rate')
      .eq('id', user.id)
      .single(),

    // JOBS — the backlog: work finished but never billed. Deliberately NOT period
    // bounded (a job completed in March is still unbilled money today) and no longer
    // capped at 20 rows: the cap was only ever a display limit, but the rows are
    // summed, so it quietly reported the oldest 20 jobs' worth of a longer backlog.
    supabase
      .from('hd_work_orders')
      .select('id, total_amount')
      .eq('user_id', user.id)
      .eq('status', 'completed'),
  ])

  // Voids are dropped HERE, in JS, rather than with `.neq('status', 'void')`.
  // PostgREST renders neq as SQL `<>`, which is NULL-propagating: an invoice whose
  // status is NULL evaluates to NULL and is filtered out alongside the voids. Those
  // rows are real unpaid invoices and dropping them understates revenue. Same
  // reasoning as the comment in /api/financials/tax-summary and in the HD summary
  // endpoint — and the whole point of Fix 2 is that this page and that endpoint
  // apply identical rules.
  const invoices = (periodInvoices ?? []).filter(inv => inv.status !== 'void')

  // hd_invoices.total is what was INVOICED and the HD invoice form builds it as
  // taxBase + taxAmount, so the tax is inside it. Revenue is therefore total minus
  // tax: sales tax is collected for the state and remitted to it, it is not earnings,
  // and it must not appear in revenue, in net profit or in gross margin. It is
  // reported on its own card instead. invoiceRevenue + taxCollected = amount invoiced.
  const taxCollected    = invoices.reduce((s, i) => s + Number(i.tax_amount ?? 0), 0)
  const invoiceRevenue  = invoices.reduce((s, i) => s + Number(i.total ?? 0), 0) - taxCollected
  const invoiceCount    = invoices.length

  const hourlyRate = Number(laborRateRow?.hd_labor_rate ?? 125)

  // JOB figures. Named for what they measure so nothing downstream can mistake one of
  // these for the billing revenue above. jobsTotal is the value of work closed in the
  // period; invoicedJobsTotal is the subset that has been handed to invoicing.
  const jobsTotal         = (allWOs ?? []).reduce((s, w) => s + Number(w.total_amount ?? 0), 0)
  const invoicedJobsTotal = (invoicedWOs ?? []).reduce((s, w) => s + Number(w.total_amount ?? 0), 0)
  const closedCount       = (allWOs ?? []).length
  const avgJobValue       = closedCount > 0 ? jobsTotal / closedCount : 0
  const outstandingTotal  = (outstandingWOs ?? []).reduce((s, w) => s + Number(w.total_amount ?? 0), 0)

  const byAccount: Record<string, { name: string; revenue: number; count: number }> = {}
  for (const wo of allWOs ?? []) {
    const key = (wo.fleet_account_id as string) ?? '__none__'
    if (!byAccount[key]) byAccount[key] = { name: key === '__none__' ? 'No Account' : key, revenue: 0, count: 0 }
    byAccount[key].revenue += Number(wo.total_amount ?? 0)
    byAccount[key].count   += 1
  }

  const accountIds = Object.keys(byAccount).filter(k => k !== '__none__')
  const { data: accounts } = accountIds.length > 0
    ? await supabase.from('hd_fleet_accounts').select('id, fleet_name').in('id', accountIds)
    : { data: [] }

  for (const acct of accounts ?? []) {
    if (byAccount[acct.id]) byAccount[acct.id].name = acct.fleet_name as string
  }

  const accountRows = Object.values(byAccount).sort((a, b) => b.revenue - a.revenue).slice(0, 8)

  const totalLaborHours = (invoicedWOs ?? []).reduce((s, w) => {
    return s + Number(w.labor_hours ?? 0) + Number(w.labor_minutes ?? 0) / 60
  }, 0)
  const laborRevenue = totalLaborHours * hourlyRate
  // Measured against invoicedJobsTotal, not against the invoice revenue above. Both
  // sides of this ratio then come from the same set of work orders; dividing a
  // work-order-derived labor figure by an hd_invoices figure would compare two
  // different populations and produce percentages over 100 whenever they drift apart.
  const laborPct     = invoicedJobsTotal > 0 ? (laborRevenue / invoicedJobsTotal) * 100 : 0

  return (
    <main className="flex-1 p-4 sm:p-6 space-y-6">

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">FINANCIALS</h1>
        </div>
      </div>

      <HDFinancialsClient stats={{
        // Billing — hd_invoices, bounded on created_at, voids excluded.
        invoiceRevenue,
        taxCollected,
        invoiceCount,
        // Jobs — hd_work_orders, bounded on the effective job date.
        jobsTotal,
        invoicedJobsTotal,
        outstandingTotal,
        avgJobValue,
        totalLaborHours,
        laborRevenue,
        laborPct,
        hourlyRate,
        closedCount,
        accountRows,
        periodLabel,
        periodParam,
      }} />

      {/* Accountant hand-off. Sits outside the tabbed client because it owns its own
          date range — the page period toggle above does not apply to it. */}
      <QuickBooksExport />
    </main>
  )
}
