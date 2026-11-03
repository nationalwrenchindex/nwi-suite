'use client'

// The unit's hour reading at the time of service (migration 179). Pre-filled from the
// unit record's last known reading when the work order has none; recorded on the work
// order only when the tech saves it, and carried to the invoice on convert. Blank is
// saved as no reading - the documents then print no hours rather than a wrong number.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatUnitHours } from '@/lib/hd/unit-hours'

export default function WorkOrderUnitHours({ workOrderId, recorded, lastKnown, available, locked }: {
  workOrderId: string
  /** hd_work_orders.unit_hours. NULL = no reading recorded. */
  recorded: number | null
  /** The linked unit's last known reading, for the pre-fill only. */
  lastKnown: number | null
  /** False before migration 179. */
  available: boolean
  locked: boolean
}) {
  const router = useRouter()
  const initial = recorded != null ? String(recorded) : lastKnown != null ? String(lastKnown) : ''
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(recorded != null ? String(recorded) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!available) return <span style={{ color: 'var(--hd-text-faint)' }}>Needs migration 179</span>
  if (locked) return <span style={{ color: 'rgba(var(--hd-ink-rgb), 0.85)' }}>{formatUnitHours(recorded) ?? '—'}</span>

  const dirty = value.trim() !== saved
  const prefilled = recorded == null && lastKnown != null && value === String(lastKnown)

  async function save() {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/hd/work-orders/${workOrderId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_hours: value.trim() === '' ? null : value.trim() }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(String(j.error ?? 'Not saved.')); return }
      const h = j.work_order?.unit_hours
      setSaved(h == null ? '' : String(Number(h))); setValue(h == null ? '' : String(Number(h)))
      router.refresh()
    } catch {
      setError('Could not reach the server. Not saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="wo-unit-hours">
      <div className="flex items-center gap-2">
        <input type="text" inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} placeholder="Hour meter"
          className="w-28 px-2 py-1.5 rounded-lg text-base sm:text-sm text-white"
          style={{ background: 'var(--hd-inner)', border: '1px solid var(--hd-border)' }} data-testid="wo-unit-hours-input" />
        {dirty && (
          <button type="button" onClick={save} disabled={saving}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--hd-inner)', border: '1px solid var(--hd-border)' }}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>
      <span className="block text-[11px] mt-1" style={{ color: 'var(--hd-text-faint)' }}>
        {prefilled
          ? 'Last reading on the unit record - check the meter and save to record it on this job.'
          : saved === '' ? 'Not recorded - the invoice will show no hours.' : 'Recorded on this work order; carries to the invoice.'}
      </span>
      {error && <span className="block text-[11px] mt-1" style={{ color: '#FBBF24' }}>{error}</span>}
    </div>
  )
}
