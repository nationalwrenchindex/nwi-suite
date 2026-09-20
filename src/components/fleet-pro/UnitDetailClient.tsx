'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { FleetProUnitDetail, FleetProUnitRow, ServiceEvent, ServiceEventKind, PmState } from '@/types/fleet-pro'
import type { MeterReading, UnitMonthCost } from '@/types/fleet-pro-partner'
import type { UnitCostBreakdown } from '@/types/fleet-pro-cost'
import { formatPerHour, formatPerMile } from '@/types/fleet-pro-cost'
import { NWI_BLUE, NWI_ORANGE } from './brand'
import CostTrendChart from './CostTrendChart'
import RegistrationSection from './RegistrationSection'
import ScanInvoiceClient from './ScanInvoiceClient'


interface UnitServiceEvent extends Omit<ServiceEvent, 'kind'> {
  kind:     ServiceEventKind
  pdf_url?: string | null
}

// PM is hours-based on hd_units for most fleets and date-based only when a manager
// sets fleet_pro_pm_schedules by hand. The route resolves which and sends both the
// figure and a ready-made label; src/types/fleet-pro.ts still only knows about the
// date half, so the extra fields are declared here.
type PmSource = 'hours' | 'date' | 'none'

interface DetailUnit extends FleetProUnitRow {
  pm_source?:       PmSource
  pm_label?:        string
  next_due_hours?:  number | null
  hours_remaining?: number | null
  last_pm_date?:    string | null
  last_pm_type?:    string | null
}

interface UnitDetail extends Omit<FleetProUnitDetail, 'events' | 'unit'> {
  unit:            DetailUnit
  events:          UnitServiceEvent[]
  meter_readings?: MeterReading[]
  cost_by_month?:  UnitMonthCost[] | null
  // The rolling twelve-month basis from the cost engine. Distinct from cost_by_month
  // above, which is invoices only — see the route for why both are on the wire.
  cost?:           UnitCostBreakdown | null
}

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
  pretrip:              '#38BDF8',
  tech_service_entry: '#F59E0B',
}

const KIND_LABEL: Record<ServiceEventKind, string> = {
  work_order:           'Work Order',
  invoice:              'Invoice',
  pm_checklist:         'PM',
  dot_inspection:       'DOT',
  aerial_inspection:    'Aerial',
  equipment_inspection: 'Equipment',
  pretrip:              'Pre-Trip',
  tech_service_entry: 'Service Entry',
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

function fmtMonth(month: string) {
  const d = new Date(`${month}-01T12:00:00`)
  if (Number.isNaN(d.getTime())) return month
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function fmtNum(value: number | null) {
  return value == null ? '—' : value.toLocaleString('en-US')
}

function isFail(result: string | null) {
  return (result ?? '').toLowerCase() === 'fail'
}

/**
 * Inline SVG trend line — no chart library. Readings with a null meter are skipped
 * rather than plotted as zero: a pre-trip that recorded hours but not miles must not
 * draw the odometer falling off a cliff.
 */
function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
  const points = values
    .map((value, index) => ({ value, index }))
    .filter((p): p is { value: number; index: number } => p.value != null)

  if (points.length < 2) return null

  const W = 240
  const H = 40
  const PAD = 3
  const min  = Math.min(...points.map(p => p.value))
  const max  = Math.max(...points.map(p => p.value))
  const span = max - min || 1
  const stepX = values.length > 1 ? W / (values.length - 1) : W

  const d = points
    .map((p, i) => {
      const x = (p.index * stepX).toFixed(1)
      const y = (H - PAD - ((p.value - min) / span) * (H - PAD * 2)).toFixed(1)
      return `${i === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  )
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

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string | null; color?: string }) {
  return (
    <div className="rounded-xl px-4 py-3 min-w-0" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
      <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: DIM }}>{label}</p>
      <p className="font-condensed font-bold text-xl tracking-wide truncate" style={{ color: color ?? '#ffffff' }}>
        {value}
      </p>
      {sub && <p className="text-xs mt-0.5 truncate" style={{ color: DIM }}>{sub}</p>}
    </div>
  )
}

/**
 * Manager-only meter entry.
 *
 * The other four writers of this table (pre-trip, work order, PM, invoice) all depend
 * on someone else doing their job first. A trailer nobody pre-trips has no mileage at
 * all, and with no mileage there is no cost per mile — so the figure the whole page is
 * built around is one the manager has to be able to feed himself.
 */
function MeterEntryForm({ unitId, onSaved }: { unitId: string; onSaved: () => void }) {
  const [odometer, setOdometer] = useState('')
  const [hours,    setHours]    = useState('')
  const [date,     setDate]     = useState(() => new Date().toISOString().slice(0, 10))
  const [saving,   setSaving]   = useState(false)
  const [message,  setMessage]  = useState<{ text: string; ok: boolean } | null>(null)

  const today = new Date().toISOString().slice(0, 10)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return

    // Mirrors the route's own rule so the common mistake is answered instantly rather
    // than after a round trip. The server still enforces it — this is a courtesy, not
    // the check.
    if (!odometer.trim() && !hours.trim()) {
      setMessage({ text: 'Enter an odometer reading, engine hours, or both', ok: false })
      return
    }

    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/fleet-pro/units/${unitId}/meter`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          odometer:     odometer.trim() || null,
          engine_hours: hours.trim() || null,
          reading_date: date || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage({ text: (json as { error?: string }).error ?? 'Could not save the reading', ok: false })
        return
      }
      setOdometer('')
      setHours('')
      setMessage({ text: 'Reading saved', ok: true })
      onSaved()
    } catch {
      setMessage({ text: 'Could not save the reading', ok: false })
    } finally {
      setSaving(false)
    }
  }

  const field = 'rounded-lg px-3 py-2 text-sm text-white w-full'
  const fieldStyle = { background: STRIP, border: `1px solid ${BORDER}` }

  return (
    <form onSubmit={submit} className="px-4 py-4" style={{ background: CARD, borderTop: `1px solid ${BORDER}` }}>
      <p className="text-[10px] uppercase tracking-widest mb-2" style={{ color: DIM }}>Record a reading</p>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <input
          className={field} style={fieldStyle}
          type="number" inputMode="decimal" step="0.1" min="0"
          placeholder="Odometer" aria-label="Odometer"
          value={odometer} onChange={e => setOdometer(e.target.value)}
        />
        <input
          className={field} style={fieldStyle}
          type="number" inputMode="decimal" step="0.01" min="0"
          placeholder="Engine hours" aria-label="Engine hours"
          value={hours} onChange={e => setHours(e.target.value)}
        />
        {/* Backdating is allowed — catching up a month of missed entries is normal —
            but a future reading would fall outside the rolling window and never count. */}
        <input
          className={field} style={fieldStyle}
          type="date" max={today} aria-label="Reading date"
          value={date} onChange={e => setDate(e.target.value)}
        />
        <button
          type="submit" disabled={saving}
          className="rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
          style={{ background: ACCENT, color: '#0b1218' }}
        >
          {saving ? 'Saving…' : 'Save reading'}
        </button>
      </div>
      {message && (
        <p className="text-xs mt-2" style={{ color: message.ok ? '#22C55E' : RED }}>{message.text}</p>
      )}
    </form>
  )
}

export default function UnitDetailClient({ unitId }: { unitId: string }) {
  const [detail,  setDetail]  = useState<UnitDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  // Lifted out of the effect so a saved meter reading can pull the page again. It has
  // to be a full reload, not a local patch: a new odometer changes miles driven, which
  // changes cost per mile and the whole breakdown, and only the server knows the
  // twelve-month span.
  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/fleet-pro/units/${unitId}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((json as { error?: string }).error ?? 'Could not load this unit')
        setDetail(null)
      } else {
        setDetail((json as { detail: UnitDetail }).detail)
      }
    } catch {
      setError('Could not load this unit')
    } finally {
      setLoading(false)
    }
  }, [unitId])

  useEffect(() => { load(true) }, [load])

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

  // Server order is oldest -> newest, which is what the trend line needs. The table
  // under it reads newest first, like every other list on this page.
  const meterReadings = detail.meter_readings ?? []
  const meterNewest   = [...meterReadings].reverse()
  // Every one of the twelve months is rendered, zeros included — a month with no
  // spend is information. The section itself only appears once there is spend to
  // show, so a brand-new unit does not get a wall of $0.00.
  const costByMonth   = detail.cost_by_month ?? []
  // The rolling-window basis. Null for viewers and for a payload that predates it.
  const cost          = detail.cost ?? null
  const hasCostMonths = costByMonth.some(m => m.invoice_count > 0)
  const costTotal     = costByMonth.reduce((sum, m) => sum + m.cost, 0)

  const identity = [unit.year ? String(unit.year) : null, unit.manufacturer, unit.model]
    .filter(Boolean)
    .join(' ')

  // Whichever unit this unit's PM is actually measured in. Most fleets run on the
  // meter, so a date-only "Next Due" was showing an em dash on every single page.
  const nextPmDue = unit.pm_source === 'hours' && unit.next_due_hours != null
    ? `${Math.round(unit.next_due_hours).toLocaleString('en-US')} hrs`
    : fmtDate(unit.next_due_date)

  // pm_label already reads "1,233 hrs overdue" / "445 hrs remaining" / "Due in 12 days".
  const pmSub = unit.pm_state === 'unscheduled' ? null : unit.pm_label ?? null

  const lastPm = unit.last_pm_date
    ? [fmtDate(unit.last_pm_date), unit.last_pm_type].filter(Boolean).join(' · ')
    : '—'

  const facts: { label: string; value: string }[] = [
    { label: 'Type',          value: unit.unit_type ?? '—' },
    { label: 'Serial',        value: unit.serial_number ?? '—' },
    // Thermo King build number — how a reefer's spec is actually looked up.
    { label: 'BM Number',     value: unit.bm_number ?? '—' },
    { label: 'Truck/Trailer', value: unit.truck_trailer_number ?? '—' },
    { label: 'Hours',         value: unit.total_hours == null ? '—' : unit.total_hours.toLocaleString('en-US') },
    { label: 'Last PM',       value: lastPm },
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
        {/* Cost-gated, like every other money surface on this page: an invoice IS a
            cost figure, and a viewer who could photograph one would read the total
            off the confirmation screen. Sits before the QR button because filing a
            shop's paper invoice is the common daily action of the two. */}
        {can_view_costs && (
          <button
            onClick={() => setScanning(true)}
            className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap"
            style={{ background: ACCENT, color: '#0b1218' }}
          >
            Scan Invoice
          </button>
        )}
        {/* Opens in a new tab so the print dialog does not lose the unit page behind it. */}
        <Link
          href={`/fleet-pro/units/${unitId}/qr-sticker`}
          target="_blank"
          rel="noopener noreferrer"
          className={`${can_view_costs ? '' : 'ml-auto '}px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap`}
          style={{ border: `1px solid ${ACCENT}`, color: ACCENT }}
        >
          Print QR Sticker
        </Link>
      </div>

      {scanning && (
        <ScanInvoiceClient
          unitId={unitId}
          unitNumber={unit.unit_number || 'Unit'}
          onClose={() => setScanning(false)}
          // Full reload, same reason a saved meter reading triggers one: a new cost
          // record changes total spend, cost per mile and the monthly breakdown, and
          // only the server knows the twelve-month span.
          onSaved={() => load(false)}
        />
      )}
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
      <div className={`grid grid-cols-2 gap-3 mb-6 ${can_view_costs ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
        {can_view_costs && <Stat label="Total Spend" value={fmtMoney(total_spend)} color={ACCENT} />}
        <Stat label="Service Records" value={String(event_count)} />
        <Stat label="PM Status"       value={pm.label} sub={pmSub} color={pm.color} />
        <Stat label="Next PM Due"     value={nextPmDue} />
        <Stat label="Last Service"    value={fmtDate(unit.last_service_date)} />
      </div>

      {/* ── Cost per mile ───────────────────────────────────────────────────── */}
      {/* Absent entirely for viewers: the server sends null, so there is nothing
          rendered here to hide. Sits above registration and history because it is
          the figure that decides whether this asset stays in the fleet. */}
      {can_view_costs && cost && (
        <>
          <h2 className="font-condensed font-bold text-xl text-white tracking-wide mb-3">
            COST TO RUN — LAST 12 MONTHS
          </h2>
          <div className="rounded-xl mb-6 px-4 py-4" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: DIM }}>Cost / Mile</p>
                <p
                  className="font-condensed font-bold text-3xl leading-none"
                  style={{ color: cost.cost_per_mile == null ? DIM : ACCENT }}
                >
                  {formatPerMile(cost.cost_per_mile)}
                </p>
                <p className="text-xs mt-1" style={{ color: DIM }}>
                  {/* Never "0 miles". An unmeasured truck and a parked one are not the
                      same fact, and the dash has to say which one this is. */}
                  {cost.miles_driven == null
                    ? 'No mileage recorded'
                    : `${Math.round(cost.miles_driven).toLocaleString('en-US')} mi driven`}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: DIM }}>Cost / Hour</p>
                <p
                  className="font-condensed font-bold text-3xl leading-none"
                  style={{ color: cost.cost_per_hour == null ? DIM : NWI_BLUE }}
                >
                  {formatPerHour(cost.cost_per_hour)}
                </p>
                <p className="text-xs mt-1" style={{ color: DIM }}>
                  {cost.hours_run == null
                    ? 'No hours recorded'
                    : `${Math.round(cost.hours_run).toLocaleString('en-US')} hrs run`}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: DIM }}>12-Month Cost</p>
                <p className="font-condensed font-bold text-3xl leading-none text-white">
                  {fmtMoney(cost.total_cost)}
                </p>
                <p className="text-xs mt-1" style={{ color: DIM }}>In-house + outside vendor</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: DIM }}>Repair Events</p>
                <p className="font-condensed font-bold text-3xl leading-none text-white">
                  {cost.repair_events.toLocaleString('en-US')}
                </p>
                <p className="text-xs mt-1" style={{ color: DIM }}>Billable visits</p>
              </div>
            </div>

            {/* Parts + labor + other reconcile exactly against the total; outside
                vendor is the same money cut a second way, by who billed it, so it is
                listed apart rather than as a fourth addend that would double-count. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4" style={{ borderTop: `1px solid ${BORDER}` }}>
              {[
                { label: 'Parts',          value: cost.parts_cost,  color: ACCENT },
                { label: 'Labor',          value: cost.labor_cost,  color: NWI_BLUE },
                { label: 'Tax / Fees',     value: cost.other_cost,  color: DIM2 },
                { label: 'Outside Vendor', value: cost.vendor_cost, color: '#F59E0B' },
              ].map(part => (
                <div key={part.label} className="min-w-0">
                  <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: DIM }}>{part.label}</p>
                  <p className="text-sm font-semibold truncate" style={{ color: part.color }}>
                    {fmtMoney(part.value)}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-xs mt-3" style={{ color: DIM }}>
              Parts, labor and tax/fees add up to the 12-month cost. Outside vendor is the share of
              that same total billed by a third-party shop, not an additional charge.
            </p>

            <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${BORDER}` }}>
              <CostTrendChart months={cost.months} />
            </div>
          </div>
        </>
      )}

      {/* ── Registration ────────────────────────────────────────────────────── */}
      <RegistrationSection unitId={unitId} canEdit={detail.can_edit} />

      {/* ── Meter history ───────────────────────────────────────────────────── */}
      {/* Shown to a manager even with no readings on file: the unit with an empty
          meter history is precisely the one whose cost per mile cannot be computed,
          and hiding the entry form from him is hiding the fix. */}
      {(meterReadings.length > 0 || detail.can_edit) && (
        <>
          <h2 className="font-condensed font-bold text-xl text-white tracking-wide mb-3">METER HISTORY</h2>
          <div className="rounded-xl overflow-hidden mb-6" style={{ border: `1px solid ${BORDER}` }}>
            {meterReadings.length === 0 ? (
              <p className="px-4 py-4 text-sm" style={{ background: CARD, color: DIM2 }}>
                No meter readings on file. Cost per mile needs at least two readings in the
                last twelve months — until then this unit shows a dash rather than a guess.
              </p>
            ) : (
            <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 px-4 py-4" style={{ background: CARD }}>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: DIM }}>Odometer</p>
                <Sparkline values={meterReadings.map(r => r.odometer)} color={ACCENT} />
                <p className="text-sm text-white mt-1">{fmtNum(meterNewest[0]?.odometer ?? null)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: DIM }}>Engine Hours</p>
                <Sparkline values={meterReadings.map(r => r.engine_hours)} color={NWI_BLUE} />
                <p className="text-sm text-white mt-1">{fmtNum(meterNewest[0]?.engine_hours ?? null)}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px]" style={{ background: CARD }}>
                <thead style={{ background: STRIP }}>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: DIM }}>Date</th>
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: DIM }}>Odometer</th>
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: DIM }}>Hours</th>
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: DIM }}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {meterNewest.map((reading, i) => (
                    <tr
                      key={`${reading.reading_date}-${i}`}
                      style={{ borderTop: `1px solid ${BORDER}` }}
                    >
                      <td className="px-4 py-2.5 text-sm whitespace-nowrap" style={{ color: DIM2 }}>
                        {fmtDate(reading.reading_date || null)}
                      </td>
                      <td className="px-4 py-2.5 text-sm whitespace-nowrap" style={{ color: reading.odometer == null ? DIM : '#ffffff' }}>
                        {fmtNum(reading.odometer)}
                      </td>
                      <td className="px-4 py-2.5 text-sm whitespace-nowrap" style={{ color: reading.engine_hours == null ? DIM : '#ffffff' }}>
                        {fmtNum(reading.engine_hours)}
                      </td>
                      <td className="px-4 py-2.5 text-sm capitalize whitespace-nowrap" style={{ color: DIM2 }}>
                        {reading.source.replace('_', ' ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
            )}
            {detail.can_edit && <MeterEntryForm unitId={unitId} onSaved={() => load(false)} />}
          </div>
        </>
      )}

      {/* ── Cost per month. Absent entirely when costs are withheld — the server
             sends null, so there is nothing here to hide in the first place. ──── */}
      {can_view_costs && hasCostMonths && (
        <>
          <h2 className="font-condensed font-bold text-xl text-white tracking-wide mb-3">COST PER MONTH</h2>
          <div className="rounded-xl overflow-hidden mb-6" style={{ border: `1px solid ${BORDER}` }}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px]" style={{ background: CARD }}>
                <thead style={{ background: STRIP }}>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: DIM }}>Month</th>
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: DIM }}>Invoices</th>
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: DIM }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {[...costByMonth].reverse().map((row, i) => (
                    <tr key={row.month} style={i > 0 ? { borderTop: `1px solid ${BORDER}` } : undefined}>
                      <td className="px-4 py-2.5 text-sm whitespace-nowrap text-white">{fmtMonth(row.month)}</td>
                      <td className="px-4 py-2.5 text-sm whitespace-nowrap" style={{ color: DIM2 }}>{row.invoice_count}</td>
                      <td
                        className="px-4 py-2.5 text-sm whitespace-nowrap"
                        style={{ color: row.invoice_count === 0 ? DIM : '#ffffff' }}
                      >
                        {fmtMoney(row.cost)}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: `1px solid ${BORDER}`, background: STRIP }}>
                    <td className="px-4 py-2.5 text-xs uppercase tracking-wider" style={{ color: DIM }}>12-Month Total</td>
                    <td className="px-4 py-2.5" />
                    <td className="px-4 py-2.5 text-sm font-semibold whitespace-nowrap" style={{ color: ACCENT }}>
                      {fmtMoney(costTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

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
                {events.map((event: UnitServiceEvent, i: number) => {
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
                      {/* Invoice and work order numbers are shown, never linked — the
                          mechanic's document pages are not the fleet's to open. An
                          inspection is different: the signed record is the customer's
                          compliance document, so it gets a printable link. */}
                      <td className="px-4 py-3 text-sm font-mono whitespace-nowrap" style={{ color: DIM2 }}>
                        {event.reference ?? '—'}
                        {event.pdf_url && (
                          <a
                            href={event.pdf_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block mt-0.5 text-xs font-semibold font-sans hover:underline"
                            style={{ color: ACCENT }}
                          >
                            PDF
                          </a>
                        )}
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
