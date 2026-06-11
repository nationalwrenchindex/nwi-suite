import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import HDTrialBanner from '@/components/hd/HDTrialBanner'

export const metadata = { title: 'Dashboard — NWI HD Suite' }

const HD_TIER_PRICES: Record<string, number> = {
  hd_reefer:  79,
  hd_starter: 49,
  hd_pro:     99,
  hd_elite:   199,
}

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

function KpiCard({
  label, value, sub, color = 'white',
}: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  const textColor = color === 'orange' ? HD_ORANGE : color === 'blue' ? '#60A5FA' : color === 'red' ? '#EF4444' : color === 'green' ? '#22C55E' : '#ffffff'
  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-1"
      style={{ background: '#111920', border: '1px solid #1e3040' }}
    >
      <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</p>
      <p className="font-condensed font-bold text-3xl leading-none" style={{ color: textColor }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{sub}</p>}
    </div>
  )
}

export default async function HDDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const [{ data: profile }, { data: hdSub }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, business_name')
      .eq('id', user.id)
      .single(),
    supabase
      .from('subscriptions')
      .select('status, current_period_end, tier')
      .eq('user_id', user.id)
      .eq('vertical', 'heavy_duty')
      .maybeSingle(),
  ])

  const isTrialing      = hdSub?.status === 'trialing' && !!hdSub.current_period_end
  const trialMonthPrice = HD_TIER_PRICES[hdSub?.tier ?? ''] ?? 49

  // Parallel data fetch
  const [
    { data: units,      count: unitCount },
    { data: workOrders, count: openWOCount },
    { data: recentPMs },
    { data: epaLog },
    { data: invoices },
  ] = await Promise.all([
    supabase
      .from('hd_units')
      .select('id, unit_number, manufacturer, model, status, total_hours, next_pm_due_hours, last_pm_date, last_pm_type', { count: 'exact' })
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('unit_number')
      .limit(20),

    supabase
      .from('hd_work_orders')
      .select('id, work_order_number, status, service_type, total_amount, created_at', { count: 'exact' })
      .eq('user_id', user.id)
      .in('status', ['open', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(5),

    supabase
      .from('hd_pm_checklists')
      .select('id, pm_type, completed_at, flagged_items, alarm_codes_found, unit_id')
      .eq('user_id', user.id)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(5),

    supabase
      .from('hd_epa_log')
      .select('id, date, refrigerant_type, action, pounds')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .limit(5),

    supabase
      .from('hd_work_orders')
      .select('total_amount')
      .eq('user_id', user.id)
      .eq('status', 'invoiced')
      .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
  ])

  const mtdRevenue = (invoices ?? []).reduce((s, i) => s + Number(i.total_amount ?? 0), 0)
  const today      = new Date()
  const dayLabel   = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // Units due for PM (within 200 hours)
  const pmDueSoon = (units ?? []).filter(u =>
    u.next_pm_due_hours !== null &&
    u.total_hours !== null &&
    Number(u.next_pm_due_hours) - Number(u.total_hours) <= 200
  )

  const alarmCount = (recentPMs ?? []).filter(p =>
    p.alarm_codes_found && String(p.alarm_codes_found).trim().length > 0
  ).length

  const totalEpaLbs = (epaLog ?? []).reduce((s, e) => s + Number(e.pounds), 0)

  return (
    <main className="flex-1 p-4 sm:p-6 space-y-6">

      {/* Trial banner */}
      {isTrialing && hdSub?.current_period_end && (
        <HDTrialBanner
          trialEndISO={hdSub.current_period_end}
          monthlyPrice={trialMonthPrice}
        />
      )}

      {/* Header */}
      <div
        className="rounded-2xl px-6 py-6 relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${HD_BLUE} 0%, #0d3460 100%)` }}
      >
        <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.04)' }} />
        <div className="absolute right-10 bottom-0 w-16 h-16 rounded-full pointer-events-none" style={{ background: `${HD_ORANGE}25` }} />
        <div className="relative z-10">
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>
            HD Suite · {dayLabel}
          </p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
            {profile?.full_name ?? user.email}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>{profile?.business_name ?? 'HD Suite'}</p>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="MTD Revenue" value={`$${mtdRevenue.toLocaleString()}`} color="green" sub="Invoiced this month" />
        <KpiCard label="Active Fleet Units" value={unitCount ?? 0} color="blue" sub="Active units" />
        <KpiCard label="Open Work Orders" value={openWOCount ?? 0} color="orange" />
        <KpiCard label="Active Alarm Codes" value={alarmCount} color={alarmCount > 0 ? 'red' : 'white'} sub="From recent PMs" />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Open Work Orders */}
        <div className="lg:col-span-2 rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <div className="flex items-center justify-between mb-4">
            <p className="font-condensed font-bold text-white text-lg tracking-wide">OPEN WORK ORDERS</p>
            <Link href="/hd/work-orders"
              className="text-xs rounded-lg px-3 py-1.5 border transition-colors"
              style={{ color: 'rgba(255,255,255,0.4)', borderColor: '#1e3040' }}
            >
              View all →
            </Link>
          </div>
          {!workOrders || workOrders.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.25)' }}>No open work orders</p>
              <Link href="/hd/work-orders"
                className="mt-2 inline-block text-xs" style={{ color: HD_ORANGE }}>
                + New Work Order
              </Link>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: '#1e3040' }}>
              {workOrders.map(wo => (
                <div key={wo.id} className="py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium">{wo.work_order_number ?? `WO-${wo.id.slice(0, 6).toUpperCase()}`}</p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{wo.service_type ?? 'Service'}</p>
                  </div>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: wo.status === 'in_progress' ? `${HD_ORANGE}25` : 'rgba(255,255,255,0.08)',
                      color:      wo.status === 'in_progress' ? HD_ORANGE : 'rgba(255,255,255,0.5)',
                    }}
                  >
                    {wo.status === 'in_progress' ? 'In Progress' : 'Open'}
                  </span>
                  {wo.total_amount && (
                    <p className="text-sm font-medium text-white">${Number(wo.total_amount).toFixed(0)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* EPA 608 Log summary */}
        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <div className="flex items-center justify-between mb-4">
            <p className="font-condensed font-bold text-white text-lg tracking-wide">EPA 608 LOG</p>
            <Link href="/hd/epa-log" className="text-xs" style={{ color: HD_ORANGE }}>View all →</Link>
          </div>
          <div className="mb-3 p-3 rounded-lg" style={{ background: '#162030' }}>
            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Total Refrigerant Tracked</p>
            <p className="font-condensed font-bold text-2xl text-white">{totalEpaLbs.toFixed(1)} <span className="text-sm font-normal" style={{ color: 'rgba(255,255,255,0.4)' }}>lbs</span></p>
          </div>
          {!epaLog || epaLog.length === 0 ? (
            <p className="text-xs text-center py-6" style={{ color: 'rgba(255,255,255,0.25)' }}>No EPA log entries</p>
          ) : (
            <div className="space-y-2">
              {epaLog.slice(0, 4).map(e => (
                <div key={e.id} className="flex items-center gap-2 text-xs">
                  <div className="flex-1 truncate" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    {e.action} — {e.refrigerant_type}
                  </div>
                  <span style={{ color: HD_ORANGE }}>{Number(e.pounds).toFixed(1)} lbs</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* PM Due Soon */}
      <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
        <div className="flex items-center justify-between mb-4">
          <p className="font-condensed font-bold text-white text-lg tracking-wide">PM DUE SOON</p>
          <Link href="/hd/pm-schedules" className="text-xs" style={{ color: HD_ORANGE }}>PM Schedules →</Link>
        </div>
        {pmDueSoon.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.25)' }}>
              {unitCount === 0 ? 'No fleet units added yet' : 'All units up to date on PMs'}
            </p>
            {unitCount === 0 && (
              <Link href="/hd/fleet-units"
                className="mt-2 inline-block text-xs" style={{ color: HD_ORANGE }}>
                + Add Fleet Units
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {pmDueSoon.map(u => {
              const hoursUntil = u.next_pm_due_hours !== null && u.total_hours !== null
                ? Number(u.next_pm_due_hours) - Number(u.total_hours)
                : null
              const pct = hoursUntil !== null ? Math.max(0, Math.min(100, ((200 - hoursUntil) / 200) * 100)) : 0
              return (
                <div key={u.id}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm text-white">{u.unit_number} — {u.manufacturer} {u.model}</p>
                    <p className="text-xs" style={{ color: hoursUntil !== null && hoursUntil <= 0 ? '#EF4444' : HD_ORANGE }}>
                      {hoursUntil !== null
                        ? hoursUntil <= 0 ? 'OVERDUE' : `${hoursUntil.toFixed(0)} hrs`
                        : 'No schedule'
                      }
                    </p>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1e3040' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 80 ? '#EF4444' : pct >= 60 ? HD_ORANGE : HD_BLUE,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* HD QuickWrench quick access */}
      <div>
        <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.35)' }}>Quick Access</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { href: '/hd/quickwrench',   label: 'HD QUICKWRENCH', sub: 'Alarm codes & specs', color: HD_ORANGE },
            { href: '/hd/pm-checklist',  label: 'PM CHECKLIST',   sub: 'Start a new PM',      color: HD_BLUE   },
            { href: '/hd/fleet-units',   label: 'FLEET UNITS',    sub: 'Manage your fleet',   color: '#6B7280' },
            { href: '/hd/epa-log',       label: 'EPA 608 LOG',    sub: 'Refrigerant tracking', color: '#6B7280' },
          ].map(({ href, label, sub, color }) => (
            <Link
              key={href}
              href={href}
              className="rounded-xl p-4 flex flex-col gap-1 transition-opacity hover:opacity-80"
              style={{ background: `${color}18`, border: `1px solid ${color}35` }}
            >
              <p className="font-condensed font-bold text-white text-sm tracking-wide">{label}</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{sub}</p>
            </Link>
          ))}
        </div>
      </div>

    </main>
  )
}
