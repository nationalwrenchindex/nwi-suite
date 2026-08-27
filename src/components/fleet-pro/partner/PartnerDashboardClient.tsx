'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type {
  PartnerDashboard,
  PartnerFleetRow,
  PartnerActivityRow,
  PartnerPmAlert,
} from '@/types/fleet-pro-partner'
import { NWI_ORANGE } from '@/components/fleet-pro/brand'

const RED   = '#ef4444'
const GREEN = '#22C55E'
const MUTED = 'rgba(255,255,255,0.4)'
const FAINT = 'rgba(255,255,255,0.3)'

const CARD  = { background: '#111920', border: '1px solid #1e3040' }

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

// Activity rows are money-bearing often enough that cents matter on a single line,
// but the KPI row is a glance — so two formatters rather than one compromise.
const usdExact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

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

const KIND_LABEL: Record<PartnerActivityRow['kind'], string> = {
  work_order:        'Work Order',
  invoice:           'Invoice',
  pretrip:           'Pre-Trip',
  dot_inspection:    'DOT',
  aerial_inspection: 'Aerial',
}

// ─── Partner nav ──────────────────────────────────────────────────────────────
// Lives here rather than in the layout because active state needs usePathname, and
// the layout has to stay a server component to resolve the partner row. The
// middleware's x-pathname is set on the RESPONSE, so headers() in a layout cannot
// see it — reading it there would silently never match.
const NAV = [
  { href: '/fleet-pro/partner',          label: 'Overview' },
  { href: '/fleet-pro/partner/accounts', label: 'Fleet Accounts' },
  { href: '/fleet-pro/partner/billing',  label: 'Billing' },
]

export function PartnerNav({ partnerName }: { partnerName: string }) {
  const pathname = usePathname()

  function isActive(href: string) {
    return href === '/fleet-pro/partner' ? pathname === '/fleet-pro/partner' : pathname.startsWith(href)
  }

  return (
    <nav className="flex items-center gap-1 flex-1 overflow-x-auto hide-scrollbar" aria-label={`${partnerName} partner console`}>
      {NAV.map(item => {
        const active = isActive(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className="px-3 min-h-[44px] flex items-center rounded-lg text-sm font-medium whitespace-nowrap transition-colors"
            style={active ? { background: `${NWI_ORANGE}20`, color: NWI_ORANGE } : { color: 'rgba(255,255,255,0.5)' }}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

function KpiCard({ label, value, sub, color = '#ffffff' }: {
  label:  string
  value:  string
  sub?:   string
  color?: string
}) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1" style={CARD}>
      <p className="text-xs uppercase tracking-widest" style={{ color: MUTED }}>{label}</p>
      <p className="font-condensed font-bold text-3xl leading-none" style={{ color }}>{value}</p>
      {sub && <p className="text-xs" style={{ color: FAINT }}>{sub}</p>}
    </div>
  )
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: `${color}20`, color }}>
      {label}
    </span>
  )
}

/** One glance at whether this fleet needs the partner today. */
function HealthPill({ fleet }: { fleet: PartnerFleetRow }) {
  if (fleet.overdue_pm_count > 0)  return <Pill label={`${fleet.overdue_pm_count} Overdue`} color={RED} />
  if (fleet.due_soon_pm_count > 0) return <Pill label={`${fleet.due_soon_pm_count} Due Soon`} color={NWI_ORANGE} />
  return <Pill label="On Schedule" color={GREEN} />
}

function BillingPill({ fleet }: { fleet: PartnerFleetRow }) {
  if (!fleet.fleet_pro_enabled) return <Pill label="Not Billed" color={MUTED} />
  if (!fleet.has_subscription)  return <Pill label="No Subscription" color={NWI_ORANGE} />
  return <Pill label={(fleet.fleet_pro_status ?? 'active').replace(/_/g, ' ')} color={GREEN} />
}

function Skeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="rounded-xl h-24" style={CARD} />)}
      </div>
      <div className="rounded-xl h-72" style={CARD} />
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl h-64" style={CARD} />
        <div className="rounded-xl h-64" style={CARD} />
      </div>
    </div>
  )
}

function Panel({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="rounded-xl overflow-hidden flex flex-col" style={CARD}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ background: '#162030' }}>
        <h2 className="text-xs uppercase tracking-wider font-semibold" style={{ color: MUTED }}>{title}</h2>
        <span className="text-xs" style={{ color: FAINT }}>{count}</span>
      </div>
      {children}
    </section>
  )
}

function FleetTableRow({ fleet, index }: { fleet: PartnerFleetRow; index: number }) {
  return (
    <tr style={{ borderTop: index > 0 ? '1px solid #1e3040' : undefined }}>
      <td className="px-4 py-3 text-sm">
        <Link
          href={`/fleet-pro/partner/${fleet.fleet_account_id}`}
          className="font-medium hover:underline"
          style={{ color: NWI_ORANGE }}
        >
          {fleet.brand_name}
        </Link>
        {/* The legal fleet name only shows when white labelling has renamed it —
            otherwise it is the same string twice. */}
        {fleet.brand_name !== fleet.fleet_name && (
          <span className="block text-xs" style={{ color: FAINT }}>{fleet.fleet_name}</span>
        )}
      </td>
      <td className="px-4 py-3 text-sm text-white">{fleet.unit_count}</td>
      <td className="px-4 py-3 text-sm text-white">{fleet.member_count}</td>
      <td className="px-4 py-3 text-sm"><HealthPill fleet={fleet} /></td>
      <td className="px-4 py-3 text-sm">
        {fleet.open_defect_count > 0
          ? <Pill label={String(fleet.open_defect_count)} color={RED} />
          : <span style={{ color: MUTED }}>—</span>}
      </td>
      <td className="px-4 py-3 text-sm text-white">{money(fleet.revenue_mtd)}</td>
      <td className="px-4 py-3 text-sm text-white">{money(fleet.revenue_ytd)}</td>
      <td className="px-4 py-3 text-sm text-white">{shortDate(fleet.last_service_date)}</td>
      <td className="px-4 py-3 text-sm"><BillingPill fleet={fleet} /></td>
    </tr>
  )
}

function ActivityItem({ row, index }: { row: PartnerActivityRow; index: number }) {
  const failed = row.result === 'fail' || row.result?.startsWith('fail')

  return (
    <li className="px-4 py-3 flex items-start gap-3" style={{ borderTop: index > 0 ? '1px solid #1e3040' : undefined }}>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white truncate">{row.title}</p>
        <p className="text-xs truncate" style={{ color: FAINT }}>
          {row.fleet_name}
          {row.unit_number && ` · Unit ${row.unit_number}`}
          {` · ${shortDate(row.date)}`}
        </p>
      </div>
      <div className="text-right shrink-0 flex flex-col items-end gap-1">
        <span className="text-xs uppercase tracking-wider" style={{ color: MUTED }}>{KIND_LABEL[row.kind]}</span>
        {row.amount !== null
          ? <span className="text-sm text-white">{usdExact.format(row.amount)}</span>
          : failed
            ? <Pill label="Fail" color={RED} />
            : null}
      </div>
    </li>
  )
}

function PmAlertItem({ alert, index }: { alert: PartnerPmAlert; index: number }) {
  const color = alert.overdue ? RED : NWI_ORANGE

  // Prefer the label the PM calculator already produced. Most fleets run hours-based
  // PM, where a day count is meaningless — deriving "0 d late" from days_until_due
  // would read as due-today on a unit that is 1,233 hours overdue.
  const when = alert.pm_label ?? (alert.overdue
    ? `${Math.abs(alert.days_until_due)} d late`
    : alert.days_until_due === 0 ? 'due today' : `in ${alert.days_until_due} d`)

  // An hours PM has no due date; show the meter target instead of an em dash.
  const detail = alert.next_due_date
    ? shortDate(alert.next_due_date)
    : alert.next_due_hours != null
      ? `${alert.next_due_hours.toLocaleString('en-US')} hrs`
      : '—'

  return (
    <li className="px-4 py-3 flex items-center gap-3" style={{ borderTop: index > 0 ? '1px solid #1e3040' : undefined }}>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white truncate">Unit {alert.unit_number}</p>
        <p className="text-xs truncate" style={{ color: FAINT }}>
          {alert.fleet_name} · {detail}
        </p>
      </div>
      <Pill label={when} color={color} />
    </li>
  )
}

export default function PartnerDashboardClient() {
  const [dashboard, setDashboard] = useState<PartnerDashboard | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res  = await fetch('/api/fleet-pro/partner/dashboard')
        const json = await res.json()
        if (cancelled) return
        if (!res.ok) { setError(json?.error ?? 'Could not load the partner dashboard'); return }
        setDashboard(json.dashboard as PartnerDashboard)
      } catch {
        if (!cancelled) setError('Could not load the partner dashboard')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  const header = (
    <div className="mb-6">
      <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>Partner</p>
      <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">FLEET ACCOUNTS</h1>
    </div>
  )

  if (loading) {
    return <div>{header}<Skeleton /></div>
  }

  if (error || !dashboard) {
    return (
      <div>
        {header}
        <div className="rounded-xl p-6" style={CARD}>
          <p className="text-sm" style={{ color: RED }}>{error ?? 'Could not load the partner dashboard'}</p>
        </div>
      </div>
    )
  }

  const headers = ['Fleet', 'Units', 'Members', 'PM', 'Defects', 'MTD', 'YTD', 'Last Service', 'Billing']

  return (
    <div>
      {header}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
        <KpiCard label="Fleets"  value={String(dashboard.fleet_count)} sub={dashboard.partner_name} />
        <KpiCard label="Units"   value={String(dashboard.total_units)} sub="Across all accounts" />
        <KpiCard label="MTD"     value={money(dashboard.revenue_mtd)}  sub="Billed this month" />
        <KpiCard label="YTD"     value={money(dashboard.revenue_ytd)}  sub="Billed this year" />
        <KpiCard label="Overdue" value={String(dashboard.overdue_pm_total)}
                 color={dashboard.overdue_pm_total > 0 ? RED : '#ffffff'}
                 sub={`${dashboard.due_soon_pm_total} due soon`} />
        <KpiCard label="Cost"    value={money(dashboard.monthly_cost)} sub="Fleet Pro / month" />
      </div>

      {dashboard.fleets.length === 0 ? (
        <div className="rounded-xl p-10 text-center" style={CARD}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-1">NO FLEET ACCOUNTS YET</p>
          <p className="text-sm mb-4" style={{ color: MUTED }}>
            No fleet accounts yet — add your first and its portal, branding and billing all start here.
          </p>
          <Link
            href="/fleet-pro/partner/accounts"
            className="inline-flex items-center px-4 min-h-[44px] rounded-lg text-sm font-semibold"
            style={{ background: NWI_ORANGE, color: '#0a0f14' }}
          >
            Add a fleet account
          </Link>
        </div>
      ) : (
        <>
          <div className="rounded-xl overflow-hidden mb-6" style={{ border: '1px solid #1e3040' }}>
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
                  {dashboard.fleets.map((fleet, i) => (
                    <FleetTableRow key={fleet.fleet_account_id} fleet={fleet} index={i} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Panel title="Recent Activity" count={dashboard.recent_activity.length}>
              {dashboard.recent_activity.length === 0 ? (
                <p className="px-4 py-8 text-sm text-center" style={{ color: MUTED }}>
                  Nothing logged yet across these fleets.
                </p>
              ) : (
                <ul>
                  {dashboard.recent_activity.map((row, i) => (
                    <ActivityItem key={`${row.kind}-${row.fleet_account_id}-${row.date}-${i}`} row={row} index={i} />
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="PM Alerts Due" count={dashboard.pm_alerts.length}>
              {dashboard.pm_alerts.length === 0 ? (
                <p className="px-4 py-8 text-sm text-center" style={{ color: GREEN }}>
                  Every unit is on schedule.
                </p>
              ) : (
                <ul>
                  {dashboard.pm_alerts.map((alert, i) => (
                    <PmAlertItem key={`${alert.unit_id}-${i}`} alert={alert} index={i} />
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
