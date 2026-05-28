'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'

const HD_ORANGE = '#E85D24'

type Format = 'invoices' | 'fullbay' | 'custom'
type Step   = 'format' | 'upload' | 'preview' | 'importing' | 'results'

interface ParsedCSV {
  headers: string[]
  rows: string[][]
}

interface Mapping {
  csv_header: string
  field_key: string | null
  confidence: 'high' | 'medium' | 'low'
}

interface AvailableField {
  key: string
  label: string
  required: boolean
}

interface ImportResults {
  fleet_accounts_created: number
  fleet_accounts_matched: number
  work_orders_imported:   number
  work_orders_skipped:    number
  units_created?:         number
  total_revenue?:         number
  date_range?:            { min: string; max: string } | null
}

const FORMATS = [
  {
    id: 'invoices' as Format,
    title: 'My Current Invoice App',
    subtitle: 'Sales Journal CSV Export',
    desc: 'Import invoice history from your billing software. Needs CLIENT, INV DATE, INV NO, and amount columns.',
    expectedCols: ['#', 'INV DATE', 'INV NO', 'CLIENT', 'SUB TOTAL', 'TAX', 'TOTAL', 'PAID', 'OWED'],
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="12" y2="17" />
      </svg>
    ),
  },
  {
    id: 'fullbay' as Format,
    title: 'Fullbay',
    subtitle: 'Work Order Export',
    desc: 'Switching from Fullbay? Import your complete work order history with units, customers, and service records.',
    expectedCols: ['Work Order Number', 'Customer Name', 'Unit Number', 'Year', 'Make', 'Model', 'VIN', 'Service Date', 'Total', '…'],
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
  },
  {
    id: 'custom' as Format,
    title: 'Custom CSV',
    subtitle: 'AI Column Mapping — Fleet Units',
    desc: 'Upload any fleet unit CSV and AI maps your columns automatically. Review the mapping before importing.',
    expectedCols: ['Any format — AI maps automatically'],
    icon: (
      <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
  },
]

const FULLBAY_FIELD_MAP = [
  ['Work Order Number', 'Work Order Number'],
  ['Customer Name',     'Fleet Account Name'],
  ['Unit Number',       'Unit Number'],
  ['Year',              'Unit Year'],
  ['Make',              'Manufacturer'],
  ['Model',             'Unit Model'],
  ['VIN',               'Serial Number / VIN'],
  ['Engine Hours',      'Engine Hours'],
  ['Service Date',      'Work Order Date'],
  ['Completed Date',    'Completion Date'],
  ['Labor Total',       'Labor Amount'],
  ['Parts Total',       'Parts Amount'],
  ['Total',             'Total Amount'],
  ['Amount Paid',       'Paid Amount'],
  ['Balance Due',       'Outstanding Balance'],
  ['Service Description', 'Work Order Comments'],
  ['Internal Notes',    'Internal Notes'],
  ['Technician',        'Tech Name'],
  ['Status',            'Status'],
]

// Robust CSV parser
function parseCSV(text: string): ParsedCSV {
  // Normalize line endings, strip BOM
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = clean.split('\n')
  if (lines.length === 0) return { headers: [], rows: [] }

  function parseLine(line: string): string[] {
    const cells: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = !inQ
      } else if (ch === ',' && !inQ) {
        cells.push(cur.trim()); cur = ''
      } else {
        cur += ch
      }
    }
    cells.push(cur.trim())
    return cells
  }

  const nonEmpty = lines.filter(l => l.trim())
  if (nonEmpty.length === 0) return { headers: [], rows: [] }

  const headers = parseLine(nonEmpty[0])
  const rows    = nonEmpty.slice(1).map(parseLine)
  return { headers, rows }
}

function rowToObj(headers: string[], row: string[]): Record<string, string> {
  const obj: Record<string, string> = {}
  headers.forEach((h, i) => { obj[h] = row[i] ?? '' })
  return obj
}

function formatDate(iso: string): string {
  try {
    const [y, m, d] = iso.split('-')
    return `${m}/${d}/${y}`
  } catch { return iso }
}

// ── Step indicator ────────────────────────────────────────────────────────────
function StepIndicator({ step }: { step: Step }) {
  const steps = [
    { id: 'format',    label: 'Format'  },
    { id: 'upload',    label: 'Upload'  },
    { id: 'preview',   label: 'Preview' },
    { id: 'results',   label: 'Done'    },
  ]
  const idx = steps.findIndex(s => s.id === step || (step === 'importing' && s.id === 'preview'))
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => {
        const done    = i < idx
        const current = i === idx
        return (
          <div key={s.id} className="flex items-center">
            <div className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{
                  background: done ? '#22C55E' : current ? HD_ORANGE : '#1e3040',
                  color: done || current ? 'white' : 'rgba(255,255,255,0.3)',
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <span className="text-xs font-medium" style={{ color: current ? 'white' : done ? '#22C55E' : 'rgba(255,255,255,0.3)' }}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="w-8 h-px mx-2" style={{ background: done ? '#22C55E40' : '#1e3040' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Preview table ─────────────────────────────────────────────────────────────
function PreviewTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const preview = rows.slice(0, 6)
  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid #1e3040' }}>
      <table className="text-xs min-w-max">
        <thead style={{ background: '#162030' }}>
          <tr>
            {headers.map(h => (
              <th key={h} className="px-3 py-2 text-left whitespace-nowrap uppercase tracking-wider"
                style={{ color: 'rgba(255,255,255,0.5)', borderBottom: '1px solid #1e3040' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody style={{ background: '#111920' }}>
          {preview.map((row, i) => (
            <tr key={i} style={{ borderTop: i > 0 ? '1px solid #1e3040' : undefined }}>
              {headers.map((h, j) => (
                <td key={h} className="px-3 py-1.5 text-white/70 whitespace-nowrap max-w-xs truncate">
                  {row[j] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 6 && (
        <p className="px-3 py-2 text-xs" style={{ color: 'rgba(255,255,255,0.3)', borderTop: '1px solid #1e3040', background: '#111920' }}>
          +{rows.length - 6} more rows
        </p>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ImportWizard() {
  const [step,    setStep]    = useState<Step>('format')
  const [format,  setFormat]  = useState<Format | null>(null)
  const [csv,     setCsv]     = useState<ParsedCSV | null>(null)
  const [mapping, setMapping] = useState<Mapping[]>([])
  const [fields,  setFields]  = useState<AvailableField[]>([])
  const [results, setResults] = useState<ImportResults | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  function selectFormat(f: Format) {
    setFormat(f)
    setStep('upload')
    setError(null)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setError(null)

    const text   = await file.text()
    const parsed = parseCSV(text)

    if (parsed.headers.length === 0) {
      setError('Could not parse CSV — make sure the file has column headers on the first row.')
      return
    }

    setCsv(parsed)

    if (format === 'custom') {
      // Call analyze API for AI column mapping
      setStep('importing') // reuse importing spinner state
      try {
        const res = await fetch('/api/hd/import/analyze', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ headers: parsed.headers, sample_rows: parsed.rows.slice(0, 3) }),
        })
        if (!res.ok) throw new Error('AI mapping failed')
        const data = await res.json() as { mapping: Mapping[]; available_fields: AvailableField[] }
        setMapping(data.mapping)
        setFields(data.available_fields)
        setStep('preview')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to analyze columns')
        setStep('upload')
      }
    } else {
      setStep('preview')
    }
  }

  function updateMapping(idx: number, fieldKey: string | null) {
    setMapping(prev => prev.map((m, i) => i === idx ? { ...m, field_key: fieldKey, confidence: 'high' } : m))
  }

  async function handleImport() {
    if (!csv || !format) return
    setStep('importing')
    setError(null)

    const rows = csv.rows.map(r => rowToObj(csv.headers, r))

    let endpoint: string
    let body: unknown

    if (format === 'invoices') {
      endpoint = '/api/hd/import/invoices'
      body = { rows }
    } else if (format === 'fullbay') {
      endpoint = '/api/hd/import/fullbay'
      body = { rows }
    } else {
      // custom — fleet units with confirmed mapping
      endpoint = '/api/hd/import/units'
      const confirmed = mapping.filter(m => m.field_key)
      const unitRows = csv.rows.map(r => {
        const obj: Record<string, string> = {}
        for (const m of confirmed) {
          const idx = csv.headers.indexOf(m.csv_header)
          if (idx >= 0 && m.field_key) obj[m.field_key] = r[idx] ?? ''
        }
        return obj
      })
      body = { rows: unitRows }
    }

    try {
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json() as ImportResults & { error?: string; imported?: number }
      if (!res.ok) throw new Error(json.error ?? 'Import failed')

      // Normalize custom import response to ImportResults shape
      if (format === 'custom' && json.imported !== undefined) {
        setResults({
          fleet_accounts_created: 0,
          fleet_accounts_matched: 0,
          work_orders_imported:   0,
          work_orders_skipped:    0,
          units_created:          json.imported,
        })
      } else {
        setResults(json)
      }
      setStep('results')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
      setStep('preview')
    }
  }

  function reset() {
    setStep('format')
    setFormat(null)
    setCsv(null)
    setMapping([])
    setResults(null)
    setError(null)
  }

  const selectedFormat = FORMATS.find(f => f.id === format)

  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">IMPORT DATA</h1>
      </div>

      <StepIndicator step={step} />

      {error && (
        <div className="mb-5 px-4 py-3 rounded-lg text-sm text-red-300" style={{ background: '#7f1d1d40', border: '1px solid #EF444440' }}>
          {error}
        </div>
      )}

      {/* ── Step 1: Format Selection ── */}
      {step === 'format' && (
        <div className="space-y-4">
          <p className="text-sm mb-6" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Select the format that matches your CSV file.
          </p>
          <div className="grid gap-4">
            {FORMATS.map(f => (
              <button
                key={f.id}
                onClick={() => selectFormat(f.id)}
                className="text-left rounded-xl p-5 transition-all"
                style={{ background: '#111920', border: `1px solid #1e3040` }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = `${HD_ORANGE}80` }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1e3040' }}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: `${HD_ORANGE}15`, color: HD_ORANGE }}>
                    {f.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-condensed font-bold text-white text-lg tracking-wide">{f.title}</p>
                    <p className="text-xs font-medium mb-1" style={{ color: HD_ORANGE }}>{f.subtitle}</p>
                    <p className="text-sm mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>{f.desc}</p>
                    <div className="flex flex-wrap gap-1">
                      {f.expectedCols.slice(0, 7).map(c => (
                        <span key={c} className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: '#162030', color: 'rgba(255,255,255,0.5)' }}>
                          {c}
                        </span>
                      ))}
                      {f.expectedCols.length > 7 && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: 'rgba(255,255,255,0.3)' }}>
                          +{f.expectedCols.length - 7} more
                        </span>
                      )}
                    </div>
                  </div>
                  <svg className="w-5 h-5 flex-shrink-0 mt-1" style={{ color: 'rgba(255,255,255,0.2)' }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 2: Upload ── */}
      {step === 'upload' && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setStep('format')} className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>← Back</button>
            <p className="font-condensed font-bold text-white text-lg tracking-wide">{selectedFormat?.title}</p>
          </div>

          {/* Upload area */}
          <div
            className="rounded-xl p-8 text-center cursor-pointer"
            style={{ background: '#111920', border: `2px dashed #1e3040` }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = `${HD_ORANGE}60` }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1e3040' }}
            onClick={() => fileRef.current?.click()}
          >
            <svg className="w-10 h-10 mx-auto mb-3" style={{ color: 'rgba(255,255,255,0.2)' }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-sm font-medium text-white mb-1">Click to upload CSV</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>or drag and drop — CSV files only</p>
          </div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />

          {/* Expected columns for the selected format */}
          {selectedFormat && format !== 'custom' && (
            <div className="rounded-xl p-4" style={{ background: '#111920', border: '1px solid #1e3040' }}>
              <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Expected Columns
              </p>
              <div className="flex flex-wrap gap-1.5">
                {selectedFormat.expectedCols.map(c => (
                  <span key={c} className="text-xs px-2 py-0.5 rounded font-mono" style={{ background: '#162030', color: 'rgba(255,255,255,0.6)' }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Fullbay field mapping reference */}
          {format === 'fullbay' && (
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
              <div className="px-4 py-3" style={{ background: '#0d1820', borderBottom: '1px solid #1e3040' }}>
                <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  Fullbay → HD Suite Field Reference
                </p>
              </div>
              <div className="grid grid-cols-2 gap-0" style={{ background: '#111920' }}>
                {FULLBAY_FIELD_MAP.map(([fb, hd], i) => (
                  <div key={fb} className="flex items-center gap-2 px-3 py-1.5 text-xs" style={{ borderBottom: i < FULLBAY_FIELD_MAP.length - 2 ? '1px solid #1e3040' : undefined, borderRight: i % 2 === 0 ? '1px solid #1e3040' : undefined }}>
                    <span className="font-mono" style={{ color: 'rgba(255,255,255,0.5)', minWidth: 120 }}>{fb}</span>
                    <svg className="w-3 h-3 flex-shrink-0" style={{ color: HD_ORANGE }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6" /></svg>
                    <span style={{ color: 'rgba(255,255,255,0.75)' }}>{hd}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── AI mapping spinner (custom format) ── */}
      {step === 'importing' && !results && (
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <div className="w-10 h-10 rounded-full border-4 animate-spin" style={{ borderColor: `${HD_ORANGE}30`, borderTopColor: HD_ORANGE }} />
          <p className="text-sm font-medium text-white">
            {format === 'custom' ? 'AI is mapping your columns…' : 'Importing data…'}
          </p>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>This may take a moment</p>
        </div>
      )}

      {/* ── Step 3: Preview & Confirm ── */}
      {step === 'preview' && csv && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <button onClick={() => setStep('upload')} className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>← Back</button>
            <p className="font-condensed font-bold text-white text-lg tracking-wide">Preview & Confirm</p>
          </div>

          {/* Row / column summary */}
          <div className="flex gap-4 text-sm">
            <div className="px-4 py-3 rounded-lg" style={{ background: '#111920', border: '1px solid #1e3040' }}>
              <span className="font-bold text-white text-lg">{csv.rows.length}</span>
              <span className="text-xs ml-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>rows detected</span>
            </div>
            <div className="px-4 py-3 rounded-lg" style={{ background: '#111920', border: '1px solid #1e3040' }}>
              <span className="font-bold text-white text-lg">{csv.headers.length}</span>
              <span className="text-xs ml-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>columns</span>
            </div>
          </div>

          {/* Custom: AI mapping review table */}
          {format === 'custom' && mapping.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-widest mb-2 font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>
                AI Column Mapping — Review & Edit
              </p>
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e3040' }}>
                <div className="grid grid-cols-3 px-3 py-2 text-xs uppercase tracking-wider" style={{ background: '#162030', color: 'rgba(255,255,255,0.4)' }}>
                  <span>Your Column</span><span>Maps To</span><span>Confidence</span>
                </div>
                {mapping.map((m, i) => {
                  const color = m.confidence === 'high' ? '#22C55E' : m.confidence === 'medium' ? '#F59E0B' : 'rgba(255,255,255,0.3)'
                  return (
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
                      <span className="text-xs font-medium" style={{ color }}>{m.confidence}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* CSV data preview */}
          <div>
            <p className="text-xs uppercase tracking-widest mb-2 font-semibold" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Data Preview (first 6 rows)
            </p>
            <PreviewTable headers={csv.headers} rows={csv.rows} />
          </div>

          {/* Warning if key columns missing (invoices/fullbay) */}
          {format === 'invoices' && !csv.headers.some(h => h.toUpperCase().includes('CLIENT')) && (
            <div className="px-4 py-3 rounded-lg text-xs" style={{ background: '#7f1d1d30', border: '1px solid #EF444430', color: '#FCA5A5' }}>
              Warning: No CLIENT column detected. Fleet accounts cannot be created without client names.
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleImport}
              className="px-6 py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: HD_ORANGE }}
            >
              Import {csv.rows.length} {format === 'invoices' ? 'Invoice' : format === 'fullbay' ? 'Work Order' : 'Unit'}{csv.rows.length !== 1 ? 's' : ''}
            </button>
            <button onClick={reset} className="px-4 py-2.5 rounded-lg text-sm" style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Results ── */}
      {step === 'results' && results && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: '#22C55E20', border: '1px solid #22C55E40' }}>
              <svg className="w-4 h-4" style={{ color: '#22C55E' }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="font-condensed font-bold text-white text-xl tracking-wide">IMPORT COMPLETE</p>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
            <div className="px-5 py-3" style={{ background: '#0d1820', borderBottom: '1px solid #1e3040' }}>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Import Summary
              </p>
            </div>
            <div className="divide-y" style={{ background: '#111920', borderColor: '#1e3040' }}>
              {[
                results.fleet_accounts_created > 0 && {
                  label: 'Fleet accounts created',
                  value: results.fleet_accounts_created,
                  color: '#22C55E',
                },
                results.fleet_accounts_matched > 0 && {
                  label: 'Fleet accounts matched (existing)',
                  value: results.fleet_accounts_matched,
                  color: '#3B82F6',
                },
                results.units_created !== undefined && results.units_created > 0 && {
                  label: 'Units created',
                  value: results.units_created,
                  color: '#22C55E',
                },
                results.work_orders_imported > 0 && {
                  label: format === 'custom' ? 'Units imported' : 'Work orders imported',
                  value: results.work_orders_imported,
                  color: '#22C55E',
                },
                results.work_orders_skipped > 0 && {
                  label: 'Duplicates skipped',
                  value: results.work_orders_skipped,
                  color: 'rgba(255,255,255,0.4)',
                },
                results.total_revenue && results.total_revenue > 0 && {
                  label: 'Total revenue imported',
                  value: `$${results.total_revenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                  color: HD_ORANGE,
                  isStr: true,
                },
                results.date_range && {
                  label: 'Date range',
                  value: `${formatDate(results.date_range.min)} — ${formatDate(results.date_range.max)}`,
                  color: 'rgba(255,255,255,0.6)',
                  isStr: true,
                },
              ].filter(Boolean).map((item, i) => {
                const it = item as { label: string; value: number | string; color: string; isStr?: boolean }
                return (
                  <div key={i} className="flex items-center justify-between px-5 py-3 text-sm" style={{ borderColor: '#1e3040' }}>
                    <span style={{ color: 'rgba(255,255,255,0.6)' }}>{it.label}</span>
                    <span className="font-bold" style={{ color: it.color }}>
                      {it.isStr ? it.value : it.value.toLocaleString()}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href="/hd/fleet-accounts" className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: HD_ORANGE }}>
              View Fleet Accounts →
            </Link>
            {format !== 'custom' && (
              <Link href="/hd/work-orders" className="px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ background: '#162030', color: 'rgba(255,255,255,0.8)', border: '1px solid #1e3040' }}>
                View Work Orders →
              </Link>
            )}
            {format === 'custom' && (
              <Link href="/hd/fleet-units" className="px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ background: '#162030', color: 'rgba(255,255,255,0.8)', border: '1px solid #1e3040' }}>
                View Fleet Units →
              </Link>
            )}
            <button onClick={reset} className="px-5 py-2.5 rounded-lg text-sm" style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }}>
              Import Another File
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
