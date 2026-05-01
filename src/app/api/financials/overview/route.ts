import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { DayBreakdown, WeekBreakdown } from '@/types/financials'

// Monday-start ISO week
function isoWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const dow = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() - (dow - 1))
  return d.toISOString().slice(0, 10)
}

// ─── GET /api/financials/overview ─────────────────────────────────────────────
// Query params:
//   from_date + to_date  (YYYY-MM-DD) — explicit range (takes priority)
//   month                (YYYY-MM)    — shorthand; computes from/to automatically
// Returns: revenue totals, COGS, margins, per-job averages, time variance,
//          daily + weekly breakdowns, invoice counts
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams

  let fromDate: string
  let toDate: string

  if (sp.has('from_date') && sp.has('to_date')) {
    fromDate = sp.get('from_date')!
    toDate   = sp.get('to_date')!
  } else {
    const month = sp.get('month') ?? new Date().toISOString().slice(0, 7)
    const [yearStr, monStr] = month.split('-')
    const year = Number(yearStr), mon = Number(monStr)
    fromDate = `${month}-01`
    const lastDay = new Date(year, mon, 0).getDate()
    toDate = `${month}-${String(lastDay).padStart(2, '0')}`
  }

  const COGS_CATEGORIES = new Set(['parts_cogs', 'shop_supplies'])

  const [invResult, expResult, jobsResult, timeJobsResult] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, total, status, net_profit, cogs_total, invoice_date')
      .eq('user_id', user.id)
      .gte('invoice_date', fromDate)
      .lte('invoice_date', toDate),

    supabase
      .from('expenses')
      .select('id, amount, category, transaction_type, expense_date')
      .eq('user_id', user.id)
      .gte('expense_date', fromDate)
      .lte('expense_date', toDate),

    supabase
      .from('jobs')
      .select('service_type, job_date')
      .eq('user_id', user.id)
      .gte('job_date', fromDate)
      .lte('job_date', toDate)
      .neq('status', 'cancelled'),

    supabase
      .from('jobs')
      .select('estimated_duration_minutes, actual_start_at, actual_end_at')
      .eq('user_id', user.id)
      .gte('job_date', fromDate)
      .lte('job_date', toDate)
      .not('actual_start_at', 'is', null)
      .not('actual_end_at', 'is', null)
      .not('estimated_duration_minutes', 'is', null),
  ])

  if (invResult.error)  return NextResponse.json({ error: invResult.error.message },  { status: 500 })
  if (expResult.error)  return NextResponse.json({ error: expResult.error.message },  { status: 500 })
  if (jobsResult.error) return NextResponse.json({ error: jobsResult.error.message }, { status: 500 })

  const invoices  = invResult.data  ?? []
  const expenses  = expResult.data  ?? []
  const jobs      = jobsResult.data ?? []
  const timeJobs  = timeJobsResult.data ?? []

  const paidInvoices    = invoices.filter(i => i.status === 'paid')
  const overdueInvoices = invoices.filter(i => i.status === 'overdue')

  const revenue_total = paidInvoices.reduce((s, i) => s + Number(i.total), 0)

  const cogsExpenses      = expenses.filter(e => COGS_CATEGORIES.has(e.category) && e.transaction_type === 'auto_invoice')
  const operatingExpenses = expenses.filter(e => !(COGS_CATEGORIES.has(e.category) && e.transaction_type === 'auto_invoice'))

  const cogs_total         = cogsExpenses.reduce((s, e) => s + Number(e.amount), 0)
  const operating_expenses = operatingExpenses.reduce((s, e) => s + Number(e.amount), 0)
  const expense_total      = cogs_total + operating_expenses

  const gross_profit  = revenue_total - cogs_total
  const gross_margin  = revenue_total > 0 ? (gross_profit / revenue_total) * 100 : 0
  const net_profit    = gross_profit - operating_expenses
  const profit_margin = revenue_total > 0 ? (net_profit / revenue_total) * 100 : 0

  const avg_job_value = paidInvoices.length > 0 ? revenue_total / paidInvoices.length : 0

  const invoicesWithProfit = paidInvoices.filter(i => Number(i.net_profit) !== 0)
  const avg_job_profit = invoicesWithProfit.length > 0
    ? invoicesWithProfit.reduce((s, i) => s + Number(i.net_profit), 0) / invoicesWithProfit.length
    : 0

  const serviceCount = jobs.reduce<Record<string, number>>((acc, j) => {
    acc[j.service_type] = (acc[j.service_type] ?? 0) + 1
    return acc
  }, {})
  const top_service = Object.entries(serviceCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  // Estimate vs actual time variance
  let avg_time_variance: number | null = null
  if (timeJobs.length > 0) {
    const variances = timeJobs.map(j => {
      const actualMin = (new Date(j.actual_end_at as string).getTime() - new Date(j.actual_start_at as string).getTime()) / 60000
      return actualMin - Number(j.estimated_duration_minutes)
    })
    avg_time_variance = variances.reduce((s, v) => s + v, 0) / variances.length
  }

  // ── Daily breakdown ──────────────────────────────────────────────────────────
  const dayMap = new Map<string, { revenue: number; cogs: number; expenses: number; job_count: number }>()

  // Seed every date in range so zero-activity days are included
  const cur = new Date(fromDate + 'T12:00:00')
  const end = new Date(toDate   + 'T12:00:00')
  while (cur <= end) {
    dayMap.set(cur.toISOString().slice(0, 10), { revenue: 0, cogs: 0, expenses: 0, job_count: 0 })
    cur.setDate(cur.getDate() + 1)
  }

  for (const inv of paidInvoices) {
    const d = dayMap.get(inv.invoice_date)
    if (d) d.revenue += Number(inv.total)
  }
  for (const exp of expenses) {
    const d = dayMap.get(exp.expense_date)
    if (d) {
      if (COGS_CATEGORIES.has(exp.category) && exp.transaction_type === 'auto_invoice') {
        d.cogs += Number(exp.amount)
      } else {
        d.expenses += Number(exp.amount)
      }
    }
  }
  for (const job of jobs) {
    const d = dayMap.get(job.job_date)
    if (d) d.job_count++
  }

  const daily_breakdown: DayBreakdown[] = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({
      date,
      revenue:      d.revenue,
      cogs:         d.cogs,
      gross_profit: d.revenue - d.cogs,
      expenses:     d.expenses,
      net_profit:   d.revenue - d.cogs - d.expenses,
      job_count:    d.job_count,
    }))

  // ── Weekly breakdown ─────────────────────────────────────────────────────────
  const weekMap = new Map<string, { revenue: number; cogs: number; expenses: number; job_count: number }>()
  for (const d of daily_breakdown) {
    const wk = isoWeekStart(d.date)
    if (!weekMap.has(wk)) weekMap.set(wk, { revenue: 0, cogs: 0, expenses: 0, job_count: 0 })
    const w = weekMap.get(wk)!
    w.revenue   += d.revenue
    w.cogs      += d.cogs
    w.expenses  += d.expenses
    w.job_count += d.job_count
  }

  const weekly_breakdown: WeekBreakdown[] = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week_start, w]) => ({
      week_start,
      revenue:      w.revenue,
      cogs:         w.cogs,
      gross_profit: w.revenue - w.cogs,
      expenses:     w.expenses,
      net_profit:   w.revenue - w.cogs - w.expenses,
      job_count:    w.job_count,
    }))

  return NextResponse.json({
    overview: {
      period:               fromDate.slice(0, 7),
      from_date:            fromDate,
      to_date:              toDate,
      revenue_total,
      cogs_total,
      gross_profit,
      gross_margin,
      operating_expenses,
      expense_total,
      net_profit,
      profit_margin,
      avg_job_value,
      avg_job_profit,
      avg_time_variance,
      top_service,
      invoice_count:         invoices.length,
      paid_invoice_count:    paidInvoices.length,
      overdue_invoice_count: overdueInvoices.length,
      daily_breakdown,
      weekly_breakdown,
    },
  })
}
