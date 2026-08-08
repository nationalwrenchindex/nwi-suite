import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import PartsComingSoon from '@/components/hd/PartsComingSoon'
import NewWorkOrderForm from './NewWorkOrderForm'

export const metadata = { title: 'Work Orders — NWI HD Suite' }

const HD_ORANGE = '#E85D24'

function statusColor(s: string) {
  return s === 'in_progress' ? HD_ORANGE : s === 'completed' ? '#22C55E' : s === 'invoiced' ? '#3B82F6' : 'rgba(255,255,255,0.4)'
}
function statusLabel(s: string) {
  return s === 'in_progress' ? 'In Progress' : s === 'completed' ? 'Completed' : s === 'invoiced' ? 'Invoiced' : 'Open'
}

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

  const [{ data: workOrders }, { data: formUnits }, { data: fleetAccounts }] = await Promise.all([
    supabase
      .from('hd_work_orders')
      .select(`
        id, work_order_number, status, service_type, created_at,
        tech_name, total_amount, started_at,
        unit:hd_units(unit_number, manufacturer, model),
        fleet:hd_fleet_accounts(fleet_name)
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('hd_units')
      .select('id, unit_number, manufacturer, model, serial_number, fleet_account_id')
      .eq('user_id', user.id)
      .order('unit_number'),
    supabase
      .from('hd_fleet_accounts')
      .select('id, fleet_name')
      .eq('user_id', user.id)
      .order('fleet_name'),
  ])

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">WORK ORDERS</h1>
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
          units={(formUnits ?? []) as Array<{ id: string; unit_number: string; manufacturer: string; model: string; serial_number: string | null; fleet_account_id: string | null }>}
          fleetAccounts={(fleetAccounts ?? []) as Array<{ id: string; fleet_name: string }>}
          presetAccountId={presetAccountId}
        />
      )}

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
        {!workOrders || workOrders.length === 0 ? (
          <div className="py-16 text-center" style={{ background: '#111920' }}>
            <p className="text-sm mb-2" style={{ color: 'rgba(255,255,255,0.3)' }}>No work orders yet</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>Create a work order to track service on a fleet unit</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]" style={{ background: '#111920' }}>
            <thead style={{ background: '#162030' }}>
              <tr>
                {['WO #', 'Fleet / Unit', 'Service', 'Tech', 'Status', 'Total', 'Date'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(workOrders as unknown as {
                id: string; work_order_number: string | null; status: string
                service_type: string | null; tech_name: string | null
                total_amount: number | null; created_at: string
                unit: { unit_number: string; manufacturer: string; model: string } | null
                fleet: { fleet_name: string } | null
              }[]).map((wo, i) => (
                <tr key={wo.id} className="cursor-pointer hover:bg-white/[0.02] transition-colors" style={{ borderTop: i > 0 ? '1px solid #1e3040' : undefined }}>
                  <td className="px-4 py-3 text-sm text-white font-medium">
                    <Link href={`/hd/work-orders/${wo.id}`} className="hover:underline">
                      {wo.work_order_number ?? `WO-${wo.id.slice(0, 6).toUpperCase()}`}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    <Link href={`/hd/work-orders/${wo.id}`} className="block">
                      {wo.fleet?.fleet_name ?? '—'}
                      {wo.unit && <span className="block text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{wo.unit.unit_number} — {wo.unit.manufacturer}</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    <Link href={`/hd/work-orders/${wo.id}`} className="block">{wo.service_type ?? '—'}</Link>
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    <Link href={`/hd/work-orders/${wo.id}`} className="block">{wo.tech_name ?? '—'}</Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/hd/work-orders/${wo.id}`} className="block">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: `${statusColor(wo.status)}20`, color: statusColor(wo.status) }}>
                        {statusLabel(wo.status)}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-white">
                    <Link href={`/hd/work-orders/${wo.id}`} className="block">
                      {wo.total_amount ? `$${Number(wo.total_amount).toFixed(2)}` : '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    <Link href={`/hd/work-orders/${wo.id}`} className="block">
                      {new Date(wo.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <PartsComingSoon />
    </main>
  )
}
