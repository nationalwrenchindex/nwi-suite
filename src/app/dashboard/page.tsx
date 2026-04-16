import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import { STATUS_CONFIG, formatTime } from '@/lib/scheduler'
import type { JobStatus } from '@/types/jobs'

export const metadata = { title: 'Dashboard — NWI Suite' }

// ─── Local types ──────────────────────────────────────────────────────────────

interface TodayJob {
  id: string
  job_time: string | null
  service_type: string
  status: JobStatus
  location_address: string | null
  estimated_duration_minutes: number | null
  customer: { first_name: string; last_name: string; phone: string | null } | null
  vehicle: { year: number | null; make: string; model: string } | null
}

interface OutstandingInvoice {
  id: string
  invoice_number: string
  total: number
  status: string
  due_date: string | null
  customer: { first_name: string; last_name: string } | null
}

type AlertStatus = 'overdue' | 'due_soon' | 'no_history' | 'up_to_date'

interface TopAlert {
  vehicle: { id: string; year: number | null; make: string; model: string }
  customer: { id: string; first_name: string; last_name: string; phone: string | null }
  alert_status: AlertStatus
  days_overdue: number | null
  days_until_due: number | null
  last_service: { service_type: string; service_date: string } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000)      return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

function fmtDate(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(y, mo - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function calcAlerts(
  vehicles: {
    id: string; customer_id: string; year: number | null
    make: string; model: string; mileage: number | null
    service_history: {
      service_date: string; service_type: string
      mileage_at_service: number | null
      next_service_date: string | null
      next_service_mileage: number | null
    }[]
  }[],
  customerMap: Record<string, { id: string; first_name: string; last_name: string; phone: string | null }>,
): TopAlert[] {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const ORDER: Record<AlertStatus, number> = { overdue: 0, due_soon: 1, no_history: 2, up_to_date: 3 }
  const results: TopAlert[] = []

  for (const v of vehicles) {
    const customer = customerMap[v.customer_id]
    if (!customer) continue

    const history = [...(v.service_history ?? [])].sort(
      (a, b) => new Date(b.service_date).getTime() - new Date(a.service_date).getTime(),
    )
    const latest = history[0] ?? null
    let alert_status: AlertStatus = 'no_history'
    let days_overdue: number | null = null
    let days_until_due: number | null = null

    if (latest) {
      const nextDate = latest.next_service_date
        ? new Date(latest.next_service_date + 'T00:00:00') : null
      const nextMileage = latest.next_service_mileage ?? null
      const currentMileage = v.mileage ?? null
      const diffDays = nextDate
        ? Math.round((nextDate.getTime() - today.getTime()) / 86_400_000) : null

      const mileageOverdue  = nextMileage !== null && currentMileage !== null && currentMileage >= nextMileage
      const mileageDueSoon  = nextMileage !== null && currentMileage !== null && currentMileage >= nextMileage - 500

      if      (diffDays !== null && diffDays < 0)       { alert_status = 'overdue';   days_overdue   = -diffDays }
      else if (mileageOverdue)                           { alert_status = 'overdue' }
      else if (diffDays !== null && diffDays <= 30)      { alert_status = 'due_soon';  days_until_due = diffDays }
      else if (mileageDueSoon)                           { alert_status = 'due_soon' }
      else if (nextDate || nextMileage)                  { alert_status = 'up_to_date'; if (diffDays !== null) days_until_due = diffDays }
      else {
        const daysSince = Math.round((today.getTime() - new Date(latest.service_date + 'T00:00:00').getTime()) / 86_400_000)
        alert_status = daysSince > 90 ? 'due_soon' : 'up_to_date'
      }
    }

    if (alert_status === 'up_to_date') continue  // skip up-to-date on dashboard

    results.push({
      vehicle:       { id: v.id, year: v.year, make: v.make, model: v.model },
      customer,
      alert_status,
      days_overdue,
      days_until_due,
      last_service:  latest ? { service_type: latest.service_type, service_date: latest.service_date } : null,
    })
  }

  return results.sort((a, b) => ORDER[a.alert_status] - ORDER[b.alert_status])
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, accent, icon,
}: {
  label: string; value: string; sub?: string
  accent: 'orange' | 'blue' | 'success' | 'danger' | 'muted'
  icon: React.ReactNode
}) {
  const borders = { orange: 'border-orange/30', blue: 'border-blue/30', success: 'border-success/30', danger: 'border-danger/30', muted: 'border-white/10' }
  const texts   = { orange: 'text-orange', blue: 'text-blue-light', success: 'text-success', danger: 'text-danger', muted: 'text-white/60' }
  return (
    <div className={`nwi-card border ${borders[accent]} flex items-start gap-4`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-current/10`}
        style={{ background: 'rgba(255,255,255,0.04)' }}>
        <span className={texts[accent]}>{icon}</span>
      </div>
      <div className="min-w-0">
        <p className={`font-condensed font-bold text-3xl leading-none ${texts[accent]}`}>{value}</p>
        <p className="text-white/40 text-xs uppercase tracking-widest mt-1">{label}</p>
        {sub && <p className="text-white/25 text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: JobStatus }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function JobRow({ job, isLast }: { job: TodayJob; isLast: boolean }) {
  const customerName = job.customer
    ? `${job.customer.first_name} ${job.customer.last_name}`
    : 'Walk-in'
  const vehicleLabel = job.vehicle
    ? `${[job.vehicle.year, job.vehicle.make, job.vehicle.model].filter(Boolean).join(' ')}`
    : null

  return (
    <div className={`flex items-start gap-4 py-4 ${!isLast ? 'border-b border-dark-border' : ''}`}>
      {/* Time column */}
      <div className="w-16 flex-shrink-0 text-right">
        <p className="font-condensed font-bold text-white text-sm">
          {job.job_time ? formatTime(job.job_time) : '—'}
        </p>
        {job.estimated_duration_minutes && (
          <p className="text-white/25 text-[10px]">{job.estimated_duration_minutes}m</p>
        )}
      </div>

      {/* Status dot */}
      <div className="flex-shrink-0 mt-1">
        <span className={`block w-2.5 h-2.5 rounded-full ${STATUS_CONFIG[job.status]?.dot ?? 'bg-white/20'}`} />
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-white font-medium text-sm truncate">{customerName}</p>
          <StatusBadge status={job.status} />
        </div>
        <p className="text-white/50 text-xs mt-0.5">{job.service_type}</p>
        {vehicleLabel && <p className="text-white/30 text-xs">{vehicleLabel}</p>}
        {job.location_address && (
          <p className="text-white/20 text-xs mt-0.5 truncate">📍 {job.location_address}</p>
        )}
      </div>

      {/* Link */}
      <Link href="/scheduler" className="flex-shrink-0 text-white/20 hover:text-orange transition-colors mt-0.5">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </div>
  )
}

function AlertCard({ alert }: { alert: TopAlert }) {
  const { alert_status, vehicle, customer, days_overdue, days_until_due, last_service } = alert

  const cfg = {
    overdue:    { bar: 'bg-danger',  badge: 'bg-danger/15 text-danger border-danger/30',         label: 'Overdue'   },
    due_soon:   { bar: 'bg-amber-400', badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30', label: 'Due Soon'  },
    no_history: { bar: 'bg-white/20', badge: 'bg-white/5 text-white/40 border-white/10',          label: 'No History' },
    up_to_date: { bar: 'bg-success',  badge: 'bg-success/15 text-success border-success/30',       label: 'Up to Date' },
  }[alert_status]

  const subText = days_overdue
    ? `${days_overdue}d overdue`
    : days_until_due !== null
    ? `Due in ${days_until_due}d`
    : last_service
    ? `Last: ${fmtDate(last_service.service_date)}`
    : 'Never serviced'

  return (
    <div className="flex items-start gap-3 py-3 border-b border-dark-border last:border-0">
      <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${cfg.bar}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <p className="text-white text-sm font-medium">{customer.first_name} {customer.last_name}</p>
          <span className={`text-[10px] font-semibold rounded-full border px-2 py-0.5 ${cfg.badge}`}>
            {cfg.label}
          </span>
        </div>
        <p className="text-white/50 text-xs">
          {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}
        </p>
        <p className="text-white/30 text-xs mt-0.5">{subText}</p>
      </div>
    </div>
  )
}

function InvoiceRow({ inv, todayStr }: { inv: OutstandingInvoice; todayStr: string }) {
  const isOverdue = inv.status === 'overdue' || (inv.due_date ? inv.due_date < todayStr : false)
  const customerName = inv.customer
    ? `${inv.customer.first_name} ${inv.customer.last_name}`
    : 'Unknown customer'

  return (
    <div className="flex items-center gap-4 py-3 border-b border-dark-border last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-white text-sm font-medium">{inv.invoice_number}</p>
          {isOverdue
            ? <span className="text-[10px] font-semibold rounded-full border px-2 py-0.5 bg-danger/15 text-danger border-danger/30">Overdue</span>
            : <span className="text-[10px] font-semibold rounded-full border px-2 py-0.5 bg-blue/15 text-blue-light border-blue/30">Sent</span>
          }
        </div>
        <p className="text-white/40 text-xs mt-0.5">
          {customerName}{inv.due_date ? ` · Due ${fmtDate(inv.due_date)}` : ''}
        </p>
      </div>
      <p className={`font-condensed font-bold text-lg flex-shrink-0 ${isOverdue ? 'text-danger' : 'text-white'}`}>
        ${Number(inv.total).toFixed(2)}
      </p>
      <Link href="/financials" className="text-white/20 hover:text-orange transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </Link>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, business_name, profession_type, service_area_description, slug')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  const today      = new Date()
  const todayStr   = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const monthStart = todayStr.slice(0, 7) + '-01'
  const dayLabel   = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  // ── Parallel data fetch ──
  const [
    { data: todayJobsRaw },
    { data: outstandingInvoicesRaw },
    { data: paidInvoicesRaw },
    { count: customerCount },
    { data: customersForAlerts },
  ] = await Promise.all([
    supabase
      .from('jobs')
      .select(`id, job_time, service_type, status, location_address, estimated_duration_minutes,
               customer:customers(first_name, last_name, phone),
               vehicle:vehicles(year, make, model)`)
      .eq('user_id', user.id)
      .eq('job_date', todayStr)
      .neq('status', 'cancelled')
      .order('job_time', { ascending: true, nullsFirst: true }),

    supabase
      .from('invoices')
      .select('id, invoice_number, total, status, due_date, customer:customers(first_name, last_name)')
      .eq('user_id', user.id)
      .in('status', ['sent', 'overdue'])
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(8),

    supabase
      .from('invoices')
      .select('total')
      .eq('user_id', user.id)
      .eq('status', 'paid')
      .gte('invoice_date', monthStart),

    supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id),

    supabase
      .from('customers')
      .select('id, first_name, last_name, phone')
      .eq('user_id', user.id)
      .limit(200),
  ])

  // ── Service alerts (two-step: need customer IDs first) ──
  let topAlerts: TopAlert[] = []
  const customerIds = (customersForAlerts ?? []).map(c => c.id)
  if (customerIds.length > 0) {
    const { data: vehiclesRaw } = await supabase
      .from('vehicles')
      .select(`id, customer_id, year, make, model, mileage,
               service_history(service_date, service_type, mileage_at_service, next_service_date, next_service_mileage)`)
      .in('customer_id', customerIds)

    if (vehiclesRaw) {
      const customerMap = Object.fromEntries(
        (customersForAlerts ?? []).map(c => [c.id, c])
      )
      topAlerts = calcAlerts(
        vehiclesRaw as Parameters<typeof calcAlerts>[0],
        customerMap,
      ).slice(0, 3)
    }
  }

  // ── Derived KPIs ──
  const todayJobs        = (todayJobsRaw ?? []) as TodayJob[]
  const outstandingInvs  = (outstandingInvoicesRaw ?? []) as OutstandingInvoice[]
  const revenueMTD       = (paidInvoicesRaw ?? []).reduce((s, inv) => s + Number(inv.total), 0)
  const outstandingTotal = outstandingInvs.reduce((s, inv) => s + Number(inv.total), 0)
  const overdueCount     = outstandingInvs.filter(i => i.status === 'overdue' || (i.due_date && i.due_date < todayStr)).length

  const professionLabels: Record<string, string> = {
    mobile_mechanic:  'Mobile Mechanic',
    auto_electrician: 'Auto Electrician',
    diagnostician:    'Diagnostician',
    tire_technician:  'Tire Technician',
    other:            'Auto Technician',
  }

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav businessName={profile.business_name} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── Welcome banner ── */}
        <div className="bg-blue-gradient rounded-2xl px-6 sm:px-8 py-7 relative overflow-hidden">
          <div className="absolute -right-10 -top-10 w-44 h-44 rounded-full bg-white/5 pointer-events-none" />
          <div className="absolute right-8 bottom-0 w-20 h-20 rounded-full bg-orange/20 pointer-events-none" />
          <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-white/50 text-xs uppercase tracking-widest mb-1">
                {professionLabels[profile.profession_type ?? ''] ?? 'Technician'} · {dayLabel}
              </p>
              <h1 className="font-condensed font-bold text-3xl sm:text-4xl text-white tracking-wide mb-0.5">
                {profile.full_name ?? user.email}
              </h1>
              <p className="text-white/60 text-sm">{profile.business_name}</p>
              {profile.service_area_description && (
                <p className="text-white/40 text-xs mt-1">📍 {profile.service_area_description}</p>
              )}
            </div>
            {/* Live summary pills */}
            <div className="flex flex-wrap gap-2">
              <div className="bg-white/10 rounded-xl px-3 py-2 text-center min-w-[60px]">
                <p className="font-condensed font-bold text-xl text-white">{todayJobs.length}</p>
                <p className="text-white/50 text-[10px] uppercase tracking-wider">Today</p>
              </div>
              <div className="bg-white/10 rounded-xl px-3 py-2 text-center min-w-[60px]">
                <p className={`font-condensed font-bold text-xl ${overdueCount > 0 ? 'text-danger' : 'text-white'}`}>
                  {outstandingInvs.length}
                </p>
                <p className="text-white/50 text-[10px] uppercase tracking-wider">Invoices</p>
              </div>
              <div className="bg-white/10 rounded-xl px-3 py-2 text-center min-w-[60px]">
                <p className="font-condensed font-bold text-xl text-success">{fmtCurrency(revenueMTD)}</p>
                <p className="text-white/50 text-[10px] uppercase tracking-wider">MTD</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── KPI cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Today's Jobs"
            value={String(todayJobs.length)}
            sub={todayJobs.length === 1 ? '1 appointment' : `${todayJobs.length} appointments`}
            accent="orange"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            }
          />
          <KpiCard
            label="Outstanding"
            value={fmtCurrency(outstandingTotal)}
            sub={overdueCount > 0 ? `${overdueCount} overdue` : `${outstandingInvs.length} unpaid`}
            accent={overdueCount > 0 ? 'danger' : 'blue'}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            }
          />
          <KpiCard
            label="Revenue MTD"
            value={fmtCurrency(revenueMTD)}
            sub="Paid invoices this month"
            accent="success"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
            }
          />
          <KpiCard
            label="Active Customers"
            value={String(customerCount ?? 0)}
            accent="muted"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            }
          />
        </div>

        {/* ── Main content grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Today's schedule */}
          <div className="lg:col-span-2">
            <div className="nwi-card h-full">
              <div className="flex items-center justify-between mb-4 pb-4 border-b border-dark-border">
                <div>
                  <p className="font-condensed font-bold text-white text-lg tracking-wide">TODAY&apos;S SCHEDULE</p>
                  <p className="text-white/30 text-xs mt-0.5">{dayLabel}</p>
                </div>
                <Link href="/scheduler"
                  className="text-xs text-white/40 hover:text-orange transition-colors border border-dark-border hover:border-orange/30 rounded-lg px-3 py-1.5">
                  Open Scheduler →
                </Link>
              </div>

              {todayJobs.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="w-12 h-12 bg-dark rounded-full flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-white/20" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <rect x="3" y="4" width="18" height="18" rx="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8"  y1="2" x2="8"  y2="6" />
                      <line x1="3"  y1="10" x2="21" y2="10" />
                    </svg>
                  </div>
                  <p className="text-white/25 text-sm font-medium">No jobs scheduled today</p>
                  <Link href="/scheduler"
                    className="mt-3 inline-flex items-center gap-1 text-xs text-orange hover:text-orange/80 transition-colors">
                    + Book a job
                  </Link>
                </div>
              ) : (
                <div>
                  {todayJobs.map((job, i) => (
                    <JobRow key={job.id} job={job} isLast={i === todayJobs.length - 1} />
                  ))}
                  <div className="pt-4">
                    <Link href="/scheduler"
                      className="text-xs text-white/30 hover:text-orange transition-colors">
                      View full calendar →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Service alerts */}
          <div>
            <div className="nwi-card h-full">
              <div className="flex items-center justify-between mb-4 pb-4 border-b border-dark-border">
                <div>
                  <p className="font-condensed font-bold text-white text-lg tracking-wide">SERVICE ALERTS</p>
                  <p className="text-white/30 text-xs mt-0.5">Customers due for service</p>
                </div>
                {topAlerts.length > 0 && (
                  <span className="bg-danger/20 text-danger border border-danger/30 rounded-full px-2 py-0.5 text-xs font-bold">
                    {topAlerts.filter(a => a.alert_status === 'overdue').length > 0
                      ? topAlerts.filter(a => a.alert_status === 'overdue').length
                      : topAlerts.length}
                  </span>
                )}
              </div>

              {topAlerts.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="w-12 h-12 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-white/25 text-sm">All customers up to date</p>
                </div>
              ) : (
                <div>
                  {topAlerts.map((alert) => (
                    <AlertCard key={alert.vehicle.id} alert={alert} />
                  ))}
                  <div className="pt-4">
                    <Link href="/intel"
                      className="text-xs text-white/30 hover:text-orange transition-colors">
                      View all alerts →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Outstanding invoices ── */}
        <div className="nwi-card">
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-dark-border">
            <div>
              <p className="font-condensed font-bold text-white text-lg tracking-wide">OUTSTANDING INVOICES</p>
              <p className="text-white/30 text-xs mt-0.5">
                {outstandingInvs.length > 0
                  ? `${outstandingInvs.length} unpaid · ${fmtCurrency(outstandingTotal)} total`
                  : 'No outstanding invoices'}
              </p>
            </div>
            <Link href="/financials"
              className="text-xs text-white/40 hover:text-orange transition-colors border border-dark-border hover:border-orange/30 rounded-lg px-3 py-1.5">
              Open Financials →
            </Link>
          </div>

          {outstandingInvs.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-success text-2xl mb-2">✓</p>
              <p className="text-white/25 text-sm">All invoices paid up</p>
            </div>
          ) : (
            <div>
              {outstandingInvs.map(inv => (
                <InvoiceRow key={inv.id} inv={inv} todayStr={todayStr} />
              ))}
              {outstandingInvs.length >= 8 && (
                <div className="pt-4 text-center">
                  <Link href="/financials" className="text-xs text-white/30 hover:text-orange transition-colors">
                    View all outstanding invoices →
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Module navigation ── */}
        <div>
          <p className="text-white/30 text-xs uppercase tracking-widest mb-3">Quick Access</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                href: '/scheduler',
                label: 'SCHEDULER',
                sub: 'Calendar, jobs & notifications',
                accent: 'orange' as const,
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8"  y1="2" x2="8"  y2="6" />
                    <line x1="3"  y1="10" x2="21" y2="10" />
                  </svg>
                ),
              },
              {
                href: '/intel',
                label: 'INTEL HUB',
                sub: 'Customers, vehicles & alerts',
                accent: 'blue' as const,
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                ),
              },
              {
                href: '/financials',
                label: 'FINANCIALS',
                sub: 'Invoices, expenses & P&L',
                accent: 'success' as const,
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                ),
              },
              {
                href: profile.slug ? `/book/${profile.slug}` : '/onboarding',
                label: 'BOOKING PAGE',
                sub: profile.slug ? `book/${profile.slug}` : 'Set up your booking URL',
                accent: 'muted' as const,
                icon: (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                ),
              },
            ].map(({ href, label, sub, accent, icon }) => {
              const colors = {
                orange:  { ring: 'hover:border-orange/40 hover:bg-orange/5',  ic: 'bg-orange/10 border-orange/20 text-orange'  },
                blue:    { ring: 'hover:border-blue/40 hover:bg-blue/5',       ic: 'bg-blue/10 border-blue/20 text-blue-light'  },
                success: { ring: 'hover:border-success/40 hover:bg-success/5', ic: 'bg-success/10 border-success/20 text-success' },
                muted:   { ring: 'hover:border-white/20 hover:bg-white/3',     ic: 'bg-white/5 border-white/10 text-white/40'   },
              }[accent]
              return (
                <Link key={href} href={href}
                  className={`nwi-card flex items-start gap-3 transition-colors group ${colors.ring}`}>
                  <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 transition-colors ${colors.ic}`}>
                    {icon}
                  </div>
                  <div className="min-w-0">
                    <p className="font-condensed font-bold text-white text-sm tracking-wide">{label}</p>
                    <p className="text-white/30 text-[11px] mt-0.5 leading-tight truncate">{sub}</p>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>

      </main>
    </div>
  )
}
