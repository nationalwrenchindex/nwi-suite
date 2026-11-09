'use client'

// A reading at the time of service, on an HD work order:
//
//   kind="hours"     the reefer unit's hour meter (migration 179).
//   kind="odometer"  the truck or trailer's odometer, whole miles (migration 183). For
//                    warranty: the reading this repair was done at.
//
// THE INPUT HOLDS ONLY WHAT WILL BE RECORDED ON THIS JOB. It used to be pre-filled with
// the unit record's last known hours, and a pre-filled value was deliberately never
// saved - so WO-2026-1572 showed 123456 in the box, with a Save button, and Create
// Invoice billed no hours at all (INV-2026-0029). A reading the tech is looking at and
// a reading on the job looked identical. Now the box starts with this job's recorded
// reading or empty; the unit's last known figure sits BESIDE it, labelled as the unit
// record's, with a "Use it" button that puts it in the box. Whatever is in the box and
// not yet saved is saved by Create Invoice before it converts (lib/hd/wo-pending), like
// the lines, the fees and the discount. Blank is saved as no reading - the documents
// then print nothing rather than a wrong number.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatOdometer, formatUnitHours } from '@/lib/hd/unit-hours'
import { registerPending } from '@/lib/hd/wo-pending'

export default function WorkOrderUnitHours({ workOrderId, recorded, lastKnown = null, available, locked, kind = 'hours' }: {
  workOrderId: string
  /** The work order's recorded reading. NULL = none recorded. */
  recorded: number | null
  /** The linked unit's last known hours, offered beside the box - never put in it. Hours only. */
  lastKnown?: number | null
  /** False before the column's migration (179 for hours, 183 for the odometer). */
  available: boolean
  locked: boolean
  kind?: 'hours' | 'odometer'
}) {
  const router = useRouter()
  const column = kind === 'hours' ? 'unit_hours' : 'vehicle_odometer'
  const format = kind === 'hours' ? formatUnitHours : formatOdometer
  const [value, setValue] = useState(recorded != null ? String(recorded) : '')
  const [saved, setSaved] = useState(recorded != null ? String(recorded) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = value.trim() !== saved

  async function save(): Promise<string | null> {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/hd/work-orders/${workOrderId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [column]: value.trim() === '' ? null : value.trim() }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { const msg = String(j.error ?? 'Not saved.'); setError(msg); return msg }
      const h = j.work_order?.[column]
      setSaved(h == null ? '' : String(Number(h))); setValue(h == null ? '' : String(Number(h)))
      router.refresh()
      return null
    } catch {
      const msg = 'Could not reach the server. Not saved.'
      setError(msg)
      return msg
    } finally {
      setSaving(false)
    }
  }

  // Everything in the box that the server does not have is pending. There is no
  // pre-fill any more, so there is no exception.
  const dirtyRef = useRef(false)
  dirtyRef.current = available && !locked && dirty
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => registerPending(workOrderId, kind, {
    dirty: () => dirtyRef.current,
    flush: () => saveRef.current(),
  }), [workOrderId, kind])

  if (!available) return <span style={{ color: 'var(--hd-text-faint)' }}>Needs migration {kind === 'hours' ? '179' : '183'}</span>
  if (locked) return <span style={{ color: 'rgba(var(--hd-ink-rgb), 0.85)' }}>{format(recorded) ?? '—'}</span>

  return (
    <ReadingBox kind={kind} value={value} onChange={setValue} saved={saved} lastKnown={lastKnown}
      testId={kind === 'hours' ? 'wo-unit-hours' : 'wo-odometer'} document="work order"
      onSave={() => void save()} saving={saving} error={error} />
  )
}

/** Which document the box is on - only the wording of the state line changes. */
type ReadingDocument = 'work order' | 'quote' | 'invoice'

const STATE_WORDS: Record<ReadingDocument, { prints: string; typed: string; cleared: string }> = {
  'work order': {
    prints:  'prints on the invoice',
    typed:   'Typed, not saved yet - Save, or Create Invoice saves it first.',
    cleared: 'Cleared, not saved yet - Create Invoice saves it as no reading.',
  },
  quote: {
    prints:  'prints on the quote',
    typed:   'Typed, not saved yet - saved when you save the quote.',
    cleared: 'Cleared, not saved yet - saving the quote records no reading.',
  },
  invoice: {
    prints:  'prints on the invoice',
    typed:   'Typed, not saved yet - saved when you save the invoice.',
    cleared: 'Cleared, not saved yet - saving the invoice records no reading.',
  },
}

/**
 * The reading box itself, controlled - the ONE version, shared by the work order (above,
 * which saves it on its own) and the HD quote and new-invoice forms (which save it with
 * the form). It never fills itself: `value` is only what the tech typed or this document
 * already recorded, and the unit's last known reading is offered UNDER it, labelled
 * "(not this job's)", with a Use it button.
 */
export function ReadingBox({ kind = 'hours', value, onChange, saved, lastKnown = null, testId, document, onSave, saving = false, error = null }: {
  kind?: 'hours' | 'odometer'
  value: string
  onChange: (v: string) => void
  /** What this document has stored. '' = none recorded. */
  saved: string
  /** The unit's last known reading, offered beside the box - never put in it. Hours only. */
  lastKnown?: number | null
  testId: string
  document: ReadingDocument
  /** Work order only: its own Save button. The forms save the box with everything else. */
  onSave?: () => void
  saving?: boolean
  error?: string | null
}) {
  const format = kind === 'hours' ? formatUnitHours : formatOdometer
  const unitWord = kind === 'hours' ? 'h' : 'mi'
  const words = STATE_WORDS[document]
  const dirty = value.trim() !== saved
  const offerLastKnown = kind === 'hours' && lastKnown != null && saved === '' && value.trim() === ''
  // The state, in words that cannot be mistaken for one another.
  const state: 'recorded' | 'unsaved' | 'none' = dirty ? 'unsaved' : saved !== '' ? 'recorded' : 'none'
  return (
    <div data-testid={testId} data-reading-state={state}>
      <div className="flex items-center gap-2">
        <input type="text" inputMode={kind === 'hours' ? 'decimal' : 'numeric'} value={value} onChange={e => onChange(e.target.value)}
          placeholder={kind === 'hours' ? 'Hour meter' : 'Truck / trailer miles'}
          aria-label={kind === 'hours' ? 'Unit hours on this job' : 'Odometer on this job'}
          className="w-32 px-2 py-1.5 rounded-lg text-base sm:text-sm"
          style={{ background: 'var(--hd-inner)', border: '1px solid var(--hd-border)', color: 'var(--hd-text)' }} data-testid={`${testId}-input`} />
        {dirty && onSave && (
          <button type="button" onClick={onSave} disabled={saving}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
            style={{ background: 'var(--hd-inner)', border: '1px solid var(--hd-border)', color: 'var(--hd-text)' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>
      <span className="block text-[11px] mt-1" data-testid={`${testId}-state`}
        style={{ color: state === 'unsaved' ? 'var(--hd-warn)' : state === 'recorded' ? 'var(--hd-positive)' : 'var(--hd-text-faint)', fontWeight: state === 'none' ? 400 : 600 }}>
        {state === 'recorded'
          ? `RECORDED ON THIS JOB: ${format(Number(saved))} ${unitWord} - ${words.prints}.`
          : state === 'unsaved'
            ? (value.trim() === '' ? words.cleared : words.typed)
            : `NOT RECORDED ON THIS JOB - the ${document === 'quote' ? 'quote' : 'invoice'} will show no ${kind === 'hours' ? 'hours' : 'odometer'}.`}
      </span>
      {offerLastKnown && (
        <span className="block text-[11px] mt-1" data-testid={`${testId}-last-known`} style={{ color: 'var(--hd-text-muted)' }}>
          {`Unit record's last reading: ${format(lastKnown)} ${unitWord} (not this job's). `}
          <button type="button" onClick={() => onChange(String(lastKnown))}
            className="underline font-semibold" style={{ color: 'var(--hd-text)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            Use it
          </button>
        </span>
      )}
      {error && <span className="block text-[11px] mt-1" style={{ color: 'var(--hd-warn)' }}>{error}</span>}
    </div>
  )
}
