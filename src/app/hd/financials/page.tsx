import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import HDFinancialsClient from '@/components/hd/HDFinancialsClient'

export const metadata = { title: 'Financials — NWI HD Suite' }

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

  const [
    { data: invoicedWOs },
    { data: allWOs },
    { data: laborRateRow },
    { data: outstandingWOs },
  ] = await Promise.all([
    supabase
      .from('hd_work_orders')
      .select('id, total_amount, labor_hours, labor_minutes, service_type, fleet_account_id, completed_at')
      .eq('user_id', user.id)
      .eq('status', 'invoiced')
      .gte('completed_at', periodStart.toISOString())
      .order('completed_at', { ascending: false }),

    supabase
      .from('hd_work_orders')
      .select('id, total_amount, service_type, fleet_account_id, completed_at')
      .eq('user_id', user.id)
      .in('status', ['completed', 'invoiced'])
      .gte('completed_at', periodStart.toISOString()),

    supabase
      .from('profiles')
      .select('hd_labor_rate')
      .eq('id', user.id)
      .single(),

    supabase
      .from('hd_work_orders')
      .select('id, work_order_number, total_amount, completed_at')
      .eq('user_id', user.id)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(20),
  ])

  const hourlyRate    = Number(laborRateRow?.hd_labor_rate ?? 125)
  const totalRevenue  = (invoicedWOs ?? []).reduce((s, w) => s + Number(w.total_amount ?? 0), 0)
  const closedCount   = (allWOs ?? []).length
  const avgJobValue   = closedCount > 0
    ? (allWOs ?? []).reduce((s, w) => s + Number(w.total_amount ?? 0), 0) / closedCount
    : 0
  const outstandingTotal = (outstandingWOs ?? []).reduce((s, w) => s + Number(w.total_amount ?? 0), 0)

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
  const laborPct     = totalRevenue > 0 ? (laborRevenue / totalRevenue) * 100 : 0

  return (
    <main className="flex-1 p-4 sm:p-6 space-y-6">

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">FINANCIALS</h1>
        </div>
      </div>

      <HDFinancialsClient stats={{
        totalRevenue,
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
    </main>
  )
}
