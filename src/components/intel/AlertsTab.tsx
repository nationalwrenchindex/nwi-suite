'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ServiceAlert, AlertStatus } from '@/types/intel'

// ─── Status config ─────────────────────────────────────────────────────────────

const STATUS_META: Record<AlertStatus, { label: string; cls: string; badge: string }> = {
  overdue:    { label: 'Overdue',     cls: 'border-danger/30 bg-danger/5',       badge: 'bg-danger/20 text-danger' },
  due_soon:   { label: 'Due Soon',    cls: 'border-yellow-500/30 bg-yellow-500/5', badge: 'bg-yellow-500/20 text-yellow-400' },
  no_history: { label: 'No History',  cls: 'border-white/10 bg-white/2',         badge: 'bg-white/10 text-white/40' },
  up_to_date: { label: 'Up to Date',  cls: 'border-success/20 bg-success/5',     badge: 'bg-success/20 text-success' },
}

const FILTER_TABS: { value: '' | AlertStatus; label: string }[] = [
  { value: '',            label: 'All' },
  { value: 'overdue',     label: 'Overdue' },
  { value: 'due_soon',    label: 'Due Soon' },
  { value: 'no_history',  label: 'No History' },
  { value: 'up_to_date',  label: 'Up to Date' },
]

// ─── Alert card ───────────────────────────────────────────────────────────────

function AlertCard({ alert }: { alert: ServiceAlert }) {
  const { label, cls, badge } = STATUS_META[alert.alert_status]
  const v = alert.vehicle
  const c = alert.customer

  const vehicleLabel = [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ')

  function statusSub() {
    if (alert.alert_status === 'overdue' && alert.days_overdue) {
      return `${alert.days_overdue} day${alert.days_overdue !== 1 ? 's' : ''} overdue`
    }
    if (alert.alert_status === 'due_soon' && alert.days_until_due !== null) {
      return `Due in ${alert.days_until_due} day${alert.days_until_due !== 1 ? 's' : ''}`
    }
    if (alert.next_service_date) {
      return `Next service: ${new Date(alert.next_service_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    }
    if (alert.next_service_mileage) {
      return `Next service: ${alert.next_service_mileage.toLocaleString()} mi`
    }
    if (alert.alert_status === 'no_history') return 'Never serviced'
    return ''
  }

  return (
    <div className={`border rounded-xl p-4 ${cls}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Vehicle */}
          <p className="font-medium text-white truncate">{vehicleLabel}</p>
          <p className="text-white/40 text-xs mt-0.5">
            {c.first_name} {c.last_name}
            {c.phone && <span className="ml-2">&middot; {c.phone}</span>}
          </p>
          {v.license_plate && (
            <p className="text-white/30 text-xs mt-0.5 font-mono">{v.license_plate}</p>
          )}
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold ${badge}`}>
          {label}
        </span>
      </div>

      {/* Status info row */}
      <div className="flex items-center gap-4 mt-3 flex-wrap">
        {statusSub() && (
          <span className="text-xs text-white/50">{statusSub()}</span>
        )}
        {alert.last_service && (
          <span className="text-xs text-white/30">
            Last: {alert.last_service.service_type} on{' '}
            {new Date(alert.last_service.service_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        )}
        {v.mileage && (
          <span className="text-xs text-white/30">
            {v.mileage.toLocaleString()} mi
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AlertsTab() {
  const [alerts,        setAlerts]       = useState<ServiceAlert[]>([])
  const [loading,       setLoading]      = useState(true)
  const [error,         setError]        = useState<string | null>(null)
  const [statusFilter,  setStatusFilter] = useState<'' | AlertStatus>('')

  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch('/api/alerts')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load alerts')
      setAlerts(json.alerts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAlerts() }, [fetchAlerts])

  const filtered = statusFilter
    ? alerts.filter(a => a.alert_status === statusFilter)
    : alerts

  const counts = alerts.reduce<Record<string, number>>((acc, a) => {
    acc[a.alert_status] = (acc[a.alert_status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {FILTER_TABS.map(f => {
          const count = f.value ? (counts[f.value] ?? 0) : alerts.length
          return (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === f.value
                  ? 'bg-orange/15 text-orange'
                  : 'text-white/40 hover:text-white hover:bg-white/5'
              }`}
            >
              {f.label}
              {count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  statusFilter === f.value ? 'bg-orange/30' : 'bg-white/10'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}

        <button
          onClick={fetchAlerts}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-white/30 hover:text-white text-xs transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          Refresh
        </button>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* Overdue banner */}
      {!loading && counts['overdue'] > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-danger/10 border border-danger/30 rounded-xl">
          <svg className="w-4 h-4 text-danger shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <p className="text-danger text-sm font-medium">
            {counts['overdue']} vehicle{counts['overdue'] !== 1 ? 's' : ''} overdue for service — reach out to schedule.
          </p>
        </div>
      )}

      {/* Alert list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="nwi-card animate-pulse h-20 bg-dark-card/50" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="nwi-card text-center py-12">
          <svg className="w-10 h-10 text-white/10 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <p className="text-white/30 text-sm">
            {statusFilter
              ? `No vehicles with status "${STATUS_META[statusFilter].label}".`
              : 'No vehicles found. Add customers and vehicles in the Customers tab.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((alert) => (
            <AlertCard key={alert.vehicle.id} alert={alert} />
          ))}
        </div>
      )}
    </div>
  )
}
