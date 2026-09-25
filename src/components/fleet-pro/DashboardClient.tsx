'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { FleetProDashboard, FleetProUnitRow, PmState } from '@/types/fleet-pro'
import { formatPerMile } from '@/types/fleet-pro-cost'
import { FleetProWordmark, NWI_ORANGE } from './brand'
import { registrationLabel, todayIso, REGISTRATION_COLOR, REGISTRATION_LABEL } from '@/lib/fleet-pro/registration'
import type { RegistrationState } from '@/types/fleet-pro-registration'
import ReplacementCard from './ReplacementCard'
import type { ReplacementReport } from '@/types/fleet-pro-replacement'
import { MPG_DROP_ALERT_PCT, type FuelAlert } from '@/types/fleet-pro-fuel'
import { money as sharedMoney } from '@/lib/format'

// ─── Wire shape ───────────────────────────────────────────────────────────────
// PM is hours-based on hd_units for most fleets and date-based only when a manager
// sets fleet_pro_pm_schedules by hand. The route resolves which, and sends both the
// figure and a ready-made label; src/types/fleet-pro.ts still only knows about the
// date half, so the extra fields are declared here.

type PmSource = 'hours' | 'date' | 'none'

interface UnitRow extends FleetProUnitRow {
  registration_state?:      RegistrationState
  registration_expires_on?: string | null
  registration_days_until?: number | null
  license_plate?:           string | null
  jurisdiction?:            string | null
  pm_source?:       PmSource
  pm_label?:        string
  next_due_hours?:  number | null
  hours_remaining?: number | null
  last_pm_date?:    string | null
  last_pm_type?:    string | null
}

interface Dashboard extends Omit<FleetProDashboard, 'units'> {
  units: UnitRow[]
}

const FP_ORANGE = NWI_ORANGE
const RED       = '#ef4444'
const GREEN     = '#22C55E'
const MUTED     = 'rgba(255,255,255,0.4)'

const PM_STYLE: Record<PmState, { label: string; color: string }> = {
  overdue:     { label: 'Overdue',     color: RED },
  due_soon:    { label: 'Due Soon',    color: FP_ORANGE },
  scheduled:   { label: 'Scheduled',   color: GREEN },
  unscheduled: { label: 'Unscheduled', color: MUTED },
}

// Mirrors the route's own ranking so re-sorting on the client reproduces the order
// the server sent rather than approximating it.
const PM_RANK: Record<PmState, number> = { overdue: 0, due_soon: 1, unscheduled: 2, scheduled: 3 }

const usd = { format: (n: number) => sharedMoney(n) }

function money(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : usd.format(n)
}

// ─── Sorting ──────────────────────────────────────────────────────────────────
// PM-overdue-first is kept as the default: it is what the page was built to answer
// and what a manager opening it at 6am is looking for. Cost per mile is an
// investigation, not a morning check, so it is a choice rather than the new default.

type SortKey = 'pm' | 'cost_per_mile' | 'cost_12mo' | 'unit'

const SORT_LABELS: { key: SortKey; label: string }[] = [
  { key: 'pm',            label: 'PM overdue first' },
  { key: 'cost_per_mile', label: 'Highest cost per mile' },
  { key: 'cost_12mo',     label: 'Highest 12-mo cost' },
  { key: 'unit',          label: 'Unit number' },
]

function byUnitNumber(a: UnitRow, b: UnitRow): number {
  return a.unit_number.localeCompare(b.unit_number, 'en', { numeric: true })
}

/**
 * Descending by a money figure, with UNKNOWN PINNED LAST.
 *
 * A unit with no meter history has a null cost per mile, not a zero. Sorting nulls
 * as 0 would bury them at the bottom of an ascending sort and float them to the top
 * of a descending one — and "the most expensive unit in the fleet" showing a row
 * that has never been measured is exactly the wrong answer. They always sink,
 * whichever direction the comparison runs, and keep unit order among themselves.
 */
function byMoneyDesc(a: number | null | undefined, b: number | null | undefined): number | null {
  const av = a ?? null
  const bv = b ?? null
  if (av === null && bv === null) return null   // tie — fall through to unit number
  if (av === null) return 1
  if (bv === null) return -1
  if (av === bv) return null
  return bv - av
}

/** Miles over the rolling window. Null stays unknown; it is never "0 mi". */
function miles(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'miles unknown'
  return `${Math.round(n).toLocaleString('en-US')} mi`
}

function shortDate(iso: string | null): string {
  if (!iso) return '—'
  // Dates arrive as YYYY-MM-DD; pin to midday so the local timezone cannot shift them a day.
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function KpiCard({ label, value, sub, color = '#ffffff' }: {
  label: string
  value: string
  sub?:  string
  color?: string
}) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1" style={{ background: '#111920', border: '1px solid #1e3040' }}>
      <p className="text-xs uppercase tracking-widest" style={{ color: MUTED }}>{label}</p>
      <p className="font-condensed font-bold text-3xl leading-none" style={{ color }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{sub}</p>}
    </div>
  )
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ background: `${color}20`, color }}
    >
      {label}
    </span>
  )
}

function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="rounded-xl h-24" style={{ background: '#111920', border: '1px solid #1e3040' }} />
        ))}
      </div>
      <div className="rounded-xl h-72" style={{ background: '#111920', border: '1px solid #1e3040' }} />
    </div>
  )
}

function UnitTableRow({ unit, index, showCosts }: { unit: UnitRow; index: number; showCosts: boolean }) {
  const pm = PM_STYLE[unit.pm_state]
  const makeModel = [unit.manufacturer, unit.model].filter(Boolean).join(' ') || '—'

  // Whichever unit the PM is actually measured in. An hours-based PM has no due
  // date at all, so printing an em dash there and the meter target here is the only
  // honest reading — the old column showed a dash for every single unit.
  const nextDue = unit.pm_source === 'hours' && unit.next_due_hours != null
    ? `${Math.round(unit.next_due_hours).toLocaleString('en-US')} hrs`
    : shortDate(unit.next_due_date)

  // pm_label already reads "1,233 hrs overdue" / "445 hrs remaining" / "Due in 12
  // days". Fall back to the day count for a payload that predates it.
  const subLabel = unit.pm_label
    ?? (unit.days_until_due === null || unit.days_until_due === undefined
          ? null
          : unit.days_until_due < 0 ? `${Math.abs(unit.days_until_due)} d late` : `in ${unit.days_until_due} d`)

  return (
    <tr style={{ borderTop: index > 0 ? '1px solid #1e3040' : undefined }}>
      <td className="px-4 py-3 text-sm text-white">
        <Link href={`/fleet-pro/units/${unit.id}`} className="font-medium hover:underline" style={{ color: FP_ORANGE }}>
          {unit.unit_number || 'Unit'}
        </Link>
        {unit.truck_trailer_number && (
          <span className="block text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{unit.truck_trailer_number}</span>
        )}
      </td>
      {/* THE headline figure. Cost per mile is the number that decides whether a
          unit stays in the fleet, so it sits second from the left in the same weight
          as the unit number rather than at the far right end of a scroll. */}
      {showCosts && (
        <td className="px-4 py-3">
          <span
            className="font-condensed font-bold text-lg leading-none"
            style={{ color: unit.cost_per_mile == null ? MUTED : FP_ORANGE }}
          >
            {formatPerMile(unit.cost_per_mile ?? null)}
          </span>
          <span className="block text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {/* An em dash on its own is a dead end. Say WHY there is no figure — the
                fix is a meter reading, and the manager is the one who can enter it. */}
            {unit.cost_per_mile == null
              ? 'No mileage on file'
              : `${money(unit.cost_12mo)} · ${miles(unit.miles_driven)}`}
          </span>
        </td>
      )}
      <td className="px-4 py-3 text-sm text-white">
        {makeModel}
        {unit.year && <span className="block text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{unit.year}</span>}
      </td>
      <td className="px-4 py-3 text-sm text-white">{unit.unit_type || '—'}</td>
      <td className="px-4 py-3 text-sm text-white">
        <Pill label={pm.label} color={pm.color} />
        {subLabel && unit.pm_state !== 'unscheduled' && (
          <span className="block text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {subLabel}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-white">{nextDue}</td>
      <td className="px-4 py-3 text-sm text-white">{shortDate(unit.last_service_date)}</td>
      <td className="px-4 py-3 text-sm text-white">
        {unit.open_inspection_issue
          ? <Pill label="Failed" color={RED} />
          : <span style={{ color: MUTED }}>{unit.last_inspection_date ? 'Pass' : '—'}</span>}
        {unit.last_inspection_date && (
          <span className="block text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {shortDate(unit.last_inspection_date)}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-white">
        {(() => {
          // A unit with no registration row is 'missing', which is red like expired —
          // a plate the manager cannot produce is the same roadside problem.
          const state = unit.registration_state ?? 'missing'
          const color = REGISTRATION_COLOR[state]
          return (
            <>
              <Pill label={REGISTRATION_LABEL[state]} color={color} />
              <span className="block text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {unit.license_plate
                  ? `${unit.license_plate}${unit.jurisdiction ? ' · ' + unit.jurisdiction : ''}`
                  : registrationLabel(unit.registration_expires_on ?? null, todayIso())}
              </span>
            </>
          )
        })()}
      </td>
      {showCosts && <td className="px-4 py-3 text-sm text-white">{money(unit.spend_mtd)}</td>}
      {showCosts && <td className="px-4 py-3 text-sm text-white">{money(unit.spend_ytd)}</td>}
    </tr>
  )
}

export default function DashboardClient() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [sortKey, setSortKey]     = useState<SortKey>('pm')
  // Replacement candidates ride on their own request. Deliberately NOT folded into
  // the dashboard payload: the report scans work-order downtime across the fleet,
  // and making the PM list wait on it would slow down the thing this page is for.
  // A failure here leaves the section absent rather than breaking the dashboard.
  const [replacement, setReplacement] = useState<ReplacementReport | null>(null)
  // Fuel alerts arrive on the dashboard response itself rather than a second request:
  // unlike the replacement report they are not cost-gated, so there is no role check
  // to wait on and no reason to make the browser ask twice.
  const [fuelAlerts, setFuelAlerts] = useState<FuelAlert[]>([])

  // Sorted here rather than refetched: the whole fleet is already on the client, and
  // a round trip to reorder 60 rows the browser is holding would be slower and would
  // lose the manager's place on the page.
  const sortedUnits = useMemo(() => {
    const rows = [...(dashboard?.units ?? [])]
    switch (sortKey) {
      case 'cost_per_mile':
        return rows.sort((a, b) => byMoneyDesc(a.cost_per_mile, b.cost_per_mile) ?? byUnitNumber(a, b))
      case 'cost_12mo':
        return rows.sort((a, b) => byMoneyDesc(a.cost_12mo, b.cost_12mo) ?? byUnitNumber(a, b))
      case 'unit':
        return rows.sort(byUnitNumber)
      case 'pm':
      default:
        // The server already returns this order; it is restated so switching away
        // and back does not require a refetch to get it.
        return rows.sort((a, b) => PM_RANK[a.pm_state] - PM_RANK[b.pm_state] || byUnitNumber(a, b))
    }
  }, [dashboard, sortKey])

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res  = await fetch('/api/fleet-pro/dashboard')
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) { setError(json?.error ?? 'Could not load the fleet dashboard'); return }
        setDashboard(json.dashboard as Dashboard)
        setFuelAlerts((json.fuel_alerts ?? []) as FuelAlert[])
      } catch {
        if (!cancelled) setError('Could not load the fleet dashboard')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  // Gated on can_view_costs, and therefore chained behind the dashboard rather than
  // fired alongside it. /api/fleet-pro/replacement answers a viewer with 403 by
  // design — the flag IS a money figure — so asking on their behalf would log a
  // permission failure on every dashboard load a viewer performs.
  const canViewCosts = dashboard?.can_view_costs ?? false

  useEffect(() => {
    if (!canViewCosts) { setReplacement(null); return }
    let cancelled = false

    async function loadReplacement() {
      try {
        const res  = await fetch('/api/fleet-pro/replacement')
        if (!res.ok) return
        const json = await res.json()
        if (!cancelled) setReplacement(json.report as ReplacementReport)
      } catch {
        // Silent: the dashboard is still fully usable without this section.
      }
    }

    loadReplacement()
    return () => { cancelled = true }
  }, [canViewCosts])

  const header = (
    <div className="mb-6">
      <FleetProWordmark className="block text-xs uppercase tracking-widest mb-1 font-semibold" />
      <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">FLEET</h1>
    </div>
  )

  if (loading) {
    return <div>{header}<Skeleton /></div>
  }

  if (error || !dashboard) {
    return (
      <div>
        {header}
        <div className="rounded-xl p-6" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-sm" style={{ color: RED }}>{error ?? 'Could not load the fleet dashboard'}</p>
        </div>
      </div>
    )
  }

  const showCosts = dashboard.can_view_costs
  const headers = [
    'Unit',
    ...(showCosts ? ['Cost / Mile'] : []),
    'Make / Model', 'Type', 'PM Status', 'Next Due', 'Last Service', 'Inspection', 'Registration',
    ...(showCosts ? ['MTD', 'YTD'] : []),
  ]

  // How much of the fleet the average actually rests on. A cost per mile drawn from
  // 4 of 60 trucks is not the fleet's cost per mile, and the tile has to say so
  // rather than let a manager quote it in a budget meeting.
  const withMileage = dashboard.units_with_mileage ?? 0
  const fleetCpmSub = withMileage === 0
    ? 'No meter readings yet'
    : `${withMileage} of ${dashboard.unit_count} units measured`

  return (
    <div>
      {header}

      <div className={`grid grid-cols-2 gap-4 mb-6 ${showCosts ? 'lg:grid-cols-7' : 'lg:grid-cols-4'}`}>
        {/* Leads the strip when the viewer is allowed money: it is the one figure on
            this page that answers "what is this fleet costing me to run". */}
        {showCosts && (
          <KpiCard
            label="Fleet $/Mile"
            value={formatPerMile(dashboard.fleet_cost_per_mile ?? null)}
            color={dashboard.fleet_cost_per_mile == null ? MUTED : FP_ORANGE}
            sub={fleetCpmSub}
          />
        )}
        <KpiCard label="Units"        value={String(dashboard.unit_count)} sub={dashboard.fleet_name} />
        <KpiCard label="Overdue"      value={String(dashboard.overdue_count)}
                 color={dashboard.overdue_count > 0 ? RED : '#ffffff'} sub="PM past due" />
        {/* Two units, one tile: a fleet's PMs are hours-based unless a manager set a date. */}
        <KpiCard label="Due Soon"     value={String(dashboard.due_soon_count)}
                 color={dashboard.due_soon_count > 0 ? FP_ORANGE : '#ffffff'} sub="Within 200 hrs / 30 days" />
        <KpiCard label="Failed Insp." value={String(dashboard.failed_inspection_count)}
                 color={dashboard.failed_inspection_count > 0 ? RED : '#ffffff'} sub="Open issues" />
        {showCosts && <KpiCard label="Spend MTD" value={money(dashboard.spend_mtd)} sub="This month" />}
        {showCosts && <KpiCard label="Spend YTD" value={money(dashboard.spend_ytd)} sub="This year" />}
      </div>

      {/* ── Fuel economy alerts ─────────────────────────────────────────────
          Above replacement review, because this is the only panel on the page
          that is time-sensitive in days rather than quarters: a truck losing
          fuel economy is usually losing it to something mechanical that is
          still cheap to fix. Absent entirely when nothing is flagged — an empty
          "0 alerts" box trains people to skip the space where the real warning
          will one day appear, the same reasoning as the section below.

          Not gated on showCosts: MPG is a use figure. No dollar amount from a
          fillup is on this wire at all. */}
      {fuelAlerts.length > 0 && (
        <div className="mb-6">
          <h2 className="font-condensed font-bold text-white text-lg tracking-wide mb-1">
            FUEL ECONOMY ALERTS
          </h2>
          <p className="text-xs mb-3" style={{ color: MUTED }}>
            {fuelAlerts.length === 1 ? 'One unit came in' : `${fuelAlerts.length} units came in`}{' '}
            more than {MPG_DROP_ALERT_PCT}% below {fuelAlerts.length === 1 ? 'its' : 'their'} own
            rolling average on the last fillup.
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {fuelAlerts.slice(0, 6).map(alert => (
              <div
                key={alert.unit_id}
                className="rounded-xl p-4"
                style={{ background: '#111920', border: `1px solid ${RED}55`, borderLeft: `4px solid ${RED}` }}
              >
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <Link
                    href={`/fleet-pro/units/${alert.unit_id}`}
                    className="font-condensed font-bold text-white tracking-wide hover:underline"
                  >
                    {alert.unit_number || 'Unit'}
                  </Link>
                  <span className="text-lg font-bold tabular-nums" style={{ color: RED }}>
                    −{alert.drop_pct.toFixed(1)}%
                  </span>
                </div>
                <p className="text-sm tabular-nums" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  {alert.latest_mpg.toFixed(2)} mpg
                  <span style={{ color: MUTED }}> vs {alert.average_mpg.toFixed(2)} avg</span>
                </p>
                {/* The sample size is shown rather than hidden: an average drawn from
                    three tanks is a hint, one drawn from thirty is a finding, and the
                    manager deciding whether to pull the truck needs to know which. */}
                <p className="text-xs mt-2" style={{ color: MUTED }}>
                  {alert.fuel_date || 'recent'} · over {alert.sample_size} prior fillup
                  {alert.sample_size === 1 ? '' : 's'}
                  {alert.driver_name ? ` · ${alert.driver_name}` : ''}
                </p>
              </div>
            ))}
          </div>
          {fuelAlerts.length > 6 && (
            <p className="text-xs mt-3" style={{ color: MUTED }}>
              + {fuelAlerts.length - 6} more flagged
            </p>
          )}
        </div>
      )}

      {/* ── Replacement review ──────────────────────────────────────────────
          Above the unit table, because a truck that has eaten half its own value
          is a budget decision and the table below is an operations list — it
          would never be found buried at row 40. Absent entirely when nothing is
          flagged: an empty "0 candidates" panel trains people to skip the space
          where the real warning will one day appear. */}
      {replacement && replacement.candidates.length > 0 && (
        <div className="mb-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="font-condensed font-bold text-white text-lg tracking-wide">
              REPLACEMENT REVIEW
            </h2>
            <Link
              href="/fleet-pro/replacement"
              className="text-xs font-semibold hover:underline"
              style={{ color: NWI_ORANGE }}
            >
              Full report &amp; PDF →
            </Link>
          </div>
          <p className="text-xs mb-3" style={{ color: MUTED }}>
            {replacement.candidate_count} of {replacement.unit_count} units crossed this
            fleet&rsquo;s threshold ({replacement.thresholds.cost_ratio_pct}% of value, or{' '}
            {replacement.thresholds.breakdown_min}+ breakdowns) in the last 12 months.
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {replacement.candidates.slice(0, 6).map(c => (
              <ReplacementCard
                key={c.unit_id}
                candidate={c}
                thresholds={replacement.thresholds}
                href={`/fleet-pro/units/${c.unit_id}`}
                compact
              />
            ))}
          </div>
          {/* The grid is capped so the operations table is never pushed off the
              first screen by a fleet with twenty flagged trucks. */}
          {replacement.candidates.length > 6 && (
            <Link
              href="/fleet-pro/replacement"
              className="inline-block mt-3 text-xs font-semibold hover:underline"
              style={{ color: NWI_ORANGE }}
            >
              + {replacement.candidates.length - 6} more flagged for review
            </Link>
          )}
        </div>
      )}

      {dashboard.units.length === 0 ? (
        <div className="rounded-xl p-10 text-center" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-1">NO UNITS YET</p>
          <p className="text-sm" style={{ color: MUTED }}>
            Units appear here as soon as your maintenance contractor adds them to this fleet account.
          </p>
        </div>
      ) : (
        <>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          {showCosts && (
            <p className="text-xs" style={{ color: MUTED }}>
              {money(dashboard.fleet_cost_12mo)} spent across the fleet in the last 12 months
            </p>
          )}
          {/* A native select rather than a custom menu: it is one control, and the
              phone's own picker beats anything hand-rolled at 360px. */}
          <label className="flex items-center gap-2 text-xs ml-auto" style={{ color: MUTED }}>
            Sort
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as SortKey)}
              className="rounded-lg px-2 py-1.5 text-xs text-white"
              style={{ background: '#162030', border: '1px solid #1e3040' }}
            >
              {SORT_LABELS
                // Sorting by money is meaningless to someone who is not sent any.
                .filter(o => showCosts || (o.key !== 'cost_per_mile' && o.key !== 'cost_12mo'))
                .map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]" style={{ background: '#111920' }}>
              <thead style={{ background: '#162030' }}>
                <tr>
                  {headers.map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: MUTED }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedUnits.map((unit, i) => (
                  <UnitTableRow key={unit.id} unit={unit} index={i} showCosts={showCosts} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}
    </div>
  )
}
