'use client'

// The discount on an HD work order (migration 168): carried from the approved quote,
// or set here. Saved through PUT /api/hd/work-orders/[id]/discount, which prices it
// against the work order's lines with the converter's own function - so the "comes to"
// line below is the server's figure, not a second calculation in the browser.
//
// NOTHING TYPED HERE IS LOST (lib/hd/wo-pending), the same as the fees card: Create
// Invoice saves an unsaved discount before it converts - after the lines, because the
// discount is priced on the saved lines - and stops, invoicing nothing, if the save
// fails. The draft is held in this card's own state and is never re-seeded from the
// server by another card's save (router.refresh), so typed input survives that reload.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseDiscount, type DocumentDiscount } from '@/lib/document-discount'
import {
  DiscountEditor, draftFrom, discountFromDraft, discountKey, type DiscountDraft,
} from '@/components/shared/DiscountEditor'
import { registerPending } from '@/lib/hd/wo-pending'

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

  // Resolves to the error, or null when saved. The button and Create Invoice both call it.
  async function save(): Promise<string | null> {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/hd/work-orders/${workOrderId}/discount`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discount: discountFromDraft(draft) }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { const msg = String(j.error ?? 'The discount was not saved.'); setError(msg); return msg }
      setSaved(parseDiscount(j.discount))
      setNotice(j.notice ?? null)
      router.refresh()
      return null
    } catch {
      const msg = 'Could not reach the server. Nothing was saved.'
      setError(msg)
      return msg
    } finally {
      setSaving(false)
    }
  }

  const dirtyRef = useRef(false)
  dirtyRef.current = dirty && !locked
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => registerPending(workOrderId, 'discount', {
    dirty: () => dirtyRef.current,
    flush: () => saveRef.current(),
  }), [workOrderId])

  return (
    <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}>
      <p className="font-condensed font-bold text-white text-sm tracking-widest mb-1">DISCOUNT</p>
      <p className="text-xs mb-3" style={{ color: 'var(--hd-text-muted)' }}>
        Comes off the labor and parts lines only - never travel, mileage, shop supplies or the fees. It carries to the invoice.
      </p>
      <DiscountEditor theme="hd" value={draft} onChange={d => { setDraft(d); setError(null) }}
        disabled={locked || saving} applied={dirty ? null : saved} error={error} notice={dirty ? null : notice} />
      {dirty && !locked && (
        <button type="button" onClick={() => void save()} disabled={saving}
          className="mt-3 px-4 py-2 rounded-lg text-sm font-semibold text-on-accent disabled:opacity-50"
          style={{ background: '#E85D24', minHeight: 40 }}>
          {saving ? 'Saving...' : discountFromDraft(draft) ? 'Save discount' : 'Remove discount'}
        </button>
      )}
      {locked && (
        <p className="text-xs mt-2" style={{ color: 'var(--hd-text-muted)' }}>
          Invoiced - change the discount on the invoice.
        </p>
      )}
    </div>
  )
}
