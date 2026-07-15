'use client'

import { useState, useEffect, useCallback } from 'react'
import type { QWVehicle } from '@/types/quickwrench'
import PartsOnTheWay, { type PartInput } from '@/components/parts-delivery/PartsOnTheWay'

// ─── Types ────────────────────────────────────────────────────────────────────

// Gemini-grounded structured diagnostic (same shape the Claude fallback returns).
// Rendered as colored severity cards, symptom pills, and collapsible sections.
interface DTCResult {
  code?:                 string
  name?:                 string
  category?:             string
  symptoms?:             string[]
  severity?:             string
  severity_description?: string
  common_causes?:        string[]
  related_codes?:        string[]
  diagnostic_order?:     string[]
  repair_steps?:         string[]
  suggested_repair?:     string
  parts_needed?:         string[]
  special_tools?:        string
  labor_estimate?:       string
  safety_warnings?:      string
  citations?:            string[]
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

interface TireSpecs {
  tire_size_front:         string | null
  tire_size_rear:          string | null
  lug_torque_lb_ft:        number | null
  bolt_pattern:            string | null
  tire_pressure_front_psi: number | null
  tire_pressure_rear_psi:  number | null
  load_speed_rating:       string | null
  wheel_size:              string | null
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

// Severity color, keyed on the lowercase severity string from the model.
function severityBadgeCls(level: string): string {
  switch (level.toLowerCase()) {
    case 'low':      return 'text-success'
    case 'moderate': return 'text-orange'
    case 'high':     return 'text-[#FF4500]'
    case 'critical': return 'text-danger'
    default:         return 'text-white/60'
  }
}

function SectionCard({
  title,
  defaultOpen = true,
  children,
}: {
  title:        string
  defaultOpen?: boolean
  children:     React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="nwi-card">
      <button
        className="w-full text-left flex items-center justify-between gap-3"
        onClick={() => setOpen(o => !o)}
      >
        <p className="text-white/40 text-xs uppercase tracking-widest">{title}</p>
        <svg
          className={`w-4 h-4 text-white/40 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}

// Payload handed to the parent when the tech pushes a DTC diagnosis into the quote.
export interface DTCJobPayload {
  code:            string
  name:            string
  suggestedRepair: string
  laborHours:      number
  parts:           string[]
  category:        string
}

// Gemini sometimes returns pre-numbered steps ("1. Do X"); strip the leading
// number so the <li> badge doesn't double it up ("1. 1. Do X").
function stripStepNumber(step: string): string {
  return step.trim().replace(/^(?:\d+\.\s+)+/, '').trim()
}

// Pull the first number out of a labor estimate ("3.0 - 5.0 hours..." → 3.0).
function parseLaborHours(laborEstimate: string): number {
  const m = laborEstimate.match(/\d+(?:\.\d+)?/)
  const n = m ? parseFloat(m[0]) : NaN
  return Number.isFinite(n) && n > 0 ? n : 1.5
}

// Map Gemini's free-text category to a JOB_CATEGORIES id in QuickWrenchClient.
// (Emissions/Fuel use the real catalog ids emissions_evap / fuel_system so the
// parent resolves the correct category label.)
function mapCategory(geminiCategory: string): string {
  const c = (geminiCategory || '').toLowerCase()
  if (c.includes('emission') || c.includes('catalyst') || c.includes('evap')) return 'emissions_evap'
  if (c.includes('fuel'))                                                      return 'fuel_system'
  if (c.includes('transmission'))                                             return 'transmission'
  if (c.includes('suspension') || c.includes('steering'))                     return 'suspension'
  if (c.includes('brake'))                                                    return 'brakes'
  if (c.includes('a/c') || c.includes('hvac') || c.includes('air condition') || c.includes('heat')) return 'ac_heating'
  if (c.includes('electric'))                                                 return 'electrical'
  if (c.includes('engine'))                                                   return 'engine'
  return 'diagnostics'
}

// Parse an AI parts_needed string into a structured part for delivery.
// e.g. "MAF Sensor — OEM Part# 22680-7S000 (Aftermarket: Denso 1234) Est. $80-$120"
function parsePartString(s: string): PartInput {
  let name = s
  const emIdx = s.indexOf('—')
  if (emIdx > 0) name = s.slice(0, emIdx)
  else { const oemIdx = s.search(/OEM/i); if (oemIdx > 0) name = s.slice(0, oemIdx) }
  const oemM = s.match(/OEM\s*Part\s*#?\s*:?\s*([A-Za-z0-9][A-Za-z0-9\-]{2,})/i)
  const aftM = s.match(/Aftermarket:\s*([^)]+)/i)
  return {
    name:        name.trim() || s,
    oem:         oemM ? oemM[1].trim() : '',
    aftermarket: aftM ? aftM[1].trim().replace(/\)+$/, '').trim() : undefined,
  }
}

function DTCPanel({ vehicle, onAddDTCJob }: {
  vehicle:      QWVehicle | null
  onAddDTCJob?: (job: DTCJobPayload) => void
}) {
  const [showDelivery, setShowDelivery] = useState(false)
  const [input,          setInput]          = useState('')
  const [displayMessage, setDisplayMessage] = useState('')
  const [loading,        setLoading]        = useState(false)
  const [result,         setResult]         = useState<DTCResult | null>(null)
  const [cached,         setCached]         = useState(false)
  const [error,          setError]          = useState<string | null>(null)

  async function lookup(overrideCode?: string) {
    const code    = (overrideCode ?? input).trim().toUpperCase()
    const display = displayMessage.trim()
    const validCode = /^[PBCU][0-9]{4}$/.test(code)

    // Code optional: allow a symptom/description instead. Only block when there's
    // nothing to go on (no code + no description).
    if (!code && !display) {
      setError('Enter a DTC code or describe the issue below')
      return
    }
    if (code && !validCode && !display) {
      setError('Enter a valid DTC code (e.g. P0420) or describe the issue below')
      return
    }

    setLoading(true); setError(null); setResult(null)
    try {
      let json: { error?: string; result?: DTCResult; cached?: boolean }
      if (validCode) {
        // Existing DTC flow — unchanged.
        setInput(code)
        const qs = new URLSearchParams()
        if (vehicle?.year)   qs.set('year',   vehicle.year)
        if (vehicle?.make)   qs.set('make',   vehicle.make)
        if (vehicle?.model)  qs.set('model',  vehicle.model)
        if (vehicle?.engine) qs.set('engine', vehicle.engine)
        if (display)         qs.set('display', display)
        const qStr = qs.toString()
        const res  = await fetch(`/api/quickwrench/dtc/${code}${qStr ? `?${qStr}` : ''}`)
        json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Lookup failed')
      } else {
        // Symptom-only flow — describe the issue, no code required.
        const res = await fetch('/api/quickwrench/diagnose', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayMessage: display,
            symptom:        display,
            year:   vehicle?.year   ?? '',
            make:   vehicle?.make   ?? '',
            model:  vehicle?.model  ?? '',
            engine: vehicle?.engine ?? '',
          }),
        })
        json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Diagnosis failed')
      }
      setResult((json.result ?? null) as DTCResult | null)
      setCached(json.cached === true)
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
          placeholder="DTC code (optional — e.g. P0420)"
          maxLength={6}
          value={input}
          onChange={e => { setInput(e.target.value.toUpperCase()); setError(null) }}
          onKeyDown={e => e.key === 'Enter' && lookup()}
        />
        <button
          onClick={() => lookup()}
          disabled={loading}
          className="px-5 py-2 bg-orange hover:bg-orange-hover disabled:opacity-40 text-white font-condensed font-bold text-sm rounded-lg transition-colors whitespace-nowrap"
        >
          {loading ? (input.trim() ? 'Looking up…' : 'Diagnosing…') : input.trim() ? 'Look Up Code' : 'Diagnose'}
        </button>
      </div>

      {/* Display Message (optional) — anchors Gemini to the exact fault description */}
      <input
        className="nwi-input w-full"
        placeholder="What does your scanner or display show?"
        value={displayMessage}
        onChange={e => setDisplayMessage(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && lookup()}
      />

      {error && <p className="text-danger text-xs">{error}</p>}

      {loading && <LoadingSpinner />}

      {result && !loading && (
        <div className="space-y-3">
          {/* Safety warnings — always first, safety-first (like HD) */}
          {result.safety_warnings && result.safety_warnings.trim() && !/^none\b/i.test(result.safety_warnings.trim()) && (
            <div className="nwi-card border-orange/50 bg-orange/10">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-orange flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <div>
                  <p className="text-orange font-condensed font-bold text-sm tracking-wide uppercase mb-1">Safety Warning</p>
                  <p className="text-white/80 text-sm leading-relaxed">{result.safety_warnings}</p>
                </div>
              </div>
            </div>
          )}

          {/* Top card — a symptom diagnosis (NO-CODE) shows the summary in place of the code chip */}
          <div className="nwi-card border-orange/30 bg-orange/5">
            <div className="flex items-start justify-between gap-3 mb-2">
              <span className="font-condensed font-bold text-orange text-xl tracking-wide">
                {result.code === 'NO-CODE' ? (result.name || 'Symptom Diagnosis') : (result.code || input || '—')}
              </span>
              <div className="flex items-center gap-2 flex-shrink-0">
                {cached && (
                  <span className="bg-blue/15 border border-blue/30 text-blue-light text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap">
                    Cached
                  </span>
                )}
                {result.code === 'NO-CODE' ? (
                  <span className="bg-blue/15 border border-blue/30 text-blue-light text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap">
                    Symptom Diagnosis
                  </span>
                ) : result.category && (
                  <span className="bg-blue/15 border border-blue/30 text-blue-light text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide whitespace-nowrap">
                    {result.category}
                  </span>
                )}
              </div>
            </div>
            {result.code !== 'NO-CODE' && result.name && <p className="text-white font-medium text-sm leading-relaxed">{result.name}</p>}
          </div>

          {(result.symptoms?.length ?? 0) > 0 && (
            <SectionCard title="Symptoms" defaultOpen={true}>
              <ul className="space-y-1.5">
                {result.symptoms!.map((s, i) => (
                  <li key={i} className="flex gap-2 text-white/70 text-sm">
                    <span className="text-orange flex-shrink-0 mt-0.5">•</span>
                    {s}
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {(result.severity || result.severity_description || result.labor_estimate) && (
            <SectionCard title="Severity" defaultOpen={true}>
              <div className="space-y-2">
                {result.severity && (
                  <span className={`font-condensed font-bold text-lg uppercase ${severityBadgeCls(result.severity)}`}>
                    {result.severity}
                  </span>
                )}
                {result.severity_description && (
                  <p className="text-white/60 text-xs italic leading-relaxed">{result.severity_description}</p>
                )}
                {result.labor_estimate && (
                  <p className="text-white/60 text-xs leading-relaxed">
                    <span className="text-white/40 uppercase tracking-widest text-[10px]">Labor estimate:</span> {result.labor_estimate}
                  </p>
                )}
              </div>
            </SectionCard>
          )}

          {(result.common_causes?.length ?? 0) > 0 && (
            <SectionCard title="Common Causes" defaultOpen={true}>
              <ul className="space-y-1.5">
                {result.common_causes!.map((c, i) => (
                  <li key={i} className="flex gap-2 text-white/70 text-sm">
                    <span className="text-orange flex-shrink-0 mt-0.5">•</span>
                    {c}
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {(result.related_codes?.length ?? 0) > 0 && (
            <SectionCard title="Related Codes" defaultOpen={false}>
              <div className="flex flex-wrap gap-2">
                {result.related_codes!.map(rc => (
                  <button
                    key={rc}
                    onClick={() => lookup(rc)}
                    className="px-3 py-1.5 bg-dark-lighter border border-dark-border hover:border-orange/40 hover:bg-orange/10 text-white/70 hover:text-orange font-mono text-xs rounded-lg transition-colors"
                  >
                    {rc}
                  </button>
                ))}
              </div>
            </SectionCard>
          )}

          {(result.diagnostic_order?.length ?? 0) > 0 && (
            <SectionCard title="Diagnostic Order" defaultOpen={false}>
              <ol className="space-y-2.5">
                {result.diagnostic_order!.map((step, i) => (
                  <li key={i} className="flex gap-3 text-white/70 text-sm">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue/15 border border-blue/30 flex items-center justify-center font-condensed font-bold text-blue-light text-xs">
                      {i + 1}
                    </span>
                    <span className="pt-0.5 leading-relaxed">{stripStepNumber(step)}</span>
                  </li>
                ))}
              </ol>
            </SectionCard>
          )}

          {(result.repair_steps?.length ?? 0) > 0 && (
            <SectionCard title="Repair Procedure" defaultOpen={false}>
              <ol className="space-y-2.5">
                {result.repair_steps!.map((step, i) => (
                  <li key={i} className="flex gap-3 text-white/70 text-sm">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center font-condensed font-bold text-white text-xs" style={{ background: '#FF6600' }}>
                      {i + 1}
                    </span>
                    <span className="pt-0.5 leading-relaxed">{stripStepNumber(step)}</span>
                  </li>
                ))}
              </ol>
            </SectionCard>
          )}

          {(result.parts_needed?.length ?? 0) > 0 && (
            <SectionCard title="Parts Needed" defaultOpen={false}>
              <ul className="space-y-1.5">
                {result.parts_needed!.map((p, i) => (
                  <li key={i} className="flex gap-2 text-white/70 text-sm">
                    <span className="text-orange flex-shrink-0 mt-0.5">•</span>
                    {p}
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          {result.special_tools && result.special_tools.trim() && (
            <SectionCard title="Special Tools" defaultOpen={false}>
              <p className="text-white/70 text-sm leading-relaxed">{result.special_tools}</p>
            </SectionCard>
          )}

          {result.suggested_repair && (
            <SectionCard title="Suggested Repair" defaultOpen={true}>
              <p className="text-white/80 text-sm leading-relaxed">{result.suggested_repair}</p>
            </SectionCard>
          )}

          {onAddDTCJob && (
            <button
              onClick={() => onAddDTCJob({
                code:            result.code || input,
                name:            result.name || result.code || input,
                suggestedRepair: result.suggested_repair || '',
                laborHours:      parseLaborHours(result.labor_estimate || ''),
                parts:           result.parts_needed || [],
                category:        mapCategory(result.category || ''),
              })}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors min-h-[48px]"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add to Quote
            </button>
          )}

          {/* Parts on the Way — delivery dispatch */}
          <button
            onClick={() => setShowDelivery(true)}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors min-h-[48px]"
            style={{ background: '#2969B0' }}
          >
            <span>🚚</span> Get Parts Delivered
          </button>

          {result.citations && result.citations.length > 0 && (
            <SectionCard title="Sources" defaultOpen={false}>
              <ul className="space-y-1.5">
                {result.citations.map((url, i) => (
                  <li key={i} className="truncate">
                    <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-light hover:text-orange text-xs underline break-all">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          <p className="text-white/20 text-[10px] leading-relaxed">
            AI-generated diagnostic information for reference only. Always verify with OEM service documentation. National Wrench Index assumes no liability for diagnostic accuracy.
          </p>
        </div>
      )}

      {showDelivery && result && (
        <PartsOnTheWay
          suite="ld"
          parts={(result.parts_needed ?? []).map(parsePartString)}
          vehicleInfo={{
            year:   vehicle?.year,
            make:   vehicle?.make,
            model:  vehicle?.model,
            engine: vehicle?.engine,
            trim:   vehicle?.trim,
            vin:    vehicle?.vin,
          }}
          techPhone=""
          onClose={() => setShowDelivery(false)}
          onDeliveryDispatched={() => { /* tech sees tracking in-modal */ }}
        />
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
          <p className="text-success font-semibold text-sm">No Known Issues on Record</p>
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

// ─── Tire Specs Panel ─────────────────────────────────────────────────────────

const TIRE_CACHE_PREFIX = 'nwi_tire_specs_v1_'
const NULL_VALUE        = 'Not specified — refer to door jamb sticker'

type SpecRow = { label: string; value: string | null; note?: string }

function TireSpecsPanel({
  vehicle,
  onFindTires,
}: {
  vehicle:      QWVehicle | null
  onFindTires?: (sizes: { front: string | null; rear: string | null }) => void
}) {
  const [loading, setLoading] = useState(false)
  const [specs,   setSpecs]   = useState<TireSpecs | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!vehicle) return
    setLoading(true); setError(null); setSpecs(null)

    try {
      const cached = localStorage.getItem(TIRE_CACHE_PREFIX + vehicle.vin)
      if (cached) {
        setSpecs(JSON.parse(cached))
        setLoading(false)
        return
      }
    } catch { /* ignore storage errors */ }

    try {
      const res  = await fetch('/api/quickwrench/tire-specs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          year:   vehicle.year,
          make:   vehicle.make,
          model:  vehicle.model,
          trim:   vehicle.trim,
          engine: vehicle.engine,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load tire specs')
      setSpecs(json.specs)
      try {
        localStorage.setItem(TIRE_CACHE_PREFIX + vehicle.vin, JSON.stringify(json.specs))
      } catch { /* ignore storage errors */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tire specs')
    } finally {
      setLoading(false)
    }
  }, [vehicle])

  useEffect(() => { load() }, [load])

  if (!vehicle) return (
    <div className="nwi-card border-white/10 text-center py-8">
      <p className="text-white/40 text-sm">Decode a VIN first to see tire specifications.</p>
    </div>
  )
  if (loading) return <LoadingSpinner />
  if (error) return (
    <div className="space-y-3">
      <div className="nwi-card border-danger/30 bg-danger/5">
        <p className="text-danger text-sm">Unable to load tire specs right now. Please try again or refer to the vehicle&apos;s door jamb sticker.</p>
      </div>
      <button onClick={load} className="text-orange text-xs hover:underline">Try Again</button>
    </div>
  )
  if (!specs) return null

  const sameTire = !specs.tire_size_rear || specs.tire_size_front === specs.tire_size_rear
  const samePsi  = !specs.tire_pressure_rear_psi || specs.tire_pressure_front_psi === specs.tire_pressure_rear_psi

  const rows: SpecRow[] = [
    ...(sameTire
      ? [{ label: 'Factory Tire Size', value: specs.tire_size_front }]
      : [
          { label: 'Factory Tire Size (Front)', value: specs.tire_size_front },
          { label: 'Factory Tire Size (Rear)',  value: specs.tire_size_rear  },
        ]
    ),
    {
      label: 'Lug Nut Torque',
      value: specs.lug_torque_lb_ft != null ? `${specs.lug_torque_lb_ft} lb-ft` : null,
      note:  'Tighten in star pattern. Re-check after 50 miles.',
    },
    { label: 'Bolt Pattern', value: specs.bolt_pattern },
    {
      label: 'Recommended Pressure (Cold)',
      value: specs.tire_pressure_front_psi != null
        ? samePsi
          ? `${specs.tire_pressure_front_psi} PSI`
          : `${specs.tire_pressure_front_psi} PSI front / ${specs.tire_pressure_rear_psi} PSI rear`
        : null,
    },
    { label: 'Load/Speed Rating', value: specs.load_speed_rating },
    { label: 'Wheel Size',        value: specs.wheel_size ? `${specs.wheel_size} inches` : null },
  ]

  return (
    <div className="space-y-4">
      <div className="nwi-card border-blue/20 bg-blue/5">
        <p className="text-blue-light text-xs uppercase tracking-widest mb-4">
          OEM Tire Specifications — {vehicle.year} {vehicle.make} {vehicle.model}{vehicle.trim ? ` ${vehicle.trim}` : ''} {vehicle.engine}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {rows.map(row => (
            <div key={row.label} className="rounded-lg border border-dark-border bg-[#242424] p-3">
              <p className="text-[#999] text-xs mb-1">{row.label}</p>
              {row.value != null ? (
                <>
                  <p className="font-condensed font-bold text-white text-base">{row.value}</p>
                  {row.note && (
                    <p className="text-white/30 text-[10px] mt-1 leading-relaxed">{row.note}</p>
                  )}
                </>
              ) : (
                <p className="text-white/30 text-xs italic">{NULL_VALUE}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {onFindTires && (
        <button
          onClick={() => onFindTires({ front: specs.tire_size_front, rear: specs.tire_size_rear })}
          className="flex items-center justify-center gap-2 px-5 py-3 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors min-h-[48px] w-full sm:w-auto"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
          </svg>
          Find Tires for This Vehicle
        </button>
      )}

      <p className="text-white/25 text-[10px] italic leading-relaxed">
        AI-generated specifications for reference only. Always verify against OEM documentation or the vehicle&apos;s door jamb sticker before installation. Tire and wheel specifications can vary by trim level, option package, and production year. National Wrench Index assumes no liability for inaccuracies.
      </p>
    </div>
  )
}

// ─── Main DiagnosticTools Component ──────────────────────────────────────────

const DIAG_TABS = [
  { id: 'dtc',    label: 'DTC Lookup',  short: 'DTC'    },
  { id: 'recall', label: 'Recalls',     short: 'Recalls' },
  { id: 'tsb',    label: 'Known Issues', short: 'Issues' },
  { id: 'fluids', label: 'Fluid Specs', short: 'Fluids' },
  { id: 'tires',  label: 'Tire Specs',  short: 'Tires'  },
]

export default function DiagnosticTools({
  vehicle,
  onFindTires,
  onAddDTCJob,
}: {
  vehicle:      QWVehicle | null
  onFindTires?: (sizes: { front: string | null; rear: string | null }) => void
  onAddDTCJob?: (job: DTCJobPayload) => void
}) {
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

      {/* Panel subtitle */}
      {activeTab === 'tsb' && (
        <div>
          <p className="font-condensed font-bold text-white text-sm tracking-wide">Known Issues</p>
          <p className="text-white/40 text-xs italic mt-0.5">Common problems reported by owners of this vehicle.</p>
        </div>
      )}

      {/* Panel content */}
      <div>
        {activeTab === 'dtc'    && <DTCPanel vehicle={vehicle} onAddDTCJob={onAddDTCJob} />}
        {activeTab === 'recall' && <RecallPanel vehicle={vehicle} />}
        {activeTab === 'tsb'    && <ComplaintsPanel vehicle={vehicle} />}
        {activeTab === 'fluids' && <FluidSpecsPanel vehicle={vehicle} />}
        {activeTab === 'tires'  && <TireSpecsPanel vehicle={vehicle} onFindTires={onFindTires} />}
      </div>
    </div>
  )
}
