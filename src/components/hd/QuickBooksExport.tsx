'use client'

import { useCallback, useEffect, useState } from 'react'
import { generateIIF, generateQBOCsv, type QBInvoice } from '@/lib/hd/quickbooks-export'

const HD_ORANGE = '#E85D24'

interface ExportPayload {
  company_name:  string | null
  from_date:     string
  to_date:       string
  invoice_count: number
  total:         number
  invoices:      QBInvoice[]
}

type PresetKey = 'ytd' | 'q1' | 'q2' | 'q3' | 'q4' | 'custom'

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'ytd',    label: 'Year to Date' },
  { key: 'q1',     label: 'Q1' },
  { key: 'q2',     label: 'Q2' },
  { key: 'q3',     label: 'Q3' },
  { key: 'q4',     label: 'Q4' },
  { key: 'custom', label: 'Custom' },
]

function pad2(n: number) { return String(n).padStart(2, '0') }
function ymd(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }

const QUARTERS: Record<'q1' | 'q2' | 'q3' | 'q4', [string, string]> = {
  q1: ['01-01', '03-31'],
  q2: ['04-01', '06-30'],
  q3: ['07-01', '09-30'],
  q4: ['10-01', '12-31'],
}

// Presets are resolved against the calendar year of "today" — the range a tech is
// almost always reconciling. Custom leaves whatever is already in the inputs alone.
function rangeForPreset(key: PresetKey, current: { from: string; to: string }): { from: string; to: string } {
  const now  = new Date()
  const year = now.getFullYear()
  if (key === 'custom') return current
  if (key === 'ytd')    return { from: `${year}-01-01`, to: ymd(now) }
  const [start, end] = QUARTERS[key]
  return { from: `${year}-${start}`, to: `${year}-${end}` }
}

// House download pattern: build the text in the browser, wrap it in a blob with a UTF-8
// BOM so Excel/QuickBooks read accented customer names correctly, then click a temp link.
function downloadText(content: string, filename: string, mime: string) {
  const blob = new Blob(['﻿' + content], { type: `${mime};charset=utf-8;` })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function fmtMoney(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function QuickBooksExport() {
  const initial = rangeForPreset('ytd', { from: '', to: '' })

  const [preset,  setPreset]  = useState<PresetKey>('ytd')
  const [from,    setFrom]    = useState(initial.from)
  const [to,      setTo]      = useState(initial.to)
  const [data,    setData]    = useState<ExportPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  function applyPreset(key: PresetKey) {
    setPreset(key)
    const next = rangeForPreset(key, { from, to })
    setFrom(next.from)
    setTo(next.to)
  }

  const load = useCallback(async () => {
    if (!from || !to || from > to) {
      setData(null)
      setError(from && to && from > to ? 'Start date must not be after end date.' : null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/hd/quickbooks-export?from_date=${from}&to_date=${to}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? 'Could not load invoices for this range.')
      setData(body as ExportPayload)
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : 'Could not load invoices for this range.')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  // Refetch whenever the range changes so the count/total shown always describes the
  // file the buttons would produce right now.
  useEffect(() => { load() }, [load])

  const count    = data?.invoice_count ?? 0
  const disabled = loading || count === 0

  function handleIIF() {
    if (!data) return
    downloadText(
      generateIIF(data.invoices, data.company_name),
      `nwi-hd-invoices-${data.from_date}-to-${data.to_date}.iif`,
      'application/octet-stream',
    )
  }

  function handleCSV() {
    if (!data) return
    downloadText(
      generateQBOCsv(data.invoices),
      `nwi-hd-invoices-${data.from_date}-to-${data.to_date}.csv`,
      'text/csv',
    )
  }

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: '#111920', border: '1px solid #1e3040' }}>
      <div>
        <p className="font-condensed font-bold text-white text-lg tracking-wide">QUICKBOOKS EXPORT</p>
        <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Export invoices for your accountant. Voided invoices are excluded.
        </p>
      </div>

      {/* Range presets */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => applyPreset(p.key)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={preset === p.key
              ? { background: HD_ORANGE, color: '#fff' }
              : { color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Date inputs — always visible so the resolved preset range is auditable */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'rgba(255,255,255,0.4)' }}>From</label>
          <input
            type="date"
            value={from}
            onChange={e => { setPreset('custom'); setFrom(e.target.value) }}
            className="w-full px-3 py-2 rounded-lg text-sm text-white"
            style={{ background: '#162030', border: '1px solid #1e3040' }}
          />
        </div>
        <div>
          <label className="text-xs mb-1 block" style={{ color: 'rgba(255,255,255,0.4)' }}>To</label>
          <input
            type="date"
            value={to}
            onChange={e => { setPreset('custom'); setTo(e.target.value) }}
            className="w-full px-3 py-2 rounded-lg text-sm text-white"
            style={{ background: '#162030', border: '1px solid #1e3040' }}
          />
        </div>
      </div>

      {/* Range summary */}
      <div className="rounded-lg px-4 py-3" style={{ background: '#162030' }}>
        {loading ? (
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Checking range…</p>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : count === 0 ? (
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>
            No invoices in this range — pick a wider range to export.
          </p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-sm text-white">
              <span className="font-semibold">{count}</span> invoice{count !== 1 ? 's' : ''} ready
            </p>
            <p className="text-sm font-semibold" style={{ color: HD_ORANGE }}>{fmtMoney(data?.total ?? 0)}</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {data?.from_date} → {data?.to_date}
            </p>
          </div>
        )}
      </div>

      {/* Downloads */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleIIF}
          disabled={disabled}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
          style={{ background: HD_ORANGE, opacity: disabled ? 0.5 : 1 }}
        >
          Download IIF (Desktop)
        </button>
        <button
          onClick={handleCSV}
          disabled={disabled}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
          style={{ border: `1px solid ${HD_ORANGE}`, color: HD_ORANGE, opacity: disabled ? 0.5 : 1 }}
        >
          Download CSV (Online)
        </button>
      </div>

      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
        IIF imports into QuickBooks Desktop (File → Utilities → Import). CSV imports into
        QuickBooks Online (Settings → Import Data → Invoices).
      </p>
    </div>
  )
}
