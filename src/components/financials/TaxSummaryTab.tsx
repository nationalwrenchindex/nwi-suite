'use client'

import { useState, useEffect, useCallback } from 'react'
import type { TaxSummary } from '@/types/financials'

type Preset = 'ytd' | 'q1' | 'q2' | 'q3' | 'q4' | 'custom'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}
function pad2(n: number) { return String(n).padStart(2, '0') }

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// "2026-03" → "Mar 2026"
function fmtMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function fmtRangeLabel(from: string, to: string) {
  const d = (s: string) => {
    const [y, m, day] = s.split('-').map(Number)
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  return `${d(from)} – ${d(to)}`
}

const QUARTERS: Record<'q1' | 'q2' | 'q3' | 'q4', [string, string]> = {
  q1: ['01-01', '03-31'],
  q2: ['04-01', '06-30'],
  q3: ['07-01', '09-30'],
  q4: ['10-01', '12-31'],
}

export default function TaxSummaryTab() {
  const year = new Date().getFullYear()

  const [preset,     setPreset]     = useState<Preset>('ytd')
  const [customFrom, setCustomFrom] = useState(`${year}-01-01`)
  const [customTo,   setCustomTo]   = useState(todayStr())

  const [summary, setSummary] = useState<TaxSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const getRange = useCallback((): { from: string; to: string } => {
    if (preset === 'ytd')    return { from: `${year}-01-01`, to: todayStr() }
    if (preset === 'custom') return { from: customFrom, to: customTo }
    const [start, end] = QUARTERS[preset]
    return { from: `${year}-${start}`, to: `${year}-${end}` }
  }, [preset, customFrom, customTo, year])

  const fetchSummary = useCallback(async (from: string, to: string) => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/financials/tax-summary?from_date=${from}&to_date=${to}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load tax summary')
      setSummary(json.tax_summary)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tax summary')
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (preset === 'custom' && (!customFrom || !customTo || customFrom > customTo)) return
    const { from, to } = getRange()
    fetchSummary(from, to)
  }, [getRange, fetchSummary, preset, customFrom, customTo])

  const presetBtns: { id: Preset; label: string }[] = [
    { id: 'ytd',    label: 'Year to Date' },
    { id: 'q1',     label: 'Q1' },
    { id: 'q2',     label: 'Q2' },
    { id: 'q3',     label: 'Q3' },
    { id: 'q4',     label: 'Q4' },
    { id: 'custom', label: 'Custom' },
  ]

  const rangeInvalid = preset === 'custom' && !!customFrom && !!customTo && customFrom > customTo
  const hasActivity  = !!summary && summary.rows.some(r => r.invoice_count > 0)

  return (
    <div className="space-y-6">
      {/* ── Period controls ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
        <div>
          <p className="nwi-label mb-1.5">Period</p>
          <div className="flex rounded-lg border border-dark-border overflow-hidden">
            {presetBtns.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setPreset(id)}
                className={`px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  preset === id
                    ? 'bg-orange text-white'
                    : 'bg-dark text-white/40 hover:text-white hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {preset === 'custom' && (
          <>
            <div>
              <label className="nwi-label">From</label>
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="nwi-input max-w-[160px]"
              />
            </div>
            <div>
              <label className="nwi-label">To</label>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="nwi-input max-w-[160px]"
              />
            </div>
          </>
        )}
      </div>

      {rangeInvalid && (
        <p className="text-danger text-xs">“From” date must be on or before the “To” date.</p>
      )}

      {error && (
        <div className="nwi-card border-danger/40">
          <p className="text-danger text-sm">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[0, 1, 2].map(i => <div key={i} className="nwi-card animate-pulse h-20 bg-dark-card/50" />)}
          </div>
          <div className="nwi-card animate-pulse h-64 bg-dark-card/50" />
        </div>
      ) : summary && (
        <>
          {/* ── Totals ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="nwi-card flex flex-col gap-1 min-w-0">
              <p className="text-white/40 text-xs font-medium uppercase tracking-widest truncate">Tax Collected</p>
              <p className="font-condensed font-bold text-2xl text-orange truncate">{fmt(summary.tax_collected)}</p>
              <p className="text-white/30 text-xs truncate">{fmtRangeLabel(summary.from_date, summary.to_date)}</p>
            </div>
            <div className="nwi-card flex flex-col gap-1 min-w-0">
              <p className="text-white/40 text-xs font-medium uppercase tracking-widest truncate">Taxable Amount</p>
              <p className="font-condensed font-bold text-2xl text-white truncate">{fmt(summary.taxable_amount)}</p>
              <p className="text-white/30 text-xs truncate">Pre-tax invoice subtotals</p>
            </div>
            <div className="nwi-card flex flex-col gap-1 min-w-0">
              <p className="text-white/40 text-xs font-medium uppercase tracking-widest truncate">Invoices</p>
              <p className="font-condensed font-bold text-2xl text-white truncate">{summary.invoice_count}</p>
              <p className="text-white/30 text-xs truncate">
                {summary.hd_tax > 0 || summary.ld_tax > 0
                  ? `LD ${fmt(summary.ld_tax)} · HD ${fmt(summary.hd_tax)}`
                  : 'Light duty + heavy duty'}
              </p>
            </div>
          </div>

          {/* ── Monthly breakdown ── */}
          <div className="nwi-card">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-condensed font-bold text-lg text-white tracking-wide">
                TAX BY MONTH
              </h2>
              <p className="text-white/30 text-xs">Sent &amp; paid invoices</p>
            </div>

            {!hasActivity ? (
              <p className="text-white/30 text-sm py-6 text-center">
                No invoiced tax in this period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-white/30 uppercase tracking-widest border-b border-dark-border">
                      <th className="py-2 pr-4 text-left  font-medium">Month</th>
                      <th className="py-2 px-2 text-right font-medium">Invoices</th>
                      <th className="py-2 px-2 text-right font-medium">Taxable Amount</th>
                      <th className="py-2 pl-2 text-right font-medium">Tax Collected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-border/50">
                    {summary.rows.map(r => (
                      <tr key={r.month} className={r.invoice_count > 0 ? 'text-white/80' : 'text-white/20'}>
                        <td className="py-1.5 pr-4 whitespace-nowrap">{fmtMonth(r.month)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{r.invoice_count || '—'}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">
                          {r.taxable_amount > 0 ? fmt(r.taxable_amount) : '—'}
                        </td>
                        <td className="py-1.5 pl-2 text-right tabular-nums font-semibold">
                          {r.tax_collected > 0 ? fmt(r.tax_collected) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-dark-border text-white font-semibold">
                      <td className="py-2 pr-4">Total</td>
                      <td className="py-2 px-2 text-right tabular-nums">{summary.invoice_count}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmt(summary.taxable_amount)}</td>
                      <td className="py-2 pl-2 text-right tabular-nums text-orange">{fmt(summary.tax_collected)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <p className="text-white/25 text-[11px] mt-4 leading-relaxed">
              Includes light-duty and heavy-duty invoices that have been finalized, sent, or paid.
              Drafts, in-progress invoices, and voided invoices are excluded. Figures are what you
              invoiced in the period, not what has cleared the bank.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
