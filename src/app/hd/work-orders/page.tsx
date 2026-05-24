import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

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

  const params   = await searchParams
  const showForm = params.new === '1'

  const { data: workOrders } = await supabase
    .from('hd_work_orders')
    .select(`
      id, work_order_number, status, service_type, created_at,
      tech_name, total_amount, started_at,
      unit:hd_units(unit_number, manufacturer, model),
      fleet:hd_fleet_accounts(fleet_name)
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <main className="flex-1 p-6">
      <div className="flex items-center justify-between mb-6">
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
        <div className="rounded-xl p-5 mb-6" style={{ background: '#111920', border: `1px solid ${HD_ORANGE}50` }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-1">NEW WORK ORDER</p>
          <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Full work order creation form coming in the next update. Add a fleet unit and fleet account first, then work orders will be available here.
          </p>
          <div className="flex gap-3">
            <Link href="/hd/fleet-units?new=1" className="text-xs px-4 py-2 rounded-lg font-semibold" style={{ background: `${HD_ORANGE}20`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}40` }}>
              Add Fleet Unit →
            </Link>
            <Link href="/hd/fleet-accounts?new=1" className="text-xs px-4 py-2 rounded-lg font-semibold" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '1px solid #1e3040' }}>
              Add Fleet Account →
            </Link>
            <Link href="/hd/work-orders" className="text-xs px-4 py-2 rounded-lg" style={{ color: 'rgba(255,255,255,0.3)', border: '1px solid #1e3040' }}>
              Cancel
            </Link>
          </div>
        </div>
      )}

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
        {!workOrders || workOrders.length === 0 ? (
          <div className="py-16 text-center" style={{ background: '#111920' }}>
            <p className="text-sm mb-2" style={{ color: 'rgba(255,255,255,0.3)' }}>No work orders yet</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>Create a work order to track service on a fleet unit</p>
          </div>
        ) : (
          <table className="w-full" style={{ background: '#111920' }}>
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
                <tr key={wo.id} style={{ borderTop: i > 0 ? '1px solid #1e3040' : undefined }}>
                  <td className="px-4 py-3 text-sm text-white font-medium">
                    {wo.work_order_number ?? `WO-${wo.id.slice(0, 6).toUpperCase()}`}
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
                    {wo.fleet?.fleet_name ?? '—'}
                    {wo.unit && <span className="block text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{wo.unit.unit_number} — {wo.unit.manufacturer}</span>}
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>{wo.service_type ?? '—'}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>{wo.tech_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: `${statusColor(wo.status)}20`, color: statusColor(wo.status) }}>
                      {statusLabel(wo.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-white">
                    {wo.total_amount ? `$${Number(wo.total_amount).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {new Date(wo.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  )
}
