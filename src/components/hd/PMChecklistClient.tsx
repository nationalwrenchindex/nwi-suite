'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  SAFETY_ITEMS, CHECKLIST_SECTIONS, PM_TYPES,
  type ItemState, type PMTypeValue,
} from './checklist-data'

const HD_ORANGE = '#E85D24'
const HD_BLUE   = '#1A6BAF'

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'setup' | 'safety' | 'checklist' | 'signature' | 'done'

interface WorkOrderOption {
  id: string
  work_order_number: string | null
  unit_id: string | null
  fleet_account_id: string | null
  current_setpoint: string | null
  tech_name: string | null
}

interface UnitOption {
  id: string
  unit_number: string
  manufacturer: string
  model: string
  unit_type: string | null
  total_hours: number | null
}

interface FlaggedItem {
  id: string
  text: string
  section: string
}

// ─── Small components ─────────────────────────────────────────────────────────

function StepBadge({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
      style={{
        background: done ? '#22C55E' : active ? HD_ORANGE : '#1e3040',
        color:      done || active ? '#fff' : 'rgba(255,255,255,0.3)',
      }}
    >
      {done ? '✓' : n}
    </div>
  )
}

function RefWarn() {
  return (
    <p className="text-xs font-semibold mt-1" style={{ color: '#EF4444' }}>
      ⚠ REFRIGERANT SAFETY — EPA 608 licensed technicians only. Extremely dangerous. Always wear full PPE.
    </p>
  )
}

function ItemButtons({
  state,
  onChange,
}: {
  state: ItemState
  onChange: (s: ItemState) => void
}) {
  const btn = (
    val: NonNullable<ItemState>,
    label: string,
    activeColor: string,
    activeBg: string,
  ) => (
    <button
      type="button"
      onClick={() => onChange(state === val ? null : val)}
      className="px-2.5 py-1 rounded text-xs font-semibold transition-all"
      style={{
        background:  state === val ? activeBg : '#1e3040',
        color:       state === val ? activeColor : 'rgba(255,255,255,0.4)',
        border:      state === val ? `1px solid ${activeColor}60` : '1px solid transparent',
      }}
    >
      {label}
    </button>
  )
  return (
    <div className="flex gap-1.5 flex-shrink-0">
      {btn('pass', '✓ Pass', '#22C55E', '#14532d')}
      {btn('flag', '⚑ Flag', HD_ORANGE, '#4a1a08')}
      {btn('na',   'N/A',    '#9CA3AF', '#374151')}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PMChecklistClient({
  workOrders,
  units,
  userId,
}: {
  workOrders: WorkOrderOption[]
  units:      UnitOption[]
  userId:     string
}) {
  const router = useRouter()

  // Setup state
  const [step,       setStep]       = useState<Step>('setup')
  const [selectedWO, setSelectedWO] = useState<string>('')
  const [selectedUnit, setSelectedUnit] = useState<string>('')
  const [pmType,     setPmType]     = useState<PMTypeValue>('3000hr')
  const [isMultiTemp, setIsMultiTemp] = useState(false)
  const [techName,   setTechName]   = useState('')

  // Safety placard state
  const [safetyChecked, setSafetyChecked] = useState<Record<string, boolean>>({})
  const [safetyInitials, setSafetyInitials] = useState('')
  const [safetyDate,     setSafetyDate]     = useState(() => new Date().toISOString().slice(0, 10))
  const [safetyTime,     setSafetyTime]     = useState(() => {
    const d = new Date()
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })

  // Checklist state
  const [itemStates,  setItemStates]  = useState<Record<string, ItemState>>({})
  const [itemInputs,  setItemInputs]  = useState<Record<string, string>>({})
  const [alarmFound,  setAlarmFound]  = useState('')
  const [alarmCleared, setAlarmCleared] = useState('')

  // Signature
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const drawing    = useRef(false)
  const lastPos    = useRef<{ x: number; y: number } | null>(null)
  const [hasSig,   setHasSig]        = useState(false)

  // Submission
  const [submitting, setSubmitting]  = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ── Derived ───────────────────────────────────────────────────────────────
  const allSafetyChecked = SAFETY_ITEMS.every(s => safetyChecked[s.id])
  const safetyComplete   = allSafetyChecked && safetyInitials.trim().length >= 2 && safetyDate && safetyTime

  const selectedUnitData = units.find(u => u.id === selectedUnit)
  const unitType         = selectedUnitData?.unit_type ?? 'trailer'

  const visibleSections = CHECKLIST_SECTIONS.filter(s => {
    if (!s.showWhen) return true
    if (s.showWhen === 'multitemp') return isMultiTemp
    if (s.showWhen === '12month')   return pmType === '12month' || pmType === '24month'
    if (s.showWhen === '24month')   return pmType === '24month'
    return true
  })

  const flaggedItems: FlaggedItem[] = []
  for (const section of visibleSections) {
    for (const item of section.items) {
      if (itemStates[item.id] === 'flag') {
        flaggedItems.push({ id: item.id, text: item.text, section: section.title })
      }
      // Auto-flag battery CCA < 800
      if (item.input?.autoFlag && itemInputs[item.id]) {
        const val = Number(itemInputs[item.id])
        if (!isNaN(val) && val < item.input.autoFlag.below && itemStates[item.id] !== 'flag') {
          flaggedItems.push({ id: item.id, text: item.text + ` — CCA: ${val}`, section: section.title })
        }
      }
    }
  }

  const totalItems = visibleSections.reduce((s, sec) => s + sec.items.length, 0)
  const doneItems  = visibleSections.reduce((s, sec) =>
    s + sec.items.filter(i => itemStates[i.id] !== null && itemStates[i.id] !== undefined).length, 0)
  const pct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0

  // ── Signature canvas ──────────────────────────────────────────────────────
  function getPos(e: { clientX: number; clientY: number }, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const startDraw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    drawing.current = true
    const canvas = canvasRef.current
    if (!canvas) return
    const pos = getPos(
      'touches' in e ? (e.touches[0] as unknown as { clientX: number; clientY: number }) : e.nativeEvent as MouseEvent,
      canvas,
    )
    lastPos.current = pos
  }, [])

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return
    const canvas = canvasRef.current
    const ctx    = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    e.preventDefault()
    const pos = getPos(
      'touches' in e ? (e.touches[0] as unknown as { clientX: number; clientY: number }) : e.nativeEvent as MouseEvent,
      canvas,
    )
    if (lastPos.current) {
      ctx.beginPath()
      ctx.moveTo(lastPos.current.x, lastPos.current.y)
      ctx.lineTo(pos.x, pos.y)
      ctx.strokeStyle = '#E85D24'
      ctx.lineWidth   = 2.5
      ctx.lineCap     = 'round'
      ctx.stroke()
      setHasSig(true)
    }
    lastPos.current = pos
  }, [])

  const stopDraw = useCallback(() => { drawing.current = false; lastPos.current = null }, [])

  function clearSig() {
    const canvas = canvasRef.current
    const ctx    = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSig(false)
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setSubmitting(true)
    setSubmitError(null)

    const signatureBase64 = hasSig ? canvasRef.current?.toDataURL('image/png') ?? null : null
    const batteryCCA      = itemInputs['1-18'] ? Number(itemInputs['1-18']) : null

    // Build checklist_data payload
    const checklistData: Record<string, { state: ItemState; input?: string }> = {}
    for (const section of visibleSections) {
      for (const item of section.items) {
        checklistData[item.id] = {
          state: itemStates[item.id] ?? null,
          ...(item.input && itemInputs[item.id] ? { input: itemInputs[item.id] } : {}),
        }
      }
    }

    const body = {
      unit_id:           selectedUnit || null,
      work_order_id:     selectedWO   || null,
      pm_type:           pmType,
      checklist_data:    checklistData,
      safety_initials:   safetyInitials,
      safety_acknowledged: true,
      safety_acknowledged_at: `${safetyDate}T${safetyTime}:00`,
      alarm_codes_found:  alarmFound   || null,
      alarm_codes_cleared: alarmCleared || null,
      battery_cca:        batteryCCA,
      flagged_items:      flaggedItems,
      signature_base64:   signatureBase64,
      tech_name:          techName || null,
    }

    try {
      const res = await fetch('/api/hd/pm-checklist', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Submission failed')
      setStep('done')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  const steps: { key: Step; label: string }[] = [
    { key: 'setup',     label: 'Setup'     },
    { key: 'safety',    label: 'Safety'    },
    { key: 'checklist', label: 'Checklist' },
    { key: 'signature', label: 'Sign & Complete' },
  ]
  const stepIdx = { setup: 0, safety: 1, checklist: 2, signature: 3, done: 4 }

  // ── Render ────────────────────────────────────────────────────────────────

  if (step === 'done') {
    return (
      <div className="max-w-2xl mx-auto p-6 text-center">
        <div className="rounded-2xl p-8" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: '#14532d' }}>
            <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="font-condensed font-bold text-2xl text-white mb-2">PM CHECKLIST COMPLETE</h2>
          <p className="text-sm mb-2" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {totalItems} items inspected · {flaggedItems.length} flagged for customer review
          </p>
          {flaggedItems.length > 0 && (
            <div className="mt-4 text-left rounded-xl p-4" style={{ background: '#162030' }}>
              <p className="font-semibold mb-2" style={{ color: HD_ORANGE }}>Flagged Items</p>
              {flaggedItems.map(f => (
                <div key={f.id} className="py-1.5 border-b text-sm" style={{ borderColor: '#1e3040', color: 'rgba(255,255,255,0.7)' }}>
                  <span className="font-medium" style={{ color: HD_ORANGE }}>⚑ </span>{f.text}
                  <span className="text-xs ml-2" style={{ color: 'rgba(255,255,255,0.3)' }}>{f.section}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-3 mt-6 justify-center">
            <button
              onClick={() => { setStep('setup'); setItemStates({}); setItemInputs({}); setSafetyChecked({}); setHasSig(false) }}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: HD_ORANGE }}
            >
              Start New PM
            </button>
            <button
              onClick={() => router.push('/hd/dashboard')}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold border"
              style={{ color: 'rgba(255,255,255,0.6)', borderColor: '#1e3040' }}
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">

      {/* Step tracker */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <StepBadge
                n={i + 1}
                active={step === s.key}
                done={stepIdx[step] > i}
              />
              <span
                className="text-xs hidden sm:block"
                style={{ color: step === s.key ? '#fff' : 'rgba(255,255,255,0.3)' }}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="w-6 h-px" style={{ background: '#1e3040' }} />
            )}
          </div>
        ))}
      </div>

      {/* ── STEP 1: Setup ─────────────────────────────────────────────────── */}
      {step === 'setup' && (
        <div className="rounded-xl p-6 space-y-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <h2 className="font-condensed font-bold text-xl text-white tracking-wide">PM SETUP</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Work Order (optional)
              </label>
              <select
                value={selectedWO}
                onChange={e => setSelectedWO(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white"
                style={{ background: '#162030', border: '1px solid #1e3040' }}
              >
                <option value="">— Select work order —</option>
                {workOrders.map(wo => (
                  <option key={wo.id} value={wo.id}>
                    {wo.work_order_number ?? `WO-${wo.id.slice(0, 6).toUpperCase()}`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Fleet Unit
              </label>
              <select
                value={selectedUnit}
                onChange={e => setSelectedUnit(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white"
                style={{ background: '#162030', border: '1px solid #1e3040' }}
              >
                <option value="">— Select unit —</option>
                {units.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.unit_number} — {u.manufacturer} {u.model}
                    {u.total_hours ? ` (${Number(u.total_hours).toFixed(0)} hrs)` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                PM Type
              </label>
              <select
                value={pmType}
                onChange={e => setPmType(e.target.value as PMTypeValue)}
                className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white"
                style={{ background: '#162030', border: '1px solid #1e3040' }}
              >
                {PM_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                Tech Name
              </label>
              <input
                type="text"
                value={techName}
                onChange={e => setTechName(e.target.value)}
                placeholder="Technician name"
                className="w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/30"
                style={{ background: '#162030', border: '1px solid #1e3040' }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="multitemp"
              checked={isMultiTemp}
              onChange={e => setIsMultiTemp(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <label htmlFor="multitemp" className="text-sm" style={{ color: 'rgba(255,255,255,0.7)' }}>
              Multi-temp unit (includes Section 3 — Remote Evaporators)
            </label>
          </div>

          {selectedUnitData && (
            <div className="rounded-lg p-3 text-sm" style={{ background: '#162030', border: '1px solid #1e3040' }}>
              <p className="font-medium text-white">{selectedUnitData.manufacturer} {selectedUnitData.model}</p>
              <p style={{ color: 'rgba(255,255,255,0.5)' }}>
                Unit #{selectedUnitData.unit_number}
                {selectedUnitData.total_hours !== null ? ` · ${Number(selectedUnitData.total_hours).toFixed(0)} hours` : ''}
                {' · '}{(selectedUnitData.unit_type ?? 'trailer').charAt(0).toUpperCase() + (selectedUnitData.unit_type ?? 'trailer').slice(1)}
              </p>
            </div>
          )}

          <button
            onClick={() => setStep('safety')}
            className="w-full py-3 rounded-xl font-semibold text-white text-sm"
            style={{ background: HD_ORANGE }}
          >
            Continue to Safety Placard →
          </button>
        </div>
      )}

      {/* ── STEP 2: Safety Placard ─────────────────────────────────────────── */}
      {step === 'safety' && (
        <div className="space-y-4">
          <div className="rounded-xl p-5" style={{ background: '#2d0a0a', border: '1px solid #7f1d1d' }}>
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5 flex-shrink-0" style={{ color: '#EF4444' }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <h2 className="font-condensed font-bold text-lg tracking-wide" style={{ color: '#EF4444' }}>
                SAFETY PLACARD — REQUIRED ACKNOWLEDGMENT
              </h2>
            </div>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
              All items must be acknowledged before the PM checklist unlocks. This confirms you have read and understand each hazard.
            </p>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
            {SAFETY_ITEMS.map((item, i) => (
              <div
                key={item.id}
                className="flex gap-4 p-4 cursor-pointer"
                style={{
                  background:   safetyChecked[item.id] ? '#0d1f15' : '#111920',
                  borderBottom: i < SAFETY_ITEMS.length - 1 ? '1px solid #1e3040' : undefined,
                }}
                onClick={() => setSafetyChecked(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
              >
                <div
                  className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{
                    background: safetyChecked[item.id] ? '#22C55E' : '#1e3040',
                    border:     safetyChecked[item.id] ? 'none' : '1px solid #374151',
                  }}
                >
                  {safetyChecked[item.id] && (
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-sm text-white mb-0.5">{i + 1}. {item.title}</p>
                  <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>{item.text}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Initials + date + time */}
          <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
            <p className="text-sm font-semibold text-white mb-3">Tech Acknowledgment</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Initials</label>
                <input
                  type="text"
                  value={safetyInitials}
                  onChange={e => setSafetyInitials(e.target.value.toUpperCase().slice(0, 4))}
                  placeholder="JD"
                  maxLength={4}
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white text-center font-bold uppercase placeholder-white/20"
                  style={{ background: '#162030', border: '1px solid #1e3040' }}
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Date</label>
                <input
                  type="date"
                  value={safetyDate}
                  onChange={e => setSafetyDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                  style={{ background: '#162030', border: '1px solid #1e3040' }}
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Time</label>
                <input
                  type="time"
                  value={safetyTime}
                  onChange={e => setSafetyTime(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white"
                  style={{ background: '#162030', border: '1px solid #1e3040' }}
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setStep('setup')}
              className="px-4 py-2.5 rounded-lg text-sm border"
              style={{ color: 'rgba(255,255,255,0.5)', borderColor: '#1e3040' }}
            >
              ← Back
            </button>
            <button
              disabled={!safetyComplete}
              onClick={() => setStep('checklist')}
              className="flex-1 py-2.5 rounded-xl font-semibold text-sm transition-opacity"
              style={{
                background: safetyComplete ? HD_ORANGE : '#1e3040',
                color:      safetyComplete ? '#fff' : 'rgba(255,255,255,0.3)',
                cursor:     safetyComplete ? 'pointer' : 'not-allowed',
              }}
            >
              {safetyComplete
                ? 'Safety Acknowledged — Open Checklist →'
                : `Check all ${SAFETY_ITEMS.length} items + enter initials, date, and time`
              }
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Checklist ─────────────────────────────────────────────── */}
      {step === 'checklist' && (
        <div className="space-y-4">
          {/* Progress bar */}
          <div className="rounded-xl p-4" style={{ background: '#111920', border: '1px solid #1e3040' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-white">Progress</p>
              <p className="text-sm" style={{ color: HD_ORANGE }}>{pct}% — {doneItems}/{totalItems}</p>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1e3040' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: HD_ORANGE }} />
            </div>
          </div>

          {/* Sections */}
          {visibleSections.map(section => (
            <div key={section.id} className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e3040' }}>
              <div className="px-4 py-3" style={{ background: '#162030' }}>
                <p className="font-condensed font-bold text-white tracking-wide text-sm">{section.title.toUpperCase()}</p>
                {(section.showWhen === 'multitemp') && (
                  <p className="text-xs mt-0.5" style={{ color: HD_ORANGE }}>Multi-temp units only</p>
                )}
                {(section.showWhen === '12month' || section.showWhen === '24month') && (
                  <p className="text-xs mt-0.5" style={{ color: HD_BLUE }}>
                    {section.showWhen === '24month' ? '24-month' : '12-month'} inspection only
                  </p>
                )}
              </div>

              <div style={{ background: '#111920' }}>
                {section.items.map((item, i) => {
                  const state = itemStates[item.id] ?? null
                  const isAutoFlagged = item.input?.autoFlag && itemInputs[item.id]
                    ? Number(itemInputs[item.id]) < item.input.autoFlag.below
                    : false

                  return (
                    <div
                      key={item.id}
                      className="px-4 py-3"
                      style={{
                        borderBottom: i < section.items.length - 1 ? '1px solid #1e3040' : undefined,
                        background:   state === 'flag' || isAutoFlagged ? '#2a1200' : undefined,
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.85)' }}>
                            {i + 1}. {item.text}
                          </p>
                          {item.refWarn && <RefWarn />}
                          {isAutoFlagged && (
                            <p className="text-xs font-semibold mt-1" style={{ color: '#EF4444' }}>
                              ⚠ AUTO-FLAGGED — Battery CCA below 800 minimum. Recommend immediate replacement.
                            </p>
                          )}
                          {item.input && (
                            <input
                              type={item.input.type}
                              value={itemInputs[item.id] ?? ''}
                              onChange={e => {
                                setItemInputs(prev => ({ ...prev, [item.id]: e.target.value }))
                                // Auto-flag if battery CCA
                                if (item.input?.autoFlag && e.target.value) {
                                  const val = Number(e.target.value)
                                  if (!isNaN(val) && val < item.input.autoFlag.below) {
                                    setItemStates(prev => ({ ...prev, [item.id]: 'flag' }))
                                  }
                                }
                              }}
                              placeholder={item.input.label}
                              className="mt-2 w-full max-w-xs px-3 py-1.5 rounded-lg text-sm text-white placeholder-white/30"
                              style={{ background: '#162030', border: '1px solid #1e3040' }}
                            />
                          )}
                        </div>
                        <ItemButtons
                          state={state}
                          onChange={s => setItemStates(prev => ({ ...prev, [item.id]: s }))}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Alarm codes (Section 4 supplement) */}
          <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
            <p className="font-condensed font-bold text-white mb-3">ALARM CODES</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Alarm Codes Found
                </label>
                <input
                  type="text"
                  value={alarmFound}
                  onChange={e => setAlarmFound(e.target.value)}
                  placeholder="e.g. 91, 127"
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/30"
                  style={{ background: '#162030', border: '1px solid #1e3040' }}
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Alarm Codes Cleared
                </label>
                <input
                  type="text"
                  value={alarmCleared}
                  onChange={e => setAlarmCleared(e.target.value)}
                  placeholder="e.g. 91, 127"
                  className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/30"
                  style={{ background: '#162030', border: '1px solid #1e3040' }}
                />
              </div>
            </div>
          </div>

          {/* Flagged summary */}
          {flaggedItems.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: '#1a0a00', border: `1px solid ${HD_ORANGE}50` }}>
              <p className="font-semibold mb-2 text-sm" style={{ color: HD_ORANGE }}>
                ⚑ {flaggedItems.length} Flagged Item{flaggedItems.length !== 1 ? 's' : ''} — Customer Review Required
              </p>
              {flaggedItems.map(f => (
                <p key={f.id} className="text-xs py-1 border-b" style={{ color: 'rgba(255,255,255,0.65)', borderColor: '#2a1200' }}>
                  {f.text}
                </p>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep('safety')}
              className="px-4 py-2.5 rounded-lg text-sm border"
              style={{ color: 'rgba(255,255,255,0.5)', borderColor: '#1e3040' }}
            >
              ← Back
            </button>
            <button
              onClick={() => setStep('signature')}
              className="flex-1 py-2.5 rounded-xl font-semibold text-white text-sm"
              style={{ background: HD_ORANGE }}
            >
              Continue to Signature →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 4: Signature + Complete ──────────────────────────────────── */}
      {step === 'signature' && (
        <div className="space-y-4">
          <div className="rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
            <h2 className="font-condensed font-bold text-xl text-white tracking-wide mb-4">TECH SIGNATURE</h2>

            {/* PM Summary */}
            <div className="rounded-lg p-4 mb-5" style={{ background: '#162030' }}>
              <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.4)' }}>PM Summary</p>
              <div className="grid grid-cols-2 gap-y-1 text-sm">
                <p style={{ color: 'rgba(255,255,255,0.5)' }}>PM Type</p>
                <p className="text-white">{PM_TYPES.find(t => t.value === pmType)?.label}</p>
                <p style={{ color: 'rgba(255,255,255,0.5)' }}>Unit</p>
                <p className="text-white">
                  {selectedUnitData
                    ? `${selectedUnitData.unit_number} — ${selectedUnitData.manufacturer} ${selectedUnitData.model}`
                    : 'No unit selected'}
                </p>
                <p style={{ color: 'rgba(255,255,255,0.5)' }}>Items Inspected</p>
                <p className="text-white">{totalItems}</p>
                <p style={{ color: 'rgba(255,255,255,0.5)' }}>Items Flagged</p>
                <p style={{ color: flaggedItems.length > 0 ? HD_ORANGE : '#22C55E' }}>
                  {flaggedItems.length}
                </p>
                {itemInputs['1-18'] && (
                  <>
                    <p style={{ color: 'rgba(255,255,255,0.5)' }}>Battery CCA</p>
                    <p style={{ color: Number(itemInputs['1-18']) < 800 ? '#EF4444' : '#22C55E' }}>
                      {itemInputs['1-18']} CCA {Number(itemInputs['1-18']) < 800 ? '— REPLACE' : '✓'}
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Signature pad */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-white">Sign with finger or stylus</p>
                <button
                  type="button"
                  onClick={clearSig}
                  className="text-xs px-2 py-1 rounded border"
                  style={{ color: 'rgba(255,255,255,0.4)', borderColor: '#1e3040' }}
                >
                  Clear
                </button>
              </div>
              <canvas
                ref={canvasRef}
                width={560}
                height={140}
                className="w-full rounded-lg touch-none"
                style={{ background: '#162030', border: `2px solid ${hasSig ? HD_ORANGE : '#1e3040'}`, cursor: 'crosshair', maxHeight: 140 }}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={stopDraw}
                onMouseLeave={stopDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={stopDraw}
              />
              {!hasSig && (
                <p className="text-xs text-center mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  Draw signature above (optional)
                </p>
              )}
            </div>
          </div>

          {submitError && (
            <p className="text-sm text-red-400 p-3 rounded-lg" style={{ background: '#2d0a0a', border: '1px solid #7f1d1d' }}>
              {submitError}
            </p>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setStep('checklist')}
              className="px-4 py-2.5 rounded-lg text-sm border"
              style={{ color: 'rgba(255,255,255,0.5)', borderColor: '#1e3040' }}
            >
              ← Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 py-3 rounded-xl font-bold text-white text-sm transition-opacity"
              style={{ background: HD_ORANGE, opacity: submitting ? 0.6 : 1 }}
            >
              {submitting ? 'Saving PM Record…' : 'Complete PM Checklist'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
