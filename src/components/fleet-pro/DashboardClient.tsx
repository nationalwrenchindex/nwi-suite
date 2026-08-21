'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { FleetProDashboard, FleetProUnitRow, PmState } from '@/types/fleet-pro'

const FP_ORANGE = '#E85D24'
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

function UnitRow({ unit, index, showCosts }: { unit: FleetProUnitRow; index: number; showCosts: boolean }) {
  const pm = PM_STYLE[unit.pm_state]
  const makeModel = [unit.manufacturer, unit.model].filter(Boolean).join(' ') || '—'

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
        {unit.days_until_due !== null && unit.pm_state !== 'scheduled' && (
          <span className="block text-xs mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {unit.days_until_due < 0
              ? `${Math.abs(unit.days_until_due)} d late`
              : `in ${unit.days_until_due} d`}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-white">{shortDate(unit.next_due_date)}</td>
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
      {showCosts && <td className="px-4 py-3 text-sm text-white">{money(unit.spend_mtd)}</td>}
      {showCosts && <td className="px-4 py-3 text-sm text-white">{money(unit.spend_ytd)}</td>}
    </tr>
  )
}

export default function DashboardClient() {
  const [dashboard, setDashboard] = useState<FleetProDashboard | null>(null)
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
        setDashboard(json.dashboard as FleetProDashboard)
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
      <p className="text-xs uppercase tracking-widest mb-1" style={{ color: MUTED }}>NWI Fleet Pro</p>
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
    'Unit', 'Make / Model', 'Type', 'PM Status', 'Next Due', 'Last Service', 'Inspection',
    ...(showCosts ? ['MTD', 'YTD'] : []),
  ]

  return (
    <div>
      {header}

      <div className={`grid grid-cols-2 gap-4 mb-6 ${showCosts ? 'lg:grid-cols-6' : 'lg:grid-cols-4'}`}>
        <KpiCard label="Units"        value={String(dashboard.unit_count)} sub={dashboard.fleet_name} />
        <KpiCard label="Overdue"      value={String(dashboard.overdue_count)}
                 color={dashboard.overdue_count > 0 ? RED : '#ffffff'} sub="PM past due" />
        <KpiCard label="Due Soon"     value={String(dashboard.due_soon_count)}
                 color={dashboard.due_soon_count > 0 ? FP_ORANGE : '#ffffff'} sub="Within 30 days" />
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
                  <UnitRow key={unit.id} unit={unit} index={i} showCosts={showCosts} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
