'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { FleetProUnitDetail, ServiceEvent, ServiceEventKind, PmState } from '@/types/fleet-pro'
import { NWI_BLUE, NWI_ORANGE } from './brand'

const ACCENT = NWI_ORANGE
const CARD   = '#111920'
const STRIP  = '#162030'
const BORDER = '#1e3040'
const RED    = '#ef4444'

const DIM  = 'rgba(255,255,255,0.4)'
const DIM2 = 'rgba(255,255,255,0.55)'

// One color per record type, so a manager scanning years of history can find the
// invoices without reading the Type column.
const KIND_COLOR: Record<ServiceEventKind, string> = {
  work_order:           ACCENT,
  invoice:              NWI_BLUE,
  pm_checklist:         '#22C55E',
  dot_inspection:       '#A78BFA',
  aerial_inspection:    '#A78BFA',
  equipment_inspection: '#A78BFA',
}

const KIND_LABEL: Record<ServiceEventKind, string> = {
  work_order:           'Work Order',
  invoice:              'Invoice',
  pm_checklist:         'PM',
  dot_inspection:       'DOT',
  aerial_inspection:    'Aerial',
  equipment_inspection: 'Equipment',
}

const PM_STYLE: Record<PmState, { label: string; color: string }> = {
  overdue:     { label: 'Overdue',     color: RED       },
  due_soon:    { label: 'Due Soon',    color: NWI_ORANGE },
  scheduled:   { label: 'Scheduled',   color: '#22C55E' },
  unscheduled: { label: 'Unscheduled', color: 'rgba(255,255,255,0.35)' },
}

function fmtDate(value: string | null) {
  if (!value) return '—'
  const d = new Date(`${value}T12:00:00`)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMoney(value: number | null) {
  if (value == null) return '—'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function isFail(result: string | null) {
  return (result ?? '').toLowerCase() === 'fail'
}

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
      <p className="font-condensed font-bold text-xl tracking-wide truncate" style={{ color: color ?? '#ffffff' }}>
        {value}
      </p>
    </div>
  )
}

export default function UnitDetailClient({ unitId }: { unitId: string }) {
  const [detail,  setDetail]  = useState<FleetProUnitDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res  = await fetch(`/api/fleet-pro/units/${unitId}`, { cache: 'no-store' })
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setError((json as { error?: string }).error ?? 'Could not load this unit')
          setDetail(null)
        } else {
          setDetail((json as { detail: FleetProUnitDetail }).detail)
        }
      } catch {
        if (!cancelled) setError('Could not load this unit')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [unitId])

  const backLink = (
    <p className="text-xs uppercase tracking-widest mb-1" style={{ color: DIM }}>
      <Link href="/fleet-pro" className="hover:underline">&larr; Fleet</Link>
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
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">UNIT UNAVAILABLE</h1>
        <div className="rounded-xl p-6 mt-4" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <p className="text-sm" style={{ color: DIM2 }}>{error ?? 'Could not load this unit'}</p>
          <Link href="/fleet-pro" className="inline-block mt-4 text-sm font-semibold" style={{ color: ACCENT }}>
            Back to fleet
          </Link>
        </div>
      </>
    )
  }

  const { unit, events, total_spend, event_count, can_view_costs } = detail
  const pm = PM_STYLE[unit.pm_state]

  const identity = [unit.year ? String(unit.year) : null, unit.manufacturer, unit.model]
    .filter(Boolean)
    .join(' ')

  const facts: { label: string; value: string }[] = [
    { label: 'Type',          value: unit.unit_type ?? '—' },
    { label: 'Serial',        value: unit.serial_number ?? '—' },
    // Thermo King build number — how a reefer's spec is actually looked up.
    { label: 'BM Number',     value: unit.bm_number ?? '—' },
    { label: 'Truck/Trailer', value: unit.truck_trailer_number ?? '—' },
    { label: 'Hours',         value: unit.total_hours == null ? '—' : unit.total_hours.toLocaleString('en-US') },
  ]

  return (
    <>
      {/* ── Identity header ─────────────────────────────────────────────────── */}
      {backLink}
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
          {unit.unit_number || 'Unit'}
        </h1>
        {unit.status && <Pill text={unit.status} color={ACCENT} />}
        {unit.open_inspection_issue && <Pill text="Failed inspection" color={RED} />}
      </div>
      {identity && <p className="text-sm mb-4" style={{ color: DIM2 }}>{identity}</p>}

      <div
        className="rounded-xl px-4 py-3 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-4"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        {facts.map(f => (
          <div key={f.label} className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest mb-0.5" style={{ color: DIM }}>{f.label}</p>
            <p className="text-sm text-white truncate">{f.value}</p>
          </div>
        ))}
      </div>

      {/* ── Stat strip. Total spend is absent, not blanked, for viewers. ─────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {can_view_costs && <Stat label="Total Spend" value={fmtMoney(total_spend)} color={ACCENT} />}
        <Stat label="Service Records" value={String(event_count)} />
        <Stat label="PM Status"       value={pm.label} color={pm.color} />
        <Stat label="Last Service"    value={fmtDate(unit.last_service_date)} />
      </div>

      {/* ── Service history ─────────────────────────────────────────────────── */}
      <h2 className="font-condensed font-bold text-xl text-white tracking-wide mb-3">SERVICE HISTORY</h2>

      {events.length === 0 ? (
        <div className="rounded-xl p-6 text-center" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <p className="text-sm" style={{ color: DIM2 }}>No service records for this unit yet.</p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]" style={{ background: CARD }}>
              <thead style={{ background: STRIP }}>
                <tr>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: DIM }}>Date</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: DIM }}>Type</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: DIM }}>Description</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: DIM }}>Reference</th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: DIM }}>Result</th>
                  {can_view_costs && (
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: DIM }}>Cost</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {events.map((event: ServiceEvent, i: number) => {
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
                      <td className="px-4 py-3">
                        <Pill text={KIND_LABEL[event.kind]} color={color} />
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm" style={{ color: failed ? RED : '#ffffff' }}>{event.title}</p>
                        {event.detail && (
                          <p className="text-xs mt-0.5" style={{ color: DIM }}>{event.detail}</p>
                        )}
                        {event.status && (
                          <p className="text-xs mt-0.5 capitalize" style={{ color: DIM }}>{event.status}</p>
                        )}
                      </td>
                      {/* Invoice and inspection numbers are shown, never linked — the
                          mechanic's document pages are not the fleet's to open. */}
                      <td className="px-4 py-3 text-sm font-mono whitespace-nowrap" style={{ color: DIM2 }}>
                        {event.reference ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {event.result
                          ? <Pill text={event.result} color={failed ? RED : '#22C55E'} />
                          : <span className="text-sm" style={{ color: DIM }}>—</span>}
                      </td>
                      {can_view_costs && (
                        <td className="px-4 py-3 text-sm whitespace-nowrap" style={{ color: event.cost == null ? DIM : '#ffffff' }}>
                          {fmtMoney(event.cost)}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {can_view_costs && events.some(e => e.kind === 'work_order') && (
        <p className="text-xs mt-3" style={{ color: DIM }}>
          Total spend is billed invoices only. Work order amounts are shown for reference and are not added
          to the total, since the invoice raised from a work order bills the same labor and parts.
        </p>
      )}
    </>
  )
}
