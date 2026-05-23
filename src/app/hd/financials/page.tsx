import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Financials — NWI HD Suite' }

const HD_ORANGE = '#E85D24'

export default async function HDFinancialsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const today = new Date()
  const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`

  const [{ data: mtdRevenue }, { data: ytdRevenue }, { data: openWOs }] = await Promise.all([
    supabase.from('hd_work_orders').select('total_amount').eq('user_id', user.id).eq('status', 'invoiced').gte('completed_at', monthStart),
    supabase.from('hd_work_orders').select('total_amount').eq('user_id', user.id).eq('status', 'invoiced').gte('completed_at', `${today.getFullYear()}-01-01`),
    supabase.from('hd_work_orders').select('total_amount').eq('user_id', user.id).in('status', ['completed']),
  ])

  const mtd = (mtdRevenue ?? []).reduce((s, w) => s + Number(w.total_amount ?? 0), 0)
  const ytd = (ytdRevenue ?? []).reduce((s, w) => s + Number(w.total_amount ?? 0), 0)
  const outstanding = (openWOs ?? []).reduce((s, w) => s + Number(w.total_amount ?? 0), 0)

  return (
    <main className="flex-1 p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">FINANCIALS</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'MTD Revenue', value: `$${mtd.toLocaleString()}`, color: '#22C55E' },
          { label: 'YTD Revenue', value: `$${ytd.toLocaleString()}`, color: '#22C55E' },
          { label: 'Outstanding', value: `$${outstanding.toLocaleString()}`, color: outstanding > 0 ? HD_ORANGE : '#22C55E' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</p>
            <p className="font-condensed font-bold text-3xl" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl p-10 text-center" style={{ background: '#111920', border: `1px solid ${HD_ORANGE}30` }}>
        <p className="font-condensed font-bold text-white text-xl tracking-wide mb-2">FULL FINANCIALS COMING IN PHASE 2</p>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          P&L reports, expense tracking, fleet account billing summaries, and tax export
        </p>
      </div>
    </main>
  )
}
