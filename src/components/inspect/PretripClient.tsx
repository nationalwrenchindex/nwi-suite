'use client'

// Driver pre-trip inspection form — the offline-first half of the QR flow.
//
// Design constraints, in priority order:
//   1. A completed inspection is NEVER lost and is NEVER reported as sent when it is
//      not. Everything is written to localStorage before the network is touched.
//   2. It works with zero connectivity. Every checklist item is bundled in the JS;
//      the only thing the network provides is the unit header, which is cached.
//   3. It is usable one-handed, outdoors, in gloves. 44px minimum targets, three big
//      buttons per item, no dropdowns, no modals.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NWI_ORANGE } from '@/components/fleet-pro/brand'
import {
  PRETRIP_CHECKLIST_VERSION,
  criticalFailureCount,
  groupedPretripItems,
  pretripDefects,
  pretripOverallResult,
  sanitizePretripAnswers,
  unansweredPretripKeys,
  type PretripAnswer,
  type PretripAnswers,
} from '@/lib/fleet-pro/pretrip-checklist'
import {
  PRETRIP_QUEUE_EVENT,
  cachePretripUnit,
  clearPretripDraft,
  flushPretripQueue,
  newClientUuid,
  pretripQueueCount,
  readCachedPretripUnit,
  readDriverName,
  readPretripDraft,
  rejectedPretripCount,
  savePretripDraft,
  saveDriverName,
  submitPretrip,
  type PretripSubmitState,
} from '@/lib/fleet-pro/pretrip-queue'
import type { PretripSubmission, PretripUnitInfo } from '@/types/fleet-pro-partner'

const BG     = '#0a0f14'
const CARD   = '#111920'
const BORDER = '#1e3040'
const PASS   = '#22C55E'
const FAIL   = '#ef4444'
const MUTED  = 'rgba(255,255,255,0.55)'
const FAINT  = 'rgba(255,255,255,0.35)'

const GROUPS = groupedPretripItems()
const TOTAL_ITEMS = GROUPS.reduce((n, g) => n + g.items.length, 0)

const ANSWER_LABEL: Record<PretripAnswer, string> = { pass: 'PASS', fail: 'FAIL', na: 'N/A' }
const ANSWER_COLOR: Record<PretripAnswer, string> = { pass: PASS, fail: FAIL, na: '#64748b' }

// ── small presentational pieces ───────────────────────────────────────────────

function Field({
  label, value, onChange, hint, type = 'text', inputMode, placeholder, maxLength,
}: {
  label:        string
  value:        string
  onChange:     (v: string) => void
  hint?:        string | null
  type?:        string
  inputMode?:   'text' | 'decimal' | 'numeric'
  placeholder?: string
  maxLength?:   number
}) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 13, letterSpacing: '0.05em', textTransform: 'uppercase', color: MUTED, marginBottom: 6 }}>
        {label}
      </span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', minHeight: 48, padding: '10px 12px', fontSize: 17,
          background: '#162030', border: `1px solid ${BORDER}`, borderRadius: 8, color: '#fff',
        }}
      />
      {hint ? <span style={{ display: 'block', fontSize: 12, color: FAINT, marginTop: 4 }}>{hint}</span> : null}
    </label>
  )
}

/**
 * Signature pad. Optional — a driver with no stylus and cold hands still has to be
 * able to submit, so nothing here is required. Pointer events cover touch and mouse
 * with one code path.
 */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing   = useRef(false)
  const [signed, setSigned] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Size the backing store to the device pixel ratio, or the stroke looks like a
    // crayon on a modern phone.
    const dpr  = Math.min(window.devicePixelRatio || 1, 2)
    const rect = canvas.getBoundingClientRect()
    canvas.width  = Math.max(1, Math.floor(rect.width * dpr))
    canvas.height = Math.max(1, Math.floor(rect.height * dpr))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.lineWidth   = 2.5
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    ctx.strokeStyle = '#ffffff'
  }, [])

  function pointAt(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const p = pointAt(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = pointAt(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  function end() {
    if (!drawing.current) return
    drawing.current = false
    const canvas = canvasRef.current
    if (!canvas) return
    setSigned(true)
    try {
      onChange(canvas.toDataURL('image/png'))
    } catch {
      // Tainted or oversized canvas: drop the signature rather than block the submit.
      onChange(null)
    }
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setSigned(false)
    onChange(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 13, letterSpacing: '0.05em', textTransform: 'uppercase', color: MUTED }}>
          Signature <span style={{ color: FAINT, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
        </span>
        <button
          type="button"
          onClick={clear}
          style={{
            minHeight: 36, padding: '0 14px', fontSize: 13, borderRadius: 6,
            background: 'transparent', border: `1px solid ${BORDER}`, color: MUTED,
          }}
        >
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        // touchAction none: without it the browser scrolls the page instead of drawing.
        style={{
          width: '100%', height: 140, display: 'block', touchAction: 'none',
          background: '#162030', border: `1px solid ${signed ? NWI_ORANGE : BORDER}`, borderRadius: 8,
        }}
      />
    </div>
  )
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function PretripClient({
  unitId,
  initialUnit,
}: {
  unitId:      string
  initialUnit: PretripUnitInfo | null
}) {
  const [unit, setUnit]           = useState<PretripUnitInfo | null>(initialUnit)
  const [fromCache, setFromCache] = useState(false)

  const [driverName, setDriverName]   = useState('')
  const [odometer, setOdometer]       = useState('')
  const [reeferHours, setReeferHours] = useState('')
  const [answers, setAnswers]         = useState<PretripAnswers>({})
  const [notes, setNotes]             = useState<Record<string, string>>({})
  const [signatureData, setSignature] = useState<string | null>(null)

  const [restored, setRestored] = useState(false)
  const [online, setOnline]     = useState(true)
  const [queued, setQueued]     = useState(0)
  const [rejected, setRejected] = useState(0)

  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [result, setResult] = useState<{ state: PretripSubmitState; overall: 'pass' | 'fail' } | null>(null)

  const refreshCounts = useCallback(() => {
    setQueued(pretripQueueCount())
    setRejected(rejectedPretripCount())
  }, [])

  const flush = useCallback(async () => {
    await flushPretripQueue()
    refreshCounts()
  }, [refreshCounts])

  // ── queue wiring: flush on mount, on reconnect, and when the tab comes back ──
  useEffect(() => {
    refreshCounts()
    setOnline(navigator.onLine)

    const onOnline  = () => { setOnline(true); void flush() }
    const onOffline = () => setOnline(false)
    // A sibling tab (or the service worker) may have drained the queue.
    const onQueue   = () => refreshCounts()
    const onVisible = () => { if (document.visibilityState === 'visible') void flush() }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener(PRETRIP_QUEUE_EVENT, onQueue)
    window.addEventListener('storage', onQueue)
    document.addEventListener('visibilitychange', onVisible)

    void flush()

    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener(PRETRIP_QUEUE_EVENT, onQueue)
      window.removeEventListener('storage', onQueue)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [flush, refreshCounts])

  // ── unit header: cache the server copy, or fall back to the cached one ──────
  useEffect(() => {
    if (initialUnit) {
      cachePretripUnit(initialUnit)
      setUnit(initialUnit)
      setFromCache(false)
      return
    }

    // No server data: either the page came out of the service worker's cache or the
    // backend was unreachable. Show whatever was saved last, then try the network.
    const cached = readCachedPretripUnit(unitId)
    if (cached) {
      setUnit(cached)
      setFromCache(true)
    }

    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/inspect/${unitId}`, { cache: 'no-store', credentials: 'omit' })
        if (!res.ok) return
        const json = await res.json() as { unit?: PretripUnitInfo }
        if (json.unit && !cancelled) {
          cachePretripUnit(json.unit)
          setUnit(json.unit)
          setFromCache(false)
        }
      } catch {
        // Offline. The cached copy (or the bare unit id) is enough to inspect a truck.
      }
    }
    void load()

    return () => { cancelled = true }
  }, [initialUnit, unitId])

  // ── draft restore: a walkaround survives a locked screen or a reload ─────────
  useEffect(() => {
    const draft = readPretripDraft(unitId, PRETRIP_CHECKLIST_VERSION)
    if (draft) {
      setAnswers(sanitizePretripAnswers(draft.answers))
      setNotes(draft.notes && typeof draft.notes === 'object' ? draft.notes : {})
      setOdometer(typeof draft.odometer === 'string' ? draft.odometer : '')
      setReeferHours(typeof draft.reefer_hours === 'string' ? draft.reefer_hours : '')
      setDriverName(draft.driver_name || readDriverName())
    } else {
      setDriverName(readDriverName())
    }
    setRestored(true)
  }, [unitId])

  // ── draft autosave ──────────────────────────────────────────────────────────
  useEffect(() => {
    // Gated on `restored` so the initial empty state cannot overwrite a saved draft
    // in the moment between mount and restore.
    if (!restored || result) return
    const t = window.setTimeout(() => {
      savePretripDraft(unitId, {
        version:      PRETRIP_CHECKLIST_VERSION,
        answers,
        notes,
        odometer,
        reefer_hours: reeferHours,
        driver_name:  driverName,
        saved_at:     new Date().toISOString(),
      })
    }, 400)
    return () => window.clearTimeout(t)
  }, [restored, result, unitId, answers, notes, odometer, reeferHours, driverName])

  // ── derived ─────────────────────────────────────────────────────────────────
  const answeredCount = useMemo(
    () => GROUPS.reduce((n, g) => n + g.items.filter(i => answers[i.key]).length, 0),
    [answers],
  )
  const unanswered = useMemo(() => unansweredPretripKeys(answers), [answers])
  const failCount  = useMemo(() => Object.values(answers).filter(v => v === 'fail').length, [answers])
  const criticalFails = useMemo(() => criticalFailureCount(answers), [answers])

  function setAnswer(key: string, value: PretripAnswer) {
    setAnswers(prev => (prev[key] === value ? prev : { ...prev, [key]: value }))
    setError(null)
  }

  function markSectionPass(section: string) {
    const group = GROUPS.find(g => g.section === section)
    if (!group) return
    setAnswers(prev => {
      const next = { ...prev }
      // Only fills the blanks — a deliberate FAIL is never silently converted to PASS.
      for (const item of group.items) if (!next[item.key]) next[item.key] = 'pass'
      return next
    })
  }

  async function handleSubmit() {
    if (busy) return
    setError(null)

    const name = driverName.trim()
    if (!name) {
      setError('Enter your name — it is the signature on this inspection.')
      return
    }
    if (unanswered.length > 0) {
      setError(`${unanswered.length} item${unanswered.length === 1 ? '' : 's'} not answered. Every item needs PASS, FAIL or N/A.`)
      const el = document.getElementById(`item-${unanswered[0]}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    setBusy(true)
    saveDriverName(name)

    const submission: PretripSubmission = {
      // Minted HERE, once, before the first send attempt, and reused by every retry.
      // This is the whole idempotency story: the server treats a duplicate as success.
      client_uuid:       newClientUuid(),
      unit_id:           unitId,
      driver_name:       name,
      odometer:          parseMeter(odometer),
      reefer_hours:      parseMeter(reeferHours),
      checklist_data:    answers,
      defects:           pretripDefects(answers, notes),
      signature_data:    signatureData,
      inspection_date:   new Date().toISOString().slice(0, 10),
      // What the device believed at the moment of submit. The server does not trust
      // it for anything but reporting.
      submitted_offline: typeof navigator !== 'undefined' && !navigator.onLine,
    }

    const overall = pretripOverallResult(answers)
    const outcome = await submitPretrip(submission)

    refreshCounts()
    setBusy(false)

    if (outcome.state === 'unsaved') {
      // The one case where we must NOT show a finished screen: nothing is on disk and
      // nothing reached the server, so the driver has to be told to keep the page open.
      setError('This phone would not let the inspection save (storage full or blocked). Do NOT close this page — find signal and press Submit again.')
      return
    }

    clearPretripDraft(unitId)
    setResult({ state: outcome.state, overall })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function startAnother() {
    setAnswers({})
    setNotes({})
    setOdometer('')
    setReeferHours('')
    setSignature(null)
    setResult(null)
    setError(null)
  }

  // ── result screen ───────────────────────────────────────────────────────────
  if (result) {
    return (
      <main style={pageStyle}>
        <Header unit={unit} fromCache={fromCache} online={online} queued={queued} rejected={rejected} />
        <div style={{ flex: 1, padding: 16, maxWidth: 640, margin: '0 auto', width: '100%' }}>
          <div style={{ ...cardStyle, borderColor: result.overall === 'fail' ? FAIL : PASS, textAlign: 'center', padding: 24 }}>
            <div style={{ fontSize: 13, letterSpacing: '0.12em', color: MUTED, textTransform: 'uppercase' }}>Inspection result</div>
            <div style={{ fontSize: 44, fontWeight: 800, color: result.overall === 'fail' ? FAIL : PASS, margin: '8px 0' }}>
              {result.overall === 'fail' ? 'DEFECTS FOUND' : 'PASS'}
            </div>
            {result.overall === 'fail' ? (
              <p style={{ color: '#fff', fontSize: 15, lineHeight: 1.5, margin: '4px 0 0' }}>
                {failCount} defect{failCount === 1 ? '' : 's'} recorded
                {criticalFails > 0 ? ` — ${criticalFails} out-of-service item${criticalFails === 1 ? '' : 's'}` : ''}.
                Do not operate this unit until a mechanic has cleared it.
              </p>
            ) : null}
          </div>

          <div style={{ ...cardStyle, marginTop: 14 }}>
            {result.state === 'sent' ? (
              <p style={{ margin: 0, color: PASS, fontSize: 16, fontWeight: 600 }}>Sent to the shop.</p>
            ) : null}
            {result.state === 'queued' ? (
              <>
                <p style={{ margin: 0, color: NWI_ORANGE, fontSize: 16, fontWeight: 600 }}>
                  Saved on this device — will send when you&apos;re back online.
                </p>
                <p style={{ margin: '8px 0 0', color: MUTED, fontSize: 14, lineHeight: 1.5 }}>
                  Nothing is lost. Keep this app on your phone; it sends by itself the moment you have signal.
                </p>
              </>
            ) : null}
            {result.state === 'rejected' ? (
              <>
                <p style={{ margin: 0, color: FAIL, fontSize: 16, fontWeight: 600 }}>The shop&apos;s system would not accept it.</p>
                <p style={{ margin: '8px 0 0', color: MUTED, fontSize: 14, lineHeight: 1.5 }}>
                  The inspection is still stored on this phone. Show this screen to your manager.
                </p>
              </>
            ) : null}
          </div>

          <button type="button" onClick={startAnother} style={{ ...primaryButton, marginTop: 16 }}>
            Start another inspection
          </button>
        </div>
      </main>
    )
  }

  // ── form ────────────────────────────────────────────────────────────────────
  return (
    <main style={pageStyle}>
      <Header unit={unit} fromCache={fromCache} online={online} queued={queued} rejected={rejected} />

      {/* flex:1 keeps the sticky action bar pinned to the bottom of the viewport even
          when the form is short (a mostly-answered draft). */}
      <div style={{ flex: 1, padding: 16, paddingBottom: 24, maxWidth: 640, margin: '0 auto', width: '100%' }}>
        <section style={cardStyle}>
          <Field
            label="Driver name"
            value={driverName}
            onChange={setDriverName}
            placeholder="First and last name"
            maxLength={120}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field
              label="Odometer"
              value={odometer}
              onChange={setOdometer}
              inputMode="decimal"
              placeholder="miles"
              hint={unit?.last_odometer != null ? `last: ${unit.last_odometer.toLocaleString()}` : null}
            />
            <Field
              label="Reefer hours"
              value={reeferHours}
              onChange={setReeferHours}
              inputMode="decimal"
              placeholder="hours"
              hint={unit?.last_hours != null ? `last: ${unit.last_hours.toLocaleString()}` : null}
            />
          </div>
        </section>

        {GROUPS.map(group => {
          const done = group.items.filter(i => answers[i.key]).length
          return (
            <section key={group.section} style={{ ...cardStyle, marginTop: 14, padding: 0, overflow: 'hidden' }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                padding: '12px 14px', borderBottom: `1px solid ${BORDER}`, background: '#0d151d',
              }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>{group.section}</div>
                  <div style={{ fontSize: 12, color: done === group.items.length ? PASS : FAINT }}>
                    {done}/{group.items.length} answered
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => markSectionPass(group.section)}
                  style={{
                    minHeight: 44, padding: '0 14px', fontSize: 13, fontWeight: 700, borderRadius: 8,
                    background: 'transparent', border: `1px solid ${BORDER}`, color: PASS, whiteSpace: 'nowrap',
                  }}
                >
                  All pass
                </button>
              </div>

              {group.items.map((item, idx) => {
                const value = answers[item.key]
                return (
                  <div
                    key={item.key}
                    id={`item-${item.key}`}
                    style={{ padding: '12px 14px', borderTop: idx === 0 ? 'none' : `1px solid rgba(30,48,64,0.6)` }}
                  >
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 10 }}>
                      <span style={{ fontSize: 16, lineHeight: 1.35, color: '#fff', flex: 1 }}>{item.label}</span>
                      {item.critical ? (
                        <span style={{
                          fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', color: FAIL,
                          border: `1px solid ${FAIL}`, borderRadius: 4, padding: '2px 5px', whiteSpace: 'nowrap', marginTop: 2,
                        }}>
                          OOS
                        </span>
                      ) : null}
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      {(['pass', 'fail', 'na'] as PretripAnswer[]).map(option => {
                        const active = value === option
                        return (
                          <button
                            key={option}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setAnswer(item.key, option)}
                            style={{
                              flex: 1, minHeight: 48, borderRadius: 8, fontSize: 15, fontWeight: 800,
                              letterSpacing: '0.04em',
                              background: active ? ANSWER_COLOR[option] : 'transparent',
                              border: `1px solid ${active ? ANSWER_COLOR[option] : BORDER}`,
                              color: active ? (option === 'na' ? '#fff' : '#06120a') : MUTED,
                            }}
                          >
                            {ANSWER_LABEL[option]}
                          </button>
                        )
                      })}
                    </div>

                    {value === 'fail' ? (
                      <textarea
                        value={notes[item.key] ?? ''}
                        onChange={e => setNotes(prev => ({ ...prev, [item.key]: e.target.value }))}
                        placeholder="What is wrong? (optional)"
                        maxLength={1000}
                        rows={2}
                        style={{
                          width: '100%', marginTop: 10, padding: '10px 12px', fontSize: 15,
                          background: '#1a1013', border: `1px solid ${FAIL}`, borderRadius: 8, color: '#fff',
                          resize: 'vertical',
                        }}
                      />
                    ) : null}
                  </div>
                )
              })}
            </section>
          )
        })}

        <section style={{ ...cardStyle, marginTop: 14 }}>
          <SignaturePad onChange={setSignature} />
        </section>

        {error ? (
          <div style={{
            marginTop: 14, padding: '12px 14px', borderRadius: 8,
            background: 'rgba(239,68,68,0.12)', border: `1px solid ${FAIL}`, color: '#fff', fontSize: 15, lineHeight: 1.45,
          }}>
            {error}
          </div>
        ) : null}
      </div>

      {/* Sticky action bar: the driver never has to hunt for Submit at the bottom of
          sixty items, and the progress figure is always in view. */}
      <div style={{
        position: 'sticky', bottom: 0, left: 0, right: 0, padding: 12,
        background: 'rgba(10,15,20,0.96)', borderTop: `1px solid ${BORDER}`,
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
      }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: MUTED, marginBottom: 8 }}>
            <span>{answeredCount}/{TOTAL_ITEMS} answered</span>
            <span style={{ color: failCount > 0 ? FAIL : MUTED }}>
              {failCount > 0 ? `${failCount} defect${failCount === 1 ? '' : 's'}` : 'no defects'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => { void handleSubmit() }}
            disabled={busy}
            style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Saving…' : 'Submit inspection'}
          </button>
        </div>
      </div>
    </main>
  )
}

/** '' / junk -> null so a blank box never becomes 0 miles. */
function parseMeter(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number(trimmed.replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

// ── header ────────────────────────────────────────────────────────────────────

function Header({
  unit, fromCache, online, queued, rejected,
}: {
  unit:     PretripUnitInfo | null
  fromCache: boolean
  online:   boolean
  queued:   number
  rejected: number
}) {
  const spec = unit
    ? [unit.year ? String(unit.year) : null, unit.manufacturer, unit.model].filter(Boolean).join(' ')
    : ''

  return (
    <header style={{ borderBottom: `1px solid ${BORDER}`, background: '#0d151d' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* White-labelled surface: the driver sees their carrier's brand, not NWI's.
              Plain <img> rather than next/image — this must render from cache with no
              optimizer round-trip. */}
          {unit?.brand_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={unit.brand_logo_url}
              alt=""
              style={{ height: 32, maxWidth: 140, objectFit: 'contain' }}
            />
          ) : null}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: MUTED, letterSpacing: '0.06em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {unit?.brand_name ?? 'Pre-Trip Inspection'}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', lineHeight: 1.15 }}>
              {unit?.unit_number ? `Unit ${unit.unit_number}` : 'Pre-Trip Inspection'}
            </div>
            {spec || unit?.serial_number ? (
              <div style={{ fontSize: 12, color: FAINT }}>
                {[spec, unit?.serial_number ? `S/N ${unit.serial_number}` : null].filter(Boolean).join(' · ')}
              </div>
            ) : null}
          </div>
          <div style={{ width: 4, alignSelf: 'stretch', background: NWI_ORANGE, borderRadius: 2 }} />
        </div>

        {(!online || queued > 0 || rejected > 0 || (!unit) || fromCache) ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {!online ? <Pill color={NWI_ORANGE}>Offline — inspection saves on this phone</Pill> : null}
            {queued > 0 ? <Pill color={NWI_ORANGE}>{queued} waiting to send</Pill> : null}
            {rejected > 0 ? <Pill color={FAIL}>{rejected} not accepted — tell your manager</Pill> : null}
            {!unit ? <Pill color={FAIL}>Unit details unavailable — you can still inspect</Pill> : null}
            {unit && fromCache ? <Pill color={FAINT}>Showing saved unit details</Pill> : null}
          </div>
        ) : null}
      </div>
    </header>
  )
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 12, fontWeight: 600, padding: '4px 9px', borderRadius: 999,
      border: `1px solid ${color}`, color, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

// ── shared styles ─────────────────────────────────────────────────────────────

const pageStyle: React.CSSProperties = {
  minHeight: '100dvh',
  background: BG,
  color: '#fff',
  // Self-contained: no app nav, no Fleet Pro shell. This page is the whole screen.
  display: 'flex',
  flexDirection: 'column',
}

const cardStyle: React.CSSProperties = {
  background: CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  padding: 14,
}

const primaryButton: React.CSSProperties = {
  width: '100%',
  minHeight: 56,
  borderRadius: 10,
  border: 'none',
  background: NWI_ORANGE,
  color: '#0a0f14',
  fontSize: 18,
  fontWeight: 800,
  letterSpacing: '0.03em',
}
