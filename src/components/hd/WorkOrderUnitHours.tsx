'use client'

// A reading at the time of service, on an HD work order:
//
//   kind="hours"     the reefer unit's hour meter (migration 179). Pre-filled from the
//                    unit record's last known reading when the work order has none.
//   kind="odometer"  the truck or trailer's odometer, whole miles (migration 183). For
//                    warranty: the reading this repair was done at.
//
// Recorded on the work order only when the tech saves it, and carried to the invoice on
// convert. Blank is saved as no reading - the documents then print nothing rather than
// a wrong number. A typed, unsaved reading is saved by Create Invoice before it
// converts (lib/hd/wo-pending), like the lines and the fees.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatOdometer, formatUnitHours } from '@/lib/hd/unit-hours'
import { registerPending } from '@/lib/hd/wo-pending'

export default function WorkOrderUnitHours({ workOrderId, recorded, lastKnown = null, available, locked, kind = 'hours' }: {
  workOrderId: string
  /** The work order's recorded reading. NULL = none recorded. */
  recorded: number | null
  /** The linked unit's last known hours, for the pre-fill only. Hours only. */
  lastKnown?: number | null
  /** False before the column's migration (179 for hours, 183 for the odometer). */
  available: boolean
  locked: boolean
  kind?: 'hours' | 'odometer'
}) {
  const router = useRouter()
  const column = kind === 'hours' ? 'unit_hours' : 'vehicle_odometer'
  const format = kind === 'hours' ? formatUnitHours : formatOdometer
  const initial = recorded != null ? String(recorded) : kind === 'hours' && lastKnown != null ? String(lastKnown) : ''
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(recorded != null ? String(recorded) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = value.trim() !== saved
  const prefilled = kind === 'hours' && recorded == null && lastKnown != null && value === String(lastKnown)

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

  // A pre-filled hours value is the unit record's, not a reading: never saved for the
  // tech. Anything he typed is.
  const dirtyRef = useRef(false)
  dirtyRef.current = available && !locked && dirty && !prefilled
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => registerPending(workOrderId, kind, {
    dirty: () => dirtyRef.current,
    flush: () => saveRef.current(),
  }), [workOrderId, kind])

  if (!available) return <span style={{ color: 'var(--hd-text-faint)' }}>Needs migration {kind === 'hours' ? '179' : '183'}</span>
  if (locked) return <span style={{ color: 'rgba(var(--hd-ink-rgb), 0.85)' }}>{format(recorded) ?? '—'}</span>

  const test = kind === 'hours' ? 'wo-unit-hours' : 'wo-odometer'
  return (
    <div data-testid={test}>
      <div className="flex items-center gap-2">
        <input type="text" inputMode={kind === 'hours' ? 'decimal' : 'numeric'} value={value} onChange={e => setValue(e.target.value)}
          placeholder={kind === 'hours' ? 'Hour meter' : 'Truck / trailer miles'}
          className="w-32 px-2 py-1.5 rounded-lg text-base sm:text-sm text-white"
          style={{ background: 'var(--hd-inner)', border: '1px solid var(--hd-border)' }} data-testid={`${test}-input`} />
        {dirty && (
          <button type="button" onClick={() => void save()} disabled={saving}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--hd-inner)', border: '1px solid var(--hd-border)' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>
      <span className="block text-[11px] mt-1" style={{ color: 'var(--hd-text-faint)' }}>
        {prefilled
          ? 'Last reading on the unit record - check the meter and save to record it on this job.'
          : saved === ''
            ? `Not recorded - the invoice will show no ${kind === 'hours' ? 'hours' : 'odometer'}.`
            : 'Recorded on this work order; carries to the invoice.'}
      </span>
      {error && <span className="block text-[11px] mt-1" style={{ color: 'var(--hd-warn)' }}>{error}</span>}
    </div>
  )
}
