import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Invoicing — NWI HD Suite' }

const HD_ORANGE = '#E85D24'

export default async function InvoicingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const { data: workOrders } = await supabase
    .from('hd_work_orders')
    .select('id, work_order_number, total_amount, status, completed_at, fleet_account:hd_fleet_accounts(fleet_name), unit:hd_units(unit_number)')
    .eq('user_id', user.id)
    .in('status', ['completed', 'invoiced'])
    .order('completed_at', { ascending: false })
    .limit(50)

  const totalInvoiced = (workOrders ?? []).filter(w => w.status === 'invoiced').reduce((s, w) => s + Number(w.total_amount ?? 0), 0)
  const totalOutstanding = (workOrders ?? []).filter(w => w.status === 'completed').reduce((s, w) => s + Number(w.total_amount ?? 0), 0)

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">INVOICING</h1>
        </div>
        <Link
          href="/hd/quotes/new"
          className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white inline-flex items-center"
          style={{ background: HD_ORANGE, minHeight: 44 }}
        >
          + Create Invoice
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Outstanding (Completed)</p>
          <p className="font-condensed font-bold text-2xl" style={{ color: totalOutstanding > 0 ? HD_ORANGE : '#22C55E' }}>
            ${totalOutstanding.toLocaleString()}
          </p>
        </div>
        <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Total Invoiced</p>
          <p className="font-condensed font-bold text-2xl text-white">${totalInvoiced.toLocaleString()}</p>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
        {!workOrders || workOrders.length === 0 ? (
          <div className="py-16 text-center" style={{ background: '#111920' }}>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>No completed work orders to invoice</p>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.2)' }}>Complete work orders will appear here for invoicing</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]" style={{ background: '#111920' }}>
            <thead style={{ background: '#162030' }}>
              <tr>
                {['Work Order', 'Fleet', 'Unit', 'Amount', 'Status', 'Completed'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(workOrders as unknown as {
                id: string; work_order_number: string | null; status: string
                total_amount: number | null; completed_at: string | null
                fleet_account: { fleet_name: string } | null
                unit: { unit_number: string } | null
              }[]).map((wo, i) => (
                <tr key={wo.id} style={{ borderTop: i > 0 ? '1px solid #1e3040' : undefined }}>
                  <td className="px-4 py-3 text-sm text-white font-medium">
                    {wo.work_order_number ?? `WO-${wo.id.slice(0, 6).toUpperCase()}`}
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>{wo.fleet_account?.fleet_name ?? '—'}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>{wo.unit?.unit_number ?? '—'}</td>
                  <td className="px-4 py-3 text-sm font-medium text-white">
                    {wo.total_amount ? `$${Number(wo.total_amount).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                      style={{
                        background: wo.status === 'invoiced' ? '#3B82F620' : `${HD_ORANGE}20`,
                        color:      wo.status === 'invoiced' ? '#3B82F6' : HD_ORANGE,
                      }}>
                      {wo.status === 'invoiced' ? 'Invoiced' : 'Awaiting Invoice'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {wo.completed_at ? new Date(wo.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </main>
  )
}
