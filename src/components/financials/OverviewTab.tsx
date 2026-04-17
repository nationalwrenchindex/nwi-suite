'use client'

import { useState, useEffect, useCallback } from 'react'
import type { FinancialsOverview } from '@/types/financials'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmtPct(n: number) {
  return `${n.toFixed(1)}%`
}

interface KpiCardProps {
  label: string
  value: string
  sub?: string
  accent?: 'orange' | 'green' | 'red' | 'blue'
}

function KpiCard({ label, value, sub, accent }: KpiCardProps) {
  const accentClass = {
    orange: 'text-orange',
    green:  'text-success',
    red:    'text-danger',
    blue:   'text-blue',
  }[accent ?? 'orange']

  return (
    <div className="nwi-card flex flex-col gap-1 min-w-0">
      <p className="text-white/40 text-xs font-medium uppercase tracking-widest truncate">{label}</p>
      <p className={`font-condensed font-bold text-2xl truncate ${accentClass}`}>{value}</p>
      {sub && <p className="text-white/30 text-xs truncate">{sub}</p>}
    </div>
  )
}

export default function OverviewTab() {
  const [month,    setMonth]    = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [overview, setOverview] = useState<FinancialsOverview | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  const fetchOverview = useCallback(async (m: string) => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/financials/overview?month=${m}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load overview')
      setOverview(json.overview)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchOverview(month) }, [month, fetchOverview])

  const netAccent = overview
    ? overview.net_profit >= 0 ? 'green' : 'red'
    : 'green'

  return (
    <div className="space-y-6">
      {/* Month picker */}
      <div className="flex items-center gap-3">
        <label className="nwi-label mb-0 whitespace-nowrap">Period</label>
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="nwi-input max-w-[180px]"
        />
        <button
          onClick={() => fetchOverview(month)}
          className="flex items-center gap-1.5 px-4 py-2 bg-white/5 hover:bg-white/10 border border-dark-border rounded-lg text-xs text-white/60 hover:text-white transition-colors"
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
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="nwi-card animate-pulse h-20 bg-dark-card/50" />
          ))}
        </div>
      ) : overview ? (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard
              label="Revenue"
              value={fmt(overview.revenue_total)}
              sub={`${overview.paid_invoice_count} paid invoice${overview.paid_invoice_count !== 1 ? 's' : ''}`}
              accent="green"
            />
            <KpiCard
              label="Expenses"
              value={fmt(overview.expense_total)}
              accent="red"
            />
            <KpiCard
              label="Net Profit"
              value={fmt(overview.net_profit)}
              sub={fmtPct(overview.profit_margin) + ' margin'}
              accent={netAccent}
            />
            <KpiCard
              label="Profit Margin"
              value={fmtPct(overview.profit_margin)}
              accent={netAccent}
            />
            <KpiCard
              label="Avg Job Value"
              value={fmt(overview.avg_job_value)}
              accent="orange"
            />
            <KpiCard
              label="Top Service"
              value={overview.top_service ?? '—'}
              accent="blue"
            />
          </div>

          {/* Invoice status breakdown */}
          <div className="nwi-card">
            <p className="text-white/40 text-xs font-medium uppercase tracking-widest mb-4">
              Invoice Breakdown — {month}
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
        </>
      ) : null}
    </div>
  )
}
