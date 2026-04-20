'use client'

import { useState, useEffect, useCallback } from 'react'
import type { QWVehicle } from '@/types/quickwrench'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DTCResult {
  code:        string
  description: string
  system:      string
  causes:      string[]
  repair:      string
}

interface RecallResult {
  campaignNumber: string
  component:      string
  summary:        string
  consequence:    string
  remedy:         string
  reportDate:     string
}

interface ComplaintDetail {
  dateOfIncident: string
  summary:        string
  crash:          boolean
  fire:           boolean
}

interface ComplaintGroup {
  component:  string
  count:      number
  complaints: ComplaintDetail[]
}

interface FluidSpecs {
  oil:           string
  coolant:       string
  transmission:  string
  brake:         string
  power_steering: string
  notes:         string
}

// ─── Shared UI helpers ────────────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-2 border-orange border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ErrorCard({ msg }: { msg: string }) {
  return (
    <div className="nwi-card border-danger/30 bg-danger/5">
      <p className="text-danger text-sm">{msg}</p>
    </div>
  )
}

function NoVehicleNotice() {
  return (
    <div className="nwi-card border-white/10 text-center py-8">
      <p className="text-white/40 text-sm">Identify a vehicle in Step 1 to use this tool.</p>
    </div>
  )
}

// ─── DTC Lookup Panel ─────────────────────────────────────────────────────────

function DTCPanel() {
  const [input,   setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState<DTCResult | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  async function lookup() {
    const code = input.trim().toUpperCase()
    if (!/^[PBCU][0-9]{4}$/.test(code)) {
      setError('Enter a valid DTC code like P0420 or P0301.')
      return
    }
    setLoading(true); setError(null); setResult(null)
    try {
      const res  = await fetch(`/api/quickwrench/dtc/${code}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Lookup failed')
      setResult(json.result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          className="nwi-input flex-1 font-mono tracking-widest uppercase"
          placeholder="e.g. P0420"
          maxLength={6}
          value={input}
          onChange={e => { setInput(e.target.value.toUpperCase()); setError(null) }}
          onKeyDown={e => e.key === 'Enter' && lookup()}
        />
        <button
          onClick={lookup}
          disabled={loading}
          className="px-5 py-2 bg-orange hover:bg-orange-hover disabled:opacity-40 text-white font-condensed font-bold text-sm rounded-lg transition-colors whitespace-nowrap"
        >
          {loading ? 'Looking up…' : 'Look Up'}
        </button>
      </div>
      {error && <p className="text-danger text-xs">{error}</p>}

      {loading && <LoadingSpinner />}

      {result && !loading && (
        <div className="space-y-3">
          <div className="nwi-card border-orange/30 bg-orange/5">
            <div className="flex items-start justify-between gap-3 mb-2">
              <span className="font-condensed font-bold text-orange text-xl tracking-wide">{result.code}</span>
              <span className="bg-blue/15 border border-blue/30 text-blue-light text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap">
                {result.system}
              </span>
            </div>
            <p className="text-white font-medium text-sm leading-relaxed">{result.description}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="nwi-card">
              <p className="text-white/40 text-xs uppercase tracking-widest mb-2">Common Causes</p>
              <ul className="space-y-1.5">
                {result.causes.map((c, i) => (
                  <li key={i} className="flex gap-2 text-white/70 text-sm">
                    <span className="text-orange flex-shrink-0 mt-0.5">•</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
            <div className="nwi-card border-blue/20 bg-blue/5">
              <p className="text-white/40 text-xs uppercase tracking-widest mb-2">Suggested Repair</p>
              <p className="text-white/80 text-sm leading-relaxed">{result.repair}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Recall Panel ─────────────────────────────────────────────────────────────

function RecallPanel({ vehicle }: { vehicle: QWVehicle | null }) {
  const [loading, setLoading] = useState(false)
  const [recalls, setRecalls] = useState<RecallResult[] | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!vehicle) return
    setLoading(true); setError(null); setRecalls(null)
    try {
      const params = new URLSearchParams({ make: vehicle.make, model: vehicle.model, year: vehicle.year })
      const res    = await fetch(`/api/quickwrench/recalls?${params}`)
      const json   = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Recall lookup failed')
      setRecalls(json.recalls)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load recalls')
    } finally {
      setLoading(false)
    }
  }, [vehicle])

  useEffect(() => { load() }, [load])

  if (!vehicle) return <NoVehicleNotice />
  if (loading)  return <LoadingSpinner />
  if (error)    return <ErrorCard msg={error} />

  if (recalls !== null && recalls.length === 0) {
    return (
      <div className="nwi-card border-success/30 bg-success/5 flex items-center gap-3 py-5">
        <div className="w-10 h-10 rounded-full bg-success/20 border border-success/40 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-success" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <p className="text-success font-semibold text-sm">No Open Recalls</p>
          <p className="text-white/50 text-xs mt-0.5">
            {vehicle.year} {vehicle.make} {vehicle.model} has no active NHTSA recalls on record.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {recalls !== null && (
        <div className="flex items-center gap-2 px-3 py-2 bg-danger/10 border border-danger/30 rounded-lg">
          <span className="w-6 h-6 rounded-full bg-danger flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
            {recalls.length}
          </span>
          <p className="text-danger text-sm font-semibold">
            Open {recalls.length === 1 ? 'Recall' : 'Recalls'} — {vehicle.year} {vehicle.make} {vehicle.model}
          </p>
        </div>
      )}

      {recalls?.map(r => (
        <div key={r.campaignNumber} className="nwi-card border-danger/20">
          <button
            className="w-full text-left"
            onClick={() => setExpanded(expanded === r.campaignNumber ? null : r.campaignNumber)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm truncate">{r.component}</p>
                <p className="text-white/40 text-xs mt-0.5">Campaign #{r.campaignNumber} · {r.reportDate}</p>
              </div>
              <svg
                className={`w-4 h-4 text-white/40 flex-shrink-0 mt-0.5 transition-transform ${expanded === r.campaignNumber ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </button>

          {expanded === r.campaignNumber && (
            <div className="mt-3 space-y-2 border-t border-dark-border pt-3">
              {r.summary && (
                <div>
                  <p className="text-white/40 text-[10px] uppercase tracking-widest mb-1">Summary</p>
                  <p className="text-white/70 text-xs leading-relaxed">{r.summary}</p>
                </div>
              )}
              {r.consequence && (
                <div>
                  <p className="text-white/40 text-[10px] uppercase tracking-widest mb-1">Consequence</p>
                  <p className="text-danger/80 text-xs leading-relaxed">{r.consequence}</p>
                </div>
              )}
              {r.remedy && (
                <div>
                  <p className="text-white/40 text-[10px] uppercase tracking-widest mb-1">Remedy</p>
                  <p className="text-success/80 text-xs leading-relaxed">{r.remedy}</p>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Complaints Panel ─────────────────────────────────────────────────────────

function ComplaintsPanel({ vehicle }: { vehicle: QWVehicle | null }) {
  const [loading,  setLoading]  = useState(false)
  const [groups,   setGroups]   = useState<ComplaintGroup[] | null>(null)
  const [total,    setTotal]    = useState(0)
  const [status,   setStatus]   = useState<'found' | 'no_complaints' | 'unavailable' | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!vehicle) return
    setLoading(true); setGroups(null); setStatus(null)
    try {
      const params = new URLSearchParams({ make: vehicle.make, model: vehicle.model, year: vehicle.year })
      const res    = await fetch(`/api/quickwrench/tsb?${params}`)
      const json   = await res.json()
      setGroups(json.groups ?? [])
      setTotal(json.total ?? 0)
      setStatus(json.status ?? (res.ok ? 'found' : 'unavailable'))
    } catch {
      setGroups([])
      setStatus('unavailable')
    } finally {
      setLoading(false)
    }
  }, [vehicle])

  useEffect(() => { load() }, [load])

  if (!vehicle) return <NoVehicleNotice />
  if (loading)  return <LoadingSpinner />

  if (status === 'no_complaints') {
    return (
      <div className="nwi-card border-success/30 bg-success/5 flex items-center gap-3 py-5">
        <div className="w-10 h-10 rounded-full bg-success/20 border border-success/40 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-success" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <p className="text-success font-semibold text-sm">No Complaints on Record</p>
          <p className="text-white/50 text-xs mt-0.5">
            {vehicle.year} {vehicle.make} {vehicle.model} has no owner complaints filed with NHTSA.
          </p>
        </div>
      </div>
    )
  }

  if (status === 'unavailable') {
    return (
      <div className="nwi-card border-white/10 bg-white/3 flex items-center gap-3 py-5">
        <div className="w-10 h-10 rounded-full bg-white/5 border border-white/15 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-white/30" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <p className="text-white/40 text-sm">Complaints data temporarily unavailable.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {groups !== null && (
        <div className="flex items-center justify-between">
          <p className="text-white/40 text-xs">
            {total} owner complaint{total !== 1 ? 's' : ''} · {groups.length} component area{groups.length !== 1 ? 's' : ''} — {vehicle.year} {vehicle.make} {vehicle.model}
          </p>
          <span className="text-white/20 text-[10px]">Source: NHTSA</span>
        </div>
      )}
      {groups?.map(g => (
        <div key={g.component} className="nwi-card">
          <button className="w-full text-left" onClick={() => setExpanded(expanded === g.component ? null : g.component)}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-orange/15 border border-orange/30 flex items-center justify-center font-condensed font-bold text-orange text-xs">
                  {g.count}
                </span>
                <p className="text-white font-semibold text-sm truncate">{g.component}</p>
              </div>
              <svg
                className={`w-4 h-4 text-white/40 flex-shrink-0 transition-transform ${expanded === g.component ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </button>

          {expanded === g.component && (
            <div className="mt-3 space-y-3 border-t border-dark-border pt-3">
              {g.complaints.slice(0, 5).map((c, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center gap-2">
                    {c.dateOfIncident && (
                      <span className="text-white/30 text-[10px]">{c.dateOfIncident}</span>
                    )}
                    {c.crash && (
                      <span className="bg-danger/20 text-danger text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide">Crash</span>
                    )}
                    {c.fire && (
                      <span className="bg-orange/20 text-orange text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide">Fire</span>
                    )}
                  </div>
                  {c.summary && (
                    <p className="text-white/60 text-xs leading-relaxed line-clamp-3">{c.summary}</p>
                  )}
                  {i < Math.min(g.complaints.length, 5) - 1 && (
                    <div className="border-b border-dark-border pb-2" />
                  )}
                </div>
              ))}
              {g.complaints.length > 5 && (
                <p className="text-white/25 text-xs">+{g.complaints.length - 5} more complaints in this category</p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Fluid Specs Panel ────────────────────────────────────────────────────────

function FluidSpecsPanel({ vehicle }: { vehicle: QWVehicle | null }) {
  const [loading, setLoading] = useState(false)
  const [specs,   setSpecs]   = useState<FluidSpecs | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!vehicle) return
    setLoading(true); setError(null); setSpecs(null)
    try {
      const res  = await fetch('/api/quickwrench/fluid-specs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ year: vehicle.year, make: vehicle.make, model: vehicle.model, engine: vehicle.engine }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load fluid specs')
      setSpecs(json.specs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load fluid specs')
    } finally {
      setLoading(false)
    }
  }, [vehicle])

  useEffect(() => { load() }, [load])

  if (!vehicle) return <NoVehicleNotice />
  if (loading)  return <LoadingSpinner />
  if (error)    return (
    <div className="space-y-3">
      <ErrorCard msg={error} />
      <button onClick={load} className="text-orange text-xs hover:underline">Try again</button>
    </div>
  )

  if (!specs) return null

  const rows: { label: string; value: string; icon: string }[] = [
    { label: 'Engine Oil',         value: specs.oil,            icon: '🛢️' },
    { label: 'Coolant / Antifreeze', value: specs.coolant,       icon: '🌡️' },
    { label: 'Transmission Fluid', value: specs.transmission,   icon: '⚙️' },
    { label: 'Brake Fluid',        value: specs.brake,          icon: '🔴' },
    { label: 'Power Steering',     value: specs.power_steering, icon: '🔧' },
  ]

  return (
    <div className="space-y-3">
      <div className="nwi-card border-blue/20 bg-blue/5">
        <p className="text-blue-light text-xs uppercase tracking-widest mb-3">
          OEM Fluid Specifications — {vehicle.year} {vehicle.make} {vehicle.model} {vehicle.engine}
        </p>
        <div className="divide-y divide-dark-border">
          {rows.map(r => (
            <div key={r.label} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-center gap-2">
                <span className="text-base leading-none">{r.icon}</span>
                <span className="text-white/60 text-sm">{r.label}</span>
              </div>
              <span className="font-condensed font-bold text-orange text-sm text-right">{r.value || '—'}</span>
            </div>
          ))}
        </div>
      </div>
      {specs.notes && (
        <div className="nwi-card border-white/10">
          <p className="text-white/40 text-[10px] uppercase tracking-widest mb-1">Notes</p>
          <p className="text-white/60 text-xs leading-relaxed">{specs.notes}</p>
        </div>
      )}
      <p className="text-white/20 text-[10px] leading-relaxed">
        AI-generated fluid specifications for reference only. Always verify against OEM service documentation.
      </p>
    </div>
  )
}

// ─── Main DiagnosticTools Component ──────────────────────────────────────────

const DIAG_TABS = [
  { id: 'dtc',    label: 'DTC Lookup',      short: 'DTC' },
  { id: 'recall', label: 'Recalls',         short: 'Recalls' },
  { id: 'tsb',    label: 'Complaints',       short: 'Complaints' },
  { id: 'fluids', label: 'Fluid Specs',     short: 'Fluids' },
]

export default function DiagnosticTools({ vehicle }: { vehicle: QWVehicle | null }) {
  const [activeTab, setActiveTab] = useState('dtc')

  return (
    <div className="space-y-4 pt-4 border-t border-dark-border mt-6">
      {/* Section header */}
      <div className="flex items-center gap-3">
        <svg className="w-4 h-4 text-orange flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <h3 className="font-condensed font-bold text-white text-base tracking-wide uppercase">Diagnostic Tools</h3>
        {vehicle && (
          <span className="text-white/30 text-xs ml-auto truncate max-w-[160px]">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </span>
        )}
      </div>

      {/* Tab row */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {DIAG_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`
              px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0
              ${activeTab === tab.id
                ? 'border-orange/60 bg-orange/15 text-orange'
                : 'border-dark-border text-white/50 hover:border-white/20 hover:text-white'}
            `}
          >
            <span className="sm:hidden">{tab.short}</span>
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div>
        {activeTab === 'dtc'    && <DTCPanel />}
        {activeTab === 'recall' && <RecallPanel vehicle={vehicle} />}
        {activeTab === 'tsb'    && <ComplaintsPanel vehicle={vehicle} />}
        {activeTab === 'fluids' && <FluidSpecsPanel vehicle={vehicle} />}
      </div>
    </div>
  )
}
