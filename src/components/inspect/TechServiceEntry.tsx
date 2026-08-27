'use client'

// Technician service entry — photograph the invoice, correct what the machine read,
// then save.
//
// The shape of this screen follows from one belief: the vision model is a typist, not
// a source of truth. It is fast and it is wrong often enough that a number it produced
// must never reach the database unseen. So the flow is deliberately four steps and the
// third one cannot be skipped:
//
//   capture  → point the phone at the paper
//   reading  → the model transcribes it
//   review   → EVERY field is an editable box, pre-filled, with the ones the model
//              could not read called out. Nothing has been written yet.
//   saved    → confirmed by a human, and only then a row exists
//
// There is also a "type it in by hand" path from every failure, because a tech in a
// yard with a dead API still has an invoice in his hand and five minutes.
//
// Rendered inside EntryChooser's <main>, which supplies the page chrome and the unit
// header, so this component starts at the content and ends at its own sticky bar.

import { useCallback, useEffect, useRef, useState } from 'react'
import { NWI_ORANGE } from '@/components/fleet-pro/brand'
import {
  ALLOWED_IMAGE_TYPES,
  EMPTY_EXTRACTION,
  MAX_DESCRIPTION_CHARS,
  MAX_IMAGE_BYTES,
  MAX_INVOICE_NO_CHARS,
  MAX_PARTS,
  MAX_PART_NAME_CHARS,
  MAX_TECH_NAME_CHARS,
  MAX_VENDOR_CHARS,
  SERVICE_ENTRY_FIELD_LABELS,
  moneyToInput,
  numberToInput,
  type ExtractedServiceEntry,
  type ServiceEntryFieldKey,
} from '@/lib/fleet-pro/service-entry'

// Kept in step with PretripClient.
const CARD   = '#111920'
const BORDER = '#1e3040'
const PASS   = '#22C55E'
const FAIL   = '#ef4444'
const MUTED  = 'rgba(255,255,255,0.55)'
const FAINT  = 'rgba(255,255,255,0.35)'

type Step = 'capture' | 'reading' | 'review' | 'saved'

interface PartDraft { name: string; qty: string; cost: string }

interface Draft {
  technician_name:   string
  vendor_name:       string
  invoice_number:    string
  service_date:      string
  labor_description: string
  labor_cost:        string
  parts_cost:        string
  tax:               string
  total:             string
}

const BLANK_DRAFT: Draft = {
  technician_name:   '',
  vendor_name:       '',
  invoice_number:    '',
  service_date:      '',
  labor_description: '',
  labor_cost:        '',
  parts_cost:        '',
  tax:               '',
  total:             '',
}

function draftFrom(extracted: ExtractedServiceEntry, technicianName: string): Draft {
  return {
    technician_name:   technicianName,
    vendor_name:       extracted.vendor_name ?? '',
    invoice_number:    extracted.invoice_number ?? '',
    service_date:      extracted.service_date ?? '',
    labor_description: extracted.labor_description ?? '',
    labor_cost:        moneyToInput(extracted.labor_cost),
    parts_cost:        moneyToInput(extracted.parts_cost),
    tax:               moneyToInput(extracted.tax),
    total:             moneyToInput(extracted.total),
  }
}

function partsFrom(extracted: ExtractedServiceEntry): PartDraft[] {
  return extracted.parts.map(p => ({
    name: p.name,
    qty:  numberToInput(p.qty),
    cost: moneyToInput(p.cost),
  }))
}

/** '' -> null so an empty box is never posted as 0. */
function num(value: string): number | null {
  const trimmed = value.replace(/[$,\s]/g, '')
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export default function TechServiceEntry({ unitId }: { unitId: string }) {
  const [step, setStep] = useState<Step>('capture')

  const [preview, setPreview] = useState<string | null>(null)
  const fileRef  = useRef<File | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [draft, setDraft]   = useState<Draft>(BLANK_DRAFT)
  const [parts, setParts]   = useState<PartDraft[]>([])
  const [unread, setUnread] = useState<ServiceEntryFieldKey[]>([])
  // What the model returned before any correction. Posted alongside the edits so the
  // record can later show what was machine-read and what a person typed.
  const [original, setOriginal] = useState<ExtractedServiceEntry | null>(null)

  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saved, setSaved]   = useState<{ duplicate: boolean } | null>(null)

  // Minted ONCE, when the tech first reaches the confirmation screen, and reused by
  // every retry after that. This is the whole idempotency story: the server treats a
  // duplicate client_uuid as success, so a phone on one bar cannot file the same
  // repair twice.
  const clientUuid = useRef<string | null>(null)

  // Object URLs leak until revoked, and a tech may retake the photo several times.
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  const startReview = useCallback((extracted: ExtractedServiceEntry, unreadKeys: ServiceEntryFieldKey[]) => {
    if (!clientUuid.current) clientUuid.current = crypto.randomUUID()
    setDraft(prev => draftFrom(extracted, prev.technician_name))
    setParts(partsFrom(extracted))
    setUnread(unreadKeys)
    setOriginal(extracted === EMPTY_EXTRACTION ? null : extracted)
    setStep('review')
  }, [])

  function pickFile(file: File | null) {
    setError(null)
    setNotice(null)
    if (!file) return

    // Checked again on the server; this copy only exists so the tech is told at the
    // moment he picks the photo instead of after a 5MB upload.
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setError('Use your phone camera — that file is not a JPEG or PNG photo.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('That photo is too large. Take it again at normal quality.')
      return
    }

    if (preview) URL.revokeObjectURL(preview)
    fileRef.current = file
    setPreview(URL.createObjectURL(file))
  }

  async function readInvoice() {
    const file = fileRef.current
    if (!file || busy) return

    setBusy(true)
    setError(null)
    setStep('reading')

    try {
      const form = new FormData()
      form.append('unit_id', unitId)
      form.append('image', file)

      const res  = await fetch('/api/inspect/extract-invoice', {
        method: 'POST', body: form, credentials: 'omit',
      })
      const json = await res.json() as {
        ok?: boolean
        error?: string
        extracted?: ExtractedServiceEntry
        unread?: ServiceEntryFieldKey[]
      }

      if (!res.ok || !json.ok || !json.extracted) {
        // A failed read is not a dead end — it drops the tech onto the same
        // confirmation screen with empty boxes and the invoice still in his hand.
        setNotice(json.error ?? 'Could not read that photo. Fill it in by hand.')
        startReview(EMPTY_EXTRACTION, [])
        return
      }

      startReview(json.extracted, json.unread ?? [])
      setNotice('Check every figure against the paper before you confirm.')
    } catch {
      setNotice('No signal for the invoice reader. Fill it in by hand — it still saves.')
      startReview(EMPTY_EXTRACTION, [])
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (busy) return
    setError(null)

    const cleanParts = parts
      .filter(p => p.name.trim())
      .map(p => ({ name: p.name.trim(), qty: num(p.qty), cost: num(p.cost) }))

    const hasContent = !!(
      draft.labor_description.trim() || draft.vendor_name.trim() || draft.invoice_number.trim() ||
      cleanParts.length > 0 ||
      num(draft.labor_cost) !== null || num(draft.parts_cost) !== null ||
      num(draft.tax) !== null || num(draft.total) !== null
    )
    if (!hasContent) {
      setError('Add what was done or what it cost — an empty record is not worth filing.')
      return
    }

    setBusy(true)
    try {
      const res = await fetch('/api/inspect/service-entry', {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({
          client_uuid:       clientUuid.current,
          unit_id:           unitId,
          technician_name:   draft.technician_name.trim() || null,
          vendor_name:       draft.vendor_name.trim() || null,
          invoice_number:    draft.invoice_number.trim() || null,
          service_date:      draft.service_date || null,
          labor_description: draft.labor_description.trim() || null,
          parts:             cleanParts,
          labor_cost:        num(draft.labor_cost),
          parts_cost:        num(draft.parts_cost),
          tax:               num(draft.tax),
          total:             num(draft.total),
          extracted_raw:     original,
        }),
      })
      const json = await res.json() as { ok?: boolean; duplicate?: boolean; error?: string }

      if (!res.ok || !json.ok) {
        setError(json.error ?? 'Could not save this record. Try again.')
        return
      }

      setSaved({ duplicate: json.duplicate === true })
      setStep('saved')
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      // The client_uuid is unchanged, so pressing Confirm again is safe — it cannot
      // produce a second row.
      setError('No signal. Stay on this page and press Confirm again when you have bars.')
    } finally {
      setBusy(false)
    }
  }

  function startAnother() {
    if (preview) URL.revokeObjectURL(preview)
    fileRef.current   = null
    clientUuid.current = null
    setPreview(null)
    // The tech's own name is the one thing worth keeping across entries.
    setDraft({ ...BLANK_DRAFT, technician_name: draft.technician_name })
    setParts([])
    setUnread([])
    setOriginal(null)
    setSaved(null)
    setError(null)
    setNotice(null)
    setStep('capture')
  }

  // ── saved ───────────────────────────────────────────────────────────────────
  if (step === 'saved') {
    return (
      <div style={contentStyle}>
        <div style={{ ...cardStyle, borderColor: PASS, textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 13, letterSpacing: '0.12em', color: MUTED, textTransform: 'uppercase' }}>
            Service record
          </div>
          <div style={{ fontSize: 34, fontWeight: 800, color: PASS, margin: '8px 0' }}>SAVED</div>
          <p style={{ margin: 0, color: MUTED, fontSize: 15, lineHeight: 1.5 }}>
            {saved?.duplicate
              ? 'This one was already filed — nothing was duplicated.'
              : 'Filed against this unit and visible to the shop now.'}
          </p>
        </div>
        <button type="button" onClick={startAnother} style={{ ...primaryButton, marginTop: 16 }}>
          Log another repair
        </button>
      </div>
    )
  }

  // ── reading ─────────────────────────────────────────────────────────────────
  if (step === 'reading') {
    return (
      <div style={contentStyle}>
        <div style={{ ...cardStyle, textAlign: 'center', padding: 28 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Reading the invoice…</div>
          <p style={{ margin: '10px 0 0', color: MUTED, fontSize: 14, lineHeight: 1.5 }}>
            This takes a few seconds. You will get every field to check and correct
            before anything is saved.
          </p>
        </div>
      </div>
    )
  }

  // ── capture ─────────────────────────────────────────────────────────────────
  if (step === 'capture') {
    return (
      <div style={contentStyle}>
        <section style={cardStyle}>
          <h2 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 800, color: '#fff' }}>
            Photograph the invoice
          </h2>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: MUTED, lineHeight: 1.5 }}>
            Lay it flat, fill the frame, and keep your shadow off it. You will check
            every number afterwards.
          </p>

          {preview ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="The invoice you photographed"
                style={{
                  width: '100%', maxHeight: 380, objectFit: 'contain',
                  background: '#0a0f14', border: `1px solid ${BORDER}`, borderRadius: 8,
                }}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                style={{ ...secondaryButton, marginTop: 12 }}
              >
                Retake photo
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              style={{
                width: '100%', minHeight: 120, borderRadius: 10, cursor: 'pointer',
                background: '#162030', border: `1px dashed ${BORDER}`, color: '#fff',
                fontSize: 17, fontWeight: 700,
              }}
            >
              Take a photo of the invoice
            </button>
          )}

          {/* accept + capture together: a phone opens the rear camera straight away
              rather than the photo library. A laptop falls back to a file picker. */}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={e => {
              pickFile(e.target.files?.[0] ?? null)
              // Reset so choosing the SAME file again still fires a change event.
              e.target.value = ''
            }}
            style={{ display: 'none' }}
          />
        </section>

        {error ? <ErrorBox>{error}</ErrorBox> : null}

        <button
          type="button"
          onClick={() => { void readInvoice() }}
          disabled={!preview || busy}
          style={{ ...primaryButton, marginTop: 14, opacity: !preview || busy ? 0.5 : 1 }}
        >
          Read this invoice
        </button>

        <button
          type="button"
          onClick={() => { setNotice(null); startReview(EMPTY_EXTRACTION, []) }}
          style={{ ...secondaryButton, marginTop: 10 }}
        >
          No photo — type it in
        </button>
      </div>
    )
  }

  // ── review ──────────────────────────────────────────────────────────────────
  const components = [num(draft.labor_cost), num(draft.parts_cost), num(draft.tax)]
  const totalNum   = num(draft.total)
  const sum        = components.some(v => v !== null)
    ? components.reduce<number>((acc, v) => acc + (v ?? 0), 0)
    : null
  // A soft check, never a block: an invoice legitimately carries fees and discounts
  // that these four boxes do not model. It is here because a transposed digit in a
  // transcribed figure shows up as a mismatch, and this is the cheapest place to
  // catch one.
  const mismatch = sum !== null && totalNum !== null && Math.abs(sum - totalNum) > 0.02

  const set = (key: keyof Draft) => (value: string) => setDraft(prev => ({ ...prev, [key]: value }))
  const wasUnread = (key: ServiceEntryFieldKey) => unread.includes(key)

  return (
    <>
      <div style={contentStyle}>
        {notice ? (
          <div style={{
            marginBottom: 14, padding: '12px 14px', borderRadius: 8,
            background: 'rgba(255,102,0,0.10)', border: `1px solid ${NWI_ORANGE}`,
            color: '#fff', fontSize: 14, lineHeight: 1.45,
          }}>
            {notice}
          </div>
        ) : null}

        {unread.length > 0 ? (
          <div style={{
            marginBottom: 14, padding: '12px 14px', borderRadius: 8,
            background: 'rgba(255,255,255,0.04)', border: `1px solid ${BORDER}`,
            color: MUTED, fontSize: 14, lineHeight: 1.5,
          }}>
            Could not read {unread.map(k => SERVICE_ENTRY_FIELD_LABELS[k]).join(', ').toLowerCase()}.
            Those boxes are marked below — fill in what the paper says.
          </div>
        ) : null}

        <section style={cardStyle}>
          <Field
            label="Your name"
            value={draft.technician_name}
            onChange={set('technician_name')}
            placeholder="First and last name"
            maxLength={MAX_TECH_NAME_CHARS}
          />
          <Field
            label={SERVICE_ENTRY_FIELD_LABELS.service_date}
            value={draft.service_date}
            onChange={set('service_date')}
            type="date"
            flagged={wasUnread('service_date')}
          />
          <Field
            label={SERVICE_ENTRY_FIELD_LABELS.vendor_name}
            value={draft.vendor_name}
            onChange={set('vendor_name')}
            maxLength={MAX_VENDOR_CHARS}
            flagged={wasUnread('vendor_name')}
          />
          <Field
            label={SERVICE_ENTRY_FIELD_LABELS.invoice_number}
            value={draft.invoice_number}
            onChange={set('invoice_number')}
            maxLength={MAX_INVOICE_NO_CHARS}
            flagged={wasUnread('invoice_number')}
          />
        </section>

        <section style={{ ...cardStyle, marginTop: 14 }}>
          <FieldLabel
            label={SERVICE_ENTRY_FIELD_LABELS.labor_description}
            flagged={wasUnread('labor_description')}
          />
          <textarea
            value={draft.labor_description}
            onChange={e => set('labor_description')(e.target.value)}
            placeholder="What was done to this unit?"
            maxLength={MAX_DESCRIPTION_CHARS}
            rows={4}
            style={{
              width: '100%', padding: '10px 12px', fontSize: 16,
              background: '#162030', border: `1px solid ${wasUnread('labor_description') ? NWI_ORANGE : BORDER}`,
              borderRadius: 8, color: '#fff', resize: 'vertical',
            }}
          />
        </section>

        <section style={{ ...cardStyle, marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={labelStyle}>Parts</span>
            <span style={{ fontSize: 12, color: FAINT }}>{parts.length} line{parts.length === 1 ? '' : 's'}</span>
          </div>

          {parts.map((part, idx) => (
            <div
              key={idx}
              style={{
                padding: 10, marginBottom: 10, borderRadius: 8,
                background: '#0d151d', border: `1px solid ${BORDER}`,
              }}
            >
              <input
                value={part.name}
                onChange={e => setParts(prev => prev.map((p, i) => i === idx ? { ...p, name: e.target.value } : p))}
                placeholder="Part name / number"
                maxLength={MAX_PART_NAME_CHARS}
                style={inputStyle}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginTop: 8 }}>
                <input
                  value={part.qty}
                  onChange={e => setParts(prev => prev.map((p, i) => i === idx ? { ...p, qty: e.target.value } : p))}
                  placeholder="Qty"
                  inputMode="decimal"
                  style={inputStyle}
                />
                <input
                  value={part.cost}
                  onChange={e => setParts(prev => prev.map((p, i) => i === idx ? { ...p, cost: e.target.value } : p))}
                  placeholder="Cost"
                  inputMode="decimal"
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => setParts(prev => prev.filter((_, i) => i !== idx))}
                  aria-label={`Remove part line ${idx + 1}`}
                  style={{
                    minWidth: 48, minHeight: 48, borderRadius: 8, cursor: 'pointer',
                    background: 'transparent', border: `1px solid ${BORDER}`, color: FAIL,
                    fontSize: 18, fontWeight: 800,
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setParts(prev => prev.length >= MAX_PARTS ? prev : [...prev, { name: '', qty: '', cost: '' }])}
            disabled={parts.length >= MAX_PARTS}
            style={{ ...secondaryButton, opacity: parts.length >= MAX_PARTS ? 0.5 : 1 }}
          >
            Add a part
          </button>
        </section>

        <section style={{ ...cardStyle, marginTop: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field
              label={SERVICE_ENTRY_FIELD_LABELS.labor_cost}
              value={draft.labor_cost}
              onChange={set('labor_cost')}
              inputMode="decimal"
              placeholder="0.00"
              flagged={wasUnread('labor_cost')}
            />
            <Field
              label={SERVICE_ENTRY_FIELD_LABELS.parts_cost}
              value={draft.parts_cost}
              onChange={set('parts_cost')}
              inputMode="decimal"
              placeholder="0.00"
              flagged={wasUnread('parts_cost')}
            />
            <Field
              label={SERVICE_ENTRY_FIELD_LABELS.tax}
              value={draft.tax}
              onChange={set('tax')}
              inputMode="decimal"
              placeholder="0.00"
              flagged={wasUnread('tax')}
            />
            <Field
              label={SERVICE_ENTRY_FIELD_LABELS.total}
              value={draft.total}
              onChange={set('total')}
              inputMode="decimal"
              placeholder="0.00"
              flagged={wasUnread('total')}
            />
          </div>

          {mismatch ? (
            <p style={{ margin: '4px 0 0', fontSize: 13, color: NWI_ORANGE, lineHeight: 1.45 }}>
              Labor + parts + tax comes to {sum?.toFixed(2)}, but the total reads {totalNum?.toFixed(2)}.
              Check the paper — that is fine if there are fees or a discount.
            </p>
          ) : null}
        </section>

        {error ? <ErrorBox>{error}</ErrorBox> : null}
      </div>

      {/* Sticky: Confirm is never below a scroll on a long invoice. */}
      <div style={{
        position: 'sticky', bottom: 0, left: 0, right: 0, padding: 12,
        background: 'rgba(10,15,20,0.96)', borderTop: `1px solid ${BORDER}`,
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
      }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>
            Nothing is saved until you press Confirm.
          </div>
          <button
            type="button"
            onClick={() => { void confirm() }}
            disabled={busy}
            style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Saving…' : 'Confirm and save'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── small presentational pieces ───────────────────────────────────────────────

function FieldLabel({ label, flagged }: { label: string; flagged?: boolean }) {
  return (
    <span style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
      {label}
      {flagged ? (
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: NWI_ORANGE,
          border: `1px solid ${NWI_ORANGE}`, borderRadius: 4, padding: '2px 5px',
        }}>
          NOT READ
        </span>
      ) : null}
    </span>
  )
}

function Field({
  label, value, onChange, type = 'text', inputMode, placeholder, maxLength, flagged,
}: {
  label:        string
  value:        string
  onChange:     (v: string) => void
  type?:        string
  inputMode?:   'text' | 'decimal' | 'numeric'
  placeholder?: string
  maxLength?:   number
  flagged?:     boolean
}) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <FieldLabel label={label} flagged={flagged} />
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={e => onChange(e.target.value)}
        style={{ ...inputStyle, borderColor: flagged ? NWI_ORANGE : BORDER }}
      />
    </label>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 14, padding: '12px 14px', borderRadius: 8,
      background: 'rgba(239,68,68,0.12)', border: `1px solid ${FAIL}`,
      color: '#fff', fontSize: 15, lineHeight: 1.45,
    }}>
      {children}
    </div>
  )
}

// ── shared styles ─────────────────────────────────────────────────────────────

const contentStyle: React.CSSProperties = {
  flex: 1,
  padding: 16,
  paddingBottom: 24,
  maxWidth: 640,
  margin: '0 auto',
  width: '100%',
}

const cardStyle: React.CSSProperties = {
  background: CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  padding: 14,
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: MUTED,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 48,
  padding: '10px 12px',
  fontSize: 17,
  background: '#162030',
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  color: '#fff',
}

const primaryButton: React.CSSProperties = {
  width: '100%',
  minHeight: 56,
  borderRadius: 10,
  border: 'none',
  cursor: 'pointer',
  background: NWI_ORANGE,
  color: '#0a0f14',
  fontSize: 18,
  fontWeight: 800,
  letterSpacing: '0.03em',
}

const secondaryButton: React.CSSProperties = {
  width: '100%',
  minHeight: 48,
  borderRadius: 10,
  cursor: 'pointer',
  background: 'transparent',
  border: `1px solid ${BORDER}`,
  color: MUTED,
  fontSize: 15,
  fontWeight: 600,
}
