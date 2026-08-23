'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { FleetBranding } from '@/types/fleet-pro-partner'
import type { FleetProUnitRow, ServiceEvent, ServiceEventKind, PmState } from '@/types/fleet-pro'
import { NWI_BLUE, NWI_ORANGE } from '../brand'

// ─── Wire shape ───────────────────────────────────────────────────────────────
// Lives here rather than in src/types because this is the only surface that speaks
// it, and this file is client-safe (no Supabase imports) so the route can pull the
// same declarations back with a type-only import instead of keeping a second copy.

export interface PartnerAccountSummary {
  fleet_account_id:  string
  fleet_name:        string
  branding:          FleetBranding
  unit_count:        number
  member_count:      number
  fleet_pro_enabled: boolean
  fleet_pro_status:  string | null
}

/** A fleet unit as the partner sees it — spend is never withheld at this layer. */
export interface PartnerAccountUnitRow extends FleetProUnitRow {
  lifetime_spend:    number
  open_defect_count: number
}

export type PartnerEventKind = ServiceEventKind

export interface PartnerAccountEvent extends Omit<ServiceEvent, 'kind'> {
  kind:        PartnerEventKind
  unit_id:     string | null
  unit_number: string | null
}

export interface PartnerCostSummary {
  revenue_mtd:      number
  revenue_ytd:      number
  lifetime_revenue: number
  labor_billed:     number
  parts_billed:     number
  invoice_count:    number
  avg_invoice:      number
}

export interface PartnerAccountDetail {
  account:       PartnerAccountSummary
  units:         PartnerAccountUnitRow[]
  recent_events: PartnerAccountEvent[]
  cost_summary:  PartnerCostSummary
}

// ─── Palette ──────────────────────────────────────────────────────────────────

const CARD   = '#111920'
const STRIP  = '#162030'
const BORDER = '#1e3040'
const RED    = '#ef4444'
const GREEN  = '#22C55E'

const DIM  = 'rgba(255,255,255,0.4)'
const DIM2 = 'rgba(255,255,255,0.55)'

const KIND_COLOR: Record<PartnerEventKind, string> = {
  work_order:           NWI_ORANGE,
  invoice:              NWI_BLUE,
  pm_checklist:         GREEN,
  dot_inspection:       '#A78BFA',
  aerial_inspection:    '#A78BFA',
  equipment_inspection: '#A78BFA',
  pretrip:              '#38BDF8',
}

const KIND_LABEL: Record<PartnerEventKind, string> = {
  work_order:           'Work Order',
  invoice:              'Invoice',
  pm_checklist:         'PM',
  dot_inspection:       'DOT',
  aerial_inspection:    'Aerial',
  equipment_inspection: 'Equipment',
  pretrip:              'Pre-Trip',
}

const PM_STYLE: Record<PmState, { label: string; color: string }> = {
  overdue:     { label: 'Overdue',     color: RED        },
  due_soon:    { label: 'Due Soon',    color: NWI_ORANGE },
  scheduled:   { label: 'Scheduled',   color: GREEN      },
  unscheduled: { label: 'Unscheduled', color: 'rgba(255,255,255,0.35)' },
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
})

// Whole dollars in the KPI strip: six tiles of cents is noise at a glance.
const USD_WHOLE = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0,
})

function fmtMoney(value: number | null) {
  return value == null ? '—' : USD.format(value)
}

function fmtMoneyWhole(value: number | null) {
  return value == null ? '—' : USD_WHOLE.format(value)
}

function fmtDate(value: string | null) {
  if (!value) return '—'
  const d = new Date(`${value}T12:00:00`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function isFail(result: string | null) {
  return (result ?? '').toLowerCase() === 'fail'
}

const TH = 'px-4 py-3 text-left text-xs uppercase tracking-wider'
const TH_R = 'px-4 py-3 text-right text-xs uppercase tracking-wider'

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="inline-block text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap capitalize"
      style={{ background: `${color}20`, color }}
    >
      {text}
    </span>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl px-4 py-3 min-w-0" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
      <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: DIM }}>{label}</p>
      <p className="font-condensed font-bold text-xl tracking-wide truncate tabular-nums" style={{ color: color ?? '#ffffff' }}>
        {value}
      </p>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AccountDetailClient({ accountId }: { accountId: string }) {
  const [detail,  setDetail]  = useState<PartnerAccountDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res  = await fetch(`/api/fleet-pro/partner/accounts/${accountId}/detail`, { cache: 'no-store' })
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setError((json as { error?: string }).error ?? 'Could not load this account')
          setDetail(null)
        } else {
          setDetail((json as { detail: PartnerAccountDetail }).detail)
        }
      } catch {
        if (!cancelled) setError('Could not load this account')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [accountId])

  const backLink = (
    <p className="text-xs uppercase tracking-widest mb-1" style={{ color: DIM }}>
      <Link href="/fleet-pro/partner" className="hover:underline">&larr; All Accounts</Link>
    </p>
  )

  if (loading) {
    return (
      <>
        {backLink}
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">LOADING&hellip;</h1>
      </>
    )
  }

  if (error || !detail) {
    return (
      <>
        {backLink}
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">ACCOUNT UNAVAILABLE</h1>
        <div className="rounded-xl p-6 mt-4" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <p className="text-sm" style={{ color: DIM2 }}>{error ?? 'Could not load this account'}</p>
          <Link href="/fleet-pro/partner" className="inline-block mt-4 text-sm font-semibold" style={{ color: NWI_ORANGE }}>
            Back to accounts
          </Link>
        </div>
      </>
    )
  }

  const { account, units, recent_events, cost_summary } = detail
  const branding = account.branding

  // THE white-label point: a branded account wears its own accent, and only falls
  // back to NWI orange when the partner never set one.
  const accent = branding.brand_accent_color || NWI_ORANGE

  const overdue  = units.filter(u => u.pm_state === 'overdue').length
  const defects  = units.reduce((sum, u) => sum + u.open_defect_count, 0)
  const statusText = account.fleet_pro_enabled ? (account.fleet_pro_status ?? 'active') : 'disabled'
  const statusColor = account.fleet_pro_enabled && account.fleet_pro_status !== 'canceled' ? GREEN : RED

  return (
    <>
      {backLink}

      {/* ── Branded header ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-1">
        {branding.brand_logo_url && (
          /* eslint-disable-next-line @next/next/no-img-element -- partner logos are
             arbitrary external URLs; next/image would need every host allow-listed. */
          <img
            src={branding.brand_logo_url}
            alt={branding.brand_name}
            className="h-10 w-auto object-contain flex-shrink-0"
            style={{ maxWidth: 180 }}
          />
        )}
        <h1 className="font-condensed font-bold text-3xl tracking-wide" style={{ color: accent }}>
          {branding.brand_name}
        </h1>
        <Pill text={statusText} color={statusColor} />
        {overdue > 0 && <Pill text={`${overdue} overdue PM`} color={RED} />}
        {defects > 0 && <Pill text={`${defects} open defect${defects === 1 ? '' : 's'}`} color={RED} />}
      </div>
      <p className="text-sm mb-4" style={{ color: DIM2 }}>
        {account.fleet_name}
        <span style={{ color: DIM }}>
          {' · '}{account.unit_count} unit{account.unit_count === 1 ? '' : 's'}
          {' · '}{account.member_count} portal user{account.member_count === 1 ? '' : 's'}
        </span>
      </p>

      {/* ── KPI strip. Cost basis is the partner's whole reason for this page. ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-2">
        <Stat label="Units"        value={String(account.unit_count)} />
        <Stat label="Revenue MTD"  value={fmtMoneyWhole(cost_summary.revenue_mtd)} color={accent} />
        <Stat label="Revenue YTD"  value={fmtMoneyWhole(cost_summary.revenue_ytd)} color={accent} />
        <Stat label="Lifetime"     value={fmtMoneyWhole(cost_summary.lifetime_revenue)} />
        <Stat label="Labor Billed" value={fmtMoneyWhole(cost_summary.labor_billed)} color={NWI_BLUE} />
        <Stat label="Parts Billed" value={fmtMoneyWhole(cost_summary.parts_billed)} color={NWI_BLUE} />
      </div>

      <p className="text-xs mb-6" style={{ color: DIM }}>
        {cost_summary.invoice_count} invoice{cost_summary.invoice_count === 1 ? '' : 's'} billed
        {' · '}average {fmtMoney(cost_summary.avg_invoice)}
        {' · '}revenue counts billed invoices only. Work order totals are shown for reference and are
        never added, since the invoice raised from a work order bills the same labor and parts.
      </p>

      {/* ── Units ───────────────────────────────────────────────────────────── */}
      <h2 className="font-condensed font-bold text-xl text-white tracking-wide mb-3">UNITS</h2>

      {units.length === 0 ? (
        <div className="rounded-xl p-6 text-center mb-6" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <p className="text-sm" style={{ color: DIM2 }}>No units on this account yet.</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden mb-6" style={{ border: `1px solid ${BORDER}` }}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]" style={{ background: CARD }}>
              <thead style={{ background: STRIP }}>
                <tr>
                  <th className={TH}   style={{ color: DIM }}>Unit</th>
                  <th className={TH}   style={{ color: DIM }}>PM</th>
                  <th className={TH}   style={{ color: DIM }}>Last Service</th>
                  <th className={TH}   style={{ color: DIM }}>Defects</th>
                  <th className={TH_R} style={{ color: DIM }}>MTD</th>
                  <th className={TH_R} style={{ color: DIM }}>YTD</th>
                  <th className={TH_R} style={{ color: DIM }}>Lifetime</th>
                </tr>
              </thead>
              <tbody>
                {units.map((unit, i) => {
                  const pm = PM_STYLE[unit.pm_state]
                  const identity = [unit.year ? String(unit.year) : null, unit.manufacturer, unit.model]
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <tr key={unit.id} style={i > 0 ? { borderTop: `1px solid ${BORDER}` } : undefined}>
                      <td className="px-4 py-3">
                        <Link
                          href={`/fleet-pro/units/${unit.id}`}
                          className="text-sm font-semibold hover:underline"
                          style={{ color: accent }}
                        >
                          {unit.unit_number || 'Unit'}
                        </Link>
                        {identity && <p className="text-xs mt-0.5" style={{ color: DIM }}>{identity}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <Pill text={pm.label} color={pm.color} />
                        {unit.next_due_date && (
                          <p className="text-xs mt-0.5 whitespace-nowrap" style={{ color: DIM }}>
                            {fmtDate(unit.next_due_date)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: DIM2 }}>
                        {fmtDate(unit.last_service_date)}
                        {unit.last_inspection_date && (
                          <p className="text-xs mt-0.5" style={{ color: DIM }}>
                            Insp {fmtDate(unit.last_inspection_date)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm tabular-nums" style={{ color: unit.open_defect_count > 0 ? RED : DIM }}>
                        {unit.open_defect_count > 0 ? unit.open_defect_count : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums whitespace-nowrap text-white">
                        {fmtMoney(unit.spend_mtd)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums whitespace-nowrap text-white">
                        {fmtMoney(unit.spend_ytd)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums whitespace-nowrap font-semibold" style={{ color: accent }}>
                        {fmtMoney(unit.lifetime_spend)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Recent activity ─────────────────────────────────────────────────── */}
      <h2 className="font-condensed font-bold text-xl text-white tracking-wide mb-3">RECENT ACTIVITY</h2>

      {recent_events.length === 0 ? (
        <div className="rounded-xl p-6 text-center" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <p className="text-sm" style={{ color: DIM2 }}>Nothing has been recorded against this account yet.</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]" style={{ background: CARD }}>
              <thead style={{ background: STRIP }}>
                <tr>
                  <th className={TH}   style={{ color: DIM }}>Date</th>
                  <th className={TH}   style={{ color: DIM }}>Unit</th>
                  <th className={TH}   style={{ color: DIM }}>Type</th>
                  <th className={TH}   style={{ color: DIM }}>Description</th>
                  <th className={TH}   style={{ color: DIM }}>Reference</th>
                  <th className={TH}   style={{ color: DIM }}>Result</th>
                  <th className={TH_R} style={{ color: DIM }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {recent_events.map((event, i) => {
                  const failed = isFail(event.result)
                  const color  = failed ? RED : KIND_COLOR[event.kind]
                  return (
                    <tr
                      key={`${event.kind}-${event.id}`}
                      style={i > 0 ? { borderTop: `1px solid ${BORDER}` } : undefined}
                    >
                      <td className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: DIM2 }}>
                        {fmtDate(event.date || null)}
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">
                        {event.unit_id
                          ? <Link href={`/fleet-pro/units/${event.unit_id}`} className="hover:underline" style={{ color: accent }}>
                              {event.unit_number || 'Unit'}
                            </Link>
                          : <span style={{ color: DIM }}>—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <Pill text={KIND_LABEL[event.kind]} color={color} />
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm" style={{ color: failed ? RED : '#ffffff' }}>{event.title}</p>
                        {event.detail && <p className="text-xs mt-0.5" style={{ color: DIM }}>{event.detail}</p>}
                        {event.status && <p className="text-xs mt-0.5 capitalize" style={{ color: DIM }}>{event.status}</p>}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono whitespace-nowrap" style={{ color: DIM2 }}>
                        {event.reference ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {event.result
                          ? <Pill text={event.result} color={failed ? RED : GREEN} />
                          : <span className="text-sm" style={{ color: DIM }}>—</span>}
                      </td>
                      <td
                        className="px-4 py-3 text-sm text-right tabular-nums whitespace-nowrap"
                        style={{ color: event.cost == null ? DIM : '#ffffff' }}
                      >
                        {fmtMoney(event.cost)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
