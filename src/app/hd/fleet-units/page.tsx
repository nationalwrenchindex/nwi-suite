import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import PartsComingSoon from '@/components/hd/PartsComingSoon'

export const metadata = { title: 'Fleet Units — NWI HD Suite' }

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

export default async function FleetUnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const params   = await searchParams
  const showForm = params.new === '1'

  const { data: units } = await supabase
    .from('hd_units')
    .select('*, fleet_account:hd_fleet_accounts(fleet_name)')
    .eq('user_id', user.id)
    .order('unit_number')

  async function addUnit(formData: FormData) {
    'use server'
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const unitNumber = (formData.get('unit_number') as string ?? '').trim()
    if (!unitNumber) return

    await supabase.from('hd_units').insert({
      user_id:          user.id,
      unit_number:      unitNumber,
      manufacturer:     formData.get('manufacturer') as string || 'Thermo King',
      model:            (formData.get('model') as string ?? '').trim() || 'Unknown',
      unit_type:        formData.get('unit_type') as string || 'trailer',
      year:             formData.get('year') ? Number(formData.get('year')) : null,
      refrigerant_type: (formData.get('refrigerant_type') as string) || 'R-404A',
      total_hours:      formData.get('total_hours') ? Number(formData.get('total_hours')) : 0,
      status:           'active',
    })
    redirect('/hd/fleet-units')
  }

  const statusColor = (s: string) =>
    s === 'active' ? '#22C55E' : s === 'out_of_service' ? '#EF4444' : 'rgba(255,255,255,0.4)'

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">FLEET UNITS</h1>
        </div>
        <Link
          href="?new=1"
          className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white"
          style={{ background: HD_ORANGE }}
        >
          + Add Unit
        </Link>
      </div>

      {/* Inline create form */}
      {showForm && (
        <form action={addUnit} className="rounded-xl p-6 mb-6 space-y-4" style={{ background: '#111920', border: `1px solid ${HD_ORANGE}50` }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide">ADD FLEET UNIT</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Unit # *</label>
              <input name="unit_number" required placeholder="e.g. TRL-001" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={{ background: '#162030', border: '1px solid #1e3040' }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Manufacturer *</label>
              <select name="manufacturer" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white" style={{ background: '#162030', border: '1px solid #1e3040' }}>
                <option value="Thermo King">Thermo King</option>
                <option value="Carrier Transicold">Carrier Transicold</option>
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Model *</label>
              <input name="model" required placeholder="e.g. Precedent S-600" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={{ background: '#162030', border: '1px solid #1e3040' }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Unit Type</label>
              <select name="unit_type" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white" style={{ background: '#162030', border: '1px solid #1e3040' }}>
                <option value="trailer">Trailer</option>
                <option value="truck">Truck</option>
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Year</label>
              <input name="year" type="number" placeholder="e.g. 2020" min="1990" max="2030" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={{ background: '#162030', border: '1px solid #1e3040' }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Refrigerant</label>
              <select name="refrigerant_type" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white" style={{ background: '#162030', border: '1px solid #1e3040' }}>
                <option value="R-404A">R-404A</option>
                <option value="R-452A">R-452A</option>
                <option value="R-22">R-22</option>
                <option value="R-407C">R-407C</option>
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Current Hours</label>
              <input name="total_hours" type="number" placeholder="e.g. 4500" min="0" className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20" style={{ background: '#162030', border: '1px solid #1e3040' }} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: HD_ORANGE }}>
              Save Unit
            </button>
            <Link href="/hd/fleet-units" className="px-4 py-2.5 rounded-lg text-sm border" style={{ color: 'rgba(255,255,255,0.5)', borderColor: '#1e3040' }}>
              Cancel
            </Link>
          </div>
        </form>
      )}

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
        {!units || units.length === 0 ? (
          <div className="py-16 text-center" style={{ background: '#111920' }}>
            <svg className="w-10 h-10 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.15)' }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <rect x="1" y="3" width="15" height="13" rx="2" />
              <path d="M16 8h4l3 5v3h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
            </svg>
            <p className="text-sm mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>No fleet units yet</p>
            <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.2)' }}>Add your refrigerated units to start tracking PMs and work orders</p>
            <Link href="?new=1" className="text-xs px-4 py-2 rounded-lg font-semibold" style={{ background: HD_ORANGE, color: '#fff' }}>
              + Add First Unit
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]" style={{ background: '#111920' }}>
            <thead style={{ background: '#162030' }}>
              <tr>
                {['Unit #', 'Fleet', 'Manufacturer / Model', 'Year', 'Refrigerant', 'Total Hours', 'Next PM', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(units as unknown as {
                id: string; unit_number: string; manufacturer: string; model: string
                year: number | null; refrigerant_type: string | null; total_hours: number | null
                next_pm_due_hours: number | null; status: string
                fleet_account: { fleet_name: string } | null
              }[]).map((u, i) => {
                const hoursUntil = u.next_pm_due_hours !== null && u.total_hours !== null
                  ? Number(u.next_pm_due_hours) - Number(u.total_hours)
                  : null
                return (
                  <tr key={u.id} style={{ borderTop: i > 0 ? '1px solid #1e3040' : undefined }}>
                    <td className="px-4 py-3 text-sm text-white font-medium">{u.unit_number}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>{u.fleet_account?.fleet_name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-white">{u.manufacturer} {u.model}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>{u.year ?? '—'}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{u.refrigerant_type ?? 'R-404A'}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
                      {u.total_hours !== null ? `${Number(u.total_hours).toFixed(0)} hrs` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {hoursUntil !== null ? (
                        <span style={{ color: hoursUntil <= 0 ? '#EF4444' : hoursUntil <= 200 ? HD_ORANGE : '#22C55E' }}>
                          {hoursUntil <= 0 ? 'OVERDUE' : `${hoursUntil.toFixed(0)} hrs`}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full capitalize"
                        style={{ background: `${statusColor(u.status)}20`, color: statusColor(u.status) }}>
                        {u.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <PartsComingSoon />
    </main>
  )
}
