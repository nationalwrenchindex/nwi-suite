import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import { fetchUnitInspections, inspectionDateLabel } from '@/lib/hd/inspections'

export const metadata = { title: 'Unit Inspection History — NWI HD Suite' }

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

interface UnitRow {
  id:            string
  unit_number:   string
  manufacturer:  string
  model:         string
  serial_number: string | null
  fleet_account: { fleet_name: string } | null
}

export default async function UnitInspectionsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDStarterAccess(user.id)
  if (!hasAccess) redirect('/hd/upgrade')

  // Resolve the unit first: a foreign or bogus id must 404 rather than render an
  // empty history that looks like "this unit has never been inspected".
  const { data: unitData } = await supabase
    .from('hd_units')
    .select('id, unit_number, manufacturer, model, serial_number, fleet_account:hd_fleet_accounts(fleet_name)')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!unitData) notFound()
  const unit = unitData as unknown as UnitRow

  const inspections = await fetchUnitInspections(supabase, user.id, id)

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <Link href="/hd/fleet-units" className="text-xs mb-2 inline-block" style={{ color: 'rgba(255,255,255,0.4)' }}>
            ← Fleet Units
          </Link>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            HD Suite — Compliance
          </p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
            {unit.unit_number} — INSPECTION HISTORY
          </h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {unit.manufacturer} {unit.model}
            {unit.serial_number ? ` · S/N ${unit.serial_number}` : ''}
            {unit.fleet_account?.fleet_name ? ` · ${unit.fleet_account.fleet_name}` : ''}
          </p>
        </div>
        <Link
          href={`/hd/dot-inspections/new?unit=${unit.id}`}
          className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white flex-shrink-0"
          style={{ background: HD_ORANGE }}
        >
          + New DOT Inspection
        </Link>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
        {inspections.length === 0 ? (
          <div className="py-16 text-center" style={{ background: '#111920' }}>
            <svg className="w-10 h-10 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.15)' }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path d="M9 12l2 2 4-4" />
              <path d="M20 6H9M4 6h.01M20 12h-5M4 12h.01M20 18H9M4 18h.01" />
            </svg>
            <p className="text-sm mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>No inspections recorded for this unit</p>
            <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.2)' }}>
              Aerial and DOT inspections filed against this unit will appear here, newest first
            </p>
            <Link
              href={`/hd/dot-inspections/new?unit=${unit.id}`}
              className="text-xs px-4 py-2 rounded-lg font-semibold"
              style={{ background: HD_ORANGE, color: '#fff' }}
            >
              + Record First Inspection
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]" style={{ background: '#111920' }}>
              <thead style={{ background: '#162030' }}>
                <tr>
                  {['Type', 'Date', 'Result', 'Inspector', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inspections.map((ins, i) => {
                  const isPassed = ins.result === 'pass'
                  return (
                    <tr key={`${ins.family}-${ins.id}`} style={{ borderTop: i > 0 ? '1px solid #1e3040' : undefined }}>
                      <td className="px-4 py-3 text-sm text-white font-medium">{ins.typeLabel}</td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
                        {inspectionDateLabel(ins.date)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-xs font-bold px-2.5 py-1 rounded-full"
                          style={{
                            background: isPassed ? '#22C55E20' : '#EF444420',
                            color:      isPassed ? '#22C55E'   : '#EF4444',
                            border:     `1px solid ${isPassed ? '#22C55E50' : '#EF444450'}`,
                          }}
                        >
                          {isPassed ? 'PASS' : 'FAIL'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
                        {ins.inspectorName ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={ins.href}
                          className="text-xs font-semibold px-3 py-1 rounded-lg"
                          style={{ color: '#60A5FA', border: '1px solid #1e3040' }}
                        >
                          View
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

      <p className="text-xs mt-3" style={{ color: 'rgba(255,255,255,0.25)' }}>
        Aerial (ANSI A92) and DOT (49 CFR 396) records combined —{' '}
        <Link href="/hd/dot-inspections" className="underline" style={{ color: HD_BLUE }}>
          all DOT inspections
        </Link>
      </p>
    </main>
  )
}
