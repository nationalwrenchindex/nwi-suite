// /fleet-manager/units/[id] - one unit's repair history, newest first: the date, the
// hours or miles AT THAT VISIT, what was asked and done, the parts used (number,
// description, quantity) and any PM or DOT sheet attached.

import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveFleetManager } from '@/lib/fleet-view/access'
import { getUnitHistory, type SafeSheet } from '@/lib/fleet-view/unit-history'
import { ACCENT, Card, Header, INK, LINE, MUTED, PmBadge, fmtDate, fmtHours, fmtMiles, pmDetail } from '@/components/fleet-manager/ui'

export const dynamic = 'force-dynamic'

/** The existing printable sheets. Both routes admit the fleet manager of the unit's fleet. */
const sheetHref = (s: SafeSheet) => s.kind === 'pm' ? `/api/hd/pm-checklist/${s.id}/pdf` : `/api/hd/dot-inspections/${s.id}/pdf`

function Text({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="text-sm whitespace-pre-line" style={{ color: INK }}>{value}</p>
    </div>
  )
}

export default async function FleetUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/fleet-manager/login')
  const access = await resolveFleetManager(user)
  if (!access) redirect('/fleet-manager/no-access')

  const h = await getUnitHistory(createServiceClient(), access, id)
  if (!h) notFound()
  const { unit, visits } = h
  const reading = [fmtHours(unit.latest_hours), fmtMiles(unit.latest_miles)].filter(Boolean).join(' / ')
  const detail = pmDetail(unit.pm_due)

  return (
    <main>
      <Header back={{ href: '/fleet-manager', label: 'All units' }} title={unit.unit_number ?? 'Unit'}
        sub={[unit.year, unit.manufacturer, unit.model].filter(Boolean).join(' ') || null} />
      <Card testid="fm-unit-card">
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm space-y-0.5" style={{ color: INK }}>
            {unit.serial_number && <p className="break-all">Serial {unit.serial_number}</p>}
            <p>{reading || 'No reading recorded'}</p>
            {unit.last_pm_date && <p style={{ color: MUTED }}>Last PM {fmtDate(unit.last_pm_date)}{unit.last_pm_type ? ` (${unit.last_pm_type.replace(/_/g, ' ')})` : ''}</p>}
            {detail && <p style={{ color: MUTED }}>{detail}</p>}
          </div>
          <PmBadge due={unit.pm_due} />
        </div>
      </Card>

      <h2 className="mt-6 mb-2 text-sm font-bold uppercase tracking-wide" style={{ color: MUTED }}>Repair history</h2>
      {visits.length === 0 ? (
        <Card><p className="text-sm" style={{ color: MUTED }}>No completed work recorded on this unit yet.</p></Card>
      ) : (
        <ol className="space-y-3" data-testid="fm-history">
          {visits.map(v => {
            const at = [fmtHours(v.hours_at_visit), fmtMiles(v.miles_at_visit)].filter(Boolean).join(' / ')
            return (
              <li key={v.key} data-testid="fm-visit" data-date={v.service_date ?? ''}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-base font-bold" style={{ color: INK }}>{fmtDate(v.service_date)}</p>
                    <p className="text-sm" data-testid="fm-visit-reading" style={{ color: MUTED }}>{at || 'No reading at this visit'}</p>
                  </div>
                  <Text label="Requested" value={v.requested} />
                  <Text label="Work order comments" value={v.comments} />
                  <Text label="Work done" value={v.final_comments} />
                  {v.parts.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Parts used</p>
                      <ul className="mt-1 divide-y" style={{ borderColor: LINE }}>
                        {v.parts.map((p, i) => (
                          <li key={i} data-testid="fm-part" className="flex items-baseline justify-between gap-3 py-1.5 text-sm" style={{ color: INK }}>
                            <span className="min-w-0">
                              {p.part_number && <span className="font-semibold mr-2">{p.part_number}</span>}
                              <span>{p.description ?? ''}</span>
                            </span>
                            <span className="whitespace-nowrap" style={{ color: MUTED }}>Qty {p.quantity ?? '-'}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {v.sheets.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {v.sheets.map(s => (
                        <a key={`${s.kind}:${s.id}`} href={sheetHref(s)} target="_blank" rel="noopener" data-testid="fm-sheet" data-kind={s.kind}
                          className="inline-block rounded-lg px-3 py-2 text-sm font-semibold"
                          style={{ color: ACCENT, border: `1px solid ${ACCENT}`, background: '#FFFFFF' }}>
                          {s.kind === 'pm' ? 'PM sheet' : 'DOT sheet'}{s.result ? ` - ${s.result}` : ''}
                        </a>
                      ))}
                    </div>
                  )}
                </Card>
              </li>
            )
          })}
        </ol>
      )}
    </main>
  )
}
