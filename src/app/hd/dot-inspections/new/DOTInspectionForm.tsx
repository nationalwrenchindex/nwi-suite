'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { INSPECTION_CATEGORIES, type InspectionResult, initialInspectionData, type InspectionData } from '@/lib/hd/dot-categories'

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

interface Unit {
  id: string
  unit_number: string
  manufacturer: string
  model: string
  serial_number: string | null
  fleet_account_id: string | null
}

interface FleetAccount {
  id: string
  fleet_name: string
}

interface Profile {
  hd_tech_name: string | null
  hd_epa_cert_number: string | null
}

interface Props {
  units: Unit[]
  fleetAccounts: FleetAccount[]
  profile: Profile
  initialUnitId: string | null
}

// ─── Signature Canvas ─────────────────────────────────────────────────────────

function SignatureCanvas({
  onHasSignature,
}: {
  onHasSignature: (has: boolean) => void
}) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const hasDrawn    = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr   = window.devicePixelRatio || 1
    const cssW  = canvas.clientWidth
    const cssH  = canvas.clientHeight
    canvas.width  = cssW * dpr
    canvas.height = cssH * dpr

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = HD_ORANGE
    ctx.lineWidth   = 2.5
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'

    const isDown = { current: false }

    function pos(e: MouseEvent | TouchEvent) {
      const rect = canvas!.getBoundingClientRect()
      const src  = 'touches' in e ? e.touches[0] : e as MouseEvent
      return { x: src.clientX - rect.left, y: src.clientY - rect.top }
    }

    function onStart(e: MouseEvent | TouchEvent) {
      e.preventDefault()
      isDown.current = true
      const { x, y } = pos(e)
      ctx.beginPath()
      ctx.moveTo(x, y)
    }

    function onDraw(e: MouseEvent | TouchEvent) {
      if (!isDown.current) return
      e.preventDefault()
      const { x, y } = pos(e)
      ctx.lineTo(x, y)
      ctx.stroke()
      if (!hasDrawn.current) {
        hasDrawn.current = true
        onHasSignature(true)
      }
    }

    function onEnd() { isDown.current = false }

    canvas.addEventListener('mousedown',  onStart)
    canvas.addEventListener('mousemove',  onDraw)
    canvas.addEventListener('mouseup',    onEnd)
    canvas.addEventListener('mouseleave', onEnd)
    canvas.addEventListener('touchstart', onStart, { passive: false })
    canvas.addEventListener('touchmove',  onDraw,  { passive: false })
    canvas.addEventListener('touchend',   onEnd)

    return () => {
      canvas.removeEventListener('mousedown',  onStart)
      canvas.removeEventListener('mousemove',  onDraw)
      canvas.removeEventListener('mouseup',    onEnd)
      canvas.removeEventListener('mouseleave', onEnd)
      canvas.removeEventListener('touchstart', onStart)
      canvas.removeEventListener('touchmove',  onDraw)
      canvas.removeEventListener('touchend',   onEnd)
    }
  }, [onHasSignature])

  function clear() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasDrawn.current = false
    onHasSignature(false)
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg touch-none"
        style={{
          height: 120,
          background: '#162030',
          border: '1px solid #1e3040',
          cursor: 'crosshair',
          display: 'block',
        }}
      />
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
          Sign above with mouse or finger
        </p>
        <button
          type="button"
          onClick={clear}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ color: 'rgba(255,255,255,0.35)', border: '1px solid #1e3040' }}
        >
          Clear
        </button>
      </div>
    </div>
  )
}

// ─── Category Row ─────────────────────────────────────────────────────────────

function CategoryRow({
  num,
  label,
  catId,
  state,
  onChange,
}: {
  num: number
  label: string
  catId: string
  state: { result: InspectionResult; notes: string }
  onChange: (catId: string, field: 'result' | 'notes', value: string) => void
}) {
  const isFail = state.result === 'fail'

  return (
    <div
      className="rounded-lg"
      style={{ border: `1px solid ${isFail ? '#EF444460' : '#1e3040'}`, background: isFail ? '#1a0505' : '#111920' }}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          className="text-xs font-mono font-bold w-6 text-right flex-shrink-0"
          style={{ color: 'rgba(255,255,255,0.25)' }}
        >
          {num}
        </span>
        <p className="flex-1 text-sm text-white font-medium">{label}</p>
        <div className="flex gap-1 flex-shrink-0">
          {(['pass', 'fail', 'na'] as const).map(r => (
            <button
              key={r}
              type="button"
              onClick={() => onChange(catId, 'result', r)}
              className="px-2.5 py-1.5 text-xs font-bold rounded transition-colors"
              style={{
                background: state.result === r
                  ? r === 'pass' ? '#22C55E'  : r === 'fail' ? '#EF4444' : '#4B5563'
                  : '#162030',
                color: state.result === r ? '#fff' : 'rgba(255,255,255,0.35)',
              }}
            >
              {r === 'na' ? 'N/A' : r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {isFail && (
        <div className="px-4 pb-3 pt-0">
          <textarea
            value={state.notes}
            onChange={e => onChange(catId, 'notes', e.target.value)}
            placeholder="Describe violation found…"
            rows={2}
            className="w-full px-3 py-2 rounded text-xs text-white placeholder-white/20 resize-none"
            style={{ background: '#162030', border: '1px solid #EF444440' }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Main Form ────────────────────────────────────────────────────────────────

export default function DOTInspectionForm({ units, fleetAccounts, profile, initialUnitId }: Props) {
  const router = useRouter()

  const [selectedUnitId, setSelectedUnitId] = useState<string>(initialUnitId ?? '')
  const [inspDate,        setInspDate]       = useState(new Date().toISOString().split('T')[0])
  const [inspectorName,   setInspectorName]  = useState(profile.hd_tech_name ?? '')
  const [inspectorCert,   setInspectorCert]  = useState(profile.hd_epa_cert_number ?? '')
  const [odometerHours,   setOdometerHours]  = useState('')
  const [location,        setLocation]       = useState('')
  const [inspData,        setInspData]       = useState<InspectionData>(initialInspectionData)
  const [hasSignature,    setHasSignature]   = useState(false)
  const [loading,         setLoading]        = useState(false)
  const [error,           setError]          = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // Get canvas element from DOM for data capture on submit
  useEffect(() => {
    canvasRef.current = document.getElementById('sig-canvas') as HTMLCanvasElement | null
  }, [])

  const selectedUnit    = units.find(u => u.id === selectedUnitId) ?? null
  const selectedAccount = fleetAccounts.find(a => a.id === (selectedUnit?.fleet_account_id ?? '')) ?? null

  function updateCategory(catId: string, field: 'result' | 'notes', value: string) {
    setInspData(prev => ({ ...prev, [catId]: { ...prev[catId], [field]: value } }))
  }

  const failCount = Object.values(inspData).filter(c => c.result === 'fail').length

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!inspDate) { setError('Inspection date is required'); return }
    if (!inspectorName.trim()) { setError('Inspector name is required'); return }
    if (!hasSignature) { setError('Inspector signature is required — sign in the box below'); return }

    const canvas = document.getElementById('sig-canvas') as HTMLCanvasElement | null
    const signatureData = canvas?.toDataURL('image/png') ?? null

    setLoading(true)
    try {
      const res = await fetch('/api/hd/dot-inspections', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id:               selectedUnitId || undefined,
          fleet_account_id:      selectedUnit?.fleet_account_id || undefined,
          inspection_date:       inspDate,
          inspector_name:        inspectorName || undefined,
          inspector_cert_number: inspectorCert || undefined,
          odometer_hours:        odometerHours || undefined,
          location:              location || undefined,
          inspection_data:       inspData,
          signature_data:        signatureData,
        }),
      })

      const json = await res.json() as { id?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Failed to save inspection')

      router.push(`/hd/dot-inspections/${json.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save inspection')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            HD Suite — Compliance
          </p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">ANNUAL DOT INSPECTION</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
            CVSA 18-point vehicle inspection — FMCSA 49 CFR Part 396
          </p>
        </div>
        <Link
          href="/hd/dot-inspections"
          className="text-xs px-3 py-1.5 rounded-lg flex-shrink-0"
          style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }}
        >
          ← Back
        </Link>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl p-4" style={{ background: '#2d0a0a', border: '1px solid #7f1d1d' }}>
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* ── Unit Selection ── */}
      <div className="rounded-xl p-5 space-y-4" style={{ background: '#111920', border: '1px solid #1e3040' }}>
        <p className="font-condensed font-bold text-white text-lg tracking-wide">UNIT INFORMATION</p>

        <div>
          <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Unit <span style={{ color: 'rgba(255,255,255,0.25)' }}>(optional — select from your fleet)</span>
          </label>
          <select
            value={selectedUnitId}
            onChange={e => setSelectedUnitId(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
            style={{ background: '#162030', border: '1px solid #1e3040' }}
          >
            <option value="">— No unit selected —</option>
            {units.map(u => (
              <option key={u.id} value={u.id}>
                {u.unit_number} — {u.manufacturer} {u.model}
              </option>
            ))}
          </select>
        </div>

        {selectedUnit && (
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Unit Number',   value: selectedUnit.unit_number },
              { label: 'Manufacturer',  value: `${selectedUnit.manufacturer} ${selectedUnit.model}` },
              { label: 'Serial / VIN',  value: selectedUnit.serial_number ?? '—' },
              { label: 'Fleet Account', value: selectedAccount?.fleet_name ?? '—' },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-lg p-3" style={{ background: '#162030', border: '1px solid #1e3040' }}>
                <p className="text-xs uppercase tracking-widest mb-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{label}</p>
                <p className="text-sm text-white font-medium">{value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Inspection Details ── */}
      <div className="rounded-xl p-5 space-y-4" style={{ background: '#111920', border: '1px solid #1e3040' }}>
        <p className="font-condensed font-bold text-white text-lg tracking-wide">INSPECTION DETAILS</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Inspection Date <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input
              type="date"
              value={inspDate}
              onChange={e => setInspDate(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
              style={{ background: '#162030', border: '1px solid #1e3040' }}
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Location
            </label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="City, State or terminal name"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
              style={{ background: '#162030', border: '1px solid #1e3040' }}
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Inspector Name <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input
              type="text"
              value={inspectorName}
              onChange={e => setInspectorName(e.target.value)}
              placeholder="Full name"
              required
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
              style={{ background: '#162030', border: '1px solid #1e3040' }}
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Certification Number
            </label>
            <input
              type="text"
              value={inspectorCert}
              onChange={e => setInspectorCert(e.target.value)}
              placeholder="e.g. EPA 608 cert #"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
              style={{ background: '#162030', border: '1px solid #1e3040' }}
            />
          </div>

          <div className="col-span-2">
            <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Odometer / Hour Meter Reading
            </label>
            <input
              type="text"
              value={odometerHours}
              onChange={e => setOdometerHours(e.target.value)}
              placeholder="e.g. 125,432 mi or 4,210 hrs"
              className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/20"
              style={{ background: '#162030', border: '1px solid #1e3040' }}
            />
          </div>
        </div>
      </div>

      {/* ── 18 CVSA Categories ── */}
      <div className="rounded-xl p-5 space-y-3" style={{ background: '#111920', border: '1px solid #1e3040' }}>
        <div className="flex items-center justify-between mb-1">
          <p className="font-condensed font-bold text-white text-lg tracking-wide">CVSA INSPECTION CATEGORIES</p>
          <div className="flex gap-3 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <span>
              {Object.values(inspData).filter(c => c.result === 'pass').length} Pass
            </span>
            {failCount > 0 && (
              <span style={{ color: '#EF4444' }}>
                {failCount} Fail
              </span>
            )}
            <span>
              {Object.values(inspData).filter(c => c.result === 'na').length} N/A
            </span>
          </div>
        </div>

        <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.3)' }}>
          Mark each category PASS, FAIL, or N/A. Failed categories require a violation description.
        </p>

        {INSPECTION_CATEGORIES.map(cat => (
          <CategoryRow
            key={cat.id}
            num={cat.num}
            label={cat.label}
            catId={cat.id}
            state={inspData[cat.id]}
            onChange={updateCategory}
          />
        ))}

        {/* Overall indicator */}
        {failCount > 0 && (
          <div
            className="rounded-lg p-4 flex items-center gap-3"
            style={{ background: '#EF444420', border: '1px solid #EF444450' }}
          >
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="#EF4444" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-sm font-bold" style={{ color: '#EF4444' }}>
              INSPECTION FAILS — {failCount} violation{failCount !== 1 ? 's' : ''} found
            </p>
          </div>
        )}
      </div>

      {/* ── Electronic Signature ── */}
      <div className="rounded-xl p-5 space-y-4" style={{ background: '#111920', border: '1px solid #1e3040' }}>
        <p className="font-condensed font-bold text-white text-lg tracking-wide">ELECTRONIC SIGNATURE</p>

        <div
          className="rounded-lg p-4"
          style={{ background: '#0d1820', border: '1px solid #1A6BAF30' }}
        >
          <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
            By signing below, I certify that this vehicle has been inspected in accordance with FMCSA 49 CFR Part 396
            and that all defects found have been noted. I am a qualified inspector as defined by 49 CFR 396.19.
            This electronic record is legally equivalent to a written signature.
          </p>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Inspector Signature <span style={{ color: '#EF4444' }}>*</span>
          </label>
          <canvas
            id="sig-canvas"
            className="w-full rounded-lg touch-none"
            style={{
              height: 120,
              background: '#162030',
              border: `1px solid ${hasSignature ? HD_ORANGE : '#1e3040'}`,
              cursor: 'crosshair',
              display: 'block',
            }}
          />
          <SignatureCanvasSetup onHasSignature={setHasSignature} />
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
              Sign above with mouse or finger
            </p>
            <button
              type="button"
              onClick={() => {
                const canvas = document.getElementById('sig-canvas') as HTMLCanvasElement | null
                if (!canvas) return
                const ctx = canvas.getContext('2d')!
                ctx.clearRect(0, 0, canvas.width, canvas.height)
                setHasSignature(false)
              }}
              className="text-xs px-2 py-1 rounded"
              style={{ color: 'rgba(255,255,255,0.35)', border: '1px solid #1e3040' }}
            >
              Clear
            </button>
          </div>
          {hasSignature && (
            <p className="text-xs mt-1.5" style={{ color: '#22C55E' }}>
              ✓ Signature captured
            </p>
          )}
        </div>
      </div>

      {/* ── Submit ── */}
      <button
        type="submit"
        disabled={loading || !inspDate || !inspectorName.trim() || !hasSignature}
        className="w-full py-4 rounded-xl font-bold text-white text-sm transition-opacity"
        style={{
          background: HD_ORANGE,
          opacity: loading || !inspDate || !inspectorName.trim() || !hasSignature ? 0.5 : 1,
        }}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Saving and Locking Inspection…
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Complete and Sign Inspection — Lock Record
          </span>
        )}
      </button>

      <p className="text-xs text-center leading-relaxed pb-4" style={{ color: 'rgba(255,255,255,0.25)' }}>
        Once signed, this record is permanently locked and cannot be edited. A PDF can be generated after submission.
      </p>

    </form>
  )
}

// Separate component to set up canvas event listeners without polluting the main form
function SignatureCanvasSetup({ onHasSignature }: { onHasSignature: (v: boolean) => void }) {
  useEffect(() => {
    const canvas = document.getElementById('sig-canvas') as HTMLCanvasElement | null
    if (!canvas) return

    const dpr  = window.devicePixelRatio || 1
    const cssW = canvas.clientWidth
    const cssH = canvas.clientHeight
    canvas.width  = cssW * dpr
    canvas.height = cssH * dpr

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = HD_ORANGE
    ctx.lineWidth   = 2.5
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'

    const isDown = { current: false }
    const onHasRef = { current: onHasSignature }
    onHasRef.current = onHasSignature

    function getPos(e: MouseEvent | TouchEvent) {
      const rect = canvas!.getBoundingClientRect()
      const src  = 'touches' in e ? e.touches[0] : e as MouseEvent
      return { x: src.clientX - rect.left, y: src.clientY - rect.top }
    }

    function onStart(e: MouseEvent | TouchEvent) {
      e.preventDefault()
      isDown.current = true
      const { x, y } = getPos(e)
      ctx.beginPath()
      ctx.moveTo(x, y)
    }

    function onDraw(e: MouseEvent | TouchEvent) {
      if (!isDown.current) return
      e.preventDefault()
      const { x, y } = getPos(e)
      ctx.lineTo(x, y)
      ctx.stroke()
      onHasRef.current(true)
    }

    function onEnd() { isDown.current = false }

    canvas.addEventListener('mousedown',  onStart)
    canvas.addEventListener('mousemove',  onDraw)
    canvas.addEventListener('mouseup',    onEnd)
    canvas.addEventListener('mouseleave', onEnd)
    canvas.addEventListener('touchstart', onStart, { passive: false })
    canvas.addEventListener('touchmove',  onDraw,  { passive: false })
    canvas.addEventListener('touchend',   onEnd)

    return () => {
      canvas.removeEventListener('mousedown',  onStart)
      canvas.removeEventListener('mousemove',  onDraw)
      canvas.removeEventListener('mouseup',    onEnd)
      canvas.removeEventListener('mouseleave', onEnd)
      canvas.removeEventListener('touchstart', onStart)
      canvas.removeEventListener('touchmove',  onDraw)
      canvas.removeEventListener('touchend',   onEnd)
    }
  }, [onHasSignature])

  return null
}
