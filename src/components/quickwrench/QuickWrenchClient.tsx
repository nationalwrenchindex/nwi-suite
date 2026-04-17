'use client'

import { useState, useEffect, useCallback } from 'react'
import type {
  QWVehicle,
  SelectedJob,
  TechGuide,
  PartWithSuppliers,
  Supplier,
} from '@/types/quickwrench'

// ─── Job catalog ──────────────────────────────────────────────────────────────

const JOB_CATEGORIES = [
  {
    id: 'oil_fluids', label: 'Oil & Fluids', color: 'orange',
    jobs: [
      { name: 'Oil & Filter Change',            hours: 0.5  },
      { name: 'Transmission Fluid Service',     hours: 1.0  },
      { name: 'Coolant Flush & Fill',           hours: 1.5  },
      { name: 'Brake Fluid Flush',              hours: 1.0  },
      { name: 'Power Steering Fluid Flush',     hours: 0.75 },
      { name: 'Differential Fluid Service',     hours: 1.0  },
    ],
  },
  {
    id: 'brakes', label: 'Brakes', color: 'red',
    jobs: [
      { name: 'Front Brake Pad Replacement',         hours: 1.5 },
      { name: 'Rear Brake Pad Replacement',          hours: 1.5 },
      { name: 'Brake Rotor Replacement — Front',     hours: 2.0 },
      { name: 'Brake Rotor Replacement — Rear',      hours: 2.0 },
      { name: 'Brake Caliper Replacement',           hours: 2.5 },
      { name: 'Full Brake Service (Pads & Rotors)',  hours: 3.5 },
    ],
  },
  {
    id: 'tires_wheels', label: 'Tires & Wheels', color: 'blue',
    jobs: [
      { name: 'Tire Rotation',              hours: 0.5  },
      { name: 'Tire Replacement (1 tire)',  hours: 0.75 },
      { name: 'Tire Replacement (4 tires)', hours: 2.0  },
      { name: 'Wheel Balancing (4 wheels)', hours: 1.0  },
      { name: 'TPMS Sensor Replacement',   hours: 1.0  },
      { name: 'Spare Tire Installation',   hours: 0.5  },
    ],
  },
  {
    id: 'electrical', label: 'Electrical', color: 'yellow',
    jobs: [
      { name: 'Battery Replacement',            hours: 0.75 },
      { name: 'Alternator Replacement',         hours: 2.5  },
      { name: 'Starter Motor Replacement',      hours: 2.0  },
      { name: 'Spark Plug Replacement',         hours: 1.5  },
      { name: 'Ignition Coil Replacement',      hours: 1.0  },
      { name: 'Headlight Bulb Replacement',     hours: 0.5  },
    ],
  },
  {
    id: 'engine', label: 'Engine', color: 'orange',
    jobs: [
      { name: 'Air Filter Replacement',         hours: 0.5  },
      { name: 'Cabin Air Filter Replacement',   hours: 0.5  },
      { name: 'Serpentine Belt Replacement',    hours: 1.5  },
      { name: 'Timing Belt Replacement',        hours: 5.0  },
      { name: 'Valve Cover Gasket Replacement', hours: 2.5  },
      { name: 'Oxygen Sensor Replacement',      hours: 1.5  },
    ],
  },
  {
    id: 'suspension', label: 'Suspension', color: 'blue',
    jobs: [
      { name: 'Shock / Strut Replacement (each)',    hours: 1.5 },
      { name: 'Front Strut Assembly Replacement',    hours: 3.0 },
      { name: 'Control Arm Replacement',             hours: 2.5 },
      { name: 'Tie Rod End Replacement',             hours: 2.0 },
      { name: 'Ball Joint Replacement',              hours: 3.0 },
      { name: 'Sway Bar Link Replacement',           hours: 1.0 },
    ],
  },
  {
    id: 'cooling', label: 'Cooling System', color: 'blue',
    jobs: [
      { name: 'Thermostat Replacement',         hours: 1.5 },
      { name: 'Water Pump Replacement',         hours: 3.5 },
      { name: 'Radiator Replacement',           hours: 3.0 },
      { name: 'Radiator Hose Replacement',      hours: 1.5 },
      { name: 'Cooling Fan Replacement',        hours: 2.0 },
      { name: 'Heater Core Replacement',        hours: 6.0 },
    ],
  },
  {
    id: 'transmission', label: 'Transmission', color: 'orange',
    jobs: [
      { name: 'Transmission Fluid & Filter Service', hours: 1.5 },
      { name: 'Transmission Mount Replacement',      hours: 2.0 },
      { name: 'Shift Cable Replacement',             hours: 2.5 },
      { name: 'CV Axle Shaft Replacement',           hours: 2.5 },
      { name: 'CV Boot Replacement',                 hours: 2.0 },
      { name: 'Clutch Replacement (Manual)',         hours: 6.0 },
    ],
  },
  {
    id: 'diagnostics', label: 'Diagnostics', color: 'green',
    jobs: [
      { name: 'OBD-II Diagnostic Scan',         hours: 0.5  },
      { name: 'Check Engine Light Diagnosis',   hours: 1.5  },
      { name: 'No-Start Diagnosis',             hours: 2.0  },
      { name: 'Noise / Vibration Diagnosis',    hours: 1.5  },
      { name: 'Electrical System Diagnosis',    hours: 2.0  },
      { name: 'Pre-Purchase Inspection',        hours: 1.5  },
    ],
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

function supplierPrices(estimate: number) {
  const seed = estimate
  return {
    price_autozone:  Math.round(seed * 1.06 * 100) / 100,
    price_orielly:   Math.round(seed * 1.02 * 100) / 100,
    price_napa:      Math.round(seed * 1.10 * 100) / 100,
    price_rockauto:  Math.round(seed * 0.76 * 100) / 100,
  }
}

function enrichParts(raw: TechGuide['parts_needed']): PartWithSuppliers[] {
  return raw.map((p, i) => ({
    ...p,
    id:               `part-${i}-${p.name.slice(0, 8).replace(/\s/g, '')}`,
    included:         true,
    selected_supplier: 'orielly' as Supplier,
    custom_price:     p.price_estimate,
    ...supplierPrices(p.price_estimate),
  }))
}

function partPrice(p: PartWithSuppliers): number {
  switch (p.selected_supplier) {
    case 'autozone': return p.price_autozone
    case 'orielly':  return p.price_orielly
    case 'napa':     return p.price_napa
    case 'rockauto': return p.price_rockauto
    case 'custom':   return p.custom_price
  }
}

// ─── Category icons ───────────────────────────────────────────────────────────

function CategoryIcon({ id, className }: { id: string; className?: string }) {
  const cls = className ?? 'w-6 h-6'
  switch (id) {
    case 'oil_fluids':    return <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><path d="M7 20a4 4 0 0 0 4-4V8l-4-4H5a2 2 0 0 0-2 2v10a4 4 0 0 0 4 4z"/><path d="M19 12V7l-5-5"/><path d="M14 2v6h6"/></svg>
    case 'brakes':        return <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/><line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/><line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/><line x1="4.93" y1="19.07" x2="9.17" y2="14.83"/></svg>
    case 'tires_wheels':  return <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
    case 'electrical':    return <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
    case 'engine':        return <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
    case 'suspension':    return <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><path d="M2 12h20M12 2v20M2 7h20M2 17h20"/></svg>
    case 'cooling':       return <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/><circle cx="12" cy="12" r="4"/></svg>
    case 'transmission':  return <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 12h10M19 7v10"/></svg>
    case 'diagnostics':   return <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
    default:              return <svg className={cls} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>
  }
}

// ─── Tab 1: Vehicle ───────────────────────────────────────────────────────────

function VehicleTab({
  vehicle,
  onVehicleSet,
  onNext,
}: {
  vehicle:      QWVehicle | null
  onVehicleSet: (v: QWVehicle) => void
  onNext:       () => void
}) {
  const [vin,          setVin]          = useState(vehicle?.vin ?? '')
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [manual,       setManual]       = useState(false)
  const [manYear,      setManYear]      = useState(vehicle?.year  ?? '')
  const [manMake,      setManMake]      = useState(vehicle?.make  ?? '')
  const [manModel,     setManModel]     = useState(vehicle?.model ?? '')
  const [manEngine,    setManEngine]    = useState(vehicle?.engine ?? '')
  const [recentVehicles, setRecentVehicles] = useState<{ id: string; year: number | null; make: string; model: string; vin: string | null }[]>([])

  useEffect(() => {
    fetch('/api/vehicles?limit=6')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.vehicles) setRecentVehicles(d.vehicles) })
      .catch(() => {})
  }, [])

  async function decodeVin() {
    const v = vin.trim().toUpperCase()
    if (v.length !== 17) { setError('VIN must be exactly 17 characters.'); return }
    setLoading(true); setError(null)
    try {
      const res  = await fetch(`/api/quickwrench/vin/${v}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Decode failed')
      onVehicleSet(json.vehicle)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  function applyManual() {
    if (!manYear || !manMake || !manModel) { setError('Year, make and model are required.'); return }
    setError(null)
    onVehicleSet({ vin: '', year: manYear, make: manMake, model: manModel, engine: manEngine || 'N/A' })
  }

  return (
    <div className="space-y-6">
      {/* VIN Entry */}
      {!manual && (
        <div className="nwi-card">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Enter VIN</p>
          <div className="flex gap-2">
            <input
              className="nwi-input flex-1 font-mono tracking-widest uppercase"
              placeholder="17-character VIN"
              maxLength={17}
              value={vin}
              onChange={e => setVin(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && decodeVin()}
            />
            <button
              onClick={decodeVin}
              disabled={loading || vin.length !== 17}
              className="px-4 py-2 bg-orange hover:bg-orange-hover disabled:opacity-40 text-white font-condensed font-bold text-sm rounded-lg transition-colors whitespace-nowrap"
            >
              {loading ? 'Decoding…' : 'Decode'}
            </button>
          </div>
          {error && <p className="text-danger text-xs mt-2">{error}</p>}
          <button
            onClick={() => { setManual(true); setError(null) }}
            className="mt-3 text-white/30 text-xs hover:text-orange transition-colors"
          >
            Enter manually instead →
          </button>
        </div>
      )}

      {/* Manual entry */}
      {manual && (
        <div className="nwi-card border-orange/20">
          <div className="flex items-center justify-between mb-3">
            <p className="text-white/40 text-xs uppercase tracking-widest">Manual Entry</p>
            <button onClick={() => setManual(false)} className="text-white/30 text-xs hover:text-orange transition-colors">
              ← Use VIN
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="nwi-label">Year</label>
              <input className="nwi-input" placeholder="2019" value={manYear} onChange={e => setManYear(e.target.value)} />
            </div>
            <div>
              <label className="nwi-label">Make</label>
              <input className="nwi-input" placeholder="Ford" value={manMake} onChange={e => setManMake(e.target.value)} />
            </div>
            <div>
              <label className="nwi-label">Model</label>
              <input className="nwi-input" placeholder="F-150" value={manModel} onChange={e => setManModel(e.target.value)} />
            </div>
            <div>
              <label className="nwi-label">Engine <span className="normal-case text-white/20">(opt)</span></label>
              <input className="nwi-input" placeholder="5.0L V8" value={manEngine} onChange={e => setManEngine(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-danger text-xs mt-2">{error}</p>}
          <button
            onClick={applyManual}
            className="mt-4 px-5 py-2 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-lg transition-colors"
          >
            Set Vehicle
          </button>
        </div>
      )}

      {/* Decoded vehicle display */}
      {vehicle && (
        <div className="nwi-card border-orange/40 bg-orange/5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-condensed font-bold text-2xl text-white tracking-wide">
                {vehicle.year} {vehicle.make} {vehicle.model}
              </p>
              <p className="text-orange text-sm font-medium mt-0.5">{vehicle.engine}</p>
              {vehicle.trim        && <p className="text-white/40 text-xs mt-1">Trim: {vehicle.trim}</p>}
              {vehicle.driveType   && <p className="text-white/30 text-xs">Drive: {vehicle.driveType}</p>}
              {vehicle.transmissionStyle && <p className="text-white/30 text-xs">Trans: {vehicle.transmissionStyle}</p>}
              {vehicle.vin         && <p className="text-white/20 text-xs mt-1 font-mono">VIN: {vehicle.vin}</p>}
            </div>
            <button
              onClick={onNext}
              className="px-5 py-2.5 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors whitespace-nowrap flex-shrink-0"
            >
              Select Job →
            </button>
          </div>
        </div>
      )}

      {/* Recent vehicles from Intel Hub */}
      {recentVehicles.length > 0 && (
        <div>
          <p className="text-white/30 text-xs uppercase tracking-widest mb-2">Recent Vehicles from Intel Hub</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {recentVehicles.map(v => (
              <button
                key={v.id}
                onClick={() => onVehicleSet({
                  vin:    v.vin ?? '',
                  year:   String(v.year ?? ''),
                  make:   v.make,
                  model:  v.model,
                  engine: 'N/A',
                })}
                className="nwi-card text-left hover:border-orange/40 hover:bg-orange/5 transition-colors p-3"
              >
                <p className="text-white text-sm font-medium truncate">
                  {[v.year, v.make, v.model].filter(Boolean).join(' ')}
                </p>
                {v.vin && <p className="text-white/25 text-[10px] font-mono truncate">{v.vin}</p>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab 2: Job Type ─────────────────────────────────────────────────────────

function JobTypeTab({
  selectedJob,
  onJobSelect,
  onNext,
}: {
  selectedJob: SelectedJob | null
  onJobSelect: (j: SelectedJob) => void
  onNext:      () => void
}) {
  const [activeCat, setActiveCat] = useState<string | null>(
    selectedJob?.category ?? null,
  )

  const cat = JOB_CATEGORIES.find(c => c.id === activeCat) ?? null

  return (
    <div className="space-y-4">
      {/* Category grid */}
      <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-9 gap-2">
        {JOB_CATEGORIES.map(c => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className={`
              flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-colors text-center
              ${activeCat === c.id
                ? 'border-orange/60 bg-orange/10 text-orange'
                : 'border-dark-border bg-dark-card text-white/50 hover:border-white/20 hover:text-white'}
            `}
          >
            <CategoryIcon id={c.id} className="w-5 h-5" />
            <span className="text-[10px] font-medium leading-tight">{c.label}</span>
          </button>
        ))}
      </div>

      {/* Job list for selected category */}
      {cat && (
        <div className="nwi-card">
          <div className="flex items-center gap-2 mb-3">
            <CategoryIcon id={cat.id} className="w-4 h-4 text-orange" />
            <p className="font-condensed font-bold text-white text-base tracking-wide">
              {cat.label.toUpperCase()}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {cat.jobs.map(j => {
              const isSelected = selectedJob?.name === j.name && selectedJob?.category === cat.id
              return (
                <button
                  key={j.name}
                  onClick={() => onJobSelect({ category: cat.id, categoryLabel: cat.label, name: j.name, hours: j.hours })}
                  className={`
                    flex items-center justify-between gap-3 px-4 py-3 rounded-lg border text-left transition-colors
                    ${isSelected
                      ? 'border-orange/60 bg-orange/10'
                      : 'border-dark-border hover:border-white/20 hover:bg-white/3'}
                  `}
                >
                  <span className={`text-sm font-medium ${isSelected ? 'text-orange' : 'text-white'}`}>
                    {j.name}
                  </span>
                  <span className="text-white/30 text-xs whitespace-nowrap flex-shrink-0">
                    {j.hours}h
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {selectedJob && (
        <div className="flex items-center justify-between px-4 py-3 bg-orange/10 border border-orange/30 rounded-xl">
          <div>
            <p className="text-white font-medium text-sm">{selectedJob.name}</p>
            <p className="text-orange text-xs">{selectedJob.hours}h flat rate</p>
          </div>
          <button
            onClick={onNext}
            className="px-5 py-2 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-lg transition-colors"
          >
            Get Tech Guide →
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Tab 3: Tech Guide ────────────────────────────────────────────────────────

function TechGuideTab({
  vehicle,
  job,
  techGuide,
  loading,
  error,
  onRetry,
  onNext,
}: {
  vehicle:   QWVehicle | null
  job:       SelectedJob | null
  techGuide: TechGuide | null
  loading:   boolean
  error:     string | null
  onRetry:   () => void
  onNext:    () => void
}) {
  const DIFF_COLORS: Record<string, string> = {
    Easy:    'bg-success/15 text-success border-success/30',
    Moderate:'bg-orange/15 text-orange border-orange/30',
    Hard:    'bg-danger/15 text-danger border-danger/30',
    Expert:  'bg-purple-500/15 text-purple-400 border-purple-500/30',
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-12 h-12 border-2 border-orange border-t-transparent rounded-full animate-spin" />
        <p className="text-white/50 text-sm">
          Getting tech guide for {vehicle?.year} {vehicle?.make} {vehicle?.model}…
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <p className="text-danger text-sm mb-4">{error}</p>
        <button
          onClick={onRetry}
          className="px-5 py-2 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-lg transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  if (!techGuide) return null

  const diffColor = DIFF_COLORS[techGuide.difficulty] ?? DIFF_COLORS.Moderate

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-white/40 text-xs uppercase tracking-widest mb-0.5">
            {vehicle?.year} {vehicle?.make} {vehicle?.model} · {vehicle?.engine}
          </p>
          <h2 className="font-condensed font-bold text-xl text-white tracking-wide">{job?.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${diffColor}`}>
            {techGuide.difficulty}
          </span>
          <span className="bg-white/5 border border-white/10 rounded-full px-3 py-1 text-xs text-white/60">
            {techGuide.labor_hours}h flat rate
          </span>
        </div>
      </div>

      {/* Overview */}
      {techGuide.overview && (
        <div className="nwi-card border-blue/20 bg-blue/5">
          <p className="text-white/70 text-sm leading-relaxed">{techGuide.overview}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Repair Steps */}
        <div className="nwi-card">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Repair Steps</p>
          <ol className="space-y-2">
            {techGuide.repair_steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-orange/15 border border-orange/30 flex items-center justify-center text-orange text-[10px] font-bold mt-0.5">
                  {i + 1}
                </span>
                <p className="text-white/70 text-sm leading-relaxed">{step.replace(/^\d+\.\s*/, '')}</p>
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-4">
          {/* Torque Specs */}
          {techGuide.torque_specs.length > 0 && (
            <div className="nwi-card">
              <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Torque Specs</p>
              <div className="space-y-2">
                {techGuide.torque_specs.map((ts, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 py-1.5 border-b border-dark-border last:border-0">
                    <div>
                      <p className="text-white text-sm">{ts.component}</p>
                      {ts.notes && <p className="text-white/30 text-xs">{ts.notes}</p>}
                    </div>
                    <span className="font-condensed font-bold text-orange text-sm whitespace-nowrap flex-shrink-0">
                      {ts.spec}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Special Tools */}
          {techGuide.special_tools.length > 0 && (
            <div className="nwi-card">
              <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Special Tools</p>
              <div className="flex flex-wrap gap-2">
                {techGuide.special_tools.map((t, i) => (
                  <div key={i} className="bg-dark-input border border-dark-border rounded-lg px-3 py-1.5">
                    <p className="text-white text-xs font-medium">{t.name}</p>
                    {t.notes && <p className="text-white/30 text-[10px]">{t.notes}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {techGuide.warnings.length > 0 && (
            <div className="nwi-card border-danger/20 bg-danger/5">
              <p className="text-danger/70 text-xs uppercase tracking-widest mb-2">⚠ Warnings</p>
              <ul className="space-y-1.5">
                {techGuide.warnings.map((w, i) => (
                  <li key={i} className="text-white/60 text-xs leading-relaxed">• {w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="px-6 py-2.5 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors"
        >
          View Parts List →
        </button>
      </div>
    </div>
  )
}

// ─── Tab 4: Parts ─────────────────────────────────────────────────────────────

const SUPPLIERS: { key: Supplier; label: string; color: string }[] = [
  { key: 'autozone', label: 'AutoZone',  color: 'text-red-400' },
  { key: 'orielly',  label: "O'Reilly",  color: 'text-blue-light' },
  { key: 'napa',     label: 'NAPA',      color: 'text-yellow-400' },
  { key: 'rockauto', label: 'RockAuto',  color: 'text-green-400' },
  { key: 'custom',   label: 'Custom',    color: 'text-white/50' },
]

function PartsTab({
  parts,
  onPartsChange,
  onNext,
}: {
  parts:         PartWithSuppliers[]
  onPartsChange: (p: PartWithSuppliers[]) => void
  onNext:        () => void
}) {
  function toggleIncluded(id: string) {
    onPartsChange(parts.map(p => p.id === id ? { ...p, included: !p.included } : p))
  }

  function setSupplier(id: string, supplier: Supplier) {
    onPartsChange(parts.map(p => p.id === id ? { ...p, selected_supplier: supplier } : p))
  }

  function setCustomPrice(id: string, val: string) {
    onPartsChange(parts.map(p => p.id === id ? { ...p, custom_price: Number(val) || 0 } : p))
  }

  function setQty(id: string, val: string) {
    onPartsChange(parts.map(p => p.id === id ? { ...p, qty: Math.max(1, Number(val) || 1) } : p))
  }

  const included  = parts.filter(p => p.included)
  const partsTotal = included.reduce((s, p) => s + partPrice(p) * p.qty, 0)

  if (parts.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-white/30 text-sm">No parts data — go back and load the tech guide first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-white/40 text-xs uppercase tracking-widest">
          {parts.length} part{parts.length !== 1 ? 's' : ''} · {included.length} selected
        </p>
        <span className="font-condensed font-bold text-lg text-white">
          Parts Est: <span className="text-orange">{fmt(partsTotal)}</span>
        </span>
      </div>

      <div className="space-y-3">
        {parts.map(p => (
          <div
            key={p.id}
            className={`nwi-card transition-opacity ${p.included ? '' : 'opacity-40'}`}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={p.included}
                onChange={() => toggleIncluded(p.id)}
                className="mt-1 w-4 h-4 accent-orange flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-white font-medium text-sm">{p.name}</p>
                    {p.part_number_hint && (
                      <p className="text-white/30 text-xs font-mono">{p.part_number_hint}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <label className="text-white/30 text-xs">Qty</label>
                    <input
                      type="number"
                      min={1}
                      value={p.qty}
                      onChange={e => setQty(p.id, e.target.value)}
                      className="nwi-input w-16 text-center text-sm py-1"
                    />
                  </div>
                </div>

                {/* Supplier pricing */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {SUPPLIERS.map(s => {
                    const price =
                      s.key === 'autozone'  ? p.price_autozone  :
                      s.key === 'orielly'   ? p.price_orielly   :
                      s.key === 'napa'      ? p.price_napa      :
                      s.key === 'rockauto'  ? p.price_rockauto  :
                      p.custom_price
                    const isSelected = p.selected_supplier === s.key
                    return (
                      <button
                        key={s.key}
                        onClick={() => setSupplier(p.id, s.key)}
                        className={`
                          flex flex-col items-center px-3 py-1.5 rounded-lg border text-xs transition-colors
                          ${isSelected
                            ? 'border-orange/60 bg-orange/10'
                            : 'border-dark-border hover:border-white/20'}
                        `}
                      >
                        <span className={`font-medium ${isSelected ? 'text-orange' : s.color}`}>
                          {s.label}
                        </span>
                        {s.key === 'custom' ? (
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={p.custom_price}
                            onClick={e => e.stopPropagation()}
                            onChange={e => { setSupplier(p.id, 'custom'); setCustomPrice(p.id, e.target.value) }}
                            className="w-16 bg-transparent border-0 text-white/60 text-xs text-center p-0 focus:outline-none"
                          />
                        ) : (
                          <span className="text-white/60">{fmt(price)}</span>
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* Line total */}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-white/30 text-xs">
                    {p.qty} × {fmt(partPrice(p))}
                  </span>
                  <span className="font-condensed font-bold text-sm text-white">
                    {fmt(partPrice(p) * p.qty)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="text-white/40 text-sm">
          Parts subtotal: <span className="text-white font-medium">{fmt(partsTotal)}</span>
        </div>
        <button
          onClick={onNext}
          className="px-6 py-2.5 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors"
        >
          Build Quote →
        </button>
      </div>
    </div>
  )
}

// ─── Tab 5: Quote ─────────────────────────────────────────────────────────────

function QuoteTab({
  vehicle,
  job,
  techGuide,
  parts,
}: {
  vehicle:   QWVehicle | null
  job:       SelectedJob | null
  techGuide: TechGuide | null
  parts:     PartWithSuppliers[]
}) {
  const [laborRate,     setLaborRate]     = useState(125)
  const [markupPct,     setMarkupPct]     = useState(20)
  const [taxPct,        setTaxPct]        = useState(8.5)
  const [customerName,  setCustomerName]  = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [saving,        setSaving]        = useState(false)
  const [saved,         setSaved]         = useState(false)
  const [sendingSms,    setSendingSms]    = useState(false)
  const [smsSent,       setSmsSent]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  const includedParts = parts.filter(p => p.included)
  const laborHours    = techGuide?.labor_hours ?? job?.hours ?? 0

  const partsBase  = includedParts.reduce((s, p) => s + partPrice(p) * p.qty, 0)
  const partsMarkup = partsBase * (markupPct / 100)
  const partsTotal  = partsBase + partsMarkup
  const laborTotal  = laborHours * laborRate
  const preTax      = partsTotal + laborTotal
  const taxAmount   = preTax * (taxPct / 100)
  const grandTotal  = preTax + taxAmount

  async function save(sendSms: boolean, saveInvoice: boolean) {
    if (!vehicle || !job) return
    if (sendSms && !customerPhone) { setError('Enter customer phone to send SMS.'); return }
    setError(null)

    if (sendSms) { setSendingSms(true) } else { setSaving(true) }

    try {
      const res  = await fetch('/api/quickwrench/quote', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle, job, parts,
          parts_total:    Math.round(partsTotal * 100) / 100,
          labor_hours:    laborHours,
          labor_rate:     laborRate,
          labor_total:    Math.round(laborTotal * 100) / 100,
          markup_percent: markupPct,
          tax_amount:     Math.round(taxAmount * 100) / 100,
          grand_total:    Math.round(grandTotal * 100) / 100,
          customer_name:  customerName,
          customer_phone: customerPhone,
          send_sms:       sendSms,
          save_invoice:   saveInvoice,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      if (sendSms) setSmsSent(true)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
      setSendingSms(false)
    }
  }

  const vehicleLabel = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ')

  return (
    <div className="space-y-5">
      {/* Vehicle + job summary */}
      <div className="nwi-card border-orange/20 bg-orange/5">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <p className="text-white/40 text-xs uppercase tracking-widest">Quote Summary</p>
            <p className="font-condensed font-bold text-xl text-white tracking-wide">{vehicleLabel}</p>
            <p className="text-orange text-sm">{job?.name}</p>
          </div>
          {saved && (
            <span className="ml-auto bg-success/15 border border-success/30 text-success text-xs rounded-full px-3 py-1 font-semibold">
              ✓ Saved
            </span>
          )}
          {smsSent && (
            <span className="bg-blue/15 border border-blue/30 text-blue-light text-xs rounded-full px-3 py-1 font-semibold">
              ✓ SMS Sent
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Rate controls */}
        <div className="nwi-card space-y-3">
          <p className="text-white/40 text-xs uppercase tracking-widest">Pricing Settings</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="nwi-label">Labor Rate/hr</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">$</span>
                <input
                  type="number" min={0} step={5}
                  className="nwi-input pl-7"
                  value={laborRate}
                  onChange={e => setLaborRate(Number(e.target.value) || 0)}
                />
              </div>
            </div>
            <div>
              <label className="nwi-label">Parts Markup</label>
              <div className="relative">
                <input
                  type="number" min={0} step={5}
                  className="nwi-input pr-7"
                  value={markupPct}
                  onChange={e => setMarkupPct(Number(e.target.value) || 0)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">%</span>
              </div>
            </div>
            <div>
              <label className="nwi-label">Tax Rate</label>
              <div className="relative">
                <input
                  type="number" min={0} step={0.25}
                  className="nwi-input pr-7"
                  value={taxPct}
                  onChange={e => setTaxPct(Number(e.target.value) || 0)}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">%</span>
              </div>
            </div>
          </div>

          {/* Customer info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div>
              <label className="nwi-label">Customer Name <span className="normal-case text-white/20">(opt)</span></label>
              <input className="nwi-input" placeholder="John Smith" value={customerName} onChange={e => setCustomerName(e.target.value)} />
            </div>
            <div>
              <label className="nwi-label">Customer Phone <span className="normal-case text-white/20">(for SMS)</span></label>
              <input className="nwi-input" type="tel" placeholder="+1 (555) 000-0000" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Quote breakdown */}
        <div className="nwi-card">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Quote Breakdown</p>

          {/* Parts line items */}
          {includedParts.length > 0 && (
            <div className="space-y-1.5 mb-3 pb-3 border-b border-dark-border">
              {includedParts.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2">
                  <span className="text-white/50 text-xs truncate">{p.qty > 1 ? `${p.qty}× ` : ''}{p.name}</span>
                  <span className="text-white/60 text-xs whitespace-nowrap">{fmt(partPrice(p) * p.qty)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-white/30 text-xs">Markup ({markupPct}%)</span>
                <span className="text-white/30 text-xs">+{fmt(partsMarkup)}</span>
              </div>
            </div>
          )}

          {/* Labor */}
          <div className="flex items-center justify-between py-1.5 border-b border-dark-border">
            <span className="text-white/50 text-sm">
              Labor ({laborHours}h × {fmt(laborRate)}/hr)
            </span>
            <span className="text-white text-sm font-medium">{fmt(laborTotal)}</span>
          </div>

          {/* Parts total row */}
          <div className="flex items-center justify-between py-1.5 border-b border-dark-border">
            <span className="text-white/50 text-sm">Parts Total</span>
            <span className="text-white text-sm font-medium">{fmt(partsTotal)}</span>
          </div>

          {/* Tax */}
          <div className="flex items-center justify-between py-1.5 border-b border-dark-border">
            <span className="text-white/30 text-sm">Tax ({taxPct}%)</span>
            <span className="text-white/50 text-sm">{fmt(taxAmount)}</span>
          </div>

          {/* Grand total */}
          <div className="flex items-center justify-between pt-3 mt-1">
            <span className="font-condensed font-bold text-white text-lg tracking-wide">TOTAL</span>
            <span className="font-condensed font-bold text-orange text-3xl">{fmt(grandTotal)}</span>
          </div>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => save(false, true)}
          disabled={saving || saved}
          className="flex items-center gap-2 px-5 py-2.5 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save to Financials'}
        </button>

        <button
          onClick={() => save(true, true)}
          disabled={sendingSms || smsSent || !customerPhone}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue hover:bg-blue-hover disabled:opacity-50 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          {sendingSms ? 'Sending…' : smsSent ? '✓ SMS Sent' : 'Text Quote to Customer'}
        </button>
      </div>

      {!customerPhone && (
        <p className="text-white/30 text-xs">Add a customer phone number above to enable SMS.</p>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

const TABS = [
  { label: 'Vehicle',    short: '1' },
  { label: 'Job Type',   short: '2' },
  { label: 'Tech Guide', short: '3' },
  { label: 'Parts',      short: '4' },
  { label: 'Quote',      short: '5' },
]

export default function QuickWrenchClient() {
  const [activeTab,    setActiveTab]    = useState(0)
  const [vehicle,      setVehicle]      = useState<QWVehicle | null>(null)
  const [selectedJob,  setSelectedJob]  = useState<SelectedJob | null>(null)
  const [techGuide,    setTechGuide]    = useState<TechGuide | null>(null)
  const [guideLoading, setGuideLoading] = useState(false)
  const [guideError,   setGuideError]   = useState<string | null>(null)
  const [parts,        setParts]        = useState<PartWithSuppliers[]>([])

  const loadTechGuide = useCallback(async (v: QWVehicle, j: SelectedJob) => {
    setGuideLoading(true)
    setGuideError(null)
    try {
      const res  = await fetch('/api/quickwrench/tech-guide', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ vehicle: v, job: j }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load tech guide')
      setTechGuide(json.guide)
      setParts(enrichParts(json.guide.parts_needed ?? []))
    } catch (e) {
      setGuideError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setGuideLoading(false)
    }
  }, [])

  // Auto-load tech guide when tab 3 becomes active
  useEffect(() => {
    if (activeTab === 2 && vehicle && selectedJob && !techGuide && !guideLoading && !guideError) {
      loadTechGuide(vehicle, selectedJob)
    }
  }, [activeTab, vehicle, selectedJob, techGuide, guideLoading, guideError, loadTechGuide])

  function handleVehicleSet(v: QWVehicle) {
    setVehicle(v)
    // Reset downstream state when vehicle changes
    setSelectedJob(null)
    setTechGuide(null)
    setGuideError(null)
    setParts([])
  }

  function handleJobSelect(j: SelectedJob) {
    setSelectedJob(j)
    // Reset guide if job changes
    setTechGuide(null)
    setGuideError(null)
    setParts([])
  }

  const canGoTo = (tab: number) => {
    if (tab === 0) return true
    if (tab === 1) return !!vehicle
    if (tab === 2) return !!vehicle && !!selectedJob
    if (tab === 3) return !!vehicle && !!selectedJob
    if (tab === 4) return !!vehicle && !!selectedJob
    return false
  }

  function goNext() {
    setActiveTab(t => Math.min(t + 1, TABS.length - 1))
  }

  return (
    <div className="space-y-5">
      {/* ── Tab navigation ── */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {TABS.map((tab, i) => {
          const isActive    = i === activeTab
          const isComplete  = (
            (i === 0 && !!vehicle) ||
            (i === 1 && !!selectedJob) ||
            (i === 2 && !!techGuide) ||
            (i === 3 && parts.length > 0) ||
            false
          )
          const isLocked = !canGoTo(i)

          return (
            <button
              key={i}
              onClick={() => !isLocked && setActiveTab(i)}
              disabled={isLocked}
              className={`
                flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0
                ${isActive
                  ? 'border-orange/60 bg-orange/15 text-orange'
                  : isComplete
                  ? 'border-success/40 bg-success/5 text-success hover:border-success/60'
                  : isLocked
                  ? 'border-dark-border text-white/20 cursor-not-allowed'
                  : 'border-dark-border text-white/50 hover:border-white/20 hover:text-white'}
              `}
            >
              <span className={`
                w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0
                ${isActive ? 'bg-orange text-white' : isComplete ? 'bg-success text-white' : 'bg-white/10 text-white/40'}
              `}>
                {isComplete && !isActive ? '✓' : i + 1}
              </span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          )
        })}

        {/* Vehicle + job context pill */}
        {vehicle && (
          <div className="ml-auto flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-dark-card border border-dark-border rounded-lg">
            <span className="text-white/60 text-xs truncate max-w-[120px]">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </span>
            {selectedJob && (
              <>
                <span className="text-white/20">·</span>
                <span className="text-orange text-xs truncate max-w-[100px]">{selectedJob.name}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Tab content ── */}
      <div>
        {activeTab === 0 && (
          <VehicleTab
            vehicle={vehicle}
            onVehicleSet={handleVehicleSet}
            onNext={() => { if (vehicle) setActiveTab(1) }}
          />
        )}
        {activeTab === 1 && (
          <JobTypeTab
            selectedJob={selectedJob}
            onJobSelect={handleJobSelect}
            onNext={() => { if (selectedJob) setActiveTab(2) }}
          />
        )}
        {activeTab === 2 && (
          <TechGuideTab
            vehicle={vehicle}
            job={selectedJob}
            techGuide={techGuide}
            loading={guideLoading}
            error={guideError}
            onRetry={() => vehicle && selectedJob && loadTechGuide(vehicle, selectedJob)}
            onNext={goNext}
          />
        )}
        {activeTab === 3 && (
          <PartsTab
            parts={parts}
            onPartsChange={setParts}
            onNext={goNext}
          />
        )}
        {activeTab === 4 && (
          <QuoteTab
            vehicle={vehicle}
            job={selectedJob}
            techGuide={techGuide}
            parts={parts}
          />
        )}
      </div>
    </div>
  )
}
