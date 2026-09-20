'use client'

// Scan Invoice — the fleet manager's path for a repair done by a shop that is not on
// NWI Suite. He photographs the paper invoice, a model transcribes it, he corrects
// whatever it could not read, and it lands in fleet_pro_service_entries where the cost
// engine already picks it up.
//
// THE DESIGN RULE FOR THIS SCREEN: the manager confirms, the machine suggests. Every
// extracted value is an editable box, fields the model could not read are marked so his
// eye goes to them, and the unit is always a visible dropdown even when a printed unit
// number matched — a silently mis-filed invoice becomes another truck's cost history
// and is nearly impossible to notice later.
//
// Extraction failure is NOT a dead end. A 502/503/422 from the extract route drops
// straight into the same empty form with a note, because the invoice in his hand is
// still real and typing it in beats losing it.

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ExtractedServiceEntry,
  ExtractedInvoiceIdentity,
  ServiceEntryFieldKey,
  ServiceEntryPart,
} from '@/lib/fleet-pro/service-entry'
import {
  EMPTY_EXTRACTION,
  MAX_IMAGE_BYTES,
  MAX_PARTS,
  SERVICE_ENTRY_FIELD_LABELS,
  moneyToInput,
  numberToInput,
} from '@/lib/fleet-pro/service-entry'
import type { FleetProUnitRow } from '@/types/fleet-pro'
import { NWI_ORANGE } from './brand'

const ACCENT = NWI_ORANGE
const CARD   = '#111920'
const STRIP  = '#162030'
const BORDER = '#1e3040'
const RED    = '#ef4444'
const GREEN  = '#22C55E'

const DIM  = 'rgba(255,255,255,0.4)'
const DIM2 = 'rgba(255,255,255,0.55)'

type Stage = 'capture' | 'reading' | 'confirm' | 'saving' | 'done'

interface UnitMatch {
  unit_id:     string
  unit_number: string | null
  matched_on:  'unit_number' | 'truck_trailer_number' | 'serial_number'
}

const MATCH_LABEL: Record<UnitMatch['matched_on'], string> = {
  unit_number:          'unit number',
  truck_trailer_number: 'truck/trailer number',
  serial_number:        'serial number',
}

/** The form's own shape: every field a string, because a half-typed "12." is not a
 *  number yet and coercing on each keystroke fights the person typing. The server
 *  re-parses and clamps all of it anyway. */
interface FormState {
  service_date:      string
  vendor_name:       string
  invoice_number:    string
  labor_description: string
  labor_cost:        string
  parts_cost:        string
  tax:               string
  total:             string
}

interface PartRow {
  name: string
  qty:  string
  cost: string
}

function toForm(e: ExtractedServiceEntry): FormState {
  return {
    service_date:      e.service_date ?? '',
    vendor_name:       e.vendor_name ?? '',
    invoice_number:    e.invoice_number ?? '',
    labor_description: e.labor_description ?? '',
    labor_cost:        moneyToInput(e.labor_cost),
    parts_cost:        moneyToInput(e.parts_cost),
    tax:               moneyToInput(e.tax),
    total:             moneyToInput(e.total),
  }
}

function toPartRows(parts: ServiceEntryPart[]): PartRow[] {
  return parts.map(p => ({
    name: p.name,
    qty:  numberToInput(p.qty),
    cost: moneyToInput(p.cost),
  }))
}

export default function ScanInvoiceClient({
  unitId,
  unitNumber,
  onClose,
  onSaved,
}: {
  unitId:     string
  unitNumber: string
  onClose:    () => void
  onSaved:    () => void
}) {
  const [stage,   setStage]   = useState<Stage>('capture')
  const [error,   setError]   = useState<string | null>(null)
  const [notice,  setNotice]  = useState<string | null>(null)

  const [form,      setForm]      = useState<FormState>(() => toForm(EMPTY_EXTRACTION))
  const [partRows,  setPartRows]  = useState<PartRow[]>([])
  const [unread,    setUnread]    = useState<ServiceEntryFieldKey[]>([])
  const [identity,  setIdentity]  = useState<ExtractedInvoiceIdentity | null>(null)
  const [match,     setMatch]     = useState<UnitMatch | null>(null)
  const [targetId,  setTargetId]  = useState(unitId)
  const [units,     setUnits]     = useState<FleetProUnitRow[]>([])

  // Kept so the confirmed record is filed with the photo it was read from, and so a
  // failed submit can be retried without re-photographing the invoice.
  const [image, setImage] = useState<File | null>(null)

  // What the model produced, before any correction. Sent as extracted_raw so the row
  // can always answer "did the machine read this, or did a person type it?".
  const rawRef = useRef<ExtractedServiceEntry | null>(null)

  // Minted once per scan, reused on every retry. This is the whole idempotency story:
  // a double-tapped Submit, or a retry after a timeout, must not file two invoices.
  const clientUuidRef = useRef<string>('')
  if (!clientUuidRef.current) clientUuidRef.current = crypto.randomUUID()

  // The dropdown. Read from the dashboard payload rather than a new endpoint — it
  // already returns this fleet's units and is already membership-checked.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res  = await fetch('/api/fleet-pro/dashboard', { cache: 'no-store' })
        const json = await res.json().catch(() => ({}))
        if (cancelled || !res.ok) return
        const rows = (json as { dashboard?: { units?: FleetProUnitRow[] } }).dashboard?.units ?? []
        setUnits(rows)
      } catch {
        // Non-fatal: without the list the manager still files against the unit whose
        // page he is on, which is the overwhelmingly common case.
      }
    })()
    return () => { cancelled = true }
  }, [])

  const goManual = useCallback((message: string) => {
    rawRef.current = null
    setForm(toForm(EMPTY_EXTRACTION))
    setPartRows([])
    setUnread([])
    setNotice(message)
    setStage('confirm')
  }, [])

  async function onPhoto(file: File) {
    setError(null)
    setNotice(null)

    if (file.size > MAX_IMAGE_BYTES) {
      setError('That photo is too large. Take it again at normal quality.')
      return
    }

    setImage(file)
    setStage('reading')

    const body = new FormData()
    body.append('unit_id', unitId)
    body.append('image', file)

    try {
      const res  = await fetch('/api/fleet-pro/service-entries/extract', { method: 'POST', body })
      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        // The route's error copy already tells him to enter it by hand.
        goManual((json as { error?: string }).error ?? 'Could not read that photo. Enter the details by hand.')
        return
      }

      const payload = json as {
        extracted:  ExtractedServiceEntry
        unread:     ServiceEntryFieldKey[]
        identity:   ExtractedInvoiceIdentity
        unit_match: UnitMatch | null
      }

      rawRef.current = payload.extracted
      setForm(toForm(payload.extracted))
      setPartRows(toPartRows(payload.extracted.parts ?? []))
      setUnread(payload.unread ?? [])
      setIdentity(payload.identity ?? null)
      setMatch(payload.unit_match ?? null)
      // A match only moves the selection; it never files on its own.
      if (payload.unit_match) setTargetId(payload.unit_match.unit_id)
      setStage('confirm')
    } catch {
      goManual('Could not read that photo. Enter the details by hand.')
    }
  }

  async function submit() {
    if (stage === 'saving') return
    setError(null)
    setStage('saving')

    const parts = partRows
      .map(p => ({ name: p.name.trim(), qty: p.qty.trim() || null, cost: p.cost.trim() || null }))
      .filter(p => p.name)

    const entry = {
      unit_id:           targetId,
      client_uuid:       clientUuidRef.current,
      service_date:      form.service_date || null,
      vendor_name:       form.vendor_name || null,
      invoice_number:    form.invoice_number || null,
      labor_description: form.labor_description || null,
      labor_cost:        form.labor_cost || null,
      parts_cost:        form.parts_cost || null,
      tax:               form.tax || null,
      total:             form.total || null,
      parts,
      extracted_raw:     rawRef.current,
    }

    const body = new FormData()
    body.append('entry', JSON.stringify(entry))
    if (image) body.append('image', image)

    try {
      const res  = await fetch('/api/fleet-pro/service-entries', { method: 'POST', body })
      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError((json as { error?: string }).error ?? 'Could not save this invoice')
        setStage('confirm')
        return
      }

      // A duplicate is a success: the record is already filed.
      setStage('done')
      onSaved()
    } catch {
      setError('Could not save this invoice')
      setStage('confirm')
    }
  }

  // ── shared styling ──────────────────────────────────────────────────────────
  const field      = 'rounded-lg px-3 py-2 text-sm text-white w-full'
  const fieldStyle = { background: STRIP, border: `1px solid ${BORDER}` }
  const unreadStyle = { background: STRIP, border: `1px solid ${ACCENT}` }

  function labelFor(key: ServiceEntryFieldKey) {
    const wasUnread = unread.includes(key)
    return (
      <span className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-widest" style={{ color: DIM }}>
          {SERVICE_ENTRY_FIELD_LABELS[key]}
        </span>
        {wasUnread && (
          <span className="text-[9px] uppercase tracking-widest" style={{ color: ACCENT }}>
            not read
          </span>
        )}
      </span>
    )
  }

  function textInput(key: keyof FormState, fieldKey: ServiceEntryFieldKey, extra: Record<string, unknown> = {}) {
    return (
      <label className="block">
        {labelFor(fieldKey)}
        <input
          className={`${field} mt-1`}
          style={unread.includes(fieldKey) ? unreadStyle : fieldStyle}
          value={form[key]}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          {...extra}
        />
      </label>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Scan invoice"
    >
      <div
        className="rounded-xl w-full max-w-2xl my-4"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        {/* ── header ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div>
            <p className="text-[10px] uppercase tracking-widest" style={{ color: DIM }}>Unit {unitNumber}</p>
            <h2 className="font-condensed font-bold text-xl text-white tracking-wide">SCAN INVOICE</h2>
          </div>
          <button
            onClick={onClose}
            className="ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{ border: `1px solid ${BORDER}`, color: DIM2 }}
          >
            {stage === 'done' ? 'Close' : 'Cancel'}
          </button>
        </div>

        <div className="px-4 py-4">
          {/* ── capture ──────────────────────────────────────────────────────── */}
          {stage === 'capture' && (
            <>
              <p className="text-sm mb-1 text-white">Photograph the paper invoice</p>
              <p className="text-xs mb-4" style={{ color: DIM2 }}>
                Lay it flat and fill the frame. Anything the camera cannot read is left blank for
                you to type — nothing is guessed.
              </p>
              <label
                className="block rounded-lg px-4 py-8 text-center cursor-pointer"
                style={{ background: STRIP, border: `1px dashed ${ACCENT}` }}
              >
                <span className="text-sm font-semibold" style={{ color: ACCENT }}>Open camera</span>
                <span className="block text-xs mt-1" style={{ color: DIM }}>JPEG or PNG, up to 5 MB</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  capture="environment"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) onPhoto(f)
                  }}
                />
              </label>
              <button
                onClick={() => goManual('Entering this invoice by hand.')}
                className="mt-3 text-xs underline"
                style={{ color: DIM2 }}
              >
                Enter it by hand instead
              </button>
              {error && <p className="text-xs mt-3" style={{ color: RED }}>{error}</p>}
            </>
          )}

          {/* ── reading ──────────────────────────────────────────────────────── */}
          {stage === 'reading' && (
            <div className="py-10 text-center">
              <p className="text-sm text-white">Reading the invoice…</p>
              <p className="text-xs mt-1" style={{ color: DIM }}>This takes a few seconds.</p>
            </div>
          )}

          {/* ── confirm / saving ─────────────────────────────────────────────── */}
          {(stage === 'confirm' || stage === 'saving') && (
            <>
              {notice && (
                <p className="text-xs mb-3 rounded-lg px-3 py-2" style={{ background: STRIP, color: DIM2 }}>
                  {notice}
                </p>
              )}

              {/* The unit is always shown and always changeable, match or no match. */}
              <div className="rounded-lg px-3 py-3 mb-4" style={{ background: STRIP, border: `1px solid ${BORDER}` }}>
                <span className="text-[10px] uppercase tracking-widest" style={{ color: DIM }}>
                  File this invoice against
                </span>
                <select
                  className={`${field} mt-1`}
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                  value={targetId}
                  onChange={e => setTargetId(e.target.value)}
                >
                  {/* The unit whose page this is, always available even before the
                      dashboard list arrives. */}
                  {units.length === 0 && <option value={unitId}>Unit {unitNumber}</option>}
                  {units.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.unit_number}{u.manufacturer ? ` — ${u.manufacturer}` : ''}
                    </option>
                  ))}
                </select>
                {match && (
                  <p className="text-xs mt-2" style={{ color: GREEN }}>
                    Matched the {MATCH_LABEL[match.matched_on]} printed on the invoice.
                  </p>
                )}
                {!match && identity?.unit_number && (
                  <p className="text-xs mt-2" style={{ color: ACCENT }}>
                    The invoice reads “{identity.unit_number}”, which did not match one unit in this
                    fleet. Check the selection above.
                  </p>
                )}
                {identity?.vin && (
                  // Surfaced but never matched: hd_units has no VIN column. It is stored
                  // with the record so it can settle a question later.
                  <p className="text-xs mt-1" style={{ color: DIM }}>VIN on invoice: {identity.vin}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                {textInput('service_date', 'service_date', { type: 'date' })}
                {textInput('vendor_name', 'vendor_name', { placeholder: 'Shop or mechanic' })}
                {textInput('invoice_number', 'invoice_number', { placeholder: 'Invoice #' })}
              </div>

              <label className="block mb-3">
                {labelFor('labor_description')}
                <textarea
                  className={`${field} mt-1`}
                  style={unread.includes('labor_description') ? unreadStyle : fieldStyle}
                  rows={3}
                  value={form.labor_description}
                  onChange={e => setForm(f => ({ ...f, labor_description: e.target.value }))}
                />
              </label>

              {/* ── parts ────────────────────────────────────────────────────── */}
              <div className="mb-3">
                <span className="text-[10px] uppercase tracking-widest" style={{ color: DIM }}>
                  Parts
                </span>
                {partRows.map((p, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 mt-2">
                    <input
                      className={`${field} col-span-6`} style={fieldStyle}
                      placeholder="Part name / number" aria-label="Part name"
                      value={p.name}
                      onChange={e => setPartRows(rows => rows.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                    />
                    <input
                      className={`${field} col-span-2`} style={fieldStyle}
                      inputMode="decimal" placeholder="Qty" aria-label="Quantity"
                      value={p.qty}
                      onChange={e => setPartRows(rows => rows.map((r, j) => j === i ? { ...r, qty: e.target.value } : r))}
                    />
                    <input
                      className={`${field} col-span-3`} style={fieldStyle}
                      inputMode="decimal" placeholder="Cost" aria-label="Part cost"
                      value={p.cost}
                      onChange={e => setPartRows(rows => rows.map((r, j) => j === i ? { ...r, cost: e.target.value } : r))}
                    />
                    <button
                      onClick={() => setPartRows(rows => rows.filter((_, j) => j !== i))}
                      className="col-span-1 rounded-lg text-sm"
                      style={{ border: `1px solid ${BORDER}`, color: DIM2 }}
                      aria-label="Remove part"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {partRows.length < MAX_PARTS && (
                  <button
                    onClick={() => setPartRows(rows => [...rows, { name: '', qty: '', cost: '' }])}
                    className="mt-2 text-xs underline"
                    style={{ color: DIM2 }}
                  >
                    Add a part
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {textInput('labor_cost', 'labor_cost', { inputMode: 'decimal', placeholder: '0.00' })}
                {textInput('parts_cost', 'parts_cost', { inputMode: 'decimal', placeholder: '0.00' })}
                {textInput('tax', 'tax', { inputMode: 'decimal', placeholder: '0.00' })}
                {textInput('total', 'total', { inputMode: 'decimal', placeholder: '0.00' })}
              </div>

              {error && <p className="text-xs mb-3" style={{ color: RED }}>{error}</p>}

              <div className="flex items-center gap-3">
                <button
                  onClick={submit}
                  disabled={stage === 'saving'}
                  className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  style={{ background: ACCENT, color: '#0b1218' }}
                >
                  {stage === 'saving' ? 'Filing…' : 'File this invoice'}
                </button>
                {image && (
                  <span className="text-xs" style={{ color: DIM }}>Photo will be kept with the record</span>
                )}
              </div>
            </>
          )}

          {/* ── done ─────────────────────────────────────────────────────────── */}
          {stage === 'done' && (
            <div className="py-8 text-center">
              <p className="text-sm font-semibold" style={{ color: GREEN }}>Invoice filed</p>
              <p className="text-xs mt-1" style={{ color: DIM2 }}>
                It is in this unit&apos;s service history and counts toward cost per mile.
              </p>
              <button
                onClick={onClose}
                className="mt-4 rounded-lg px-4 py-2 text-sm font-semibold"
                style={{ background: ACCENT, color: '#0b1218' }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
