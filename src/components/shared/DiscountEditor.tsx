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
  DISCOUNT_SCOPES, discountLabel, discountPrintLabel, normalizeDiscount,
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

/**
 * The surfaces the editor sits on. 'ld' is LD's dark card and is the default, so
 * every LD screen renders exactly as before. 'light' is HD's white document forms
 * (quote and invoice editors), 'hd' the HD app surface (the work order screen), which
 * follows HD's own dark and light theme. Colour only - the control is the same.
 */
export type DiscountTheme = 'ld' | 'light' | 'hd'

const LIGHT_INPUT: React.CSSProperties = {
  border: '1px solid #E5E7EB', borderRadius: 8, padding: '8px 10px', fontSize: 14,
  color: '#1A1A1A', background: '#FFFFFF', minHeight: 40,
}

const THEMES: Record<DiscountTheme, {
  box: string; heading: string; remove: string; toggle: string; on: string; off: string
  input: string; inputStyle?: React.CSSProperties; note: string; amount: string; error: string
}> = {
  ld: {
    box: 'border-white/10', heading: 'text-white/50', remove: 'text-white/40 hover:text-white/70',
    toggle: 'border-white/15', on: 'bg-[#FF6600] text-white', off: 'text-white/60 hover:text-white',
    input: 'nwi-input text-sm', note: 'text-white/40', amount: 'text-emerald-400', error: 'text-danger',
  },
  // Paper and HD use the AA text tokens (globals.css), so nothing here is a low-alpha
  // white that disappears on the other theme.
  light: {
    box: 'border-gray-200', heading: 'text-[color:var(--paper-muted)]', remove: 'text-[color:var(--paper-muted)] hover:text-gray-900',
    toggle: 'border-gray-300', on: 'bg-[#FF6600] text-on-accent', off: 'text-[color:var(--paper-muted)] hover:text-gray-900',
    input: 'text-sm', inputStyle: LIGHT_INPUT, note: 'text-[color:var(--paper-muted)]', amount: 'text-emerald-700', error: 'text-red-700',
  },
  hd: {
    box: 'border-white/10', heading: 'text-[color:var(--hd-text-muted)]', remove: 'text-[color:var(--hd-text-faint)] hover:text-white',
    toggle: 'border-white/15', on: 'bg-[#FF6600] text-on-accent', off: 'text-[color:var(--hd-text-muted)] hover:text-white',
    input: 'nwi-input text-sm', note: 'text-[color:var(--hd-text-muted)]', amount: 'text-[color:var(--hd-positive)]', error: 'text-[color:var(--hd-negative)]',
  },
}

export function DiscountEditor({
  value, onChange, applied, error, disabled = false, theme = 'ld', notice = null,
}: {
  value:    DiscountDraft
  onChange: (d: DiscountDraft) => void
  /** The discount as applied by the money layer, for the "comes to" line. */
  applied:  DocumentDiscount | null
  /** Why it cannot be applied, shown under the inputs. */
  error:    string | null
  disabled?: boolean
  theme?:   DiscountTheme
  /** A fact about the tax shown under the "comes to" line - HD's missing tax rate. */
  notice?:  string | null
}) {
  const t = THEMES[theme]
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
    <div data-testid="discount-editor" className={`space-y-2 rounded-lg border ${t.box} p-3`}>
      <div className="flex items-center justify-between">
        <p className={`${t.heading} text-xs uppercase tracking-widest`}>Discount</p>
        <button
          type="button"
          disabled={disabled}
          onClick={() => { onChange(EMPTY_DISCOUNT); setOpen(false) }}
          className={`text-xs ${t.remove}`}
        >
          Remove
        </button>
      </div>
      <div className="grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto] gap-2">
        <div className={`flex rounded-lg overflow-hidden border ${t.toggle}`}>
          {(['flat', 'percent'] as const).map(kind => (
            <button
              key={kind}
              type="button"
              disabled={disabled}
              aria-pressed={value.type === kind}
              onClick={() => set({ type: kind })}
              className={`px-3 text-sm ${value.type === kind ? t.on : t.off}`}
            >
              {kind === 'flat' ? '$' : '%'}
            </button>
          ))}
        </div>
        <input
          type="number" min={0} step={value.type === 'flat' ? 0.01 : 0.5} inputMode="decimal"
          name="discount_value"
          aria-label="Discount amount"
          className={t.input}
          style={t.inputStyle}
          placeholder={value.type === 'flat' ? '0.00' : '0'}
          disabled={disabled}
          value={value.value}
          onChange={e => set({ value: e.target.value })}
        />
        <select
          name="discount_scope"
          aria-label="Discount applies to"
          className={`${t.input} col-span-2 sm:col-span-1`}
          style={t.inputStyle}
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
        className={`${t.input} w-full`}
        style={t.inputStyle ? { ...t.inputStyle, width: '100%' } : undefined}
        placeholder="Reason, printed for the customer (optional) - e.g. fleet customer"
        disabled={disabled}
        value={value.reason}
        onChange={e => set({ reason: e.target.value })}
      />
      {error ? (
        <p className={`${t.error} text-xs`}>{error}</p>
      ) : applied ? (
        <p className={`${t.note} text-xs`}>
          {theme === 'ld' ? discountLabel(applied) : discountPrintLabel(applied)} comes to <span className={t.amount}>{'-' + fmt(applied.amount)}</span>
          {applied.labor_amount > 0 && applied.parts_amount > 0
            ? ` (labor -${fmt(applied.labor_amount)}, parts -${fmt(applied.parts_amount)})`
            : ''}
          . Tax is on the discounted amount.
        </p>
      ) : null}
      {notice && !error && <p className={`${theme === 'light' ? 'text-amber-800' : theme === 'hd' ? 'text-[color:var(--hd-warn)]' : 'text-amber-400'} text-xs`} data-testid="discount-notice">{notice}</p>}
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
        <span className="text-emerald-400">{'-' + fmt(discount.amount)}</span>
      </div>
    </>
  )
}
