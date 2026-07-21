'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Job, JobStatus, Inspection } from '@/types/jobs'
import { STATUS_CONFIG, STATUS_TRANSITIONS, formatTime, formatDateShort } from '@/lib/scheduler'
import MultiPointInspection from '@/components/quickwrench/MultiPointInspection'
import NavigateButton from '@/components/common/NavigateButton'

function formatElapsed(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

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
  lunchActive,
}: {
  job: Job
  businessType?: string
  onStatusChange:   (id: string, status: JobStatus) => Promise<void>
  onCancel:         (id: string) => Promise<void>
  onOpenInspection: (jobId: string, customerName: string) => void
  onJobUpdated?:    (job: Job) => void
  lunchActive?:     boolean
}) {
  const [expanded,        setExpanded]        = useState(false)
  const [updating,        setUpdating]        = useState(false)
  const [generatingQuote, setGeneratingQuote] = useState(false)
  const [notifying,       setNotifying]       = useState<string | null>(null)
  const [notifResult,     setNotifResult]     = useState<{ ok: boolean; msg: string } | null>(null)
  const [quoteError,      setQuoteError]      = useState<string | null>(null)
  const [elapsedSeconds,  setElapsedSeconds]  = useState(0)
  const cfg         = STATUS_CONFIG[job.status]
  const transitions = STATUS_TRANSITIONS[job.status] ?? []

  // Live timer — ticks while job is in-progress; pauses during lunch break
  useEffect(() => {
    if (!job.arrived_at || job.departed_at) return
    if (lunchActive) return  // freeze display during break
    const t0        = new Date(job.arrived_at).getTime()
    const lunchSecs = (job.lunch_break_minutes ?? 0) * 60
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - t0) / 1000) - lunchSecs))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [job.arrived_at, job.departed_at, job.lunch_break_minutes, lunchActive])

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

  async function handleArrive() {
    setUpdating(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}/arrive`, { method: 'POST' })
      if (res.ok) {
        const { job: updated } = await res.json()
        if (updated) onJobUpdated?.(updated)
      }
    } finally {
      setUpdating(false)
    }
  }

  async function handleCompleteAndInvoice() {
    if (!confirm('Mark job complete and go to invoice creation?')) return
    setUpdating(true)
    try {
      const res = await fetch(`/api/jobs/${job.id}/complete-job`, { method: 'POST' })
      if (res.ok) {
        const { job: updated } = await res.json()
        if (updated) onJobUpdated?.(updated)
        window.location.href = `/financials?tab=invoices`
      }
    } finally {
      setUpdating(false)
    }
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

      // Record on_my_way_sent_at and start drive timer
      if (ok && trigger === 'on_my_way') {
        const now = new Date().toISOString()
        const upd = await fetch(`/api/jobs/${job.id}`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ on_my_way_sent_at: now, drive_started_at: now }),
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
        window.location.href = `/financials?tab=quotes&quote=${json.quote.id}`
      }
    } catch {
      setQuoteError('Network error')
    } finally {
      setGeneratingQuote(false)
    }
  }

  const isActive          = job.status !== 'cancelled' && job.status !== 'completed' && job.status !== 'no_show'
  const showOnSite        = job.status === 'in_progress'
  const showQuote         = job.status === 'on_site'
  // OMW button only when customer exists — gates ARRIVED for jobs with customers
  const showOnMyWayPrimary = isActive && !job.on_my_way_sent_at && !job.arrived_at && !!job.customer
  // ARRIVED shows after OMW sent (or immediately if no customer to notify)
  const showArrived       = isActive && (!job.customer || !!job.on_my_way_sent_at) && !job.arrived_at
  const showWorking       = isActive && !!job.arrived_at && !job.departed_at
  const laborVariance  = job.arrived_at && job.departed_at && job.actual_labor_minutes != null
    ? (job.suggested_labor_minutes ?? job.estimated_duration_minutes ?? null) != null
      ? (job.suggested_labor_minutes ?? job.estimated_duration_minutes)! - job.actual_labor_minutes
      : null
    : null
  const laborDollarImpact = laborVariance != null && job.labor_rate
    ? Math.round((laborVariance / 60) * job.labor_rate)
    : null

  return (
    <div
      className={`job-card rounded-xl border transition-colors ${
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

      {/* ── Labor Watch action buttons — always visible, no expand needed ── */}

      {/* Step 1: On My Way — sends notification + starts drive timer */}
      {showOnMyWayPrimary && (
        <div className="px-4 pb-4">
          <button
            disabled={!!notifying}
            onClick={() => sendNotif('on_my_way')}
            className="w-full min-h-[56px] rounded-xl bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-lg tracking-wide transition-colors active:scale-[0.98] flex items-center justify-center gap-3"
          >
            {notifying === 'on_my_way' ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
              </svg>
            )}
            {notifying === 'on_my_way' ? 'NOTIFYING…' : 'ON MY WAY — NOTIFY CUSTOMER'}
          </button>
          {notifResult && (
            <div className={`mt-2 text-xs px-3 py-2 rounded-lg border ${
              notifResult.ok
                ? 'bg-success/10 border-success/30 text-success'
                : 'bg-danger/10 border-danger/30 text-danger'
            }`}>
              {notifResult.ok ? '✓ ' : '✗ '}{notifResult.msg}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Arrived — starts labor timer */}
      {showArrived && (
        <div className="px-4 pb-4">
          <button
            disabled={updating}
            onClick={handleArrive}
            className="w-full min-h-[56px] rounded-xl bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-lg tracking-wide transition-colors active:scale-[0.98] flex items-center justify-center gap-3"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            {updating ? 'RECORDING…' : 'ARRIVED — START TRACKING'}
          </button>
        </div>
      )}

      {/* Step 3: Working timer + Complete */}
      {showWorking && (
        <div className="px-4 pb-4 flex gap-3">
          {/* Live timer indicator — shows break state when lunch is active */}
          <div className={`flex-1 min-h-[56px] rounded-xl border flex items-center justify-center gap-3 ${
            lunchActive
              ? 'border-amber-500/40 bg-amber-500/10'
              : 'border-success/40 bg-success/10'
          }`}>
            <span className="relative flex">
              <span className={`w-2.5 h-2.5 rounded-full ${lunchActive ? 'bg-amber-400' : 'bg-success'}`} />
              {!lunchActive && (
                <span className="absolute inset-0 rounded-full bg-success animate-ping opacity-60" />
              )}
            </span>
            <span className={`font-condensed font-bold text-xl tracking-wider ${lunchActive ? 'text-amber-400' : 'text-success'}`}>
              {lunchActive ? 'ON BREAK' : `WORKING — ${formatElapsed(elapsedSeconds)}`}
            </span>
          </div>
          {/* Complete and Invoice */}
          <button
            disabled={updating || !!lunchActive}
            onClick={handleCompleteAndInvoice}
            className="flex-1 min-h-[56px] rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-condensed font-bold text-base tracking-wide transition-colors active:scale-[0.98] px-4 flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {updating ? 'SAVING…' : 'COMPLETE & INVOICE'}
          </button>
        </div>
      )}

      {/* Labor efficiency card — shown on completed jobs with tracking data */}
      {job.status === 'completed' && job.actual_labor_minutes != null && (
        <div className="mx-4 mb-4 rounded-xl border border-dark-border bg-dark-lighter p-4">
          <p className="text-white/30 text-[10px] uppercase tracking-widest mb-3">Labor Efficiency</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {job.arrived_at && (
              <div>
                <p className="text-white/40 text-xs">Arrived</p>
                <p className="text-white/80 text-xs">{new Date(job.arrived_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
              </div>
            )}
            {job.departed_at && (
              <div>
                <p className="text-white/40 text-xs">Completed</p>
                <p className="text-white/80 text-xs">{new Date(job.departed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
              </div>
            )}
            <div>
              <p className="text-white/40 text-xs">Time on Job</p>
              <p className="text-white/80 text-xs font-medium">{formatMinutes(job.actual_labor_minutes)}</p>
            </div>
            {(job.suggested_labor_minutes ?? job.estimated_duration_minutes) != null && (
              <div>
                <p className="text-white/40 text-xs">Quoted Labor</p>
                <p className="text-white/80 text-xs">{formatMinutes((job.suggested_labor_minutes ?? job.estimated_duration_minutes)!)}</p>
              </div>
            )}
            {laborVariance != null && (
              <div>
                <p className="text-white/40 text-xs">Time Variance</p>
                <p className={`text-xs font-semibold ${laborVariance >= 0 ? 'text-success' : 'text-danger'}`}>
                  {laborVariance >= 0 ? '+' : ''}{formatMinutes(Math.abs(laborVariance))} {laborVariance >= 0 ? 'faster' : 'slower'}
                </p>
              </div>
            )}
            {laborDollarImpact != null && (
              <div>
                <p className="text-white/40 text-xs">Dollar Impact</p>
                <p className={`text-xs font-semibold ${laborDollarImpact >= 0 ? 'text-success' : 'text-danger'}`}>
                  {laborDollarImpact >= 0 ? '+$' : '-$'}{Math.abs(laborDollarImpact)}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-dark-border pt-3 space-y-3">
          {job.location_address && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-white/60 text-sm">📍 {job.location_address}</p>
              <NavigateButton address={job.location_address} compact />
            </div>
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
  lunchActive  = false,
  lunchVersion = 0,
}: {
  onBookJob:     () => void
  businessType?: string
  lunchActive?:  boolean
  lunchVersion?: number
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

  // Ref so lunchVersion effect can call the latest fetchJobs without stale closure
  const fetchJobsRef = useRef<() => Promise<void>>(async () => {})

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

  useEffect(() => { fetchJobsRef.current = fetchJobs }, [fetchJobs])
  useEffect(() => { fetchJobs() }, [fetchJobs])
  // Refetch jobs after a lunch break ends so lunch_break_minutes reflects in the timer
  useEffect(() => { if (lunchVersion > 0) fetchJobsRef.current() }, [lunchVersion])

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
              lunchActive={lunchActive}
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
