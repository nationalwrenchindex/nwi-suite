'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Job, CalendarData } from '@/types/jobs'
import {
  STATUS_CONFIG,
  STATUS_TRANSITIONS,
  buildCalendarGrid,
  monthLabel,
  formatTime,
  toDateStr,
  todayStr,
} from '@/lib/scheduler'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_DOTS   = 3

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, '0') }

function monthKey(year: number, month: number) {
  return `${year}-${pad2(month + 1)}` // YYYY-MM (month is 0-based JS)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Job['status'] }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.badge}`}>
      {cfg.label}
    </span>
  )
}

function JobCard({
  job,
  onStatusChange,
}: {
  job: Job
  onStatusChange: (id: string, status: Job['status']) => void
}) {
  const transitions = STATUS_TRANSITIONS[job.status] ?? []

  return (
    <div className="rounded-xl border border-dark-border bg-dark p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-white font-semibold text-sm leading-tight">{job.service_type}</p>
          {job.job_time && (
            <p className="text-orange text-xs font-medium mt-0.5">{formatTime(job.job_time)}</p>
          )}
        </div>
        <StatusBadge status={job.status} />
      </div>

      {job.customer && (
        <p className="text-white/60 text-xs">
          👤 {job.customer.first_name} {job.customer.last_name}
          {job.customer.phone && <span className="text-white/30"> · {job.customer.phone}</span>}
        </p>
      )}
      {job.vehicle && (
        <p className="text-white/50 text-xs">
          🚗 {job.vehicle.year} {job.vehicle.make} {job.vehicle.model}
          {job.vehicle.color && <span className="text-white/30"> · {job.vehicle.color}</span>}
        </p>
      )}
      {job.location_address && (
        <p className="text-white/40 text-xs">📍 {job.location_address}</p>
      )}
      {job.estimated_duration_minutes && (
        <p className="text-white/30 text-xs">⏱ {job.estimated_duration_minutes} min</p>
      )}

      {/* Quick status transitions */}
      {transitions.length > 0 && (
        <div className="flex gap-1.5 pt-1 flex-wrap">
          {transitions.map((next) => (
            <button
              key={next}
              onClick={() => onStatusChange(job.id, next)}
              className={`text-[11px] rounded-lg px-2.5 py-1 font-medium transition-colors border ${STATUS_CONFIG[next].badge}`}
            >
              → {STATUS_CONFIG[next].label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CalendarTab({ onBookJob }: { onBookJob: () => void }) {
  const today = new Date()
  const [viewYear,  setViewYear]  = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth()) // 0-based
  const [calendar,  setCalendar]  = useState<CalendarData>({})
  const [selected,  setSelected]  = useState<string>(todayStr())
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const fetchMonth = useCallback(async (year: number, month: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/jobs/calendar?month=${monthKey(year, month)}`)
      if (!res.ok) throw new Error('Failed to load calendar data')
      const json = await res.json()
      setCalendar(json.calendar ?? {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMonth(viewYear, viewMonth)
  }, [viewYear, viewMonth, fetchMonth])

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  async function handleStatusChange(jobId: string, newStatus: Job['status']) {
    const res = await fetch(`/api/jobs/${jobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    if (res.ok) {
      // Refresh the current month
      await fetchMonth(viewYear, viewMonth)
    }
  }

  const grid    = buildCalendarGrid(viewYear, viewMonth)
  const todayS  = todayStr()
  const dayJobs = calendar[selected] ?? []

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* ── Calendar grid ── */}
      <div className="flex-1 min-w-0">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={prevMonth}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-dark-border text-white/60 hover:text-white hover:border-white/30 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="text-center">
            <p className="font-condensed font-bold text-xl text-white tracking-wide">
              {monthLabel(viewYear, viewMonth).toUpperCase()}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); setSelected(todayStr()) }}
              className="text-xs text-orange hover:text-orange-light transition-colors border border-orange/30 rounded-lg px-2 py-1"
            >
              Today
            </button>
            <button
              onClick={nextMonth}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-dark-border text-white/60 hover:text-white hover:border-white/30 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAY_LABELS.map((d) => (
            <div key={d} className="text-center text-white/30 text-xs font-medium py-1">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        {loading ? (
          <div className="h-64 flex items-center justify-center text-white/30 text-sm">
            Loading…
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-px bg-dark-border rounded-xl overflow-hidden border border-dark-border">
            {grid.map((day, i) => {
              if (day === null) {
                return <div key={`empty-${i}`} className="bg-dark h-16 sm:h-20" />
              }

              const dateStr  = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(day)}`
              const isToday  = dateStr === todayS
              const isSelected = dateStr === selected
              const jobs     = calendar[dateStr] ?? []

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelected(dateStr)}
                  className={`
                    relative bg-dark h-16 sm:h-20 p-1.5 text-left transition-colors hover:bg-dark-lighter
                    ${isSelected ? 'bg-dark-lighter ring-1 ring-inset ring-orange' : ''}
                  `}
                >
                  {/* Day number */}
                  <span
                    className={`
                      inline-flex w-6 h-6 items-center justify-center rounded-full text-xs font-semibold leading-none
                      ${isToday ? 'bg-orange text-white' : isSelected ? 'text-orange' : 'text-white/70'}
                    `}
                  >
                    {day}
                  </span>

                  {/* Job dots */}
                  {jobs.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-0.5">
                      {jobs.slice(0, MAX_DOTS).map((job) => (
                        <span
                          key={job.id}
                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_CONFIG[job.status].dot}`}
                        />
                      ))}
                      {jobs.length > MAX_DOTS && (
                        <span className="text-white/30 text-[9px] leading-none self-end">
                          +{jobs.length - MAX_DOTS}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {error && <p className="text-danger text-sm mt-3">{error}</p>}

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-4">
          {(Object.entries(STATUS_CONFIG) as [Job['status'], typeof STATUS_CONFIG[Job['status']]][])
            .filter(([s]) => s !== 'cancelled')
            .map(([status, cfg]) => (
              <div key={status} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                <span className="text-white/40 text-xs">{cfg.label}</span>
              </div>
            ))}
        </div>
      </div>

      {/* ── Day detail panel ── */}
      <div className="lg:w-80 flex-shrink-0">
        <div className="nwi-card sticky top-20">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-white/40 text-xs uppercase tracking-widest">
                {new Date(selected + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' })}
              </p>
              <p className="font-condensed font-bold text-xl text-white tracking-wide">
                {new Date(selected + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
            <span className={`font-condensed font-bold text-2xl ${dayJobs.length > 0 ? 'text-orange' : 'text-white/20'}`}>
              {dayJobs.length}
            </span>
          </div>

          {dayJobs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-white/30 text-sm mb-3">No jobs scheduled</p>
              <button
                onClick={onBookJob}
                className="text-xs bg-orange hover:bg-orange-hover text-white font-condensed font-semibold rounded-lg px-4 py-2 transition-colors"
              >
                + BOOK A JOB
              </button>
            </div>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {dayJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onStatusChange={handleStatusChange}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
