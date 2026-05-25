'use client'

import { useState, useRef } from 'react'

const HD_ORANGE = '#E85D24'

type Mapping = {
  csv_header: string
  field_key: string | null
  confidence: 'high' | 'medium' | 'low'
}

type AvailableField = {
  key: string
  label: string
  required: boolean
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split('\n').filter(Boolean)
  if (lines.length === 0) return { headers: [], rows: [] }
  const parse = (line: string) => {
    const cells: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = !inQ
      } else if (ch === ',' && !inQ) {
        cells.push(cur); cur = ''
      } else {
        cur += ch
      }
    }
    cells.push(cur)
    return cells.map(c => c.trim())
  }
  const headers = parse(lines[0])
  const rows    = lines.slice(1).map(parse)
  return { headers, rows }
}

export default function ImportData() {
  const [phase, setPhase]         = useState<'idle' | 'mapping' | 'confirm' | 'importing' | 'done' | 'error'>('idle')
  const [mapping, setMapping]     = useState<Mapping[]>([])
  const [fields, setFields]       = useState<AvailableField[]>([])
  const [csvData, setCsvData]     = useState<{ headers: string[]; rows: string[][] } | null>(null)
  const [rowCount, setRowCount]   = useState(0)
  const [error, setError]         = useState<string | null>(null)
  const [imported, setImported]   = useState(0)
  const fileRef = useRef<HTMLInputElement | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setError(null)
    setPhase('mapping')

    const text = await file.text()
    const parsed = parseCSV(text)
    setCsvData(parsed)
    setRowCount(parsed.rows.length)

    try {
      const res = await fetch('/api/hd/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: parsed.headers, sample_rows: parsed.rows.slice(0, 3) }),
      })
      if (!res.ok) throw new Error('AI mapping failed')
      const data = await res.json() as { mapping: Mapping[]; available_fields: AvailableField[] }
      setMapping(data.mapping)
      setFields(data.available_fields)
      setPhase('confirm')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get column mapping')
      setPhase('error')
    }
  }

  function updateMapping(idx: number, fieldKey: string | null) {
    setMapping(prev => prev.map((m, i) => i === idx ? { ...m, field_key: fieldKey, confidence: 'high' } : m))
  }

  async function handleImport() {
    if (!csvData) return
    setPhase('importing')
    setError(null)

    const confirmedMapping = mapping.filter(m => m.field_key)
    const rows = csvData.rows.map(row => {
      const obj: Record<string, string> = {}
      for (const m of confirmedMapping) {
        const colIdx = csvData.headers.indexOf(m.csv_header)
        if (colIdx >= 0 && m.field_key) obj[m.field_key] = row[colIdx] ?? ''
      }
      return obj
    })

    try {
      const res = await fetch('/api/hd/import/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        throw new Error(json.error ?? 'Import failed')
      }
      const json = await res.json() as { imported: number }
      setImported(json.imported ?? rows.length)
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setPhase('error')
    }
  }

  function reset() {
    setPhase('idle')
    setMapping([])
    setCsvData(null)
    setError(null)
    setImported(0)
  }

  const confidenceColor = (c: string) => c === 'high' ? '#22C55E' : c === 'medium' ? '#F59E0B' : 'rgba(255,255,255,0.3)'

  return (
    <div>
      {phase === 'idle' && (
        <div className="space-y-3">
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Upload a CSV file of fleet units. AI maps your column headers to NWI fields — you review before importing.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFile}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.7)', border: '1px solid #1e3040' }}
          >
            Upload CSV →
          </button>
        </div>
      )}

      {phase === 'mapping' && (
        <div className="flex items-center gap-2 py-3">
          <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: `${HD_ORANGE}40`, borderTopColor: HD_ORANGE }} />
          <span className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>AI is mapping your columns…</span>
        </div>
      )}

      {phase === 'confirm' && (
        <div className="space-y-4">
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {rowCount} rows detected. Review column mappings below, then import.
          </p>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e3040' }}>
            <div className="grid grid-cols-3 px-3 py-2 text-xs uppercase tracking-wider" style={{ background: '#162030', color: 'rgba(255,255,255,0.4)' }}>
              <span>Your Column</span>
              <span>Maps To</span>
              <span>Confidence</span>
            </div>
            {mapping.map((m, i) => (
              <div key={i} className="grid grid-cols-3 px-3 py-2 items-center text-sm" style={{ borderTop: '1px solid #1e3040', background: '#111920' }}>
                <span className="text-white font-mono text-xs">{m.csv_header}</span>
                <select
                  value={m.field_key ?? ''}
                  onChange={e => updateMapping(i, e.target.value || null)}
                  className="text-xs rounded px-2 py-1 mr-4"
                  style={{ background: '#162030', color: 'rgba(255,255,255,0.8)', border: '1px solid #1e3040' }}
                >
                  <option value="">— skip —</option>
                  {fields.map(f => (
                    <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>
                  ))}
                </select>
                <span className="text-xs font-medium" style={{ color: confidenceColor(m.confidence) }}>
                  {m.confidence}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleImport}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: HD_ORANGE }}
            >
              Import {rowCount} Units
            </button>
            <button
              onClick={reset}
              className="px-4 py-2.5 rounded-lg text-sm"
              style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'importing' && (
        <div className="flex items-center gap-2 py-3">
          <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: `${HD_ORANGE}40`, borderTopColor: HD_ORANGE }} />
          <span className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>Importing rows…</span>
        </div>
      )}

      {phase === 'done' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold" style={{ color: '#22C55E' }}>
            Successfully imported {imported} unit{imported !== 1 ? 's' : ''}
          </p>
          <button onClick={reset} className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Import another file</button>
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-3">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={reset} className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Try again</button>
        </div>
      )}
    </div>
  )
}
