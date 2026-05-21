'use client'

import { useState, useEffect } from 'react'

interface ServiceTypeRow {
  service_type:         string
  avg_variance_minutes: number
  job_count:            number
}

interface WeekEntry {
  week:       string
  efficiency: number | null
}

interface LaborWatchData {
  efficiency_score:         number | null
  monthly_variance_minutes: number
  monthly_variance_dollars: number | null
  total_jobs:               number
  best_service_types:       ServiceTypeRow[]
  worst_service_types:      ServiceTypeRow[]
  weekly_trend:             WeekEntry[]
  total_drive_minutes:      number
  avg_drive_minutes:        number | null
  drive_jobs_count:         number
}

function formatMins(mins: number): string {
  const h = Math.floor(Math.abs(mins) / 60)
  const m = Math.abs(mins) % 60
  const sign = mins < 0 ? '-' : '+'
  return h > 0 ? `${sign}${h}h ${m}m` : `${sign}${m}m`
}

function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function LaborWatchTab() {
  const [data,    setData]    = useState<LaborWatchData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/labor-watch')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-white/30 text-sm">Loading Labor Watch…</div>
  )
  if (error) return <div className="alert-error">{error}</div>
  if (!data) return null

  const hasData = data.total_jobs > 0

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-orange/15 border border-orange/30 flex items-center justify-center flex-shrink-0">
          <svg className="w-4 h-4 text-orange" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <div>
          <h2 className="font-condensed font-bold text-2xl text-white tracking-wide">Labor Watch</h2>
          <p className="text-white/40 text-xs">Track how your actual time on job compares to quoted labor</p>
        </div>
      </div>

      {!hasData && (
        <div className="nwi-card text-center py-16">
          <p className="text-4xl mb-3">⏱</p>
          <p className="font-condensed font-bold text-xl text-white mb-2">NO LABOR DATA YET</p>
          <p className="text-white/40 text-sm max-w-xs mx-auto">
            Tap <span className="text-orange font-medium">ARRIVED</span> when you get to a job and <span className="text-blue-300 font-medium">COMPLETE &amp; INVOICE</span> when you finish. Your efficiency score builds automatically.
          </p>
        </div>
      )}

      {hasData && (
        <>
          {/* Efficiency score + monthly variance */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="nwi-card border-orange/20 col-span-2 sm:col-span-1">
              <p className="text-white/40 text-xs uppercase tracking-widest mb-2">Efficiency Score</p>
              {data.efficiency_score != null ? (
                <>
                  <p className={`font-condensed font-bold text-4xl ${
                    data.efficiency_score >= 100 ? 'text-success' : data.efficiency_score >= 85 ? 'text-orange' : 'text-danger'
                  }`}>
                    {data.efficiency_score}%
                  </p>
                  <p className="text-white/30 text-xs mt-1">
                    {data.efficiency_score >= 100 ? 'Faster than quoted — great work' :
                     data.efficiency_score >= 85  ? 'Close to quoted time' :
                     'Running over quoted time'}
                  </p>
                </>
              ) : (
                <p className="text-white/30 text-sm">Not enough data</p>
              )}
            </div>

            <div className="nwi-card border-white/10">
              <p className="text-white/40 text-xs uppercase tracking-widest mb-2">Time Variance</p>
              <p className={`font-condensed font-bold text-2xl ${
                data.monthly_variance_minutes >= 0 ? 'text-success' : 'text-danger'
              }`}>
                {formatMins(data.monthly_variance_minutes)}
              </p>
              <p className="text-white/30 text-xs mt-1">vs. quoted this month</p>
            </div>

            <div className="nwi-card border-white/10">
              <p className="text-white/40 text-xs uppercase tracking-widest mb-2">Dollar Impact</p>
              {data.monthly_variance_dollars != null ? (
                <>
                  <p className={`font-condensed font-bold text-2xl ${
                    data.monthly_variance_dollars >= 0 ? 'text-success' : 'text-danger'
                  }`}>
                    {data.monthly_variance_dollars >= 0 ? '+' : '-'}${Math.abs(data.monthly_variance_dollars)}
                  </p>
                  <p className="text-white/30 text-xs mt-1">
                    {data.monthly_variance_dollars >= 0 ? 'extra revenue this month' : 'left on the table'}
                  </p>
                </>
              ) : (
                <p className="text-white/30 text-sm">Set labor rate on jobs to track</p>
              )}
            </div>
          </div>

          {/* Drive time */}
          {data.drive_jobs_count > 0 && (
            <div className="nwi-card border-white/10">
              <p className="text-white/40 text-xs uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
                </svg>
                Drive Time
              </p>
              <div className="flex items-end gap-4 flex-wrap">
                {data.avg_drive_minutes != null && (
                  <div>
                    <p className="font-condensed font-bold text-2xl text-white">{formatDuration(data.avg_drive_minutes)}</p>
                    <p className="text-white/30 text-xs mt-0.5">avg per job</p>
                  </div>
                )}
                <div>
                  <p className="font-condensed font-bold text-2xl text-white/60">{formatDuration(data.total_drive_minutes)}</p>
                  <p className="text-white/30 text-xs mt-0.5">total · {data.drive_jobs_count} job{data.drive_jobs_count !== 1 ? 's' : ''} tracked</p>
                </div>
              </div>
            </div>
          )}

          {/* Best & Worst service types */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {data.best_service_types.length > 0 && (
              <div className="nwi-card border-success/20">
                <p className="text-success/70 text-xs uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                    <polyline points="17 6 23 6 23 12"/>
                  </svg>
                  Fastest Jobs
                </p>
                <div className="space-y-3">
                  {data.best_service_types.map((r) => (
                    <div key={r.service_type} className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-white/80 text-sm font-medium">{r.service_type}</p>
                        <p className="text-white/30 text-xs">{r.job_count} job{r.job_count !== 1 ? 's' : ''}</p>
                      </div>
                      <span className="text-success text-sm font-semibold whitespace-nowrap">
                        {formatMins(r.avg_variance_minutes)} avg
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.worst_service_types.length > 0 && (
              <div className="nwi-card border-danger/20">
                <p className="text-danger/70 text-xs uppercase tracking-widest mb-3 flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/>
                    <polyline points="17 18 23 18 23 12"/>
                  </svg>
                  Slowest Jobs
                </p>
                <div className="space-y-3">
                  {data.worst_service_types.map((r) => (
                    <div key={r.service_type} className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-white/80 text-sm font-medium">{r.service_type}</p>
                        <p className="text-white/30 text-xs">{r.job_count} job{r.job_count !== 1 ? 's' : ''}</p>
                      </div>
                      <span className="text-danger text-sm font-semibold whitespace-nowrap">
                        {formatMins(r.avg_variance_minutes)} avg
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Weekly trend */}
          {data.weekly_trend.length > 0 && (
            <div className="nwi-card">
              <p className="text-white/40 text-xs uppercase tracking-widest mb-4">Monthly Trend</p>
              <div className="space-y-2">
                {data.weekly_trend.map((w) => {
                  const eff = w.efficiency ?? 0
                  const bar = Math.min(eff, 150)
                  const color = eff >= 100 ? 'bg-success' : eff >= 85 ? 'bg-orange' : 'bg-danger'
                  const weekLabel = new Date(w.week + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  return (
                    <div key={w.week} className="flex items-center gap-3">
                      <span className="text-white/30 text-xs w-16 shrink-0">{weekLabel}</span>
                      <div className="flex-1 h-5 rounded bg-dark-lighter overflow-hidden">
                        <div
                          className={`h-full ${color} rounded transition-all`}
                          style={{ width: `${Math.max(4, (bar / 150) * 100)}%` }}
                        />
                      </div>
                      <span className={`text-xs font-semibold w-10 text-right shrink-0 ${
                        eff >= 100 ? 'text-success' : eff >= 85 ? 'text-orange' : 'text-danger'
                      }`}>
                        {w.efficiency != null ? `${w.efficiency}%` : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
              <p className="text-white/20 text-xs mt-3">100% = exactly on time · &gt;100% = faster than quoted</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
