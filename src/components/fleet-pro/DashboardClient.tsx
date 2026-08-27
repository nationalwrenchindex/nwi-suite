'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { FleetProDashboard, FleetProUnitRow, PmState } from '@/types/fleet-pro'
import { FleetProWordmark, NWI_ORANGE } from './brand'
import { registrationLabel, todayIso, REGISTRATION_COLOR, REGISTRATION_LABEL } from '@/lib/fleet-pro/registration'
import type { RegistrationState } from '@/types/fleet-pro-registration'

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

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function money(n: number | null): string {
  return n === null ? '—' : usd.format(n)
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

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res  = await fetch('/api/fleet-pro/dashboard')
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) { setError(json?.error ?? 'Could not load the fleet dashboard'); return }
        setDashboard(json.dashboard as Dashboard)
      } catch {
        if (!cancelled) setError('Could not load the fleet dashboard')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

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
    'Unit', 'Make / Model', 'Type', 'PM Status', 'Next Due', 'Last Service', 'Inspection', 'Registration',
    ...(showCosts ? ['MTD', 'YTD'] : []),
  ]

  return (
    <div>
      {header}

      <div className={`grid grid-cols-2 gap-4 mb-6 ${showCosts ? 'lg:grid-cols-6' : 'lg:grid-cols-4'}`}>
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

      {dashboard.units.length === 0 ? (
        <div className="rounded-xl p-10 text-center" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-1">NO UNITS YET</p>
          <p className="text-sm" style={{ color: MUTED }}>
            Units appear here as soon as your maintenance contractor adds them to this fleet account.
          </p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]" style={{ background: '#111920' }}>
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
                {dashboard.units.map((unit, i) => (
                  <UnitTableRow key={unit.id} unit={unit} index={i} showCosts={showCosts} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
