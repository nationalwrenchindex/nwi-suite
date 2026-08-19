import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import {
  EQUIPMENT_TYPE_LABEL, EQUIPMENT_INTERVAL_DAYS, isEquipmentType,
} from '@/lib/hd/equipment/forms'
import type { EquipmentType } from '@/types/equipment'

export const metadata = { title: 'Equipment Inspections — NWI HD Suite' }

const HD_ORANGE = '#E85D24'

interface Row {
  id:              string
  equipment_type:  string
  inspection_date: string
  overall_result:  string | null
  removed_from_service: boolean | null
  inspector_name:  string | null
  operator_name:   string | null
  unit_id:         string | null
  unit_identifier: string | null
  unit_make:       string | null
  unit_model:      string | null
  created_at:      string
}

interface UnitRow { id: string; unit_number: string | null; manufacturer: string | null; model: string | null }

/** Whole days elapsed since a DATE column, computed at local midday to dodge TZ drift. */
function daysSince(date: string): number {
  const then = new Date(`${date}T12:00:00`).getTime()
  const now  = new Date().setHours(12, 0, 0, 0)
  return Math.max(0, Math.round((now - then) / 86_400_000))
}

export default async function EquipmentInspectionsDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDStarterAccess(user.id)
  if (!hasAccess) redirect('/hd/upgrade')

  const [{ data: inspections }, { data: units }] = await Promise.all([
    supabase
      .from('hd_equipment_inspections')
      .select('id, equipment_type, inspection_date, overall_result, removed_from_service, inspector_name, operator_name, unit_id, unit_identifier, unit_make, unit_model, created_at')
      .eq('user_id', user.id)
      .order('inspection_date', { ascending: false })
      .limit(500),
    supabase
      .from('hd_units')
      .select('id, unit_number, manufacturer, model')
      .eq('user_id', user.id),
  ])

  const rows     = (inspections ?? []) as unknown as Row[]
  const unitMap  = new Map((units ?? []).map(u => [u.id, u as UnitRow]))

  // Group by machine, then keep the newest inspection of each type on it. A unit
  // can carry several classes of inspection (a backhoe inspected as a backhoe, a
  // forklift attachment inspected as a forklift), so the key is unit + type.
  const machines = new Map<string, { label: string; unitId: string | null; latest: Map<string, Row> }>()

  for (const r of rows) {
    const unit  = r.unit_id ? unitMap.get(r.unit_id) : null
    const key   = r.unit_id ?? `free:${r.unit_identifier ?? r.id}`
    const label = unit
      ? [unit.unit_number, unit.manufacturer, unit.model].filter(Boolean).join(' · ')
      : [r.unit_identifier, r.unit_make, r.unit_model].filter(Boolean).join(' · ') || 'Unregistered machine'

    if (!machines.has(key)) machines.set(key, { label, unitId: r.unit_id, latest: new Map() })
    const m = machines.get(key)!
    // rows arrive newest-first, so the first of each type is the current one.
    if (!m.latest.has(r.equipment_type)) m.latest.set(r.equipment_type, r)
  }

  const machineList = [...machines.values()].sort((a, b) => a.label.localeCompare(b.label))

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="max-w-5xl mx-auto space-y-5">

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-condensed font-bold text-2xl text-white tracking-wide">EQUIPMENT INSPECTIONS</h1>
            <p className="text-white/40 text-sm mt-0.5">
              Latest inspection per machine and class, with overdue flagging.
            </p>
          </div>
          <Link
            href="/hd/equipment-inspections/new"
            className="px-4 py-2 rounded-lg text-xs font-condensed font-bold tracking-wide"
            style={{ background: `${HD_ORANGE}18`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}55` }}
          >
            + New Equipment Inspection
          </Link>
        </div>

        {machineList.length === 0 ? (
          <div className="rounded-xl p-8 text-center" style={{ background: '#111920', border: '1px solid #1e3040' }}>
            <p className="text-white/40 text-sm">No equipment inspections recorded yet.</p>
            <p className="text-white/25 text-xs mt-1">
              Start one from a work order, or with the button above.
            </p>
          </div>
        ) : (
          machineList.map(m => (
            <div key={m.label + (m.unitId ?? '')} className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
              <div className="px-5 py-3 flex items-center justify-between" style={{ background: '#0d1820', borderBottom: '1px solid #1e3040' }}>
                <p className="font-condensed font-bold text-white text-sm tracking-widest">{m.label.toUpperCase()}</p>
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  {m.latest.size} class{m.latest.size !== 1 ? 'es' : ''} inspected
                </span>
              </div>

              <div style={{ background: '#111920' }}>
                {[...m.latest.entries()].map(([type, r], i) => {
                  const interval = isEquipmentType(type) ? EQUIPMENT_INTERVAL_DAYS[type as EquipmentType] : 1
                  const age      = daysSince(r.inspection_date)
                  const overdue  = age > interval
                  const passed   = r.overall_result === 'pass'
                  const label    = isEquipmentType(type) ? EQUIPMENT_TYPE_LABEL[type as EquipmentType] : type

                  return (
                    <div
                      key={type}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                      style={{ borderTop: i > 0 ? '1px solid #1e3040' : undefined }}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white">{label}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          {new Date(`${r.inspection_date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {' · '}{r.inspector_name ?? r.operator_name ?? 'Unsigned'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {r.removed_from_service && (
                          <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                            style={{ background: '#EF444420', color: '#EF4444', border: '1px solid #EF444450' }}>
                            OUT OF SERVICE
                          </span>
                        )}
                        {overdue && (
                          <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                            style={{ background: `${HD_ORANGE}20`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}55` }}>
                            OVERDUE · {age}d
                          </span>
                        )}
                        <span className="text-xs font-bold px-2.5 py-1 rounded-full"
                          style={{
                            background: passed ? '#22C55E20' : '#EF444420',
                            color:      passed ? '#22C55E'   : '#EF4444',
                            border:     `1px solid ${passed ? '#22C55E50' : '#EF444450'}`,
                          }}>
                          {passed ? 'PASS' : 'FAIL'}
                        </span>
                        <Link
                          href={`/hd/equipment-inspections/${r.id}`}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                          style={{ background: `${HD_ORANGE}20`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}40` }}
                        >
                          View
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  )
}
