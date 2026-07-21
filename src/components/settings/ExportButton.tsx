'use client'

import { useState } from 'react'

function toCsv(rows: Record<string, string | number>[]) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const escape  = (v: string | number) => {
    const s = String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  return [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h] ?? '')).join(',')),
  ].join('\r\n')
}

function downloadBlob(content: string, filename: string) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function downloadAll(data: Record<string, Record<string, string | number>[]>) {
  // Try ZIP first; fall back to sequential CSVs if JSZip unavailable
  try {
    const JSZip = (await import('jszip')).default
    const zip   = new JSZip()
    for (const [sheet, rows] of Object.entries(data)) {
      zip.file(`${sheet}.csv`, '﻿' + toCsv(rows))
    }
    const blob = await zip.generateAsync({ type: 'blob' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `nwi-export-${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    // Fallback: download each CSV with 300ms gaps
    const entries = Object.entries(data)
    for (let i = 0; i < entries.length; i++) {
      const [sheet, rows] = entries[i]
      await new Promise<void>(res => setTimeout(() => {
        downloadBlob(toCsv(rows), `nwi-${sheet}-${new Date().toISOString().slice(0, 10)}.csv`)
        res()
      }, i * 350))
    }
  }
}

export default function ExportButton() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleExport() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/export')
      if (!res.ok) throw new Error('Export failed — please try again.')
      const data = await res.json()
      await downloadAll(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handleExport}
        disabled={loading}
        className="flex items-center gap-2 px-5 py-2.5 bg-[#15803d] hover:bg-[#052e16] disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-lg transition-colors"
      >
        {loading ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Preparing export…
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export My Data
          </>
        )}
      </button>
      {error && <p className="text-danger text-xs">{error}</p>}
      <p className="text-white/30 text-xs">
        Your data belongs to you. Export anytime, no questions asked.
      </p>
    </div>
  )
}
