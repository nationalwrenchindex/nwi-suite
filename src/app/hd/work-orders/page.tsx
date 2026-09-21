import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import PartsComingSoon from '@/components/hd/PartsComingSoon'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { WORK_ORDER_LIST_SELECT, WORK_ORDER_PAGE_SIZE, type WorkOrderListRow } from '@/app/api/hd/work-orders/list'
import NewWorkOrderForm from './NewWorkOrderForm'
import WorkOrderList from './WorkOrderList'

export const metadata = { title: 'Work Orders — NWI HD Suite' }

const HD_ORANGE = '#E85D24'

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasStarterAccess = await checkHDStarterAccess(user.id)
  if (!hasStarterAccess) redirect('/hd/upgrade')

  const params   = await searchParams
  const presetAccountId = typeof params.fleet_account_id === 'string' ? params.fleet_account_id : null
  const showForm = params.new === '1' || !!presetAccountId

  // The list is paged (PostgREST silently caps any response at 1,000 rows, so a
  // tenant past that was quietly losing work orders off the bottom of the table).
  // The header total comes from its own exact/head count, which reports the real
  // number regardless of how many rows this page actually loaded.
  //
  // The two form dropdowns are a different problem: a <select> cannot page, so
  // those are read to exhaustion instead of truncated at the cap.
  const [{ data: workOrders }, { count: workOrderCount }, formUnits, fleetAccounts] = await Promise.all([
    supabase
      .from('hd_work_orders')
      .select(WORK_ORDER_LIST_SELECT)
      .eq('user_id', user.id)
      // Must match the API's ordering exactly, or the offsets the client sends
      // would page through a different sequence than this first page came from.
      .order('created_at', { ascending: false })
      .order('id',         { ascending: false })
      .range(0, WORK_ORDER_PAGE_SIZE - 1),
    supabase
      .from('hd_work_orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    fetchAllRows<{ id: string; unit_number: string; manufacturer: string; model: string; serial_number: string | null; fleet_account_id: string | null }>(
      (from, to) => supabase
        .from('hd_units')
        .select('id, unit_number, manufacturer, model, serial_number, fleet_account_id')
        .eq('user_id', user.id)
        .order('unit_number')
        .order('id')
        .range(from, to),
    ),
    fetchAllRows<{ id: string; fleet_name: string }>(
      (from, to) => supabase
        .from('hd_fleet_accounts')
        .select('id, fleet_name')
        .eq('user_id', user.id)
        .order('fleet_name')
        .order('id')
        .range(from, to),
    ),
  ])

  const rows  = (workOrders ?? []) as unknown as WorkOrderListRow[]
  const total = workOrderCount ?? rows.length

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>HD Suite</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">WORK ORDERS</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>
            {total.toLocaleString()} work order{total !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="?new=1"
          className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white"
          style={{ background: HD_ORANGE }}
        >
          + New Work Order
        </Link>
      </div>

      {showForm && (
        <NewWorkOrderForm
          units={formUnits}
          fleetAccounts={fleetAccounts}
          presetAccountId={presetAccountId}
        />
      )}

      {/* key: a server re-render (a new work order, say) does not remount a client
          component on its own, so without it the table would keep the stale rows it
          had already accumulated. */}
      <WorkOrderList key={total} initialRows={rows} total={total} />

      <PartsComingSoon />
    </main>
  )
}
