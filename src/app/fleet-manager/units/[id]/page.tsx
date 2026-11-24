// /fleet-manager/units/[id] - one unit's repair history, newest first: the date, the
// work order and invoice numbers, the hours or miles AT THAT VISIT, the complaint,
// comments and work done, any PM or DOT sheet attached - and, on an invoiced visit,
// the invoice exactly as printed for him (lines, fees, discount, tax, total). A job
// never invoiced lists its parts with no prices: no paper ever priced it for him.

import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveFleetManager } from '@/lib/fleet-view/access'
import { getCustomerUnitHistory, type PrintedInvoice, type SafeSheet } from '@/lib/fleet-view/unit-history'
import { money } from '@/lib/format'
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

const qty = (n: number | null) => (n == null ? '-' : n.toLocaleString('en-US', { maximumFractionDigits: 2 }))

/** The invoice as its customer copy prints it (lib/hd/invoice-print). */
function Invoice({ inv }: { inv: PrintedInvoice }) {
  const row = 'flex items-baseline justify-between gap-3 py-1.5 text-sm'
  return (
    <div className="mt-3 rounded-lg p-3" data-testid="fm-invoice" style={{ border: `1px solid ${LINE}`, background: '#F9FAFB' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
          Invoice {inv.invoice_number ?? ''}{inv.date ? ` - ${fmtDate(inv.date)}` : ''}
        </p>
        {inv.voided && <span className="text-xs font-bold" style={{ color: '#991B1B' }}>VOIDED</span>}
      </div>
      {inv.groups.map((g, gi) => (
        <div key={gi} className="mt-2">
          {g.label && <p className="text-sm font-semibold" style={{ color: INK }}>{g.label}</p>}
          {g.labor.length > 0 && (
            <ul className="divide-y" style={{ borderColor: LINE }}>
              {g.labor.map((l, i) => (
                <li key={`l${i}`} data-testid="fm-invoice-line" data-kind="labor" className={row} style={{ color: INK }}>
                  <span className="min-w-0">
                    <span className="block">{l.description ?? 'Labor'}</span>
                    <span className="block text-xs" style={{ color: MUTED }}>{qty(l.hours)}h x {money(l.rate ?? 0)}/hr</span>
                  </span>
                  <span className="whitespace-nowrap font-semibold">{money(l.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {g.parts.length > 0 && (
            <ul className="divide-y" style={{ borderColor: LINE }}>
              {g.parts.map((p, i) => (
                <li key={`p${i}`} data-testid="fm-invoice-line" data-kind="part" className={row} style={{ color: INK }}>
                  <span className="min-w-0">
                    <span className="block">{p.part_number && <span className="font-semibold mr-2">{p.part_number}</span>}{p.description ?? ''}</span>
                    <span className="block text-xs" style={{ color: MUTED }}>Qty {qty(p.quantity)} x {money(p.unit_price ?? 0)}</span>
                  </span>
                  <span className="whitespace-nowrap font-semibold">{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          {g.subtotal != null && (
            <p className={row} style={{ color: MUTED }}><span>{g.label} subtotal</span><span>{money(g.subtotal)}</span></p>
          )}
        </div>
      ))}
      <div className="mt-2 pt-1" style={{ borderTop: `1px solid ${LINE}` }}>
        {inv.summary.map((r, i) => (
          <p key={i} data-testid="fm-invoice-summary" className={row} style={{ color: MUTED }}><span>{r.label}</span><span>{money(r.amount)}</span></p>
        ))}
        <p data-testid="fm-invoice-total" className="flex items-baseline justify-between gap-3 pt-2 text-base font-bold" style={{ color: INK }}>
          <span>Total</span><span>{money(inv.total)}</span>
        </p>
      </div>
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

  const h = await getCustomerUnitHistory(createServiceClient(), access, id)
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
                  {(v.work_order_number || v.invoice_number) && (
                    <p className="mt-1 text-sm font-semibold" data-testid="fm-visit-numbers" style={{ color: INK }}>
                      {[v.work_order_number && `Work order ${v.work_order_number}`, v.invoice_number && `Invoice ${v.invoice_number}`].filter(Boolean).join(' / ')}
                    </p>
                  )}
                  <Text label="Complaint" value={v.requested} />
                  <Text label="Work order comments" value={v.comments} />
                  <Text label="Work done" value={v.final_comments} />
                  {v.invoice ? <Invoice inv={v.invoice} /> : v.parts.length > 0 && (
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
