'use client'

// The discount on an HD work order (migration 168): carried from the approved quote,
// or set here. Saved through PUT /api/hd/work-orders/[id]/discount, which prices it
// against the work order's lines with the converter's own function - so the "comes to"
// line below is the server's figure, not a second calculation in the browser.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseDiscount, type DocumentDiscount } from '@/lib/document-discount'
import {
  DiscountEditor, draftFrom, discountFromDraft, discountKey, type DiscountDraft,
} from '@/components/shared/DiscountEditor'

export default function WorkOrderDiscount({ workOrderId, discount, locked }: {
  workOrderId: string
  /** The stored hd_work_orders.discount. */
  discount: unknown
  locked: boolean
}) {
  const router = useRouter()
  const [saved, setSaved] = useState<DocumentDiscount | null>(() => parseDiscount(discount))
  const [draft, setDraft] = useState<DiscountDraft>(() => draftFrom(saved))
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const dirty = discountKey(draft) !== discountKey(draftFrom(saved))

  async function save() {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/hd/work-orders/${workOrderId}/discount`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discount: discountFromDraft(draft) }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setError(String(j.error ?? 'The discount was not saved.')); return }
      setSaved(parseDiscount(j.discount))
      setNotice(j.notice ?? null)
      router.refresh()
    } catch {
      setError('Could not reach the server. Nothing was saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}>
      <p className="font-condensed font-bold text-white text-sm tracking-widest mb-1">DISCOUNT</p>
      <p className="text-xs mb-3" style={{ color: 'rgba(var(--hd-ink-rgb), 0.5)' }}>
        Comes off the labor and parts lines only - never travel, mileage, shop supplies or the fees. It carries to the invoice.
      </p>
      <DiscountEditor theme="hd" value={draft} onChange={d => { setDraft(d); setError(null) }}
        disabled={locked || saving} applied={dirty ? null : saved} error={error} notice={dirty ? null : notice} />
      {dirty && !locked && (
        <button type="button" onClick={save} disabled={saving}
          className="mt-3 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: '#E85D24', minHeight: 40 }}>
          {saving ? 'Saving...' : discountFromDraft(draft) ? 'Save discount' : 'Remove discount'}
        </button>
      )}
      {locked && (
        <p className="text-xs mt-2" style={{ color: 'rgba(var(--hd-ink-rgb), 0.5)' }}>
          Invoiced - change the discount on the invoice.
        </p>
      )}
    </div>
  )
}
