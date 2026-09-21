import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { buildPMReport } from '@/lib/hd/pm-report-items'

export const metadata = { title: 'PM Report — NWI HD Suite' }

const HD_ORANGE = '#E85D24'

interface Flagged { id?: string; text?: string; section?: string }

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export default async function PMChecklistReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) redirect('/hd/upgrade')

  const { data: pm } = await supabase
    .from('hd_pm_checklists')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!pm) notFound()

  let unitLabel = ''
  if (pm.unit_id) {
    const { data: unit } = await supabase
      .from('hd_units')
      .select('unit_number, manufacturer, model')
      .eq('id', pm.unit_id)
      .maybeSingle()
    if (unit) unitLabel = [unit.unit_number, unit.manufacturer, unit.model].filter(Boolean).join(' ')
  }

  const flagged   = Array.isArray(pm.flagged_items) ? (pm.flagged_items as Flagged[]) : []
  // The complete record — every point the tech actually inspected, with its result.
  // `inspected` now comes from the same join the item list is built from, so the count
  // in the summary can never disagree with the number of rows below it.
  const report    = buildPMReport(pm.checklist_data)
  const inspected = report.total
  const sig       = pm.signature_base64 as string | null

  const rows: [string, string][] = [
    ['PM Type', String(pm.pm_type ?? '—')],
    ['Unit', unitLabel || '—'],
    ['Customer', (pm.customer_name as string) || '—'],
    ['Date', fmtDate(pm.completed_at as string | null)],
    ['Technician', (pm.tech_name as string) || (pm.tech_initials as string) || '—'],
    ['Items Inspected', String(inspected)],
    ['Result Breakdown', `${report.passed} pass · ${report.failed} fail · ${report.na} N/A`],
    ['Items Flagged', String(flagged.length)],
    ['Battery CCA', pm.battery_cca != null ? `${pm.battery_cca} CCA${Number(pm.battery_cca) < 800 ? ' — REPLACE' : ''}` : '—'],
    ['Alarm Codes Found', (pm.alarm_codes_found as string) || '—'],
    ['Alarm Codes Cleared', (pm.alarm_codes_cleared as string) || '—'],
  ]

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <Link href="/hd/dashboard" className="text-xs" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>← Dashboard</Link>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-2xl">📋</span>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">PM CHECKLIST REPORT</h1>
          </div>
          {pm.invoice_id && (
            <Link href={`/hd/invoices/${pm.invoice_id}`} className="text-xs mt-1 inline-block" style={{ color: '#60A5FA' }}>
              View linked invoice →
            </Link>
          )}
        </div>

        <div className="rounded-xl overflow-hidden mb-6" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}>
          {rows.map(([label, value], i) => (
            <div key={label} className="flex justify-between gap-4 px-5 py-3 text-sm" style={{ borderTop: i > 0 ? '1px solid var(--hd-border)' : undefined }}>
              <span style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>{label}</span>
              <span className="text-right text-white">{value}</span>
            </div>
          ))}
        </div>

        <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-3">FLAGGED ITEMS — CUSTOMER REVIEW</p>
          {flagged.length === 0 ? (
            <p className="text-sm" style={{ color: '#22C55E' }}>None — all inspected items passed.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--hd-border)' }}>
              {flagged.map((f, i) => (
                <div key={f.id ?? i} className="py-2 text-sm">
                  <span style={{ color: HD_ORANGE }}>⚑ </span>
                  <span className="text-white">{f.text}</span>
                  {f.section && <span className="text-xs ml-2" style={{ color: 'rgba(var(--hd-ink-rgb), 0.3)' }}>{f.section}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* COMPLETE INSPECTION RECORD.
            Previously this report showed only the flagged items, so a customer saw the
            handful that failed and had to take the other seventy on trust. Every point
            the tech inspected is now listed with its own result. Failures keep the red
            treatment; passes and N/A are muted so the failures still read at a glance. */}
        {report.sections.length > 0 && (
          <div className="rounded-xl overflow-hidden mb-6" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}>
            <div className="px-5 py-3" style={{ background: 'var(--hd-sunken)', borderBottom: '1px solid var(--hd-border)' }}>
              <p className="font-condensed font-bold text-white text-lg tracking-wide">COMPLETE INSPECTION RECORD</p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.35)' }}>
                Every point inspected on this unit, with its result.
              </p>
            </div>

            {report.sections.map(section => (
              <div key={section.id}>
                <div className="px-5 py-2" style={{ background: 'var(--hd-inner)', borderTop: '1px solid var(--hd-border)', borderBottom: '1px solid var(--hd-border)' }}>
                  <p className="font-condensed font-bold text-xs tracking-widest" style={{ color: 'rgba(var(--hd-ink-rgb), 0.55)' }}>
                    {section.title.toUpperCase()}
                  </p>
                </div>
                {section.items.map((item, i) => {
                  const color =
                    item.state === 'pass' ? '#22C55E'
                    : item.state === 'flag' ? '#EF4444'
                    : item.state === 'na'   ? 'rgba(var(--hd-ink-rgb), 0.35)'
                    : 'rgba(var(--hd-ink-rgb), 0.25)'
                  return (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-4 px-5 py-2.5 text-sm"
                      style={{
                        borderTop: i > 0 ? '1px solid #16202c' : undefined,
                        background: item.failed ? 'rgba(239,68,68,0.07)' : undefined,
                      }}
                    >
                      <span style={{ color: item.failed ? '#FCA5A5' : 'rgba(var(--hd-ink-rgb), 0.75)' }}>
                        <span className="text-xs mr-2" style={{ color: 'rgba(var(--hd-ink-rgb), 0.25)' }}>{item.id}</span>
                        {item.text}
                      </span>
                      <span
                        className="font-condensed font-bold text-xs tracking-wide whitespace-nowrap mt-0.5"
                        style={{ color }}
                      >
                        {item.label.toUpperCase()}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl p-5" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-3">TECHNICIAN SIGNATURE</p>
          {sig ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sig} alt="Signature" style={{ maxHeight: 100, background: '#fff', borderRadius: 6, padding: 4 }} />
          ) : (
            <p className="text-sm" style={{ color: 'rgba(var(--hd-ink-rgb), 0.5)' }}>Signed digitally</p>
          )}
          {/* Signing stamp, matching the aerial and DOT detail pages. Rows predating
              migration 126 have no locked_at and simply omit the line. */}
          {pm.locked && pm.locked_at != null && (
            <p className="text-xs mt-3" style={{ color: 'rgba(var(--hd-ink-rgb), 0.35)' }}>
              Record locked {new Date(pm.locked_at as string).toLocaleString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: 'numeric', minute: '2-digit',
              })} · ID {String(pm.id).slice(0, 8)}
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
