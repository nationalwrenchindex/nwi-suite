import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'PM Schedules — NWI HD Suite' }

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

export default async function PMSchedulesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const { data: units } = await supabase
    .from('hd_units')
    .select('*, fleet_account:hd_fleet_accounts(fleet_name)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('unit_number')

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">PM SCHEDULES</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Thermo King: every 3000 hrs (1500 hr visual) · Carrier: every 1500 hrs (750 hr visual)
          </p>
        </div>
        <Link href="/hd/pm-checklist"
          className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white"
          style={{ background: HD_ORANGE }}
        >
          Start PM Checklist
        </Link>
      </div>

      {/* PM intervals reference */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {[
          {
            brand: 'Thermo King',
            color: HD_ORANGE,
            intervals: [
              { type: 'Visual Inspection',            hours: '1,500 hrs' },
              { type: 'Full Service — TK Filters',    hours: '3,000 hrs' },
              { type: 'Full Service — Aftermarket',   hours: '750–1,000 hrs max' },
              { type: 'Coolant Flush (recommended)',  hours: '6,000 hrs' },
              { type: 'Coolant Flush (required)',     hours: '12,000 hrs' },
            ],
          },
          {
            brand: 'Carrier Transicold',
            color: HD_BLUE,
            intervals: [
              { type: 'Visual & Tool Inspection',     hours: '750 hrs' },
              { type: 'Fluid & Filter Change',        hours: '1,500 hrs' },
              { type: 'Annual PM + Coolant Flush',    hours: '6,000 hrs' },
              { type: 'HD Coolant Flush',             hours: '12,000 hrs' },
            ],
          },
        ].map(({ brand, color, intervals }) => (
          <div key={brand} className="rounded-xl p-5" style={{ background: '#111920', border: `1px solid ${color}40` }}>
            <p className="font-condensed font-bold text-white text-lg tracking-wide mb-3" style={{ color }}>{brand}</p>
            {intervals.map(({ type, hours }) => (
              <div key={type} className="flex justify-between py-2 border-b text-sm" style={{ borderColor: '#1e3040' }}>
                <span style={{ color: 'rgba(255,255,255,0.7)' }}>{type}</span>
                <span className="font-medium" style={{ color }}>{hours}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Unit PM status */}
      <h2 className="font-condensed font-bold text-white text-xl tracking-wide mb-4">FLEET UNIT STATUS</h2>
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
        {!units || units.length === 0 ? (
          <div className="py-16 text-center" style={{ background: '#111920' }}>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>No active units — add fleet units to track PM schedules</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]" style={{ background: '#111920' }}>
            <thead style={{ background: '#162030' }}>
              <tr>
                {['Unit', 'Manufacturer / Model', 'Total Hours', 'Last PM', 'Next PM Due', 'Hours Until PM', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(units as unknown as {
                id: string; unit_number: string; manufacturer: string; model: string
                total_hours: number | null; last_pm_date: string | null; last_pm_type: string | null
                next_pm_due_hours: number | null
              }[]).map((u, i) => {
                const hoursUntil = u.next_pm_due_hours !== null && u.total_hours !== null
                  ? Number(u.next_pm_due_hours) - Number(u.total_hours)
                  : null
                const pmStatus = hoursUntil === null ? 'unknown'
                  : hoursUntil <= 0   ? 'overdue'
                  : hoursUntil <= 200 ? 'due_soon'
                  : 'ok'
                const statusClr = pmStatus === 'overdue' ? '#EF4444' : pmStatus === 'due_soon' ? HD_ORANGE : '#22C55E'
                return (
                  <tr key={u.id} style={{ borderTop: i > 0 ? '1px solid #1e3040' : undefined }}>
                    <td className="px-4 py-3 text-sm text-white font-medium">{u.unit_number}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>{u.manufacturer} {u.model}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      {u.total_hours !== null ? `${Number(u.total_hours).toFixed(0)} hrs` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      {u.last_pm_date ? new Date(u.last_pm_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      {u.next_pm_due_hours !== null ? `${Number(u.next_pm_due_hours).toFixed(0)} hrs` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium" style={{ color: statusClr }}>
                      {hoursUntil === null ? '—' : hoursUntil <= 0 ? 'OVERDUE' : `${hoursUntil.toFixed(0)} hrs`}
                    </td>
                    <td className="px-4 py-3">
                      <Link href="/hd/pm-checklist"
                        className="text-xs px-2.5 py-1 rounded-lg font-medium transition-opacity hover:opacity-80"
                        style={{ background: `${statusClr}20`, color: statusClr }}>
                        {pmStatus === 'overdue' ? 'Start PM Now' : pmStatus === 'due_soon' ? 'PM Due Soon' : 'Schedule PM'}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </main>
  )
}
