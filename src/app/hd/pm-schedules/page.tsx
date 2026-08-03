import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'PM Schedules — NWI HD Suite' }

const HD_ORANGE     = '#E85D24'
const HD_BLUE       = '#1A6BAF'
const TRUCK_BLUE    = '#3B82F6'   // distinct from Carrier's HD_BLUE
const TRAILER_GREEN = '#22C55E'

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
              <Link
                key={type}
                href={`/hd/invoices/new?pm_type=${encodeURIComponent(type)}&unit_manufacturer=${encodeURIComponent(brand)}`}
                className="flex justify-between items-center py-2 border-b text-sm transition-colors hover:bg-white/5 rounded px-1 -mx-1"
                style={{ borderColor: '#1e3040' }}
              >
                <span style={{ color: 'rgba(255,255,255,0.7)' }}>{type}</span>
                <span className="font-medium whitespace-nowrap" style={{ color }}>{hours} ›</span>
              </Link>
            ))}
          </div>
        ))}
      </div>
      <p className="text-xs mb-6" style={{ color: 'rgba(255,255,255,0.3)' }}>Tap any interval to start a new invoice pre-filled for that PM service.</p>

      {/* Truck & trailer PM intervals (chassis, mileage/time based) */}
      <h2 className="font-condensed font-bold text-white text-xl tracking-wide mb-4">TRUCK &amp; TRAILER PM INTERVALS</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {[
          {
            brand: 'Class 8 Truck',
            mfr: 'Truck',
            color: TRUCK_BLUE,
            intervals: [
              { type: 'PM-A Dry Service',      when: '25,000 mi / 3 mo',   detail: 'Oil change, filters, visual inspection, grease chassis, check fluids, inspect brakes' },
              { type: 'PM-B Wet Service',      when: '50,000 mi / 6 mo',   detail: 'Everything in PM-A plus coolant check, transmission fluid, differential fluid, belt & hose inspection' },
              { type: 'PM-C Major Service',    when: '100,000 mi / 12 mo', detail: 'Everything in PM-B plus coolant flush, fuel filter replacement, full brake inspection, DOT pre-trip items' },
              { type: 'DOT Annual Inspection', when: 'Every 12 mo',        detail: 'Federally required — FMCSA regulations' },
            ],
          },
          {
            brand: 'Trailer',
            mfr: 'Trailer',
            color: TRAILER_GREEN,
            intervals: [
              { type: '90-Day Inspection',       when: 'Every 90 days', detail: 'Brake adjustment, tire inspection, lights & electrical, glad hands, ABS system check' },
              { type: 'Annual DOT Inspection',   when: 'Every 12 mo',   detail: 'Federally required — FMCSA, full brake system, lighting, structure' },
              { type: 'Tire Rotation/Inspection', when: '25,000 mi',    detail: 'Rotate and inspect all tires' },
              { type: 'Landing Gear Service',    when: 'Annually',      detail: 'Lubricate and inspect landing gear' },
              { type: 'Kingpin Inspection',      when: 'Every 90 days', detail: 'Inspect kingpin wear and upper coupler' },
            ],
          },
        ].map(({ brand, mfr, color, intervals }) => (
          <div key={brand} className="rounded-xl p-5" style={{ background: '#111920', border: `1px solid ${color}40` }}>
            <p className="font-condensed font-bold text-white text-lg tracking-wide mb-3" style={{ color }}>{brand}</p>
            {intervals.map(({ type, when, detail }) => (
              <Link
                key={type}
                href={`/hd/invoices/new?pm_type=${encodeURIComponent(type)}&unit_manufacturer=${encodeURIComponent(mfr)}`}
                className="block py-2 border-b transition-colors hover:bg-white/5 rounded px-1 -mx-1"
                style={{ borderColor: '#1e3040' }}
              >
                <div className="flex justify-between gap-3 text-sm">
                  <span style={{ color: 'rgba(255,255,255,0.7)' }}>{type}</span>
                  <span className="font-medium whitespace-nowrap" style={{ color }}>{when} ›</span>
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{detail}</p>
              </Link>
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
                {['Unit', 'Type', 'Manufacturer / Model', 'Total Hours', 'Last PM', 'Next PM Due', 'Hours Until PM', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(units as unknown as {
                id: string; unit_number: string; manufacturer: string; model: string
                unit_type: string | null
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
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full capitalize"
                        style={{ background: `${u.unit_type === 'truck' ? TRUCK_BLUE : TRAILER_GREEN}20`, color: u.unit_type === 'truck' ? TRUCK_BLUE : TRAILER_GREEN }}>
                        {u.unit_type ?? 'trailer'}
                      </span>
                    </td>
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
