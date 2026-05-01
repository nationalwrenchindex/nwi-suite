'use client'

import { useState, useEffect, useCallback } from 'react'
import type { FinancialsOverview, DayBreakdown, WeekBreakdown } from '@/types/financials'

type Granularity = 'day' | 'week' | 'month' | 'custom'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}
function fmtPct(n: number) { return `${n.toFixed(1)}%` }
function pad2(n: number) { return String(n).padStart(2, '0') }

function fmtVariance(min: number | null) {
  if (min === null) return '—'
  const abs = Math.abs(min)
  const sign = min >= 0 ? '+' : '-'
  if (abs < 60) return `${sign}${Math.round(abs)}m`
  return `${sign}${Math.floor(abs / 60)}h ${Math.round(abs % 60)}m`
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

function firstOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`
}

function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const dow = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() - (dow - 1))
  return d.toISOString().slice(0, 10)
}

function sundayOf(mondayStr: string): string {
  const d = new Date(mondayStr + 'T12:00:00')
  d.setDate(d.getDate() + 6)
  return d.toISOString().slice(0, 10)
}

function monthLastDay(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${month}-${pad2(last)}`
}

function fmtShortDate(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtWeekLabel(mondayStr: string): string {
  const mon = fmtShortDate(mondayStr)
  const sun = fmtShortDate(sundayOf(mondayStr))
  return `${mon} – ${sun}`
}

interface KpiCardProps {
  label: string
  value: string
  sub?: string
  accent?: 'orange' | 'green' | 'red' | 'blue' | 'purple'
}

function KpiCard({ label, value, sub, accent }: KpiCardProps) {
  const accentClass = {
    orange: 'text-orange',
    green:  'text-success',
    red:    'text-danger',
    blue:   'text-blue',
    purple: 'text-purple-400',
  }[accent ?? 'orange']
  return (
    <div className="nwi-card flex flex-col gap-1 min-w-0">
      <p className="text-white/40 text-xs font-medium uppercase tracking-widest truncate">{label}</p>
      <p className={`font-condensed font-bold text-2xl truncate ${accentClass}`}>{value}</p>
      {sub && <p className="text-white/30 text-xs truncate">{sub}</p>}
    </div>
  )
}

function BreakdownTable({ rows }: { rows: (DayBreakdown | WeekBreakdown)[] }) {
  const isDay = (r: DayBreakdown | WeekBreakdown): r is DayBreakdown => 'date' in r

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-white/30 uppercase tracking-widest border-b border-dark-border">
            <th className="py-2 pr-4 text-left font-medium">Period</th>
            <th className="py-2 px-2 text-right font-medium">Revenue</th>
            <th className="py-2 px-2 text-right font-medium">COGS</th>
            <th className="py-2 px-2 text-right font-medium">Gross</th>
            <th className="py-2 px-2 text-right font-medium">Expenses</th>
            <th className="py-2 px-2 text-right font-medium">Net</th>
            <th className="py-2 pl-2 text-right font-medium">Jobs</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-dark-border/50">
          {rows.map((r) => {
            const label = isDay(r) ? fmtShortDate(r.date) : fmtWeekLabel(r.week_start)
            const netCls = r.net_profit >= 0 ? 'text-success' : 'text-danger'
            const hasActivity = r.revenue > 0 || r.expenses > 0 || r.job_count > 0
            return (
              <tr
                key={isDay(r) ? r.date : r.week_start}
                className={hasActivity ? 'text-white/80' : 'text-white/20'}
              >
                <td className="py-1.5 pr-4 whitespace-nowrap">{label}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{r.revenue > 0 ? fmt(r.revenue) : '—'}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-white/40">{r.cogs > 0 ? fmt(r.cogs) : '—'}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{r.revenue > 0 ? fmt(r.gross_profit) : '—'}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-white/40">{r.expenses > 0 ? fmt(r.expenses) : '—'}</td>
                <td className={`py-1.5 px-2 text-right tabular-nums font-semibold ${hasActivity ? netCls : ''}`}>
                  {hasActivity ? fmt(r.net_profit) : '—'}
                </td>
                <td className="py-1.5 pl-2 text-right">{r.job_count > 0 ? r.job_count : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function OverviewTab({ businessType }: { businessType?: string }) {
  const isDetailer = businessType === 'detailer'

  const [granularity, setGranularity] = useState<Granularity>('month')
  const [monthVal,    setMonthVal]    = useState(currentMonth)
  const [dayVal,      setDayVal]      = useState(todayStr)
  const [customFrom,  setCustomFrom]  = useState(firstOfMonth)
  const [customTo,    setCustomTo]    = useState(todayStr)
  const [breakdown,   setBreakdown]   = useState<'daily' | 'weekly'>('daily')

  const [overview, setOverview] = useState<FinancialsOverview | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  function getRange(): { from: string; to: string } {
    switch (granularity) {
      case 'day':
        return { from: dayVal, to: dayVal }
      case 'week': {
        const mon = mondayOf(dayVal)
        return { from: mon, to: sundayOf(mon) }
      }
      case 'month':
        return { from: `${monthVal}-01`, to: monthLastDay(monthVal) }
      case 'custom':
        return { from: customFrom, to: customTo }
    }
  }

  const fetchOverview = useCallback(async (from: string, to: string) => {
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`/api/financials/overview?from_date=${from}&to_date=${to}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load overview')
      setOverview(json.overview)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const { from, to } = getRange()
    fetchOverview(from, to)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, monthVal, dayVal, customFrom, customTo])

  const netAccent   = overview ? (overview.net_profit   >= 0 ? 'green' : 'red') : 'green'
  const grossAccent = overview ? (overview.gross_profit >= 0 ? 'green' : 'red') : 'green'

  const granularityBtns: { id: Granularity; label: string }[] = [
    { id: 'day',    label: 'Day'    },
    { id: 'week',   label: 'Week'   },
    { id: 'month',  label: 'Month'  },
    { id: 'custom', label: 'Custom' },
  ]

  const cogsSubLabel = isDetailer ? 'Products + supplies' : 'Parts + shop supplies'

  const breakdownRows = overview
    ? (breakdown === 'daily' ? overview.daily_breakdown : overview.weekly_breakdown)
    : []
  const activeBreakdownRows = breakdownRows.filter(
    r => r.revenue > 0 || r.expenses > 0 || r.cogs > 0 || r.job_count > 0
  )
  const hasBreakdownData = activeBreakdownRows.length > 0

  return (
    <div className="space-y-6">
      {/* ── Period controls ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        {/* Granularity toggle */}
        <div>
          <p className="nwi-label mb-1.5">Period</p>
          <div className="flex rounded-lg border border-dark-border overflow-hidden">
            {granularityBtns.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setGranularity(id)}
                className={`px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  granularity === id
                    ? 'bg-orange text-white'
                    : 'bg-dark text-white/40 hover:text-white hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Date inputs */}
        {granularity === 'month' && (
          <div>
            <label className="nwi-label">Month</label>
            <input type="month" value={monthVal} onChange={e => setMonthVal(e.target.value)} className="nwi-input max-w-[180px]" />
          </div>
        )}
        {(granularity === 'day' || granularity === 'week') && (
          <div>
            <label className="nwi-label">{granularity === 'week' ? 'Any date in week' : 'Date'}</label>
            <input type="date" value={dayVal} onChange={e => setDayVal(e.target.value)} className="nwi-input max-w-[180px]" />
          </div>
        )}
        {granularity === 'custom' && (
          <>
            <div>
              <label className="nwi-label">From</label>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="nwi-input max-w-[160px]" />
            </div>
            <div>
              <label className="nwi-label">To</label>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="nwi-input max-w-[160px]" />
            </div>
          </>
        )}

        <button
          onClick={() => { const { from, to } = getRange(); fetchOverview(from, to) }}
          className="flex items-center gap-1.5 px-4 py-2 bg-white/5 hover:bg-white/10 border border-dark-border rounded-lg text-xs text-white/60 hover:text-white transition-colors self-end"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          Refresh
        </button>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="nwi-card animate-pulse h-20 bg-dark-card/50" />
          ))}
        </div>
      ) : overview ? (
        <>
          {/* ── Revenue & COGS ── */}
          <div>
            <p className="text-white/30 text-xs font-semibold uppercase tracking-widest mb-3">Revenue & Cost of Goods</p>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <KpiCard
                label="Revenue"
                value={fmt(overview.revenue_total)}
                sub={`${overview.paid_invoice_count} paid invoice${overview.paid_invoice_count !== 1 ? 's' : ''}`}
                accent="green"
              />
              <KpiCard
                label="COGS"
                value={fmt(overview.cogs_total)}
                sub={cogsSubLabel}
                accent="red"
              />
              <KpiCard
                label="Gross Profit"
                value={fmt(overview.gross_profit)}
                sub={fmtPct(overview.gross_margin) + ' gross margin'}
                accent={grossAccent}
              />
            </div>
          </div>

          {/* ── Net Profit ── */}
          <div>
            <p className="text-white/30 text-xs font-semibold uppercase tracking-widest mb-3">Net Profit</p>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <KpiCard
                label="Operating Expenses"
                value={fmt(overview.operating_expenses)}
                sub="Tools, fuel, overhead…"
                accent="red"
              />
              <KpiCard
                label="Net Profit"
                value={fmt(overview.net_profit)}
                sub={fmtPct(overview.profit_margin) + ' net margin'}
                accent={netAccent}
              />
              <KpiCard
                label="Avg Per-Job Profit"
                value={overview.avg_job_profit > 0 ? fmt(overview.avg_job_profit) : '—'}
                sub="On posted invoices"
                accent={overview.avg_job_profit >= 0 ? 'green' : 'red'}
              />
            </div>
          </div>

          {/* ── Secondary metrics ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Avg Job Value"  value={fmt(overview.avg_job_value)}         accent="orange" />
            <KpiCard label="Gross Margin"   value={fmtPct(overview.gross_margin)}        accent={grossAccent} />
            <KpiCard label="Top Service"    value={overview.top_service ?? '—'}          accent="blue" />
            <KpiCard
              label="Avg Time Variance"
              value={fmtVariance(overview.avg_time_variance)}
              sub={overview.avg_time_variance !== null
                ? (overview.avg_time_variance >= 0 ? 'Over estimate on avg' : 'Under estimate on avg')
                : 'No completed jobs with timing'}
              accent={
                overview.avg_time_variance === null ? 'orange'
                : overview.avg_time_variance > 15   ? 'red'
                : overview.avg_time_variance < -15  ? 'green'
                : 'orange'
              }
            />
          </div>

          {/* ── Invoice breakdown ── */}
          <div className="nwi-card">
            <p className="text-white/40 text-xs font-medium uppercase tracking-widest mb-4">
              Invoice Breakdown — {overview.from_date} → {overview.to_date}
            </p>
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-3xl font-condensed font-bold text-white">{overview.invoice_count}</p>
                <p className="text-white/40 text-xs mt-0.5">Total Invoices</p>
              </div>
              <div className="w-px bg-dark-border self-stretch" />
              <div>
                <p className="text-3xl font-condensed font-bold text-success">{overview.paid_invoice_count}</p>
                <p className="text-white/40 text-xs mt-0.5">Paid</p>
              </div>
              <div className="w-px bg-dark-border self-stretch" />
              <div>
                <p className="text-3xl font-condensed font-bold text-danger">{overview.overdue_invoice_count}</p>
                <p className="text-white/40 text-xs mt-0.5">Overdue</p>
              </div>
              <div className="w-px bg-dark-border self-stretch" />
              <div>
                <p className="text-3xl font-condensed font-bold text-white/40">
                  {overview.invoice_count - overview.paid_invoice_count - overview.overdue_invoice_count}
                </p>
                <p className="text-white/40 text-xs mt-0.5">Other</p>
              </div>
            </div>
          </div>

          {/* ── Breakdown table ── */}
          <div className="nwi-card">
            <div className="flex items-center justify-between mb-4">
              <p className="text-white/40 text-xs font-medium uppercase tracking-widest">Breakdown</p>
              <div className="flex rounded-lg border border-dark-border overflow-hidden">
                {(['daily', 'weekly'] as const).map(v => (
                  <button
                    key={v}
                    onClick={() => setBreakdown(v)}
                    className={`px-3 py-1 text-xs font-semibold transition-colors capitalize ${
                      breakdown === v
                        ? 'bg-orange text-white'
                        : 'bg-dark text-white/40 hover:text-white'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            {hasBreakdownData ? (
              <BreakdownTable rows={breakdown === 'daily' ? overview.daily_breakdown : overview.weekly_breakdown} />
            ) : (
              <p className="text-white/25 text-sm text-center py-6">No activity in this period.</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
