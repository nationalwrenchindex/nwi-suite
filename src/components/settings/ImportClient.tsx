'use client'

import { useState, useRef, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type NwiField =
  | 'customer_first_name' | 'customer_last_name' | 'customer_full_name'
  | 'customer_phone' | 'customer_email'
  | 'vehicle_year' | 'vehicle_make' | 'vehicle_model' | 'vehicle_vin'
  | 'job_date' | 'job_service_type' | 'job_notes'
  | 'skip'

type Step = 'upload' | 'mapping' | 'preview' | 'importing' | 'done'

interface ParsedFile {
  headers: string[]
  rows: Record<string, string>[]
}

interface ImportResult {
  customersImported: number
  vehiclesImported:  number
  jobsImported:      number
  errors:            string[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<NwiField, string> = {
  customer_first_name: 'Customer — First Name',
  customer_last_name:  'Customer — Last Name',
  customer_full_name:  'Customer — Full Name (auto-split)',
  customer_phone:      'Customer — Phone',
  customer_email:      'Customer — Email',
  vehicle_year:        'Vehicle — Year',
  vehicle_make:        'Vehicle — Make',
  vehicle_model:       'Vehicle — Model',
  vehicle_vin:         'Vehicle — VIN',
  job_date:            'Job — Date',
  job_service_type:    'Job — Service / Description',
  job_notes:           'Job — Notes',
  skip:                '— Skip this column —',
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

async function parseCsv(file: File): Promise<ParsedFile> {
  const Papa = (await import('papaparse')).default
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const headers = results.meta.fields ?? []
        resolve({ headers, rows: results.data as Record<string, string>[] })
      },
      error: reject,
    })
  })
}

async function parseXlsx(file: File): Promise<ParsedFile> {
  const XLSX  = await import('xlsx')
  const buf   = await file.arrayBuffer()
  const wb    = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const raw   = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  if (!raw.length) return { headers: [], rows: [] }
  const headers = Object.keys(raw[0])
  const rows    = raw.map(r => {
    const out: Record<string, string> = {}
    for (const k of headers) out[k] = String(r[k] ?? '')
    return out
  })
  return { headers, rows }
}

// ─── Step components ──────────────────────────────────────────────────────────

function StepBadge({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
      done   ? 'bg-success text-white' :
      active ? 'bg-orange text-white'  :
               'bg-white/10 text-white/30'
    }`}>
      {done ? (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : n}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ImportClient() {
  const [step,    setStep]    = useState<Step>('upload')
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)

  const [parsed,  setParsed]  = useState<ParsedFile | null>(null)
  const [mapping, setMapping] = useState<Record<string, NwiField>>({})
  const [result,  setResult]  = useState<ImportResult | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── File parse ─────────────────────────────────────────────────────────────

  async function handleFile(file: File) {
    setError(null)
    setLoading(true)
    try {
      const ext  = file.name.split('.').pop()?.toLowerCase()
      const data = ext === 'xlsx' || ext === 'xls' ? await parseXlsx(file) : await parseCsv(file)
      if (!data.headers.length) throw new Error('File appears empty or has no headers.')
      setParsed(data)
      await analyzeMapping(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse file.')
      setLoading(false)
    }
  }

  // ── AI mapping ─────────────────────────────────────────────────────────────

  async function analyzeMapping(data: ParsedFile) {
    setStep('mapping')
    setLoading(true)
    try {
      const res = await fetch('/api/import/analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ headers: data.headers, firstRows: data.rows.slice(0, 5) }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Analysis failed.')
      const raw: Record<string, string> = json.mapping ?? {}
      const initial: Record<string, NwiField> = {}
      for (const h of data.headers) {
        const v = raw[h]
        initial[h] = (Object.keys(FIELD_LABELS).includes(v) ? v : 'skip') as NwiField
      }
      setMapping(initial)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI analysis failed.')
    } finally {
      setLoading(false)
    }
  }

  // ── Import execute ──────────────────────────────────────────────────────────

  async function executeImport() {
    if (!parsed) return
    setStep('importing')
    setLoading(true)
    setError(null)
    try {
      const mappedRows = parsed.rows.map(row => {
        const out: Record<string, string> = {}
        for (const [col, nwiField] of Object.entries(mapping)) {
          if (nwiField !== 'skip') out[nwiField] = row[col] ?? ''
        }
        return out
      })

      const res = await fetch('/api/import/execute', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rows: mappedRows }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Import failed.')
      setResult(json)
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.')
      setStep('mapping')
    } finally {
      setLoading(false)
    }
  }

  // ── Drag & drop ────────────────────────────────────────────────────────────

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [])

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)

  // ─── Render ────────────────────────────────────────────────────────────────

  const steps = [
    { label: 'Upload File',     key: 'upload'    },
    { label: 'Map Columns',     key: 'mapping'   },
    { label: 'Preview & Import',key: 'preview'   },
    { label: 'Complete',        key: 'done'      },
  ] as const

  const stepIdx = { upload: 0, mapping: 1, preview: 2, importing: 2, done: 3 }[step]

  return (
    <div className="space-y-6">

      {/* ── Step tracker ── */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2 flex-1 last:flex-none">
            <StepBadge n={i + 1} active={stepIdx === i} done={stepIdx > i} />
            <span className={`text-xs font-medium hidden sm:block ${stepIdx === i ? 'text-white' : stepIdx > i ? 'text-success' : 'text-white/25'}`}>
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-px ${stepIdx > i ? 'bg-success/40' : 'bg-white/10'}`} />
            )}
          </div>
        ))}
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* ════ STEP 1: UPLOAD ════ */}
      {step === 'upload' && (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`rounded-xl border-2 border-dashed p-12 flex flex-col items-center gap-4 cursor-pointer transition-colors ${
            dragging
              ? 'border-orange bg-orange/5'
              : 'border-dark-border hover:border-white/30 hover:bg-white/3'
          }`}
        >
          <svg className="w-10 h-10 text-white/20" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <div className="text-center">
            <p className="text-white font-medium text-sm">Drop your file here, or click to browse</p>
            <p className="text-white/40 text-xs mt-1">Accepts CSV (.csv) and Excel (.xlsx) files</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 mt-2">
            {['QuickBooks', 'Wave', 'FreshBooks', 'Square', 'Any CSV'].map(src => (
              <span key={src} className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 text-white/30">
                {src}
              </span>
            ))}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          {loading && (
            <div className="flex items-center gap-2 text-white/50 text-xs mt-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Reading file…
            </div>
          )}
        </div>
      )}

      {/* ════ STEP 2: MAPPING ════ */}
      {step === 'mapping' && parsed && (
        <div className="space-y-5">
          <div className="nwi-card space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-white font-medium text-sm">Column Mapping</p>
                <p className="text-white/40 text-xs mt-0.5">
                  AI suggested these mappings — adjust any that need correcting.
                </p>
              </div>
              {loading && (
                <div className="flex items-center gap-2 text-white/40 text-xs flex-shrink-0">
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Analyzing…
                </div>
              )}
            </div>

            <div className="space-y-2">
              {/* Header row */}
              <div className="grid grid-cols-2 gap-3">
                <p className="nwi-label">Your Column</p>
                <p className="nwi-label">NWI Field</p>
              </div>
              {parsed.headers.map(col => (
                <div key={col} className="grid grid-cols-2 gap-3 items-center">
                  <p className="text-white/70 text-xs font-mono truncate bg-white/5 rounded px-2 py-1.5">
                    {col}
                  </p>
                  <select
                    value={mapping[col] ?? 'skip'}
                    onChange={e => setMapping(prev => ({ ...prev, [col]: e.target.value as NwiField }))}
                    className="nwi-input text-xs py-1.5"
                  >
                    {(Object.keys(FIELD_LABELS) as NwiField[]).map(f => (
                      <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => { setStep('upload'); setParsed(null); setMapping({}) }}
              className="px-4 py-2 border border-dark-border text-white/50 hover:text-white text-sm rounded-lg transition-colors"
            >
              Back
            </button>
            <button
              onClick={() => setStep('preview')}
              disabled={loading}
              className="flex-1 px-5 py-2 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-lg transition-colors"
            >
              Preview Import →
            </button>
          </div>
        </div>
      )}

      {/* ════ STEP 3: PREVIEW ════ */}
      {step === 'preview' && parsed && (
        <div className="space-y-5">
          <div className="nwi-card space-y-4">
            <div>
              <p className="text-white font-medium text-sm">Preview</p>
              <p className="text-white/40 text-xs mt-0.5">
                First 5 rows of {parsed.rows.length.toLocaleString()} total rows.
              </p>
            </div>

            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-dark-border">
                    {parsed.headers
                      .filter(h => mapping[h] !== 'skip')
                      .map(h => (
                        <th key={h} className="text-left text-white/40 pb-2 pr-4 font-medium whitespace-nowrap">
                          {FIELD_LABELS[mapping[h]] ?? mapping[h]}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-b border-dark-border/50">
                      {parsed.headers
                        .filter(h => mapping[h] !== 'skip')
                        .map(h => (
                          <td key={h} className="py-1.5 pr-4 text-white/70 max-w-[140px] truncate">
                            {row[h] ?? ''}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white/5 rounded-lg px-4 py-3 text-xs text-white/50">
              <span className="font-semibold text-white">{parsed.rows.length.toLocaleString()}</span> rows will be imported.
              Customers and vehicles are deduplicated by phone/email/VIN. Jobs are always created.
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep('mapping')}
              className="px-4 py-2 border border-dark-border text-white/50 hover:text-white text-sm rounded-lg transition-colors"
            >
              Back
            </button>
            <button
              onClick={executeImport}
              disabled={loading}
              className="flex-1 px-5 py-2.5 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Importing…
                </>
              ) : (
                `Import ${parsed.rows.length.toLocaleString()} Rows`
              )}
            </button>
          </div>
        </div>
      )}

      {/* ════ STEP 4: IMPORTING ════ */}
      {step === 'importing' && (
        <div className="nwi-card flex flex-col items-center gap-4 py-12">
          <svg className="w-10 h-10 text-orange animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <div className="text-center">
            <p className="text-white font-medium text-sm">Importing your data…</p>
            <p className="text-white/40 text-xs mt-1">This may take a moment for large files.</p>
          </div>
        </div>
      )}

      {/* ════ STEP 5: DONE ════ */}
      {step === 'done' && result && (
        <div className="space-y-5">
          <div className="nwi-card space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-success/15 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-success" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div>
                <p className="text-white font-semibold text-sm">Import complete!</p>
                <p className="text-white/40 text-xs">Your data has been added to LawnPlatform.</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Customers', count: result.customersImported, color: 'text-orange' },
                { label: 'Vehicles',  count: result.vehiclesImported,  color: 'text-blue-light' },
                { label: 'Jobs',      count: result.jobsImported,      color: 'text-success' },
              ].map(({ label, count, color }) => (
                <div key={label} className="bg-white/5 rounded-xl p-4 text-center">
                  <p className={`font-condensed font-bold text-3xl ${color}`}>{count}</p>
                  <p className="text-white/40 text-xs mt-1">{label}</p>
                </div>
              ))}
            </div>

            {result.errors.length > 0 && (
              <div className="bg-danger/5 border border-danger/20 rounded-lg p-3 space-y-1">
                <p className="text-danger text-xs font-semibold">{result.errors.length} row(s) had issues:</p>
                {result.errors.map((e, i) => (
                  <p key={i} className="text-danger/70 text-xs">{e}</p>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <a
              href="/intel"
              className="flex-1 text-center px-5 py-2.5 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-lg transition-colors"
            >
              View Customers →
            </a>
            <button
              onClick={() => { setStep('upload'); setParsed(null); setMapping({}); setResult(null) }}
              className="px-4 py-2.5 border border-dark-border text-white/50 hover:text-white text-sm rounded-lg transition-colors"
            >
              Import Another File
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
