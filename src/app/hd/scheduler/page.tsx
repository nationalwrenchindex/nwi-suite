import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import HDSchedulerTabsClient from '@/components/hd/HDSchedulerTabsClient'

export const metadata = { title: 'Scheduler — NWI HD Suite' }

const HD_ORANGE = '#E85D24'

export default async function HDSchedulerPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasStarterAccess = await checkHDStarterAccess(user.id)
  if (!hasStarterAccess) redirect('/hd/upgrade')

  const [
    { data: workOrders },
    { data: profile },
  ] = await Promise.all([
    supabase
      .from('hd_work_orders')
      .select(`
        id, work_order_number, status, service_type, total_amount, created_at, scheduled_at,
        unit:hd_units(unit_number, manufacturer, model),
        fleet_account:hd_fleet_accounts(fleet_name)
      `)
      .eq('user_id', user.id)
      .in('status', ['open', 'on_the_way', 'in_progress', 'completed'])
      .order('created_at', { ascending: false })
      .limit(40),

    supabase
      .from('profiles')
      .select('hd_labor_rate, hd_tech_name')
      .eq('id', user.id)
      .single(),
  ])

  const laborRate = Number(profile?.hd_labor_rate ?? 125)
  const techName  = (profile as { hd_tech_name?: string } | null)?.hd_tech_name ?? null

  const activeCount = (workOrders ?? []).filter(
    wo => !['completed', 'invoiced', 'cancelled'].includes(wo.status)
  ).length

  return (
    <main className="flex-1 p-4 sm:p-6">

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">SCHEDULER</h1>
          {techName && (
            <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{techName}</p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {activeCount > 0 && (
            <span
              className="text-sm font-bold px-3 py-1.5 rounded-full"
              style={{ background: `${HD_ORANGE}25`, color: HD_ORANGE }}
            >
              {activeCount} active
            </span>
          )}
          <Link
            href="/hd/work-orders?new=1"
            className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: HD_ORANGE }}
          >
            + New Job
          </Link>
        </div>
      </div>

      <HDSchedulerTabsClient
        workOrders={workOrders as unknown as Parameters<typeof HDSchedulerTabsClient>[0]['workOrders']}
        laborRate={laborRate}
        activeCount={activeCount}
      />
    </main>
  )
}
