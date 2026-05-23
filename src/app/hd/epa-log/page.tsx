import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'EPA 608 Log — NWI HD Suite' }

const HD_ORANGE = '#E85D24'

export default async function EPALogPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const { data: log } = await supabase
    .from('hd_epa_log')
    .select('*, unit:hd_units(unit_number, manufacturer, model)')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .limit(100)

  const totalLbs = (log ?? []).reduce((s, e) => s + Number(e.pounds), 0)

  return (
    <main className="flex-1 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite — Compliance</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">EPA 608 REFRIGERANT LOG</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Federal regulation requires tracking all refrigerant recovered, added, and charged.
            EPA 608 licensed technicians only.
          </p>
        </div>
        <button className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: HD_ORANGE }}>
          + Log Entry
        </button>
      </div>

      <div className="rounded-xl p-4 mb-6" style={{ background: '#2d0a0a', border: '1px solid #7f1d1d' }}>
        <p className="text-xs font-bold" style={{ color: '#EF4444' }}>
          ⚠ ALL REFRIGERANT WORK MUST BE PERFORMED BY EPA 608 CERTIFIED TECHNICIANS ONLY.
          Refrigerant exposure is extremely dangerous. Always wear full PPE. Never work alone.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Tracked', value: `${totalLbs.toFixed(1)} lbs` },
          { label: 'Entries', value: (log ?? []).length },
          { label: 'R-404A', value: `${(log ?? []).filter(e => e.refrigerant_type === 'R-404A').reduce((s, e) => s + Number(e.pounds), 0).toFixed(1)} lbs` },
          { label: 'R-452A', value: `${(log ?? []).filter(e => e.refrigerant_type === 'R-452A').reduce((s, e) => s + Number(e.pounds), 0).toFixed(1)} lbs` },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl p-4" style={{ background: '#111920', border: '1px solid #1e3040' }}>
            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{label}</p>
            <p className="font-condensed font-bold text-xl text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
        {!log || log.length === 0 ? (
          <div className="py-16 text-center" style={{ background: '#111920' }}>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>No EPA log entries yet</p>
          </div>
        ) : (
          <table className="w-full" style={{ background: '#111920' }}>
            <thead style={{ background: '#162030' }}>
              <tr>
                {['Date', 'Unit', 'Refrigerant', 'Action', 'Pounds', 'Reason', 'Cert #'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(log as unknown as {
                id: string; date: string; refrigerant_type: string; action: string
                pounds: number; reason: string | null; tech_certification_number: string | null
                unit: { unit_number: string; manufacturer: string; model: string } | null
              }[]).map((e, i) => (
                <tr key={e.id} style={{ borderTop: i > 0 ? '1px solid #1e3040' : undefined }}>
                  <td className="px-4 py-3 text-sm text-white">{e.date}</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    {e.unit ? `${e.unit.unit_number}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: HD_ORANGE }}>{e.refrigerant_type}</td>
                  <td className="px-4 py-3 text-sm text-white capitalize">{e.action.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-sm font-medium text-white">{Number(e.pounds).toFixed(2)} lbs</td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{e.reason ?? '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{e.tech_certification_number ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  )
}
