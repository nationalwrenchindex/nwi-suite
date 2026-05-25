'use client'

import { useState } from 'react'
import JSZip from 'jszip'

const HD_ORANGE = '#E85D24'

function jsonToCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n')
}

export default function ExportData() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    setStatus('loading')
    setError(null)
    try {
      const res = await fetch('/api/hd/export')
      if (!res.ok) throw new Error('Export failed')
      const data = await res.json() as Record<string, unknown[]> & { exported_at: string }

      const tables: Record<string, unknown[]> = {
        fleet_accounts:  data.fleet_accounts  ?? [],
        units:           data.units           ?? [],
        work_orders:     data.work_orders     ?? [],
        pm_checklists:   data.pm_checklists   ?? [],
        dot_inspections: data.dot_inspections ?? [],
        epa_log:         data.epa_log         ?? [],
      }

      const zip = new JSZip()
      const folder = zip.folder('nwi-export')!

      for (const [name, rows] of Object.entries(tables)) {
        folder.file(`${name}.csv`, jsonToCSV(rows as Record<string, unknown>[]))
      }
      folder.file('export-info.txt', `NWI HD Suite Data Export\nExported at: ${data.exported_at}\n\nFiles:\n${Object.keys(tables).map(n => `  ${n}.csv`).join('\n')}`)

      const blob = await zip.generateAsync({ type: 'blob' })
      const date = new Date().toISOString().slice(0, 10)
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `nwi-export-${date}.zip`
      a.click()
      URL.revokeObjectURL(url)
      setStatus('done')
      setTimeout(() => setStatus('idle'), 4000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
      setStatus('error')
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
        Exports: Fleet Accounts, Units, Work Orders, PM Checklists, DOT Inspections, EPA Log
      </p>
      <button
        onClick={handleExport}
        disabled={status === 'loading'}
        className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
        style={{ background: HD_ORANGE, opacity: status === 'loading' ? 0.6 : 1 }}
      >
        {status === 'loading' ? 'Preparing export…' : 'Download All Data (ZIP)'}
      </button>
      {status === 'done' && <p className="text-sm" style={{ color: '#22C55E' }}>Download started</p>}
      {status === 'error' && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
