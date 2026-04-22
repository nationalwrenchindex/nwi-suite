import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ─── GET /api/financials/overview ─────────────────────────────────────────────
// Query params: month (YYYY-MM, defaults to current month)
// Returns: revenue totals, COGS, gross profit, operating expenses, net profit,
//          margins, per-job averages, invoice counts
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp    = request.nextUrl.searchParams
  const month = sp.get('month') ?? new Date().toISOString().slice(0, 7) // YYYY-MM

  const [yearStr, monStr] = month.split('-')
  const year = Number(yearStr)
  const mon  = Number(monStr)
  const fromDate = `${month}-01`
  const lastDay  = new Date(year, mon, 0).getDate()
  const toDate   = `${month}-${String(lastDay).padStart(2, '0')}`

  const [invResult, expResult, jobsResult] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, total, status, net_profit, cogs_total')
      .eq('user_id', user.id)
      .gte('invoice_date', fromDate)
      .lte('invoice_date', toDate),

    supabase
      .from('expenses')
      .select('id, amount, category, transaction_type')
      .eq('user_id', user.id)
      .gte('expense_date', fromDate)
      .lte('expense_date', toDate),

    supabase
      .from('jobs')
      .select('service_type')
      .eq('user_id', user.id)
      .gte('job_date', fromDate)
      .lte('job_date', toDate)
      .neq('status', 'cancelled'),
  ])

  if (invResult.error) {
    console.error('[GET /api/financials/overview] invoices error', invResult.error)
    return NextResponse.json({ error: invResult.error.message }, { status: 500 })
  }
  if (expResult.error) {
    console.error('[GET /api/financials/overview] expenses error', expResult.error)
    return NextResponse.json({ error: expResult.error.message }, { status: 500 })
  }
  if (jobsResult.error) {
    console.error('[GET /api/financials/overview] jobs error', jobsResult.error)
    return NextResponse.json({ error: jobsResult.error.message }, { status: 500 })
  }

  const invoices = invResult.data  ?? []
  const expenses = expResult.data  ?? []
  const jobs     = jobsResult.data ?? []

  const paidInvoices    = invoices.filter(i => i.status === 'paid')
  const overdueInvoices = invoices.filter(i => i.status === 'overdue')

  const revenue_total = paidInvoices.reduce((sum, i) => sum + Number(i.total), 0)

  // Split expenses into COGS (auto-generated from invoices) vs operating
  const COGS_CATEGORIES = new Set(['parts_cogs', 'shop_supplies'])
  const cogsExpenses = expenses.filter(e =>
    COGS_CATEGORIES.has(e.category) && e.transaction_type === 'auto_invoice'
  )
  const operatingExpenses = expenses.filter(e =>
    !(COGS_CATEGORIES.has(e.category) && e.transaction_type === 'auto_invoice')
  )

  const cogs_total        = cogsExpenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const operating_expenses = operatingExpenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const expense_total     = cogs_total + operating_expenses

  const gross_profit  = revenue_total - cogs_total
  const gross_margin  = revenue_total > 0 ? (gross_profit / revenue_total) * 100 : 0
  const net_profit    = gross_profit - operating_expenses
  const profit_margin = revenue_total > 0 ? (net_profit / revenue_total) * 100 : 0

  const avg_job_value  = paidInvoices.length > 0 ? revenue_total / paidInvoices.length : 0

  // Per-job profit: use cached net_profit on invoice if available, else estimate
  const invoicesWithProfit = paidInvoices.filter(i => Number(i.net_profit) !== 0)
  const avg_job_profit = invoicesWithProfit.length > 0
    ? invoicesWithProfit.reduce((s, i) => s + Number(i.net_profit), 0) / invoicesWithProfit.length
    : 0

  const serviceCount = jobs.reduce<Record<string, number>>((acc, job) => {
    acc[job.service_type] = (acc[job.service_type] ?? 0) + 1
    return acc
  }, {})
  const top_service = Object.entries(serviceCount)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  return NextResponse.json({
    overview: {
      period:               month,
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
      top_service,
      invoice_count:         invoices.length,
      paid_invoice_count:    paidInvoices.length,
      overdue_invoice_count: overdueInvoices.length,
    },
  })
}
