'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  INSPECTION_CATEGORIES,
  CATEGORY_ITEMS,
  type InspectionData,
  type SubItemData,
  categoryResult,
  initialInspectionData,
} from '@/lib/hd/dot-categories'

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

interface Unit {
  id: string
  unit_number: string
  manufacturer: string
  model: string
  serial_number: string | null
  fleet_account_id: string | null
  year: number | null
  total_hours: number | null
}

interface FleetAccount { id: string; fleet_name: string }

interface Profile {
  hd_tech_name:        string | null
  hd_epa_cert_number:  string | null
  business_name:       string | null
  full_name:           string | null
  hd_company_logo_url: string | null
}

interface Props {
  units:         Unit[]
  fleetAccounts: FleetAccount[]
  profile:       Profile
  initialUnitId: string | null
}

// ─── Sub-item row ─────────────────────────────────────────────────────────────

function SubItemRow({
  label, safetyCritical, state, onChange, even,
}: {
  label: string; safetyCritical?: boolean; state: SubItemData
  onChange: (f: 'result' | 'notes', v: string) => void; even: boolean
}) {
  const isFail = state.result === 'fail'
  return (
    <div style={{ background: isFail ? '#1a0505' : even ? '#0f1820' : '#111920', borderTop: '1px solid #1e3040' }}>
      <div className="flex items-center gap-3 px-4 py-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs leading-snug" style={{ color: isFail ? '#EF4444CC' : 'rgba(255,255,255,0.65)' }}>
            {label}
          </p>
          {safetyCritical && (
            <span className="inline-block text-xs font-bold px-1.5 py-0.5 rounded mt-0.5"
              style={{ background: '#EF444415', color: '#EF4444', fontSize: 9 }}>
              ⚠ SAFETY CRITICAL
            </span>
          )}
        </div>
        <div className="flex gap-0.5 flex-shrink-0">
          {(['pass', 'fail', 'na'] as const).map(r => (
            <button key={r} type="button" onClick={() => onChange('result', r)}
              className="text-xs font-bold transition-colors"
              style={{
                width: 44, padding: '4px 0', borderRadius: 4,
                background: state.result === r
                  ? r === 'pass' ? '#22C55E' : r === 'fail' ? '#EF4444' : '#4B5563'
                  : '#162030',
                color: state.result === r ? '#fff' : 'rgba(255,255,255,0.28)',
              }}>
              {r === 'na' ? 'N/A' : r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {isFail && (
        <div className="px-4 pb-2 pt-0">
          <textarea value={state.notes} onChange={e => onChange('notes', e.target.value)}
            placeholder="Describe violation found…" rows={2}
            className="w-full px-3 py-1.5 rounded text-xs text-white placeholder-white/20 resize-none"
            style={{ background: '#2d0505', border: '1px solid #EF444440', borderLeft: '3px solid #EF4444' }} />
        </div>
      )}
    </div>
  )
}

// ─── Category block ───────────────────────────────────────────────────────────

function CategoryBlock({ num, catId, label, state, onChange }: {
  num: number; catId: string; label: string
  state: { items: Record<string, SubItemData> }
  onChange: (itemId: string, f: 'result' | 'notes', v: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const items    = CATEGORY_ITEMS[catId] ?? []
  const derived  = categoryResult(state)
  const isFail   = derived === 'fail'
  const failCt   = items.filter(i => state.items[i.id]?.result === 'fail').length

  return (
    <div className="overflow-hidden" style={{ border: `1px solid ${isFail ? '#EF444440' : '#1e3040'}`, borderRadius: 6 }}>
      {/* Dark header bar */}
      <button type="button" onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left"
        style={{ background: isFail ? '#1a0000' : '#0d1820' }}>
        <span className="text-xs font-mono font-bold w-5 text-right flex-shrink-0"
          style={{ color: 'rgba(255,255,255,0.4)' }}>{num}</span>
        <p className="flex-1 text-sm font-bold text-white tracking-wide uppercase">{label}</p>
        {failCt > 0 && (
          <span className="text-xs font-bold px-2 py-0.5 rounded"
            style={{ background: '#EF444420', color: '#EF4444' }}>{failCt} FAIL</span>
        )}
        <span className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{
            background: isFail ? '#EF444420' : derived === 'na' ? '#6B728020' : '#22C55E20',
            color:      isFail ? '#EF4444'   : derived === 'na' ? '#9CA3AF'   : '#22C55E',
          }}>
          {isFail ? 'FAIL' : derived === 'na' ? 'N/A' : 'PASS'}
        </span>
        <svg className="w-4 h-4 transition-transform duration-150 flex-shrink-0"
          style={{ color: 'rgba(255,255,255,0.3)', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && items.map((item, idx) => (
        <SubItemRow key={item.id} label={item.label} safetyCritical={item.safetyCritical}
          state={state.items[item.id] ?? { result: 'pass', notes: '' }}
          onChange={(f, v) => onChange(item.id, f, v)} even={idx % 2 === 0} />
      ))}
    </div>
  )
}

// ─── Signature setup ──────────────────────────────────────────────────────────

function SignatureCanvasSetup({ onHasSignature }: { onHasSignature: (v: boolean) => void }) {
  useEffect(() => {
    const canvas = document.getElementById('sig-canvas') as HTMLCanvasElement | null
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width  = canvas.clientWidth  * dpr
    canvas.height = canvas.clientHeight * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.strokeStyle = HD_ORANGE; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    const isDown   = { current: false }
    const hasDrawn = { current: false }
    const cbRef    = { current: onHasSignature }
    cbRef.current  = onHasSignature
    function pos(e: MouseEvent | TouchEvent) {
      const rect = canvas!.getBoundingClientRect()
      const src  = 'touches' in e ? e.touches[0] : e as MouseEvent
      return { x: src.clientX - rect.left, y: src.clientY - rect.top }
    }
    function onStart(e: MouseEvent | TouchEvent) { e.preventDefault(); isDown.current = true; const {x,y} = pos(e); ctx.beginPath(); ctx.moveTo(x,y) }
    function onDraw(e: MouseEvent | TouchEvent)  { if (!isDown.current) return; e.preventDefault(); const {x,y} = pos(e); ctx.lineTo(x,y); ctx.stroke(); if (!hasDrawn.current) { hasDrawn.current = true; cbRef.current(true) } }
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

// ─── Inline editable table cell ───────────────────────────────────────────────

function InfoCell({ label, value, editable, type = 'text', onChange, children }: {
  label: string; value?: string; editable?: boolean; type?: string
  onChange?: (v: string) => void; children?: React.ReactNode
}) {
  return (
    <td className="px-3 py-2 align-top" style={{ borderBottom: '1px solid #1e3040', borderRight: '1px solid #1e3040', width: '50%', verticalAlign: 'top' }}>
      <div className="text-xs uppercase tracking-wider mb-0.5" style={{ color: 'rgba(255,255,255,0.4)', fontSize: 9, letterSpacing: '0.08em' }}>{label}</div>
      {children ?? (
        editable ? (
          <input type={type} value={value ?? ''} onChange={e => onChange?.(e.target.value)}
            className="w-full bg-transparent text-sm text-white outline-none border-b border-dashed"
            style={{ borderColor: 'rgba(255,255,255,0.15)', paddingBottom: 2 }} />
        ) : (
          <div className="text-sm text-white font-medium">{value || '—'}</div>
        )
      )}
    </td>
  )
}

// ─── Main form ────────────────────────────────────────────────────────────────

export default function DOTInspectionForm({ units, fleetAccounts, profile, initialUnitId }: Props) {
  const router = useRouter()

  // Auto-generate inspection ID on mount
  const [inspectionId] = useState(() => {
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const r = Math.random().toString(36).substring(2, 6).toUpperCase()
    return `INS-${d}-${r}`
  })

  const [selectedUnitId, setSelectedUnitId] = useState<string>(initialUnitId ?? '')
  const [inspDate,        setInspDate]       = useState(new Date().toISOString().split('T')[0])
  const [inspectorName,   setInspectorName]  = useState(profile.hd_tech_name ?? '')
  const [inspectorCert,   setInspectorCert]  = useState(profile.hd_epa_cert_number ?? '')
  const [odometerHours,   setOdometerHours]  = useState('')
  const [location,        setLocation]       = useState('')
  const [inspData,        setInspData]       = useState<InspectionData>(initialInspectionData)
  const [hasSignature,    setHasSignature]   = useState(false)
  const [signedAt,        setSignedAt]       = useState<string | null>(null)
  const [loading,         setLoading]        = useState(false)
  const [error,           setError]          = useState<string | null>(null)

  const selectedUnit    = units.find(u => u.id === selectedUnitId) ?? null
  const selectedAccount = fleetAccounts.find(a => a.id === (selectedUnit?.fleet_account_id ?? '')) ?? null

  function updateItem(catId: string, itemId: string, field: 'result' | 'notes', value: string) {
    setInspData(prev => ({
      ...prev,
      [catId]: {
        items: { ...prev[catId].items, [itemId]: { ...prev[catId].items[itemId], [field]: value } },
      },
    }))
  }

  const allItems   = Object.values(inspData).flatMap(cat => Object.values(cat.items))
  const passCount  = allItems.filter(i => i.result === 'pass').length
  const failCount  = allItems.filter(i => i.result === 'fail').length
  const naCount    = allItems.filter(i => i.result === 'na').length
  const overallPass = failCount === 0

  const hasSafetyCriticalFail = INSPECTION_CATEGORIES.some(cat =>
    CATEGORY_ITEMS[cat.id]?.some(item =>
      item.safetyCritical && inspData[cat.id]?.items[item.id]?.result === 'fail'
    )
  )

  const companyName = profile.business_name || profile.full_name || 'Fleet Inspection'
  const logoUrl     = profile.hd_company_logo_url

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!inspDate)              { setError('Inspection date is required'); return }
    if (!inspectorName.trim())  { setError('Inspector name is required');  return }
    if (!hasSignature)          { setError('Inspector signature is required — sign in the box below'); return }

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

  const printDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <>
      {/* ── Print CSS ── */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          .no-print { display: none !important; }
          @page { size: letter; margin: 0.6in; }
          body { background: white !important; color: #111 !important; font-family: Arial, sans-serif; }
          /* Repeated print header on every page */
          #print-header {
            position: fixed; top: -0.6in; left: -0.6in; right: -0.6in;
            background: #fff; border-bottom: 2px solid #E85D24;
            padding: 6px 0.6in; display: flex; align-items: center; justify-content: space-between;
          }
          /* Repeated footer on every page */
          #print-footer {
            position: fixed; bottom: -0.6in; left: -0.6in; right: -0.6in;
            background: #fff; border-top: 1px solid #ddd;
            padding: 4px 0.6in; font-size: 8px; color: #888;
            display: flex; justify-content: space-between;
          }
          /* Ensure body has padding for header/footer */
          body::before { content: ''; display: block; height: 0.5in; }
          .sig-page-break { page-break-before: always; }
          /* Toggle circles in print */
          .print-pass { background: #22C55E !important; color: white !important; }
          .print-fail { background: #EF4444 !important; color: white !important; border: none !important; }
          .print-na   { background: #9CA3AF !important; color: white !important; }
          .print-violation-note { border-left: 3px solid #EF4444 !important; color: #c00 !important; }
          .print-cat-header { background: #f0f0f0 !important; color: #111 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      ` }} />

      {/* ── Locked banner (when signed, before submit) ── */}
      {hasSignature && (
        <div className="no-print sticky top-0 z-50 flex items-center justify-center gap-2 py-2.5 text-center"
          style={{ background: '#7f1d1d', borderBottom: '2px solid #EF4444' }}>
          <svg className="w-4 h-4 text-red-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span className="text-sm font-bold text-red-200 tracking-widest">
            SIGNATURE CAPTURED — SUBMISSION WILL PERMANENTLY LOCK THIS RECORD
          </span>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="no-print mx-6 mt-4 rounded-xl p-4" style={{ background: '#2d0a0a', border: '1px solid #7f1d1d' }}>
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="pb-20">

        {/* ═══════════════════════════════════════════════════════════════════
            DOCUMENT HEADER — white-labeled to subscriber company
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="flex items-center gap-4 px-6 py-4 border-b no-print" style={{ background: '#0d1820', borderColor: '#1e3040' }}>
          {/* Left — company branding */}
          <div className="flex-shrink-0 w-44">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={companyName} className="h-10 w-auto object-contain" />
            ) : (
              <div>
                <p className="font-condensed font-bold text-white text-xl tracking-wide leading-tight">{companyName}</p>
              </div>
            )}
          </div>

          {/* Center — document title */}
          <div className="flex-1 text-center">
            <p className="font-condensed font-bold text-white text-xl tracking-widest leading-tight">
              ANNUAL VEHICLE INSPECTION REPORT
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Per 49 CFR Part 396 — Federal Motor Carrier Safety Regulations
            </p>
          </div>

          {/* Right — ID + date */}
          <div className="flex-shrink-0 w-44 text-right">
            <p className="text-sm font-mono font-bold text-white">{inspectionId}</p>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{printDate}</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Page 1</p>
          </div>
        </div>

        {/* ── Unit selector (screen only) ── */}
        <div className="px-6 py-3 border-b no-print" style={{ background: '#111920', borderColor: '#1e3040' }}>
          <div className="flex items-center gap-3">
            <label className="text-xs uppercase tracking-widest flex-shrink-0" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Select Unit
            </label>
            <select value={selectedUnitId} onChange={e => setSelectedUnitId(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg text-base sm:text-sm text-white"
              style={{ background: '#162030', border: '1px solid #1e3040' }}>
              <option value="">— No unit selected —</option>
              {units.map(u => (
                <option key={u.id} value={u.id}>{u.unit_number} — {u.manufacturer} {u.model}</option>
              ))}
            </select>
            <Link href="/hd/dot-inspections"
              className="text-xs px-3 py-2 rounded-lg flex-shrink-0 no-print"
              style={{ color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }}>
              ← Back
            </Link>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            UNIT INFO TABLE
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="px-6 py-4 border-b" style={{ borderColor: '#1e3040', background: '#0a0f14' }}>
          <table className="w-full" style={{ borderCollapse: 'collapse', border: '1px solid #1e3040' }}>
            <tbody>
              <tr>
                <InfoCell label="Unit Number"     value={selectedUnit?.unit_number     ?? '—'} />
                <InfoCell label="Fleet Account"   value={selectedAccount?.fleet_name   ?? '—'} />
              </tr>
              <tr>
                <InfoCell label="Manufacturer / Model" value={selectedUnit ? `${selectedUnit.manufacturer} ${selectedUnit.model}` : '—'} />
                <InfoCell label="Year"            value={selectedUnit?.year?.toString() ?? '—'} />
              </tr>
              <tr>
                <InfoCell label="VIN / Serial Number" value={selectedUnit?.serial_number ?? '—'} />
                <InfoCell label="Odometer / Hour Meter" value={odometerHours} editable onChange={setOdometerHours} />
              </tr>
              <tr>
                <InfoCell label="Inspector Name *" value={inspectorName} editable onChange={setInspectorName} />
                <InfoCell label="Certification Number" value={inspectorCert} editable onChange={setInspectorCert} />
              </tr>
              <tr>
                <InfoCell label="Inspection Date *">
                  <input type="date" value={inspDate} onChange={e => setInspDate(e.target.value)} required
                    className="w-full bg-transparent text-sm text-white outline-none border-b border-dashed"
                    style={{ borderColor: 'rgba(255,255,255,0.15)', paddingBottom: 2 }} />
                </InfoCell>
                <InfoCell label="Location" value={location} editable onChange={setLocation} />
              </tr>
              <tr>
                <InfoCell label="Inspection Type">
                  <div className="text-sm text-white">Annual CVSA — 49 CFR Part 396</div>
                </InfoCell>
                <InfoCell label="Overall Result">
                  <span className="inline-block text-sm font-bold px-3 py-0.5 rounded-full"
                    style={{
                      background: overallPass ? '#22C55E20' : '#EF444420',
                      color:      overallPass ? '#22C55E'   : '#EF4444',
                      border:     `1px solid ${overallPass ? '#22C55E50' : '#EF444450'}`,
                    }}>
                    {overallPass ? '● PASS' : '● FAIL'}
                    {failCount > 0 && ` — ${failCount} VIOLATION${failCount !== 1 ? 'S' : ''}`}
                  </span>
                </InfoCell>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            CVSA INSPECTION CATEGORIES
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="px-6 py-4 space-y-2">
          <div className="flex items-center justify-between mb-2">
            <p className="font-condensed font-bold text-white text-lg tracking-wide">
              CVSA INSPECTION ITEMS
            </p>
            <Link href="/hd/dot-inspections" className="text-xs no-print"
              style={{ color: 'rgba(255,255,255,0.3)' }}>
              ← Back to inspections
            </Link>
          </div>

          {hasSafetyCriticalFail && (
            <div className="rounded-lg px-4 py-3 flex items-center gap-3 mb-3"
              style={{ background: '#EF444420', border: '1px solid #EF444450' }}>
              <span style={{ color: '#F59E0B', fontSize: 18 }}>⚠</span>
              <p className="text-sm font-bold" style={{ color: '#EF4444' }}>
                SAFETY-CRITICAL VIOLATION — Vehicle must be taken out of service immediately.
              </p>
            </div>
          )}

          {INSPECTION_CATEGORIES.map(cat => (
            <CategoryBlock key={cat.id} num={cat.num} catId={cat.id} label={cat.label}
              state={inspData[cat.id]}
              onChange={(itemId, field, value) => updateItem(cat.id, itemId, field, value)} />
          ))}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════
            ELECTRONIC SIGNATURE
        ═══════════════════════════════════════════════════════════════════ */}
        <div className="px-6 py-4 mx-6 mb-4 rounded-xl" style={{ border: '1px solid #1e3040', background: '#111920' }}>
          <p className="font-condensed font-bold text-white text-lg tracking-wide mb-3">INSPECTOR CERTIFICATION</p>

          <div className="rounded-lg p-4 mb-4" style={{ background: '#0d1820', border: `1px solid ${HD_BLUE}30` }}>
            <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>
              By signing below, I certify that this vehicle has been inspected in accordance with FMCSA 49 CFR Part 396,
              that all defects found have been noted, and that I am a qualified inspector as defined by 49 CFR 396.19.
              This electronic signature is legally equivalent to a handwritten signature.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Inspector Printed Name *
              </label>
              <input type="text" value={inspectorName} onChange={e => setInspectorName(e.target.value)}
                placeholder="Full name" required
                className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20"
                style={{ background: '#162030', border: '1px solid #1e3040' }} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Certification Number
              </label>
              <input type="text" value={inspectorCert} onChange={e => setInspectorCert(e.target.value)}
                placeholder="Inspector cert #"
                className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20"
                style={{ background: '#162030', border: '1px solid #1e3040' }} />
            </div>
          </div>

          <label className="block text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Electronic Signature *
          </label>
          <canvas id="sig-canvas" className="w-full rounded-lg touch-none"
            style={{
              height: 130, background: '#162030', cursor: 'crosshair', display: 'block',
              border: `2px solid ${hasSignature ? HD_ORANGE : '#1e3040'}`,
            }} />
          <SignatureCanvasSetup onHasSignature={(v) => {
            setHasSignature(v)
            if (v) setSignedAt(new Date().toLocaleString())
          }} />

          <div className="flex items-center justify-between mt-2">
            {hasSignature && signedAt ? (
              <p className="text-xs font-semibold" style={{ color: '#22C55E' }}>
                ✓ Signature captured — {signedAt}
              </p>
            ) : (
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>Sign above with mouse or touch</p>
            )}
            <button type="button"
              onClick={() => {
                const c = document.getElementById('sig-canvas') as HTMLCanvasElement | null
                if (!c) return
                c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
                setHasSignature(false); setSignedAt(null)
              }}
              className="text-xs px-2 py-1 rounded" style={{ color: 'rgba(255,255,255,0.35)', border: '1px solid #1e3040' }}>
              Clear
            </button>
          </div>
        </div>

        {/* ── Submit ── */}
        <div className="px-6 pb-6 no-print">
          <button type="submit" disabled={loading || !inspDate || !inspectorName.trim() || !hasSignature}
            className="w-full py-4 rounded-xl font-bold text-white text-sm tracking-wide transition-opacity"
            style={{ background: HD_ORANGE, opacity: loading || !inspDate || !inspectorName.trim() || !hasSignature ? 0.45 : 1 }}>
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
          <p className="text-xs text-center mt-2" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Once signed, this record is permanently locked and cannot be edited. A PDF can be generated after submission.
          </p>
        </div>

      </form>

      {/* ── Sticky bottom totals bar ── */}
      <div className="no-print fixed bottom-0 inset-x-0 lg:left-56 z-40 flex items-center gap-4 px-5 py-3"
        style={{ background: '#0a0f14', borderTop: '2px solid #1e3040' }}>
        <span className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>Items:</span>
        <span className="text-sm font-bold" style={{ color: '#22C55E' }}>✓ {passCount} Pass</span>
        {failCount > 0 && <span className="text-sm font-bold" style={{ color: '#EF4444' }}>✗ {failCount} Fail</span>}
        <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>{naCount} N/A</span>
        <div className="flex-1" />
        <span className="text-xs uppercase tracking-widest mr-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Overall</span>
        <span className="text-sm font-bold px-3 py-1 rounded-full"
          style={{
            background: overallPass ? '#22C55E20' : '#EF444420',
            color:      overallPass ? '#22C55E'   : '#EF4444',
            border:     `1px solid ${overallPass ? '#22C55E50' : '#EF444450'}`,
          }}>
          {overallPass ? 'PASS' : `FAIL — ${failCount} violation${failCount !== 1 ? 's' : ''}`}
        </span>
        {inspectionId && (
          <span className="text-xs font-mono ml-2" style={{ color: 'rgba(255,255,255,0.2)' }}>{inspectionId}</span>
        )}
      </div>
    </>
  )
}
