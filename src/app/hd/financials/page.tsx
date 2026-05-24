import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'

export const metadata = { title: 'Financials — NWI HD Suite' }

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

function StatCard({ label, value, sub, color = 'white' }: { label: string; value: string | number; sub?: string; color?: string }) {
  const textColor = color === 'orange' ? HD_ORANGE : color === 'blue' ? '#60A5FA' : color === 'green' ? '#22C55E' : color === 'red' ? '#EF4444' : '#ffffff'
  return (
    <div className="rounded-xl p-5 flex flex-col gap-1" style={{ background: '#111920', border: '1px solid #1e3040' }}>
      <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</p>
      <p className="font-condensed font-bold text-3xl leading-none" style={{ color: textColor }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{sub}</p>}
    </div>
  )
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
  const now = new Date()

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
  ])

  const hourlyRate  = Number(laborRateRow?.hd_labor_rate ?? 125)
  const totalRevenue = (invoicedWOs ?? []).reduce((s, w) => s + Number(w.total_amount ?? 0), 0)
  const closedCount  = (allWOs ?? []).length
  const avgJobValue  = closedCount > 0
    ? (allWOs ?? []).reduce((s, w) => s + Number(w.total_amount ?? 0), 0) / closedCount
    : 0

  const { data: outstandingWOs } = await supabase
    .from('hd_work_orders')
    .select('id, work_order_number, total_amount, completed_at')
    .eq('user_id', user.id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(20)

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
    <main className="flex-1 p-6 space-y-6">

      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">FINANCIALS</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{periodLabel}</p>
        </div>
        <div className="flex gap-2">
          {[
            { key: 'mtd', label: 'MTD' },
            { key: '90d', label: '90D' },
            { key: 'ytd', label: 'YTD' },
          ].map(p => (
            <Link
              key={p.key}
              href={`/hd/financials?period=${p.key}`}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={periodParam === p.key
                ? { background: HD_ORANGE, color: '#fff' }
                : { color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }
              }
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Revenue" value={`$${totalRevenue.toLocaleString()}`} color="green" sub="Invoiced in period" />
        <StatCard label="Avg Job Value" value={`$${avgJobValue.toFixed(0)}`} color="blue" sub={`${closedCount} jobs closed`} />
        <StatCard label="Outstanding" value={`$${outstandingTotal.toLocaleString()}`} color={outstandingTotal > 0 ? 'orange' : 'white'} sub="Completed, not invoiced" />
        <StatCard label="Labor Hours" value={totalLaborHours.toFixed(1)} color="white" sub={`@ $${hourlyRate}/hr`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-4">REVENUE BY FLEET ACCOUNT</p>
          {accountRows.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: 'rgba(255,255,255,0.25)' }}>No data for this period</p>
          ) : (
            <div className="space-y-3">
              {accountRows.map(row => {
                const pct = totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0
                return (
                  <div key={row.name}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm text-white truncate">{row.name}</p>
                      <div className="flex items-center gap-3">
                        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{row.count} job{row.count !== 1 ? 's' : ''}</p>
                        <p className="text-sm font-medium" style={{ color: HD_ORANGE }}>${row.revenue.toLocaleString()}</p>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1e3040' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: HD_ORANGE }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-4">LABOR EFFICIENCY</p>
          <div className="space-y-4">
            <div className="rounded-lg p-4" style={{ background: '#162030' }}>
              <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Labor Revenue</p>
              <p className="font-condensed font-bold text-2xl" style={{ color: '#22C55E' }}>${laborRevenue.toFixed(0)}</p>
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {totalLaborHours.toFixed(1)} hrs × ${hourlyRate}/hr
              </p>
            </div>
            <div className="rounded-lg p-4" style={{ background: '#162030' }}>
              <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>Labor as % of Revenue</p>
              <p className="font-condensed font-bold text-2xl text-white">{laborPct.toFixed(0)}%</p>
              <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: '#1e3040' }}>
                <div className="h-full rounded-full" style={{
                  width: `${Math.min(100, laborPct)}%`,
                  background: laborPct > 80 ? '#22C55E' : laborPct > 50 ? HD_ORANGE : '#EF4444',
                }} />
              </div>
            </div>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
              Update your labor rate in{' '}
              <Link href="/hd/settings" style={{ color: HD_ORANGE }}>Settings</Link>
            </p>
          </div>
        </div>
      </div>

      {outstandingWOs && outstandingWOs.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: '#111920', border: `1px solid ${HD_ORANGE}40` }}>
          <div className="flex items-center justify-between mb-4">
            <p className="font-condensed font-bold text-white text-lg tracking-wide">OUTSTANDING — NEEDS INVOICE</p>
            <p className="font-condensed font-bold text-xl" style={{ color: HD_ORANGE }}>${outstandingTotal.toLocaleString()}</p>
          </div>
          <div className="divide-y" style={{ borderColor: '#1e3040' }}>
            {outstandingWOs.map(wo => (
              <div key={wo.id as string} className="py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm text-white">
                    {(wo.work_order_number as string) ?? `WO-${(wo.id as string).slice(0, 6).toUpperCase()}`}
                  </p>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {wo.completed_at ? new Date(wo.completed_at as string).toLocaleDateString() : '—'}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  {wo.total_amount && (
                    <p className="text-sm font-semibold text-white">${Number(wo.total_amount).toFixed(0)}</p>
                  )}
                  <Link
                    href="/hd/work-orders"
                    className="text-xs px-3 py-1 rounded-lg"
                    style={{ background: `${HD_ORANGE}20`, color: HD_ORANGE }}
                  >
                    Invoice →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}
