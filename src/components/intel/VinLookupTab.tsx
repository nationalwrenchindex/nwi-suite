'use client'

import { useState } from 'react'
import type { VinResult, NHTSARecall } from '@/types/intel'

// ─── Spec row ─────────────────────────────────────────────────────────────────

function SpecRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-dark-border last:border-0">
      <span className="text-white/40 text-xs uppercase tracking-widest shrink-0">{label}</span>
      <span className="text-white text-sm text-right">{value}</span>
    </div>
  )
}

// ─── Recall card ─────────────────────────────────────────────────────────────

function RecallCard({ recall }: { recall: NHTSARecall }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-danger/30 bg-danger/5 rounded-xl p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-white font-medium text-sm">{recall.Component}</p>
          <p className="text-white/40 text-xs mt-0.5">
            Campaign #{recall.NHTSACampaignNumber} &middot; {recall.ReportReceivedDate}
          </p>
        </div>
        <span className="shrink-0 px-2 py-0.5 rounded-full bg-danger/20 text-danger text-xs font-bold">RECALL</span>
      </div>

      {expanded && (
        <div className="space-y-2 pt-1">
          {recall.Summary && (
            <div>
              <p className="text-white/30 text-xs uppercase tracking-widest mb-0.5">Summary</p>
              <p className="text-white/70 text-sm leading-relaxed">{recall.Summary}</p>
            </div>
          )}
          {recall.Consequence && (
            <div>
              <p className="text-white/30 text-xs uppercase tracking-widest mb-0.5">Consequence</p>
              <p className="text-white/70 text-sm leading-relaxed">{recall.Consequence}</p>
            </div>
          )}
          {recall.Remedy && (
            <div>
              <p className="text-white/30 text-xs uppercase tracking-widest mb-0.5">Remedy</p>
              <p className="text-white/70 text-sm leading-relaxed">{recall.Remedy}</p>
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => setExpanded(v => !v)}
        className="text-orange text-xs hover:underline"
      >
        {expanded ? 'Show less ↑' : 'Show details ↓'}
      </button>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function VinLookupTab() {
  const [vin,     setVin]     = useState('')
  const [result,  setResult]  = useState<VinResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = vin.trim().toUpperCase()
    if (trimmed.length !== 17) {
      setError('VIN must be exactly 17 characters.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res  = await fetch(`/api/vin/${trimmed}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Lookup failed')
      setResult(json.result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const s = result?.specs

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Search form */}
      <form onSubmit={handleLookup} className="flex gap-3">
        <input
          className="nwi-input flex-1 font-mono uppercase tracking-widest"
          placeholder="Enter 17-character VIN"
          value={vin}
          maxLength={17}
          onChange={e => { setVin(e.target.value.toUpperCase()); setError(null) }}
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={loading || vin.trim().length === 0}
          className="px-5 py-3 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors whitespace-nowrap"
        >
          {loading ? 'Looking up…' : 'Decode VIN'}
        </button>
      </form>

      {error && <div className="alert-error">{error}</div>}

      {/* Results */}
      {result && s && (
        <div className="space-y-5">
          {/* Vehicle header */}
          <div className="nwi-card">
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="font-condensed font-bold text-2xl text-white tracking-wide">
                  {s.year} {s.make} {s.model}
                  {s.trim && <span className="text-white/50 font-normal ml-2 text-xl">{s.trim}</span>}
                </h2>
                <p className="text-white/40 text-sm font-mono mt-0.5">{result.vin}</p>
              </div>
              {result.hasOpenRecalls && (
                <span className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-danger/15 text-danger text-xs font-bold border border-danger/30">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  {result.recallCount} Open Recall{result.recallCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Specs grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
              <div>
                <SpecRow label="Body Class"     value={s.bodyClass} />
                <SpecRow label="Vehicle Type"   value={s.vehicleType} />
                <SpecRow label="Drive Type"     value={s.driveType} />
                <SpecRow label="Fuel Type"      value={s.fuelType} />
              </div>
              <div>
                <SpecRow label="Engine"         value={s.engineCylinders ? `${s.engineCylinders}-cyl ${s.displacementL ? s.displacementL + 'L' : ''}`.trim() : s.displacementL} />
                <SpecRow label="Transmission"   value={s.transmissionStyle} />
                <SpecRow label="Plant Country"  value={s.plantCountry} />
              </div>
            </div>
          </div>

          {/* Recalls */}
          {result.hasOpenRecalls ? (
            <div>
              <h3 className="font-condensed font-bold text-lg text-white tracking-wide mb-3">
                Open Recalls ({result.recallCount})
              </h3>
              <div className="space-y-3">
                {result.recalls.map((r, i) => (
                  <RecallCard key={i} recall={r} />
                ))}
              </div>
            </div>
          ) : (
            <div className="nwi-card flex items-center gap-3 border-success/30 bg-success/5">
              <svg className="w-5 h-5 text-success shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <p className="text-success text-sm font-medium">No open recalls found for this vehicle.</p>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="text-center py-10">
          <svg className="w-12 h-12 text-white/10 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            <circle cx="12" cy="16" r="1" fill="currentColor"/>
          </svg>
          <p className="text-white/30 text-sm">Enter a VIN to decode vehicle specs and check NHTSA recalls.</p>
        </div>
      )}
    </div>
  )
}
