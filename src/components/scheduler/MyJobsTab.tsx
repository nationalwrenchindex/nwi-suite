'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Job, JobStatus, Inspection } from '@/types/jobs'
import { STATUS_CONFIG, STATUS_TRANSITIONS, formatTime, formatDateShort } from '@/lib/scheduler'
import MultiPointInspection from '@/components/quickwrench/MultiPointInspection'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ALL_STATUSES: { value: '' | JobStatus; label: string }[] = [
  { value: '',             label: 'All Statuses' },
  { value: 'scheduled',   label: 'Scheduled'    },
  { value: 'en_route',    label: 'En Route'     },
  { value: 'in_progress', label: 'In Progress'  },
  { value: 'on_site',     label: 'On Site'      },
  { value: 'completed',   label: 'Completed'    },
  { value: 'no_show',     label: 'No Show'      },
  { value: 'cancelled',   label: 'Cancelled'    },
]

const QUICK_RANGES: { label: string; from: () => string; to: () => string }[] = [
  {
    label: 'Today',
    from: () => new Date().toISOString().slice(0, 10),
    to:   () => new Date().toISOString().slice(0, 10),
  },
  {
    label: 'This Week',
    from: () => {
      const d = new Date()
      d.setDate(d.getDate() - d.getDay())
      return d.toISOString().slice(0, 10)
    },
    to: () => {
      const d = new Date()
      d.setDate(d.getDate() + (6 - d.getDay()))
      return d.toISOString().slice(0, 10)
    },
  },
  {
    label: 'This Month',
    from: () => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    },
    to: () => {
      const d = new Date()
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      return last.toISOString().slice(0, 10)
    },
  },
]

// ─── Job card ─────────────────────────────────────────────────────────────────

function JobCard({
  job,
  businessType,
  onStatusChange,
  onCancel,
  onOpenInspection,
  onJobUpdated,
}: {
  job: Job
  businessType?: string
  onStatusChange:   (id: string, status: JobStatus) => Promise<void>
  onCancel:         (id: string) => Promise<void>
  onOpenInspection: (jobId: string, customerName: string) => void
  onJobUpdated?:    (job: Job) => void
}) {
  const [expanded,        setExpanded]        = useState(false)
  const [updating,        setUpdating]        = useState(false)
  const [generatingQuote, setGeneratingQuote] = useState(false)
  const [notifying,       setNotifying]       = useState<string | null>(null)
  const [notifResult,     setNotifResult]     = useState<{ ok: boolean; msg: string } | null>(null)
  const [quoteError,      setQuoteError]      = useState<string | null>(null)
  const cfg         = STATUS_CONFIG[job.status]
  const transitions = STATUS_TRANSITIONS[job.status] ?? []

  async function doStatusChange(next: JobStatus) {
    setUpdating(true)
    await onStatusChange(job.id, next)
    setUpdating(false)
  }

  async function doCancel() {
    if (!confirm('Cancel this job?')) return
    setUpdating(true)
    await onCancel(job.id)
    setUpdating(false)
  }

  async function sendNotif(trigger: string) {
    setNotifying(trigger)
    setNotifResult(null)
    try {
      const res  = await fetch('/api/notifications/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ trigger, job_id: job.id }),
      })
      const json = await res.json()
      const ok   = res.ok && json.result?.success
      const smsErr   = json.result?.sms?.error
      const emailErr = json.result?.email?.error
      const detail   = smsErr ?? emailErr
      setNotifResult({
        ok,
        msg: ok ? 'Sent!' : (json.error ?? detail ?? 'Failed to send'),
      })

      // Record on_my_way_sent_at so the "On Site" button can appear
      if (ok && trigger === 'on_my_way') {
        const upd = await fetch(`/api/jobs/${job.id}`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ on_my_way_sent_at: new Date().toISOString() }),
        })
        if (upd.ok) {
          const { job: updated } = await upd.json()
          if (updated) onJobUpdated?.(updated)
        }
      }
    } catch {
      setNotifResult({ ok: false, msg: 'Network error' })
    } finally {
      setNotifying(null)
      setTimeout(() => setNotifResult(null), 4000)
    }
  }

  async function handleGenerateQuote() {
    setGeneratingQuote(true)
    setQuoteError(null)
    try {
      const servicesList = (job.services?.length ?? 0) > 0 ? job.services : [job.service_type]
      const res = await fetch('/api/quotes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          job_id:      job.id,
          customer_id: job.customer_id,
          vehicle_id:  job.vehicle_id,
          notes:       `Services requested: ${servicesList.join(', ')}`,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setQuoteError(json.error ?? 'Failed to create quote'); return }
      if (json.quote?.id) {
        window.location.href = `/quickwrench?loadQuoteId=${json.quote.id}`
      }
    } catch {
      setQuoteError('Network error')
    } finally {
      setGeneratingQuote(false)
    }
  }

  const isActive   = job.status !== 'cancelled' && job.status !== 'completed' && job.status !== 'no_show'
  const showOnSite = job.status === 'in_progress' && !!job.on_my_way_sent_at
  const showQuote  = job.status === 'on_site' && businessType !== 'detailer'

  return (
    <div
      className={`rounded-xl border transition-colors ${
        job.status === 'cancelled' ? 'border-dark-border opacity-60' : 'border-dark-border hover:border-white/20'
      } bg-dark-card`}
    >
      {/* Card header — always visible */}
      <button
        className="w-full text-left p-4"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.badge}`}>
                {cfg.label}
              </span>
              {job.inspection_requested && (
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-blue/15 text-blue-light border border-blue/30">
                  MPI Requested
                </span>
              )}
              {job.estimated_duration_minutes && (
                <span className="text-white/30 text-xs">⏱ {job.estimated_duration_minutes} min</span>
              )}
            </div>

            <p className="font-condensed font-bold text-white text-lg tracking-wide leading-tight">
              {job.service_type}
            </p>

            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-orange text-sm font-medium">
                {formatDateShort(job.job_date)}
                {job.job_time && <span className="text-white/50"> · {formatTime(job.job_time)}</span>}
              </span>

              {job.customer && (
                <span className="text-white/50 text-sm">
                  {job.customer.first_name} {job.customer.last_name}
                </span>
              )}
            </div>

            {job.vehicle && (
              <p className="text-white/40 text-xs mt-0.5">
                {job.vehicle.year} {job.vehicle.make} {job.vehicle.model}
                {job.vehicle.color && ` · ${job.vehicle.color}`}
              </p>
            )}
          </div>

          <svg
            className={`w-4 h-4 text-white/30 flex-shrink-0 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-dark-border pt-3 space-y-3">
          {job.location_address && (
            <p className="text-white/60 text-sm">📍 {job.location_address}</p>
          )}
          {job.notes && (
            <div>
              <p className="text-white/30 text-xs uppercase tracking-widest mb-1">Notes</p>
              <p className="text-white/70 text-sm">{job.notes}</p>
            </div>
          )}
          {job.internal_notes && (
            <div>
              <p className="text-white/30 text-xs uppercase tracking-widest mb-1">Internal Notes</p>
              <p className="text-white/50 text-sm italic">{job.internal_notes}</p>
            </div>
          )}

          {job.customer?.phone && (
            <p className="text-white/50 text-sm">📞 {job.customer.phone}</p>
          )}
          {job.customer?.email && (
            <p className="text-white/50 text-sm">✉️ {job.customer.email}</p>
          )}

          {/* Action bar */}
          {isActive && (
            <div className="flex flex-wrap gap-2 pt-1">
              {/* On Site — only when in_progress AND on_my_way was sent */}
              {showOnSite && (
                <button
                  disabled={updating}
                  onClick={() => doStatusChange('on_site')}
                  className="text-xs rounded-lg px-3 py-1.5 font-medium transition-colors border bg-amber-500/20 text-amber-400 border-amber-500/40 hover:bg-amber-500/30 disabled:opacity-50"
                >
                  📍 On Site
                </button>
              )}

              {/* Generic transitions (Completed, No Show, En Route, etc.) */}
              {transitions.filter(t => t !== 'cancelled').map((next) => (
                <button
                  key={next}
                  disabled={updating}
                  onClick={() => doStatusChange(next)}
                  className={`text-xs rounded-lg px-3 py-1.5 font-medium transition-colors border ${STATUS_CONFIG[next].badge} disabled:opacity-50`}
                >
                  → {STATUS_CONFIG[next].label}
                </button>
              ))}

              {/* Generate Quote — only when on_site and mechanic */}
              {showQuote && (
                <button
                  disabled={generatingQuote}
                  onClick={handleGenerateQuote}
                  className="text-xs rounded-lg px-3 py-1.5 font-medium transition-colors border border-orange/40 text-orange bg-orange/10 hover:bg-orange/20 disabled:opacity-50"
                >
                  {generatingQuote ? 'Creating…' : '📋 Generate Quote'}
                </button>
              )}

              <button
                disabled={updating}
                onClick={doCancel}
                className="text-xs rounded-lg px-3 py-1.5 font-medium border border-danger/40 text-danger bg-danger/10 hover:bg-danger/20 transition-colors disabled:opacity-50 ml-auto"
              >
                Cancel Job
              </button>
            </div>
          )}

          {quoteError && (
            <div className="text-xs px-3 py-2 rounded-lg border bg-danger/10 border-danger/30 text-danger">
              {quoteError}
            </div>
          )}

          {/* Multi-Point Inspection */}
          {job.inspection_requested && job.status !== 'cancelled' && (
            <div className="border-t border-dark-border pt-3">
              <button
                onClick={() => {
                  const name = job.customer
                    ? `${job.customer.first_name} ${job.customer.last_name}`
                    : 'Customer'
                  onOpenInspection(job.id, name)
                }}
                className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 font-semibold border border-blue/40 text-blue-light bg-blue/10 hover:bg-blue/20 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Complete 25-Point Inspection
              </button>
            </div>
          )}

          {/* Notification actions — only show if job has a customer */}
          {job.customer && job.status !== 'cancelled' && (
            <div className="border-t border-dark-border pt-3 space-y-2">
              <p className="text-white/30 text-[10px] uppercase tracking-widest">Notify Customer</p>
              <div className="flex flex-wrap gap-2">
                {/* On My Way — available for scheduled / en_route / in_progress */}
                {['scheduled', 'en_route', 'in_progress'].includes(job.status) && (
                  <button
                    disabled={!!notifying}
                    onClick={() => sendNotif('on_my_way')}
                    className="flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 font-medium border border-amber-500/40 text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                  >
                    {notifying === 'on_my_way' ? (
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                    ) : '📍'}
                    On My Way
                  </button>
                )}

                {/* Day-before reminder — manual resend */}
                {['scheduled'].includes(job.status) && (
                  <button
                    disabled={!!notifying}
                    onClick={() => sendNotif('day_before_reminder')}
                    className="flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 font-medium border border-blue/40 text-blue-light bg-blue/10 hover:bg-blue/20 transition-colors disabled:opacity-50"
                  >
                    {notifying === 'day_before_reminder' ? (
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                    ) : '🔔'}
                    Send Reminder
                  </button>
                )}
              </div>

              {/* Notification feedback toast */}
              {notifResult && (
                <div className={`text-xs px-3 py-2 rounded-lg border ${
                  notifResult.ok
                    ? 'bg-success/10 border-success/30 text-success'
                    : 'bg-danger/10 border-danger/30 text-danger'
                }`}>
                  {notifResult.ok ? '✓ ' : '✗ '}{notifResult.msg}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MyJobsTab({
  onBookJob,
  businessType,
}: {
  onBookJob: () => void
  businessType?: string
}) {
  const [jobs,     setJobs]     = useState<Job[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  // Filter state
  const [status,      setStatus]    = useState<'' | JobStatus>('')
  const [search,      setSearch]    = useState('')
  const [fromDate,    setFromDate]  = useState('')
  const [toDate,      setToDate]    = useState('')
  const [activeRange, setActiveRange] = useState<string | null>(null)

  // Multi-Point Inspection modal state
  const [mpiModal, setMpiModal] = useState<{
    inspectionId: string
    customerName: string
  } | null>(null)
  const [mpiLoading, setMpiLoading] = useState(false)

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()
    if (status)   params.set('status',       status)
    if (search)   params.set('service_type', search)
    if (fromDate) params.set('from_date',    fromDate)
    if (toDate)   params.set('to_date',      toDate)

    try {
      const res = await fetch(`/api/jobs?${params}`)
      if (!res.ok) throw new Error('Failed to load jobs')
      const data = await res.json()
      setJobs(data.jobs ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [status, search, fromDate, toDate])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  function applyQuickRange(r: typeof QUICK_RANGES[0]) {
    setFromDate(r.from())
    setToDate(r.to())
    setActiveRange(r.label)
  }

  function clearFilters() {
    setStatus('')
    setSearch('')
    setFromDate('')
    setToDate('')
    setActiveRange(null)
  }

  async function handleStatusChange(id: string, newStatus: JobStatus) {
    const res = await fetch(`/api/jobs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (res.ok) {
      const { job: updated } = await res.json()
      setJobs((prev) => prev.map((j) => (j.id === id ? updated : j)))
    }
  }

  async function handleCancel(id: string) {
    const res = await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setJobs((prev) => prev.map((j) =>
        j.id === id ? { ...j, status: 'cancelled' as JobStatus } : j,
      ))
    }
  }

  function handleJobUpdated(updated: Job) {
    setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)))
  }

  async function handleOpenInspection(jobId: string, customerName: string) {
    setMpiLoading(true)
    try {
      const res = await fetch(`/api/inspections?job_id=${jobId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to load inspection')
      const inspection = data.inspection as Inspection | null
      if (inspection) {
        setMpiModal({ inspectionId: inspection.id, customerName })
      }
    } catch (e) {
      console.error('[handleOpenInspection]', e)
    } finally {
      setMpiLoading(false)
    }
  }

  const hasFilters = status || search || fromDate || toDate

  return (
    <div>
      {/* ── Filter bar ── */}
      <div className="nwi-card mb-5 space-y-3">
        <div className="flex flex-wrap gap-3">
          {/* Status filter */}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as '' | JobStatus)}
            className="nwi-input w-auto min-w-[150px]"
          >
            {ALL_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search service type…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="nwi-input pl-9"
            />
          </div>

          {/* Date range */}
          <input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); setActiveRange(null) }}
            className="nwi-input w-auto"
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); setActiveRange(null) }}
            className="nwi-input w-auto"
          />
        </div>

        {/* Quick range pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white/30 text-xs">Quick:</span>
          {QUICK_RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => applyQuickRange(r)}
              className={`text-xs rounded-full px-3 py-1 border transition-colors ${
                activeRange === r.label
                  ? 'bg-orange text-white border-orange'
                  : 'border-dark-border text-white/50 hover:border-white/30 hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-danger hover:text-danger/80 ml-auto"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ── Results ── */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-white/30 text-sm">
          Loading jobs…
        </div>
      )}

      {error && (
        <div className="alert-error mb-4">{error}</div>
      )}

      {!loading && !error && jobs.length === 0 && (
        <div className="nwi-card text-center py-16">
          <p className="text-4xl mb-3">📋</p>
          <p className="font-condensed font-bold text-xl text-white mb-2">NO JOBS FOUND</p>
          <p className="text-white/40 text-sm mb-5">
            {hasFilters ? 'Try adjusting your filters.' : 'Book your first job to get started.'}
          </p>
          {!hasFilters && (
            <button onClick={onBookJob} className="bg-orange hover:bg-orange-hover text-white font-condensed font-semibold rounded-lg px-6 py-2.5 text-sm transition-colors">
              + BOOK A JOB
            </button>
          )}
        </div>
      )}

      {!loading && jobs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-white/40 text-xs mb-1">
            <span>{jobs.length} job{jobs.length !== 1 ? 's' : ''}</span>
            <button onClick={onBookJob} className="text-orange hover:text-orange-light transition-colors font-medium">
              + Book New Job
            </button>
          </div>

          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              businessType={businessType}
              onStatusChange={handleStatusChange}
              onCancel={handleCancel}
              onOpenInspection={handleOpenInspection}
              onJobUpdated={handleJobUpdated}
            />
          ))}
        </div>
      )}

      {/* MPI loading indicator */}
      {mpiLoading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="bg-dark-card border border-dark-border rounded-2xl px-8 py-6 flex items-center gap-3">
            <svg className="w-5 h-5 text-orange animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <span className="text-white/70 text-sm">Loading inspection…</span>
          </div>
        </div>
      )}

      {/* Multi-Point Inspection modal */}
      {mpiModal && (
        <MultiPointInspection
          inspectionId={mpiModal.inspectionId}
          customerName={mpiModal.customerName}
          onClose={() => setMpiModal(null)}
        />
      )}
    </div>
  )
}
