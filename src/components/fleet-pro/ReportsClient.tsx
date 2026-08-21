'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FleetProReport } from '@/types/fleet-pro'
import { FleetProWordmark, NWI_ORANGE } from './brand'

const FP_ORANGE = NWI_ORANGE
const CARD      = '#111920'
const THEAD     = '#162030'
const BORDER    = '#1e3040'

// Sentinel the reports route uses for invoices with no unit_id. Kept in sync by hand;
// the API owns the value, this side only needs to recognise the row.
const UNASSIGNED_ID = '__unassigned__'

const currency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

// ─── Date range presets ───────────────────────────────────────────────────────
// Quarters are first-class, not a convenience: the county submits its maintenance
// spend quarterly, so Q1–Q4 are the buttons this page exists to provide.

type PresetKey = 'ytd' | 'q1' | 'q2' | 'q3' | 'q4' | 'custom'

const QUARTER_MONTHS: Record<'q1' | 'q2' | 'q3' | 'q4', [number, number]> = {
  q1: [1, 3],
  q2: [4, 6],
  q3: [7, 9],
  q4: [10, 12],
}

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'ytd',    label: 'Year to Date' },
  { key: 'q1',     label: 'Q1' },
  { key: 'q2',     label: 'Q2' },
  { key: 'q3',     label: 'Q3' },
  { key: 'q4',     label: 'Q4' },
  { key: 'custom', label: 'Custom' },
]

function pad(n: number) { return String(n).padStart(2, '0') }

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Last calendar day of a 1-indexed month — day 0 of the next month. */
function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0))
  return `${year}-${pad(month)}-${pad(d.getUTCDate())}`
}

function rangeForPreset(key: PresetKey, year: number): { from: string; to: string } | null {
  if (key === 'custom') return null
  if (key === 'ytd') return { from: `${year}-01-01`, to: todayKey() }
  const [start, end] = QUARTER_MONTHS[key]
  return { from: `${year}-${pad(start)}-01`, to: lastDayOfMonth(year, end) }
}

/** 'YYYY-MM' -> 'Jan 2026'. Built from a fixed table so no timezone can shift it. */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthLabel(m: string): string {
  const idx = Number(m.slice(5, 7)) - 1
  return `${MONTH_NAMES[idx] ?? m.slice(5, 7)} ${m.slice(0, 4)}`
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'fleet'
}

// ─── CSV (house pattern: client-side blob, no text/csv route) ─────────────────

const escape = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s
}

function buildCsv(report: FleetProReport): string {
  const lines: string[] = []

  // Self-describing header — this file gets emailed to an accountant with no context.
  lines.push([escape(report.fleet_name), 'Maintenance Cost Report'].join(','))
  lines.push(['Date range', `${report.from_date} to ${report.to_date}`].map(escape).join(','))
  lines.push(['Invoices', report.invoice_count].map(escape).join(','))
  lines.push(['Grand total', report.grand_total.toFixed(2)].map(escape).join(','))
  lines.push('')

  // Section 1 — per-unit by month.
  lines.push('Cost by Unit and Month')
  lines.push(['Unit', ...report.months, 'Total'].map(escape).join(','))
  for (const row of report.per_unit) {
    lines.push([
      escape(row.unit_number),
      ...report.months.map(m => (row.by_month[m] ?? 0).toFixed(2)),
      row.total.toFixed(2),
    ].join(','))
  }
  lines.push([
    escape('TOTAL'),
    ...report.by_month.map(m => m.cost.toFixed(2)),
    report.grand_total.toFixed(2),
  ].join(','))

  lines.push('')

  // Section 2 — monthly totals.
  lines.push('Monthly Totals')
  lines.push(['Month', 'Invoices', 'Cost'].map(escape).join(','))
  for (const m of report.by_month) {
    lines.push([escape(monthLabel(m.month)), m.invoice_count, m.cost.toFixed(2)].join(','))
  }
  lines.push([escape('TOTAL'), report.invoice_count, report.grand_total.toFixed(2)].join(','))

  return lines.join('\r\n')
}

function downloadCsv(report: FleetProReport) {
  // Leading BOM so Excel reads it as UTF-8 — county finance staff open this in Excel.
  const blob = new Blob(['﻿' + buildCsv(report)], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `fleet-pro-${slugify(report.fleet_name)}-${report.from_date}-to-${report.to_date}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReportsClient() {
  const year = new Date().getFullYear()
  const ytd  = rangeForPreset('ytd', year)!

  const [preset, setPreset] = useState<PresetKey>('ytd')
  const [from,   setFrom]   = useState(ytd.from)
  const [to,     setTo]     = useState(ytd.to)
  const [report, setReport] = useState<FleetProReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const invalidRange = !from || !to || from > to

  const load = useCallback(async (fromDate: string, toDate: string) => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/fleet-pro/reports?from_date=${fromDate}&to_date=${toDate}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'Could not load the report.')
      setReport(json.report as FleetProReport)
    } catch (err) {
      setReport(null)
      setError(err instanceof Error ? err.message : 'Could not load the report.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (invalidRange) return
    load(from, to)
  }, [from, to, invalidRange, load])

  function choosePreset(key: PresetKey) {
    setPreset(key)
    const range = rangeForPreset(key, year)
    if (range) { setFrom(range.from); setTo(range.to) }
  }

  const months = report?.months ?? []

  // A wide matrix needs a sensible floor: unit column + one column per month + total.
  const minWidth = useMemo(
    () => Math.max(640, 200 + months.length * 110 + 130),
    [months.length],
  )

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <FleetProWordmark className="block text-xs uppercase tracking-widest mb-1 font-semibold" />
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">REPORTS</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Maintenance spend by unit and month, for budget submission.
          </p>
        </div>

        <button
          onClick={() => report && downloadCsv(report)}
          disabled={!report || loading}
          className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white"
          style={{ background: FP_ORANGE, opacity: !report || loading ? 0.5 : 1 }}
        >
          Export CSV
        </button>
      </div>

      {/* ── Range controls ── */}
      <div className="rounded-xl p-4" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => {
            const active = preset === p.key
            return (
              <button
                key={p.key}
                onClick={() => choosePreset(p.key)}
                className="px-3 min-h-[40px] rounded-lg text-sm font-medium transition-colors"
                style={active
                  ? { background: `${FP_ORANGE}20`, color: FP_ORANGE, border: `1px solid ${FP_ORANGE}` }
                  : { color: 'rgba(255,255,255,0.5)', border: `1px solid ${BORDER}` }}
              >
                {p.key === 'ytd' || p.key === 'custom' ? p.label : `${p.label} ${year}`}
              </button>
            )
          })}
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-end gap-4 mt-4">
            <label className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>
              From
              <input
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                className="block mt-1 px-3 py-2 rounded-lg text-sm text-white"
                style={{ background: '#0a0f14', border: `1px solid ${BORDER}` }}
              />
            </label>
            <label className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>
              To
              <input
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
                className="block mt-1 px-3 py-2 rounded-lg text-sm text-white"
                style={{ background: '#0a0f14', border: `1px solid ${BORDER}` }}
              />
            </label>
          </div>
        )}

        {invalidRange && (
          <p className="text-sm mt-3" style={{ color: '#F87171' }}>
            The start date must be on or before the end date.
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-xl p-4" style={{ background: CARD, border: '1px solid #7f1d1d' }}>
          <p className="text-sm" style={{ color: '#F87171' }}>{error}</p>
        </div>
      )}

      {loading && !error && (
        <div className="rounded-xl p-8 text-center" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Loading report…</p>
        </div>
      )}

      {report && !loading && !error && (
        <>
          {/* ── Summary tiles ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Grand Total', value: currency(report.grand_total), accent: true },
              { label: 'Invoices',    value: String(report.invoice_count) },
              { label: 'Units Billed', value: String(report.per_unit.length) },
              { label: 'Period',      value: `${report.from_date} → ${report.to_date}` },
            ].map(tile => (
              <div key={tile.label} className="rounded-xl p-4" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
                <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>{tile.label}</p>
                <p
                  className="font-condensed font-bold text-xl tabular-nums"
                  style={{ color: tile.accent ? FP_ORANGE : '#fff' }}
                >
                  {tile.value}
                </p>
              </div>
            ))}
          </div>

          {/* ── Matrix: units × months ── */}
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]" style={{ background: CARD, minWidth }}>
                <thead style={{ background: THEAD }}>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      Unit
                    </th>
                    {months.map(m => (
                      <th
                        key={m}
                        className="px-4 py-3 text-right text-xs uppercase tracking-wider whitespace-nowrap"
                        style={{ color: 'rgba(255,255,255,0.4)' }}
                      >
                        {monthLabel(m)}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      Total
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {report.per_unit.length === 0 && (
                    <tr>
                      <td
                        colSpan={months.length + 2}
                        className="px-4 py-8 text-center text-sm"
                        style={{ color: 'rgba(255,255,255,0.4)' }}
                      >
                        No invoices in this period.
                      </td>
                    </tr>
                  )}

                  {report.per_unit.map(row => (
                    <tr key={row.unit_id} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td className="px-4 py-3 text-sm text-white whitespace-nowrap">
                        {row.unit_number}
                      </td>
                      {months.map(m => {
                        const cost = row.by_month[m] ?? 0
                        return (
                          <td
                            key={m}
                            className="px-4 py-3 text-sm text-right tabular-nums whitespace-nowrap"
                            style={{ color: cost ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.2)' }}
                          >
                            {cost ? currency(cost) : '—'}
                          </td>
                        )
                      })}
                      <td className="px-4 py-3 text-sm text-right font-semibold tabular-nums whitespace-nowrap text-white">
                        {currency(row.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>

                <tfoot style={{ background: THEAD }}>
                  <tr>
                    <td className="px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      Total
                    </td>
                    {report.by_month.map(m => (
                      <td
                        key={m.month}
                        className="px-4 py-3 text-sm text-right font-semibold tabular-nums whitespace-nowrap text-white"
                      >
                        {m.cost ? currency(m.cost) : '—'}
                      </td>
                    ))}
                    <td
                      className="px-4 py-3 text-sm text-right font-bold tabular-nums whitespace-nowrap"
                      style={{ color: FP_ORANGE }}
                    >
                      {currency(report.grand_total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Unattributed spend is shown, never dropped — see the reports route. */}
          {report.per_unit.some(r => r.unit_id === UNASSIGNED_ID) && (
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              &ldquo;Unassigned&rdquo; holds invoices that were billed to this fleet without a unit on
              record. The spend is real and counts toward the totals; ask your mechanic to link
              those invoices to a unit so they attribute correctly next quarter.
            </p>
          )}

          {/* ── Monthly totals summary ── */}
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${BORDER}` }}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]" style={{ background: CARD }}>
                <thead style={{ background: THEAD }}>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      Month
                    </th>
                    <th className="px-4 py-3 text-right text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      Invoices
                    </th>
                    <th className="px-4 py-3 text-right text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_month.map(m => (
                    <tr key={m.month} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td className="px-4 py-3 text-sm text-white whitespace-nowrap">{monthLabel(m.month)}</td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums" style={{ color: 'rgba(255,255,255,0.6)' }}>
                        {m.invoice_count}
                      </td>
                      <td className="px-4 py-3 text-sm text-right tabular-nums text-white">
                        {m.cost ? currency(m.cost) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot style={{ background: THEAD }}>
                  <tr>
                    <td className="px-4 py-3 text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      Grand Total
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-semibold tabular-nums text-white">
                      {report.invoice_count}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-bold tabular-nums" style={{ color: FP_ORANGE }}>
                      {currency(report.grand_total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
