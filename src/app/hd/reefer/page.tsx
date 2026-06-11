import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDReeferAccess } from '@/lib/hd-access'

export const metadata = { title: 'Reefer Module — NWI HD Suite' }

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

export default async function ReeferPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasReeferAccess = await checkHDReeferAccess(user.id)
  if (!hasReeferAccess) redirect('/hd/upgrade')

  const { data: units } = await supabase
    .from('hd_units')
    .select('id, unit_number, manufacturer, model, status, refrigerant_type, total_hours')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('unit_number')

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">REEFER MODULE</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Transport refrigeration unit monitoring, alarm tracking, and temperature logging.
        </p>
      </div>

      <div className="rounded-xl p-4 mb-6" style={{ background: '#2d0a0a', border: '1px solid #7f1d1d' }}>
        <p className="text-xs font-bold" style={{ color: '#EF4444' }}>
          ⚠ ALL REFRIGERANT WORK REQUIRES EPA 608 CERTIFICATION. Never work on refrigerant systems without proper PPE and certification.
        </p>
      </div>

      {/* Active units */}
      <h2 className="font-condensed font-bold text-white text-xl tracking-wide mb-4">ACTIVE REEFER UNITS</h2>
      {!units || units.length === 0 ? (
        <div className="rounded-xl py-16 text-center" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>No active reefer units — add fleet units to track them here</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(units as { id: string; unit_number: string; manufacturer: string; model: string; refrigerant_type: string | null; total_hours: number | null }[]).map(u => (
            <div key={u.id} className="rounded-xl p-4" style={{ background: '#111920', border: '1px solid #1e3040' }}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-condensed font-bold text-white tracking-wide">{u.unit_number}</p>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{u.manufacturer} {u.model}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#22C55E20', color: '#22C55E' }}>Active</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p style={{ color: 'rgba(255,255,255,0.4)' }}>Refrigerant</p>
                  <p className="font-medium" style={{ color: HD_ORANGE }}>{u.refrigerant_type ?? 'R-404A'}</p>
                </div>
                <div>
                  <p style={{ color: 'rgba(255,255,255,0.4)' }}>Total Hours</p>
                  <p className="font-medium text-white">{u.total_hours !== null ? `${Number(u.total_hours).toFixed(0)} hrs` : '—'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 rounded-xl p-8 text-center" style={{ background: '#111920', border: `1px solid ${HD_BLUE}40` }}>
        <p className="font-condensed font-bold text-white text-xl tracking-wide mb-2">REAL-TIME MONITORING COMING IN PHASE 2</p>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Live setpoint tracking, temperature logging, alarm code streaming, geolocation, and automated alerts
        </p>
      </div>
    </main>
  )
}
