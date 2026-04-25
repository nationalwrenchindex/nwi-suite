'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import DiagnosticTools from './DiagnosticTools'
import type {
  QWVehicle,
  SelectedJob,
  TechGuide,
  TechGuidePart,
  PartWithSuppliers,
  Supplier,
  MultiJobEntry,
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

function jobKey(j: SelectedJob): string {
  return `${j.category}:${j.name}`
}

function supplierPrices(estimate: number) {
  const seed = estimate
  return {
    price_autozone:  Math.round(seed * 1.06 * 100) / 100,
    price_orielly:   Math.round(seed * 1.02 * 100) / 100,
    price_napa:      Math.round(seed * 1.10 * 100) / 100,
    price_rockauto:  Math.round(seed * 0.76 * 100) / 100,
  }
}

function enrichParts(raw: Array<TechGuidePart | string>): PartWithSuppliers[] {
  return raw.map((part, i) => {
    const name = typeof part === 'string' ? part : part.name
    const qty  = typeof part === 'string' ? 1    : (part.qty       ?? 1)
    const cost = typeof part === 'string' ? 0    : (part.unit_cost ?? 0)
    return {
      name,
      part_number_hint:  '',
      qty,
      price_estimate:    cost,
      id:                `part-${i}-${name.slice(0, 8).replace(/\s/g, '')}`,
      included:          true,
      selected_supplier: 'orielly' as Supplier,
      custom_price:      cost,
      ...supplierPrices(cost),
    }
  })
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

// ─── VIN Camera Scanner ──────────────────────────────────────────────────────

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/

function VINScanner({
  onScan,
  onCancel,
}: {
  onScan:   (vin: string) => void
  onCancel: () => void
}) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef    = useRef<number>(0)
  const [phase,       setPhase]       = useState<'loading' | 'scanning' | 'found' | 'error'>('loading')
  const [msg,         setMsg]         = useState('Starting camera…')
  const [isLandscape, setIsLandscape] = useState(false)

  useEffect(() => {
    let alive = true

    async function init() {
      if (!('BarcodeDetector' in window)) {
        setPhase('error')
        setMsg('unsupported')
        return
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      if (!alive) { stream.getTracks().forEach(t => t.stop()); return }

      const video = videoRef.current!
      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      video.muted = true
      await video.play()
      if (!alive) return

      setPhase('scanning')
      setMsg('Point the camera at the VIN barcode on the door jamb sticker')

      const detector = new (window as any).BarcodeDetector({
        formats: ['code_39', 'code_128'],
      })

      async function scanFrame() {
        if (!alive) return
        if (video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
          try {
            const barcodes = await detector.detect(video)
            for (const bc of barcodes) {
              const raw  = bc.rawValue.trim().toUpperCase()
              const text = raw.replace(/[^A-HJ-NPR-Z0-9]/g, '')
              if (VIN_RE.test(text)) {
                alive = false
                setPhase('found')
                setMsg(`VIN detected: ${text}`)
                onScan(text)
                return
              }
            }
          } catch { /* detection errors are non-fatal */ }
        }
        rafRef.current = requestAnimationFrame(scanFrame)
      }
      rafRef.current = requestAnimationFrame(scanFrame)
    }

    init().catch(err => {
      if (!alive) return
      const name = (err as any)?.name ?? ''
      if (name === 'NotAllowedError') {
        setPhase('error')
        setMsg('denied')
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setPhase('error')
        setMsg('No camera found on this device.')
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        setPhase('error')
        setMsg('Camera is in use by another app. Close it and try again.')
      } else {
        setPhase('error')
        setMsg((err as any)?.message ?? 'Scanner failed to start.')
      }
    })

    return () => {
      alive = false
      cancelAnimationFrame(rafRef.current)
      try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Portrait orientation lock — API where supported, overlay fallback elsewhere
  useEffect(() => {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>
      unlock?: () => void
    }
    orientation.lock?.('portrait').catch(() => {/* not supported in this browser */})

    function checkOrientation() {
      setIsLandscape(window.matchMedia('(orientation: landscape)').matches)
    }
    checkOrientation()
    window.addEventListener('orientationchange', checkOrientation)
    window.addEventListener('resize', checkOrientation)

    return () => {
      try { orientation.unlock?.() } catch { /* ignore */ }
      window.removeEventListener('orientationchange', checkOrientation)
      window.removeEventListener('resize', checkOrientation)
    }
  }, [])

  function dismiss() {
    cancelAnimationFrame(rafRef.current)
    try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
    onCancel()
  }

  return (
    <>
      <style>{`
        @keyframes qw-scanline {
          0%, 100% { top: 2px; }
          50%       { top: calc(100% - 4px); }
        }
      `}</style>

      <div className="fixed inset-0 z-50 bg-black overflow-hidden">
        {isLandscape && (
          <div className="absolute inset-0 z-10 bg-black flex flex-col items-center justify-center gap-4 px-8 text-center">
            <svg className="w-12 h-12 text-orange/60" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18h3" />
            </svg>
            <p className="text-white font-semibold text-base">Rotate to Portrait</p>
            <p className="text-white/50 text-sm leading-relaxed" style={{ maxWidth: 220 }}>
              Hold your phone upright to aim the VIN scanner.
            </p>
          </div>
        )}

        <video
          ref={videoRef}
          muted
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          style={{ objectFit: 'cover', width: '100%', height: '100%' }}
        />

        <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-6 px-6">
          <p className="text-white/50 text-xs uppercase tracking-widest font-medium">
            {phase === 'loading' ? 'Initializing camera…' : 'Align barcode within frame'}
          </p>

          <div className="relative" style={{ width: 300, height: 108 }}>
            <span style={{ position:'absolute', top:0,    left:0,  width:24, height:24, borderTop:'3px solid #FF6600',    borderLeft:'3px solid #FF6600'  }} />
            <span style={{ position:'absolute', top:0,    right:0, width:24, height:24, borderTop:'3px solid #FF6600',    borderRight:'3px solid #FF6600' }} />
            <span style={{ position:'absolute', bottom:0, left:0,  width:24, height:24, borderBottom:'3px solid #FF6600', borderLeft:'3px solid #FF6600'  }} />
            <span style={{ position:'absolute', bottom:0, right:0, width:24, height:24, borderBottom:'3px solid #FF6600', borderRight:'3px solid #FF6600' }} />

            {phase === 'scanning' && (
              <div style={{
                position:   'absolute',
                left:        6,
                right:       6,
                height:      2,
                background: 'linear-gradient(90deg, transparent, #FF6600 30%, #FF6600 70%, transparent)',
                boxShadow:  '0 0 8px 2px rgba(255,102,0,0.55)',
                animation:  'qw-scanline 1.6s ease-in-out infinite',
              }} />
            )}
          </div>

          <div className="flex flex-col items-center gap-3 w-full max-w-xs text-center">
            {phase === 'loading' && (
              <div className="w-6 h-6 border-2 border-orange border-t-transparent rounded-full animate-spin" />
            )}
            {phase === 'found' && (
              <div className="w-8 h-8 rounded-full bg-success/20 border border-success/40 flex items-center justify-center">
                <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            )}
            {phase === 'error' && msg === 'denied' && (
              <div className="bg-danger/10 border border-danger/30 rounded-xl p-4 text-left w-full">
                <p className="text-danger font-semibold text-sm mb-2">Camera Permission Denied</p>
                <p className="text-white/70 text-xs leading-relaxed mb-3">
                  Allow camera access in your browser settings to use the VIN scanner:
                </p>
                <ol className="text-white/60 text-xs space-y-1 list-decimal list-inside leading-relaxed">
                  <li>Tap the lock / info icon in your address bar</li>
                  <li>Find &ldquo;Camera&rdquo; and set it to &ldquo;Allow&rdquo;</li>
                  <li>Reload the page and tap Scan again</li>
                </ol>
              </div>
            )}
            {phase === 'error' && msg === 'unsupported' && (
              <div className="bg-white/5 border border-white/15 rounded-xl p-4 text-left w-full">
                <p className="text-white font-semibold text-sm mb-1">Barcode Scanner Not Supported</p>
                <p className="text-white/60 text-xs leading-relaxed">
                  Your browser does not support barcode scanning. Please type or paste the VIN manually — it&apos;s printed on the door jamb sticker and windshield.
                </p>
              </div>
            )}
            {phase === 'error' && msg !== 'denied' && msg !== 'unsupported' && (
              <p className="text-danger text-sm leading-relaxed">{msg}</p>
            )}
            {(phase === 'loading' || phase === 'scanning') && (
              <p className="text-white/70 text-sm leading-relaxed">{msg}</p>
            )}
            {phase === 'found' && (
              <p className="text-success font-medium text-sm">{msg}</p>
            )}
          </div>

          <p className="text-white/25 text-xs text-center leading-relaxed" style={{ maxWidth: 240 }}>
            Uses built-in browser barcode detection — no external libraries
          </p>

          <button
            onClick={dismiss}
            className="px-8 py-3 border border-white/25 hover:border-white/50 text-white/70 hover:text-white rounded-xl text-sm font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
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
  const [showScanner,  setShowScanner]  = useState(false)
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

  async function decodeVin(vinOverride?: string) {
    const v = (vinOverride ?? vin).trim().toUpperCase()
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

  function handleScanResult(scannedVin: string) {
    setShowScanner(false)
    setVin(scannedVin)
    setManual(false)
    decodeVin(scannedVin)
  }

  function applyManual() {
    if (!manYear || !manMake || !manModel) { setError('Year, make and model are required.'); return }
    setError(null)
    onVehicleSet({ vin: '', year: manYear, make: manMake, model: manModel, engine: manEngine || 'N/A' })
  }

  return (
    <div className="space-y-6">
      {showScanner && (
        <VINScanner
          onScan={handleScanResult}
          onCancel={() => setShowScanner(false)}
        />
      )}

      {!manual && (
        <div className="nwi-card">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Enter VIN</p>
          <div className="flex gap-2 flex-wrap sm:flex-nowrap">
            <input
              className="nwi-input flex-1 font-mono tracking-widest uppercase min-w-0"
              placeholder="17-character VIN"
              maxLength={17}
              value={vin}
              onChange={e => setVin(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && decodeVin()}
            />
            <button
              onClick={() => { setError(null); setShowScanner(true) }}
              className="flex items-center gap-1.5 px-3 py-2 border border-orange/40 hover:border-orange/70 bg-orange/10 hover:bg-orange/20 text-orange text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
              title="Scan VIN barcode with camera"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
              <span className="hidden xs:inline">Scan</span>
            </button>
            <button
              onClick={() => decodeVin()}
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

      {vehicle && (
        <button
          onClick={onNext}
          className="w-full py-4 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-base tracking-wide rounded-xl transition-colors"
        >
          Continue to Job Type →
        </button>
      )}
    </div>
  )
}

// ─── Tab 2: Job Type (multi-select) ──────────────────────────────────────────

function JobTypeTab({
  selectedJobs,
  onJobToggle,
  onNext,
}: {
  selectedJobs: SelectedJob[]
  onJobToggle:  (j: SelectedJob) => void
  onNext:       () => void
}) {
  const [activeCat, setActiveCat] = useState<string | null>(
    selectedJobs.length > 0 ? selectedJobs[selectedJobs.length - 1].category : null
  )

  const cat = JOB_CATEGORIES.find(c => c.id === activeCat) ?? null
  const totalHours = selectedJobs.reduce((s, j) => s + j.hours, 0)

  return (
    <div className="space-y-4">
      {/* Category grid */}
      <div className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-9 gap-2">
        {JOB_CATEGORIES.map(c => {
          const hasSel = selectedJobs.some(j => j.category === c.id)
          return (
            <button
              key={c.id}
              onClick={() => setActiveCat(c.id)}
              className={`
                flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-colors text-center relative
                ${activeCat === c.id
                  ? 'border-orange/60 bg-orange/10 text-orange'
                  : hasSel
                  ? 'border-success/40 bg-success/5 text-success'
                  : 'border-dark-border bg-dark-card text-white/50 hover:border-white/20 hover:text-white'}
              `}
            >
              <CategoryIcon id={c.id} className="w-5 h-5" />
              <span className="text-[10px] font-medium leading-tight">{c.label}</span>
              {hasSel && activeCat !== c.id && (
                <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-success rounded-full" />
              )}
            </button>
          )
        })}
      </div>

      {/* Job list for selected category */}
      {cat && (
        <div className="nwi-card">
          <div className="flex items-center gap-2 mb-3">
            <CategoryIcon id={cat.id} className="w-4 h-4 text-orange" />
            <p className="font-condensed font-bold text-white text-base tracking-wide">
              {cat.label.toUpperCase()}
            </p>
            <span className="text-white/30 text-xs ml-auto">Tap to add / remove</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {cat.jobs.map(j => {
              const sj: SelectedJob = { category: cat.id, categoryLabel: cat.label, name: j.name, hours: j.hours }
              const isSelected = selectedJobs.some(s => jobKey(s) === jobKey(sj))
              return (
                <button
                  key={j.name}
                  onClick={() => onJobToggle(sj)}
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
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-white/30 text-xs whitespace-nowrap">{j.hours}h</span>
                    <span className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected ? 'bg-orange border-orange' : 'border-white/25 bg-transparent'
                    }`}>
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Running total + CTA */}
      {selectedJobs.length > 0 && (
        <div className="space-y-3">
          <div className="bg-orange/10 border border-orange/30 rounded-xl px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-white font-semibold text-sm">
                {selectedJobs.length} job{selectedJobs.length !== 1 ? 's' : ''} selected
              </p>
              <span className="text-orange text-sm font-medium">{totalHours.toFixed(1)}h labor</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedJobs.map(j => (
                <span
                  key={jobKey(j)}
                  className="flex items-center gap-1 px-2 py-0.5 bg-orange/15 border border-orange/25 rounded-full text-xs text-orange"
                >
                  {j.name}
                  <button
                    onClick={e => { e.stopPropagation(); onJobToggle(j) }}
                    className="text-orange/50 hover:text-orange ml-0.5 leading-none text-sm"
                    aria-label={`Remove ${j.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={onNext}
            className="w-full py-4 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-base tracking-wide rounded-xl transition-colors"
          >
            Get Tech Guide + Parts →
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Tech guide content (shared by single and accordion) ─────────────────────

function TechGuideContent({ guide, job }: { guide: TechGuide; job: SelectedJob }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="nwi-card">
        <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Repair Steps</p>
        <ol className="space-y-2">
          {guide.steps.map((step, i) => (
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
        {guide.torque.length > 0 && (
          <div className="nwi-card">
            <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Torque Specs</p>
            <div className="space-y-2">
              {guide.torque.map((ts, i) => (
                <div key={i} className="flex items-start justify-between gap-3 py-1.5 border-b border-dark-border last:border-0">
                  <p className="text-white text-sm">{ts.part}</p>
                  <span className="font-condensed font-bold text-orange text-sm whitespace-nowrap flex-shrink-0">
                    {ts.spec}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {guide.tools.length > 0 && (
          <div className="nwi-card">
            <p className="text-white/40 text-xs uppercase tracking-widest mb-3">Special Tools</p>
            <div className="flex flex-wrap gap-2">
              {guide.tools.map((t, i) => (
                <div key={i} className="bg-dark-input border border-dark-border rounded-lg px-3 py-1.5">
                  <p className="text-white text-xs font-medium">{t}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {guide.warning && (
          <div className="nwi-card border-danger/20 bg-danger/5">
            <p className="text-danger/70 text-xs uppercase tracking-widest mb-2">⚠ Warning</p>
            <p className="text-white/60 text-xs leading-relaxed">• {guide.warning}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tab 3: Tech Guide ────────────────────────────────────────────────────────

function TechGuideTab({
  vehicle,
  jobs,
  techGuides,
  loading,
  error,
  onRetry,
  onNext,
}: {
  vehicle:    QWVehicle | null
  jobs:       SelectedJob[]
  techGuides: Record<string, TechGuide>
  loading:    boolean
  error:      string | null
  onRetry:    () => void
  onNext:     () => void
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(
    jobs.length > 0 ? jobKey(jobs[0]) : null
  )

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="w-12 h-12 border-2 border-orange border-t-transparent rounded-full animate-spin" />
        <p className="text-white/50 text-sm">
          Loading tech guide{jobs.length > 1 ? 's' : ''} for {vehicle?.year} {vehicle?.make} {vehicle?.model}…
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

  const loadedJobs = jobs.filter(j => !!techGuides[jobKey(j)])
  if (loadedJobs.length === 0) return null

  // Single-job: flat display (same UX as before)
  if (jobs.length === 1) {
    const j    = jobs[0]
    const guide = techGuides[jobKey(j)]
    if (!guide) return null

    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-white/40 text-xs uppercase tracking-widest mb-0.5">
              {vehicle?.year} {vehicle?.make} {vehicle?.model} · {vehicle?.engine}
            </p>
            <h2 className="font-condensed font-bold text-xl text-white tracking-wide">{j.name}</h2>
          </div>
          <span className="bg-white/5 border border-white/10 rounded-full px-3 py-1 text-xs text-white/60">
            {guide.hours}h flat rate
          </span>
        </div>

        <TechGuideContent guide={guide} job={j} />

        <p className="text-white/25 text-[10px] leading-relaxed">
          AI-generated specifications for reference only. Results may omit vehicle-specific steps or torque values. Always verify against OEM service documentation before beginning work. National Wrench Index&#8482; assumes no liability for inaccuracies.
        </p>

        <button
          onClick={onNext}
          className="w-full py-4 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-base tracking-wide rounded-xl transition-colors"
        >
          View Parts List →
        </button>
      </div>
    )
  }

  // Multi-job: accordion
  return (
    <div className="space-y-4">
      <div>
        <p className="text-white/40 text-xs uppercase tracking-widest mb-0.5">
          {vehicle?.year} {vehicle?.make} {vehicle?.model} · {vehicle?.engine}
        </p>
        <h2 className="font-condensed font-bold text-xl text-white tracking-wide">
          {loadedJobs.length} Tech Guide{loadedJobs.length !== 1 ? 's' : ''}
        </h2>
      </div>

      <div className="space-y-2">
        {loadedJobs.map((j, ji) => {
          const key   = jobKey(j)
          const guide = techGuides[key]
          const isExp = expandedKey === key
          return (
            <div key={key} className="nwi-card overflow-hidden">
              <button
                onClick={() => setExpandedKey(isExp ? null : key)}
                className="flex items-center justify-between w-full text-left py-0.5"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-orange/15 border border-orange/30 flex items-center justify-center text-orange text-[10px] font-bold flex-shrink-0">
                    {ji + 1}
                  </span>
                  <p className="font-semibold text-white text-sm">{j.name}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-white/30 text-xs">{guide.hours}h</span>
                  <svg
                    className={`w-4 h-4 text-white/40 transition-transform ${isExp ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </button>

              {isExp && (
                <div className="mt-4 pt-4 border-t border-dark-border">
                  <TechGuideContent guide={guide} job={j} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-white/25 text-[10px] leading-relaxed">
        AI-generated specifications for reference only. Results may omit vehicle-specific steps or torque values. Always verify against OEM service documentation before beginning work. National Wrench Index&#8482; assumes no liability for inaccuracies.
      </p>

      <button
        onClick={onNext}
        className="w-full py-4 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-base tracking-wide rounded-xl transition-colors"
      >
        View Parts List →
      </button>
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

function PartCard({
  p,
  onChange,
}: {
  p:        PartWithSuppliers
  onChange: (updated: PartWithSuppliers) => void
}) {
  function toggle()                       { onChange({ ...p, included: !p.included }) }
  function setSupplier(s: Supplier)       { onChange({ ...p, selected_supplier: s }) }
  function setCustomPrice(val: string)    { onChange({ ...p, custom_price: Number(val) || 0 }) }
  function setQty(val: string)            { onChange({ ...p, qty: Math.max(1, Number(val) || 1) }) }

  return (
    <div className={`nwi-card transition-opacity ${p.included ? '' : 'opacity-40'}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={p.included}
          onChange={toggle}
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
                onChange={e => setQty(e.target.value)}
                className="nwi-input w-16 text-center text-sm py-1"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {SUPPLIERS.map(s => {
              const price =
                s.key === 'autozone'  ? p.price_autozone  :
                s.key === 'orielly'   ? p.price_orielly   :
                s.key === 'napa'      ? p.price_napa      :
                s.key === 'rockauto'  ? p.price_rockauto  :
                p.custom_price
              const isSel = p.selected_supplier === s.key
              return (
                <button
                  key={s.key}
                  onClick={() => setSupplier(s.key)}
                  className={`
                    flex flex-col items-center px-3 py-1.5 rounded-lg border text-xs transition-colors
                    ${isSel ? 'border-orange/60 bg-orange/10' : 'border-dark-border hover:border-white/20'}
                  `}
                >
                  <span className={`font-medium ${isSel ? 'text-orange' : s.color}`}>{s.label}</span>
                  {s.key === 'custom' ? (
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={p.custom_price}
                      onClick={e => e.stopPropagation()}
                      onChange={e => { setSupplier('custom'); setCustomPrice(e.target.value) }}
                      className="w-16 bg-transparent border-0 text-white/60 text-xs text-center p-0 focus:outline-none"
                    />
                  ) : (
                    <span className="text-white/60">{fmt(price)}</span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-white/30 text-xs">{p.qty} × {fmt(partPrice(p))}</span>
            <span className="font-condensed font-bold text-sm text-white">{fmt(partPrice(p) * p.qty)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function PartsTab({
  selectedJobs,
  partsByJob,
  onPartsChange,
  onNext,
}: {
  selectedJobs:  SelectedJob[]
  partsByJob:    Record<string, PartWithSuppliers[]>
  onPartsChange: (key: string, p: PartWithSuppliers[]) => void
  onNext:        () => void
}) {
  const allParts  = selectedJobs.flatMap(j => partsByJob[jobKey(j)] ?? [])
  const totalParts = allParts.filter(p => p.included).reduce((s, p) => s + partPrice(p) * p.qty, 0)

  if (allParts.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-white/30 text-sm">No parts data — go back and load the tech guide first.</p>
      </div>
    )
  }

  // Single-job: flat display (same UX as before)
  if (selectedJobs.length === 1) {
    const j   = selectedJobs[0]
    const key = jobKey(j)
    const parts = partsByJob[key] ?? []
    const included = parts.filter(p => p.included)

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-white/40 text-xs uppercase tracking-widest">
            {parts.length} part{parts.length !== 1 ? 's' : ''} · {included.length} selected
          </p>
          <span className="font-condensed font-bold text-lg text-white">
            Parts Est: <span className="text-orange">{fmt(totalParts)}</span>
          </span>
        </div>

        <div className="space-y-3">
          {parts.map(p => (
            <PartCard
              key={p.id}
              p={p}
              onChange={updated => onPartsChange(key, parts.map(x => x.id === p.id ? updated : x))}
            />
          ))}
        </div>

        <div className="pt-2 space-y-3">
          <div className="text-white/40 text-sm text-right">
            Parts subtotal: <span className="text-white font-medium">{fmt(totalParts)}</span>
          </div>
          <button
            onClick={onNext}
            className="w-full py-4 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-base tracking-wide rounded-xl transition-colors"
          >
            Build Quote →
          </button>
        </div>
      </div>
    )
  }

  // Multi-job: grouped by job
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-white/40 text-xs uppercase tracking-widest">Parts by Job</p>
        <span className="font-condensed font-bold text-lg text-white">
          Total: <span className="text-orange">{fmt(totalParts)}</span>
        </span>
      </div>

      {selectedJobs.map((j, ji) => {
        const key   = jobKey(j)
        const parts = partsByJob[key] ?? []
        const jobTotal = parts.filter(p => p.included).reduce((s, p) => s + partPrice(p) * p.qty, 0)

        return (
          <div key={key} className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <span className="w-5 h-5 rounded-full bg-orange/15 border border-orange/30 flex items-center justify-center text-orange text-[10px] font-bold flex-shrink-0">
                {ji + 1}
              </span>
              <p className="text-white font-semibold text-sm flex-1">{j.name}</p>
              <span className="text-orange text-xs font-medium">{fmt(jobTotal)}</span>
            </div>

            {parts.length > 0 ? (
              <div className="space-y-2 pl-7">
                {parts.map(p => (
                  <PartCard
                    key={p.id}
                    p={p}
                    onChange={updated => onPartsChange(key, parts.map(x => x.id === p.id ? updated : x))}
                  />
                ))}
              </div>
            ) : (
              <p className="text-white/30 text-sm pl-7">No parts for this job.</p>
            )}
          </div>
        )
      })}

      <div className="pt-2 space-y-3 border-t border-dark-border">
        <div className="text-white/40 text-sm text-right">
          All parts subtotal: <span className="text-white font-medium">{fmt(totalParts)}</span>
        </div>
        <button
          onClick={onNext}
          className="w-full py-4 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-base tracking-wide rounded-xl transition-colors"
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
  selectedJobs,
  techGuides,
  partsByJob,
  initialLaborRate   = 125,
  initialMarkupPct   = 20,
  initialTaxPct      = 8.5,
  initialCustomerName  = '',
  initialCustomerPhone = '',
}: {
  vehicle:               QWVehicle | null
  selectedJobs:          SelectedJob[]
  techGuides:            Record<string, TechGuide>
  partsByJob:            Record<string, PartWithSuppliers[]>
  initialLaborRate?:     number
  initialMarkupPct?:     number
  initialTaxPct?:        number
  initialCustomerName?:  string
  initialCustomerPhone?: string
}) {
  const [laborRate,     setLaborRate]     = useState(initialLaborRate)
  const [markupPct,     setMarkupPct]     = useState(initialMarkupPct)
  const [taxPct,        setTaxPct]        = useState(initialTaxPct)
  const [customerName,  setCustomerName]  = useState(initialCustomerName)
  const [customerPhone, setCustomerPhone] = useState(initialCustomerPhone)
  const [saving,        setSaving]        = useState(false)
  const [quoteNumber,   setQuoteNumber]   = useState<string | null>(null)
  const [quoteId,       setQuoteId]       = useState<string | null>(null)
  const [savedHash,     setSavedHash]     = useState('')
  const [sendingSms,    setSendingSms]    = useState(false)
  const [smsSent,       setSmsSent]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  // Per-job breakdowns
  const jobBreakdowns = selectedJobs.map(j => {
    const key        = jobKey(j)
    const guide      = techGuides[key]
    const laborHrs   = guide?.hours ?? j.hours
    const jParts     = (partsByJob[key] ?? []).filter(p => p.included)
    const partsBase  = jParts.reduce((s, p) => s + partPrice(p) * p.qty, 0)
    const partsMarkup = partsBase * markupPct / 100
    const partsRev   = partsBase + partsMarkup
    const laborTotal = laborHrs * laborRate
    const subtotal   = partsRev + laborTotal
    return { j, key, laborHrs, jParts, partsBase, partsMarkup, partsRev, laborTotal, subtotal }
  })

  const totalPartsRev   = jobBreakdowns.reduce((s, b) => s + b.partsRev,   0)
  const totalLaborHours = jobBreakdowns.reduce((s, b) => s + b.laborHrs,   0)
  const totalLaborTotal = jobBreakdowns.reduce((s, b) => s + b.laborTotal, 0)
  const preTax          = totalPartsRev + totalLaborTotal
  const taxAmount       = preTax * (taxPct / 100)
  const grandTotal      = preTax + taxAmount

  const quoteHash = [laborRate, markupPct, taxPct,
    ...selectedJobs.map(j => {
      const key = jobKey(j)
      return (partsByJob[key] ?? []).filter(p => p.included)
        .map(p => `${p.id}:${p.qty}:${partPrice(p)}`).join(',')
    })
  ].join(':')
  const isSaved = !!quoteNumber && savedHash === quoteHash

  async function save(sendSms: boolean, saveQuote: boolean) {
    if (!vehicle || selectedJobs.length === 0) return
    if (sendSms && !customerPhone) { setError('Enter customer phone to send SMS.'); return }
    setError(null)
    if (sendSms) { setSendingSms(true) } else { setSaving(true) }

    try {
      const jobsPayload: MultiJobEntry[] = jobBreakdowns.map(b => ({
        id:          b.key,
        category:    b.j.category,
        subtype:     b.j.name,
        labor_hours: b.laborHrs,
        labor_rate:  laborRate,
        parts:       b.jParts.map(p => ({
          name:       p.name,
          qty:        p.qty,
          unit_cost:  Math.round(partPrice(p) * 100) / 100,
          unit_price: Math.round(partPrice(p) * (1 + markupPct / 100) * 100) / 100,
        })),
        notes: '',
      }))

      const allParts = selectedJobs.flatMap(j => partsByJob[jobKey(j)] ?? [])

      const res  = await fetch('/api/quickwrench/quote', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle,
          job: {
            category:      selectedJobs[0].category,
            categoryLabel: selectedJobs[0].categoryLabel,
            name:          selectedJobs[0].name,
            hours:         jobsPayload[0].labor_hours,
          },
          jobs:           jobsPayload,
          parts:          allParts,
          parts_total:    Math.round(totalPartsRev * 100) / 100,
          labor_hours:    totalLaborHours,
          labor_rate:     laborRate,
          labor_total:    Math.round(totalLaborTotal * 100) / 100,
          markup_percent: markupPct,
          tax_amount:     Math.round(taxAmount * 100) / 100,
          grand_total:    Math.round(grandTotal * 100) / 100,
          customer_name:  customerName,
          customer_phone: customerPhone,
          send_sms:       sendSms,
          save_quote:     saveQuote,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      if (sendSms) setSmsSent(true)
      if (json.quoteNumber) {
        setQuoteNumber(json.quoteNumber)
        setQuoteId(json.quoteId ?? null)
        setSavedHash(quoteHash)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSaving(false)
      setSendingSms(false)
    }
  }

  const vehicleLabel = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ')
  const isMultiJob   = selectedJobs.length > 1

  return (
    <div className="space-y-5">
      {/* Vehicle + job summary */}
      <div className="nwi-card border-orange/20 bg-orange/5">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-white/40 text-xs uppercase tracking-widest">Quote Summary</p>
            <p className="font-condensed font-bold text-xl text-white tracking-wide">{vehicleLabel}</p>
            {isMultiJob ? (
              <div className="flex flex-wrap gap-1 mt-1">
                {selectedJobs.map(j => (
                  <span key={jobKey(j)} className="text-xs text-orange bg-orange/10 border border-orange/20 rounded-full px-2 py-0.5">
                    {j.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-orange text-sm">{selectedJobs[0]?.name}</p>
            )}
          </div>
          {smsSent && (
            <span className="ml-auto bg-blue/15 border border-blue/30 text-blue-light text-xs rounded-full px-3 py-1 font-semibold">
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

          {isMultiJob ? (
            /* Multi-job: per-job blocks */
            <div className="space-y-3 mb-3">
              {jobBreakdowns.map((b, bi) => (
                <div key={b.key} className="border border-white/8 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-white/3">
                    <p className="text-white font-semibold text-xs">{b.j.name}</p>
                    <span className="text-orange font-bold text-xs">{fmt(b.subtotal)}</span>
                  </div>
                  <div className="px-3 py-2 space-y-1">
                    {b.jParts.map(p => (
                      <div key={p.id} className="flex items-center justify-between gap-2">
                        <span className="text-white/50 text-xs truncate">{p.qty > 1 ? `${p.qty}× ` : ''}{p.name}</span>
                        <span className="text-white/60 text-xs whitespace-nowrap">{fmt(partPrice(p) * p.qty)}</span>
                      </div>
                    ))}
                    {b.partsMarkup > 0 && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-white/25 text-xs">Markup ({markupPct}%)</span>
                        <span className="text-white/25 text-xs">+{fmt(b.partsMarkup)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/5">
                      <span className="text-white/50 text-xs">Labor ({b.laborHrs}h × {fmt(laborRate)}/hr)</span>
                      <span className="text-white/70 text-xs">{fmt(b.laborTotal)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Single-job: flat display */
            <>
              {jobBreakdowns[0]?.jParts.length > 0 && (
                <div className="space-y-1.5 mb-3 pb-3 border-b border-dark-border">
                  {jobBreakdowns[0].jParts.map(p => (
                    <div key={p.id} className="flex items-center justify-between gap-2">
                      <span className="text-white/50 text-xs truncate">{p.qty > 1 ? `${p.qty}× ` : ''}{p.name}</span>
                      <span className="text-white/60 text-xs whitespace-nowrap">{fmt(partPrice(p) * p.qty)}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-white/30 text-xs">Markup ({markupPct}%)</span>
                    <span className="text-white/30 text-xs">+{fmt(jobBreakdowns[0].partsMarkup)}</span>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between py-1.5 border-b border-dark-border">
                <span className="text-white/50 text-sm">
                  Labor ({jobBreakdowns[0]?.laborHrs ?? 0}h × {fmt(laborRate)}/hr)
                </span>
                <span className="text-white text-sm font-medium">{fmt(totalLaborTotal)}</span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-dark-border">
                <span className="text-white/50 text-sm">Parts Total</span>
                <span className="text-white text-sm font-medium">{fmt(totalPartsRev)}</span>
              </div>
            </>
          )}

          <div className="flex items-center justify-between py-1.5 border-b border-dark-border">
            <span className="text-white/30 text-sm">Tax ({taxPct}%)</span>
            <span className="text-white/50 text-sm">{fmt(taxAmount)}</span>
          </div>

          <div className="flex items-center justify-between pt-3 mt-1">
            <span className="font-condensed font-bold text-white text-lg tracking-wide">TOTAL</span>
            <span className="font-condensed font-bold text-orange text-3xl">{fmt(grandTotal)}</span>
          </div>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {isSaved && quoteNumber && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-success/30 bg-success/8">
          <svg className="w-4 h-4 text-success flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-success text-sm font-semibold">
              Quote saved — <span className="font-mono">{quoteNumber}</span>
            </p>
            <p className="text-white/40 text-xs mt-0.5">Modify the quote and save again to create a new version.</p>
          </div>
          <a
            href={`/financials?tab=quotes${quoteId ? `&quote=${quoteId}` : ''}`}
            className="flex-shrink-0 text-xs font-semibold text-blue-light hover:underline whitespace-nowrap"
          >
            View in Financials &rsaquo; Quotes →
          </a>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => save(false, true)}
          disabled={saving || isSaved}
          className="flex items-center gap-2 px-5 py-2.5 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors"
        >
          {saving ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Saving…
            </>
          ) : isSaved ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Saved ✓
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              Save as Quote
            </>
          )}
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

interface LoadedQuoteDefaults {
  laborRate:    number
  markupPct:    number
  taxPct:       number
  customerName: string
  customerPhone: string
}

export default function QuickWrenchClient({ loadQuoteId }: { loadQuoteId?: string }) {
  const [activeTab,     setActiveTab]     = useState(0)
  const [vehicle,       setVehicle]       = useState<QWVehicle | null>(null)
  const [selectedJobs,  setSelectedJobs]  = useState<SelectedJob[]>([])
  const [techGuides,    setTechGuides]    = useState<Record<string, TechGuide>>({})
  const [guidesLoading, setGuidesLoading] = useState(false)
  const [guidesError,   setGuidesError]   = useState<string | null>(null)
  const [partsByJob,    setPartsByJob]    = useState<Record<string, PartWithSuppliers[]>>({})
  const [quoteDefaults, setQuoteDefaults] = useState<LoadedQuoteDefaults | null>(null)
  const loadedQuoteRef = useRef<string | null>(null)

  const loadAllTechGuides = useCallback(async (v: QWVehicle, jobs: SelectedJob[]) => {
    setGuidesLoading(true)
    setGuidesError(null)
    try {
      const results = await Promise.all(
        jobs.map(async j => {
          const res  = await fetch('/api/quickwrench/tech-guide', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ vehicle: v, job: j }),
          })
          const json = await res.json()
          if (!res.ok) throw new Error(json.error ?? 'Failed to load tech guide')
          return { key: jobKey(j), guide: json.guide as TechGuide, parts: enrichParts(json.guide.parts ?? []) }
        })
      )
      setTechGuides(prev => {
        const next = { ...prev }
        for (const r of results) next[r.key] = r.guide
        return next
      })
      setPartsByJob(prev => {
        const next = { ...prev }
        for (const r of results) {
          // Don't overwrite parts that were manually set (e.g. by handleFindTires)
          if (!prev[r.key] || prev[r.key].length === 0) next[r.key] = r.parts
        }
        return next
      })
    } catch (e) {
      setGuidesError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setGuidesLoading(false)
    }
  }, [])

  // Pre-fill all steps when navigated here with ?loadQuoteId=
  useEffect(() => {
    if (!loadQuoteId || loadedQuoteRef.current === loadQuoteId) return
    loadedQuoteRef.current = loadQuoteId

    fetch(`/api/quotes/${loadQuoteId}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        const q = json?.quote
        if (!q) return

        // Step 1: Vehicle
        if (q.vehicle) {
          setVehicle({
            vin:    q.vehicle.vin  ?? '',
            year:   String(q.vehicle.year ?? ''),
            make:   q.vehicle.make,
            model:  q.vehicle.model,
            engine: 'N/A',
          })
        }

        // Multi-job restore from jobs[] JSONB
        if (Array.isArray(q.jobs) && q.jobs.length > 0) {
          const restoredJobs: SelectedJob[] = []
          const restoredParts: Record<string, PartWithSuppliers[]> = {}

          for (const entry of q.jobs as MultiJobEntry[]) {
            const matchedCat = JOB_CATEGORIES.find(c => c.id === entry.category)
            const sj: SelectedJob = {
              category:      entry.category,
              categoryLabel: matchedCat?.label ?? entry.category,
              name:          entry.subtype,
              hours:         entry.labor_hours ?? 1,
            }
            restoredJobs.push(sj)
            const key = jobKey(sj)
            restoredParts[key] = entry.parts.map((p, idx) => ({
              id:               `loaded-${key}-${idx}`,
              name:             p.name,
              part_number_hint: '',
              qty:              p.qty,
              price_estimate:   p.unit_cost,
              included:         true,
              selected_supplier: 'custom' as Supplier,
              custom_price:      p.unit_cost,
              price_autozone:    p.unit_cost,
              price_orielly:     p.unit_cost,
              price_napa:        p.unit_cost,
              price_rockauto:    p.unit_cost,
            }))
          }

          setSelectedJobs(restoredJobs)
          setPartsByJob(restoredParts)
          setQuoteDefaults({
            laborRate:     q.labor_rate          ?? 125,
            markupPct:     q.parts_markup_percent ?? 20,
            taxPct:        q.tax_percent          ?? 8.5,
            customerName:  q.customer ? `${q.customer.first_name} ${q.customer.last_name}`.trim() : '',
            customerPhone: q.customer?.phone ?? '',
          })
          setTechGuides({})
          setGuidesError(null)
          setActiveTab(4)
          return
        }

        // Legacy single-job restore from line_items
        let matchedJob: SelectedJob | null = null
        if (q.job_category || q.job_subtype) {
          for (const cat of JOB_CATEGORIES) {
            if (
              cat.label.toLowerCase() === q.job_category?.toLowerCase() ||
              cat.id === q.job_category?.toLowerCase().replace(/[\s&]+/g, '_')
            ) {
              const matchJob = cat.jobs.find(j => j.name === q.job_subtype)
              if (matchJob) {
                matchedJob = { category: cat.id, categoryLabel: cat.label, name: matchJob.name, hours: matchJob.hours }
              }
              break
            }
          }
          if (!matchedJob && q.job_subtype) {
            matchedJob = {
              category:      q.job_category ?? 'diagnostics',
              categoryLabel: q.job_category ?? 'Service',
              name:          q.job_subtype,
              hours:         q.labor_hours ?? 1,
            }
          }
        }
        if (matchedJob) setSelectedJobs([matchedJob])

        const partItems = (q.line_items ?? []).filter(
          (li: { description: string }) => !/^labor/i.test(li.description ?? '')
        )
        if (partItems.length > 0 && matchedJob) {
          const markup = (q.parts_markup_percent ?? 0) / 100
          const loadedParts: PartWithSuppliers[] = partItems.map(
            (li: { description: string; quantity: number; unit_price: number }, i: number) => {
              const basePrice = markup > 0 ? li.unit_price / (1 + markup) : li.unit_price
              return {
                id:               `loaded-${i}-${Date.now()}`,
                name:             li.description,
                part_number_hint: '',
                qty:              li.quantity,
                price_estimate:   basePrice,
                included:         true,
                selected_supplier: 'custom' as Supplier,
                custom_price:      basePrice,
                price_autozone:    basePrice,
                price_orielly:     basePrice,
                price_napa:        basePrice,
                price_rockauto:    basePrice,
              }
            }
          )
          setPartsByJob({ [jobKey(matchedJob)]: loadedParts })
        }

        setQuoteDefaults({
          laborRate:     q.labor_rate          ?? 125,
          markupPct:     q.parts_markup_percent ?? 20,
          taxPct:        q.tax_percent          ?? 8.5,
          customerName:  q.customer ? `${q.customer.first_name} ${q.customer.last_name}`.trim() : '',
          customerPhone: q.customer?.phone ?? '',
        })
        setTechGuides({})
        setGuidesError(null)
        setActiveTab(4)
      })
      .catch(() => {})
  }, [loadQuoteId])

  // Auto-load missing tech guides when tab 2 (Tech Guide) becomes active
  useEffect(() => {
    if (activeTab !== 2 || !vehicle || selectedJobs.length === 0 || guidesLoading || guidesError) return
    const missing = selectedJobs.filter(j => !techGuides[jobKey(j)])
    if (missing.length === 0) return
    loadAllTechGuides(vehicle, missing)
  }, [activeTab, vehicle, selectedJobs, techGuides, guidesLoading, guidesError, loadAllTechGuides])

  function handleVehicleSet(v: QWVehicle) {
    setVehicle(v)
    setSelectedJobs([])
    setTechGuides({})
    setGuidesError(null)
    setPartsByJob({})
  }

  function handleJobToggle(j: SelectedJob) {
    const key = jobKey(j)
    const isSelected = selectedJobs.some(s => jobKey(s) === key)
    if (isSelected) {
      setSelectedJobs(prev => prev.filter(s => jobKey(s) !== key))
      setTechGuides(prev => { const n = { ...prev }; delete n[key]; return n })
      setPartsByJob(prev => { const n = { ...prev }; delete n[key]; return n })
    } else {
      setSelectedJobs(prev => [...prev, j])
    }
  }

  function handlePartsChange(key: string, updated: PartWithSuppliers[]) {
    setPartsByJob(prev => ({ ...prev, [key]: updated }))
  }

  function handleFindTires(sizes: { front: string | null; rear: string | null }) {
    const tireJob: SelectedJob = {
      category:      'tires_wheels',
      categoryLabel: 'Tires & Wheels',
      name:          'Tire Replacement (4 tires)',
      hours:         2.0,
    }
    const key = jobKey(tireJob)

    const items: string[] = []
    const sameTire = !sizes.rear || sizes.front === sizes.rear
    if (sizes.front) {
      items.push(sameTire ? `Tires — ${sizes.front}` : `Front Tires — ${sizes.front}`)
    }
    if (!sameTire && sizes.rear) {
      items.push(`Rear Tires — ${sizes.rear}`)
    }
    if (items.length === 0) items.push('Tires (check door jamb sticker for size)')

    setSelectedJobs(prev => prev.some(j => jobKey(j) === key) ? prev : [...prev, tireJob])
    setPartsByJob(prev => ({ ...prev, [key]: enrichParts(items) }))
    setGuidesError(null)
    setActiveTab(3)
  }

  const isJobsComplete   = selectedJobs.length > 0
  const isGuidesComplete = selectedJobs.length > 0 && selectedJobs.every(j => !!techGuides[jobKey(j)])
  const isPartsComplete  = Object.values(partsByJob).some(p => p.length > 0)

  const canGoTo = (tab: number) => {
    if (tab === 0) return true
    if (tab === 1) return !!vehicle
    if (tab === 2) return !!vehicle && isJobsComplete
    if (tab === 3) return !!vehicle && isJobsComplete
    if (tab === 4) return !!vehicle && isJobsComplete
    return false
  }

  function goNext() {
    setActiveTab(t => Math.min(t + 1, TABS.length - 1))
  }

  const STEP_LABELS = ['Vehicle', 'Job Type', 'Tech Guide', 'Parts', 'Quote']

  return (
    <div className="space-y-5">
      {/* ── Step progress indicator ── */}
      <div className="flex items-center gap-0">
        {STEP_LABELS.map((label, i) => {
          const isActive   = i === activeTab
          const isComplete =
            (i === 0 && !!vehicle) ||
            (i === 1 && isJobsComplete) ||
            (i === 2 && isGuidesComplete) ||
            (i === 3 && isPartsComplete)
          return (
            <div key={i} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                  isActive   ? 'bg-orange border-orange text-white' :
                  isComplete ? 'bg-success border-success text-white' :
                               'bg-transparent border-white/20 text-white/30'
                }`}>
                  {isComplete && !isActive ? '✓' : i + 1}
                </div>
                <span className={`text-[9px] font-medium whitespace-nowrap hidden sm:block ${
                  isActive ? 'text-orange' : isComplete ? 'text-success' : 'text-white/25'
                }`}>{label}</span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 transition-colors ${isComplete ? 'bg-success/50' : 'bg-white/10'}`} />
              )}
            </div>
          )
        })}
      </div>

      {/* ── Tab navigation ── */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {TABS.map((tab, i) => {
          const isActive   = i === activeTab
          const isComplete =
            (i === 0 && !!vehicle) ||
            (i === 1 && isJobsComplete) ||
            (i === 2 && isGuidesComplete) ||
            (i === 3 && isPartsComplete)
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
            {selectedJobs.length > 0 && (
              <>
                <span className="text-white/20">·</span>
                <span className="text-orange text-xs truncate max-w-[100px]">
                  {selectedJobs.length === 1 ? selectedJobs[0].name : `${selectedJobs.length} Jobs`}
                </span>
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
            selectedJobs={selectedJobs}
            onJobToggle={handleJobToggle}
            onNext={() => { if (isJobsComplete) setActiveTab(2) }}
          />
        )}
        {activeTab === 2 && (
          <TechGuideTab
            vehicle={vehicle}
            jobs={selectedJobs}
            techGuides={techGuides}
            loading={guidesLoading}
            error={guidesError}
            onRetry={() => vehicle && loadAllTechGuides(vehicle, selectedJobs.filter(j => !techGuides[jobKey(j)]))}
            onNext={goNext}
          />
        )}
        {activeTab === 3 && (
          <PartsTab
            selectedJobs={selectedJobs}
            partsByJob={partsByJob}
            onPartsChange={handlePartsChange}
            onNext={goNext}
          />
        )}
        {activeTab === 4 && (
          <QuoteTab
            vehicle={vehicle}
            selectedJobs={selectedJobs}
            techGuides={techGuides}
            partsByJob={partsByJob}
            initialLaborRate={quoteDefaults?.laborRate}
            initialMarkupPct={quoteDefaults?.markupPct}
            initialTaxPct={quoteDefaults?.taxPct}
            initialCustomerName={quoteDefaults?.customerName}
            initialCustomerPhone={quoteDefaults?.customerPhone}
          />
        )}
      </div>

      {/* ── Diagnostic Tools ── */}
      <DiagnosticTools vehicle={vehicle} onFindTires={handleFindTires} />
    </div>
  )
}
