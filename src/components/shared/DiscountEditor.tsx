'use client'

// ─── The discount control on an LD quote, work order or invoice ───────────────
//
// Flat dollars or a percent, on labour, parts or the whole document, with an
// optional reason that prints on the customer's copy. The arithmetic is entirely
// lib/document-discount; this only collects the four answers and shows what they
// came to. Every button is type="button" so it can sit inside a form without
// submitting it.

import { useState } from 'react'
import {
  DISCOUNT_SCOPES, discountLabel, normalizeDiscount,
  type DiscountInput, type DiscountScope, type DiscountType, type DocumentDiscount,
} from '@/lib/document-discount'

/** What the inputs hold - the value as typed, so an empty box is allowed. */
export interface DiscountDraft {
  type:   DiscountType
  value:  string
  scope:  DiscountScope
  reason: string
}

export const EMPTY_DISCOUNT: DiscountDraft = { type: 'flat', value: '', scope: 'document', reason: '' }

/** The editor's starting value: what the document recorded, or empty. */
export function draftFrom(d: DiscountInput | DocumentDiscount | null | undefined): DiscountDraft {
  if (!d) return EMPTY_DISCOUNT
  return { type: d.type, value: String(d.value), scope: d.scope, reason: d.reason ?? '' }
}

/** The draft as the money layer reads it. Empty or zero is null - no discount. */
export function discountFromDraft(d: DiscountDraft): DiscountInput | null {
  return normalizeDiscount(d)
}

/** For dirty detection: equal drafts give equal keys; every empty draft is the same. */
export function discountKey(d: DiscountDraft): string {
  const n = normalizeDiscount(d)
  return n ? `${n.type}|${n.value}|${n.scope}|${n.reason ?? ''}` : ''
}

const fmt = (n: number) => `$${n.toFixed(2)}`

export function DiscountEditor({
  value, onChange, applied, error, disabled = false,
}: {
  value:    DiscountDraft
  onChange: (d: DiscountDraft) => void
  /** The discount as applied by the money layer, for the "comes to" line. */
  applied:  DocumentDiscount | null
  /** Why it cannot be applied, shown under the inputs. */
  error:    string | null
  disabled?: boolean
}) {
  const has = !!normalizeDiscount(value)
  const [open, setOpen] = useState(has)
  if (!open && !has) {
    return (
      <button
        type="button"
        data-testid="add-discount"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="text-xs text-orange hover:text-orange/80 disabled:opacity-40"
      >
        + Add discount
      </button>
    )
  }
  const set = (patch: Partial<DiscountDraft>) => onChange({ ...value, ...patch })
  return (
    <div data-testid="discount-editor" className="space-y-2 rounded-lg border border-white/10 p-3">
      <div className="flex items-center justify-between">
        <p className="text-white/50 text-xs uppercase tracking-widest">Discount</p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => { onChange(EMPTY_DISCOUNT); setOpen(false) }}
          className="text-xs text-white/40 hover:text-white/70"
        >
          Remove
        </button>
      </div>
      <div className="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto] gap-2">
        <div className="flex rounded-lg overflow-hidden border border-white/15">
          {(['flat', 'percent'] as const).map(t => (
            <button
              key={t}
              type="button"
              disabled={disabled}
              aria-pressed={value.type === t}
              onClick={() => set({ type: t })}
              className={`px-3 text-sm ${value.type === t ? 'bg-[#FF6600] text-white' : 'text-white/60 hover:text-white'}`}
            >
              {t === 'flat' ? '$' : '%'}
            </button>
          ))}
        </div>
        <input
          type="number" min={0} step={value.type === 'flat' ? 0.01 : 0.5} inputMode="decimal"
          name="discount_value"
          aria-label="Discount amount"
          className="nwi-input text-sm"
          placeholder={value.type === 'flat' ? '0.00' : '0'}
          disabled={disabled}
          value={value.value}
          onChange={e => set({ value: e.target.value })}
        />
        <select
          name="discount_scope"
          aria-label="Discount applies to"
          className="nwi-input text-sm col-span-2 sm:col-span-1"
          disabled={disabled}
          value={value.scope}
          onChange={e => set({ scope: e.target.value as DiscountScope })}
        >
          {DISCOUNT_SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <input
        name="discount_reason"
        aria-label="Discount reason"
        maxLength={200}
        className="nwi-input text-sm w-full"
        placeholder="Reason, printed for the customer (optional) - e.g. fleet customer"
        disabled={disabled}
        value={value.reason}
        onChange={e => set({ reason: e.target.value })}
      />
      {error ? (
        <p className="text-danger text-xs">{error}</p>
      ) : applied ? (
        <p className="text-white/40 text-xs">
          {discountLabel(applied)} comes to <span className="text-emerald-400">-{fmt(applied.amount)}</span>
          {applied.labor_amount > 0 && applied.parts_amount > 0
            ? ` (labor -${fmt(applied.labor_amount)}, parts -${fmt(applied.parts_amount)})`
            : ''}
          . Tax is on the discounted amount.
        </p>
      ) : null}
    </div>
  )
}

/**
 * The two rows every totals block prints when there is a discount: the subtotal
 * before it, then the discount with its reason. Nothing at all when there is none -
 * a document without a discount prints exactly as it always did.
 */
export function DiscountRows({
  discount, subtotalBefore, className = 'flex justify-between text-sm',
}: {
  discount:       DocumentDiscount | null
  subtotalBefore: number
  className?:     string
}) {
  if (!discount) return null
  return (
    <>
      <div className={className}>
        <span className="text-white/60">Subtotal</span>
        <span className="text-white">{fmt(subtotalBefore)}</span>
      </div>
      <div className={className} data-testid="discount-row">
        <span className="text-white/60">
          {discountLabel(discount)}
          {discount.reason && <span className="text-white/40 text-xs ml-1.5">· {discount.reason}</span>}
        </span>
        <span className="text-emerald-400">-{fmt(discount.amount)}</span>
      </div>
    </>
  )
}
