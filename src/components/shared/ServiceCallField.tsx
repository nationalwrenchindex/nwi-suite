'use client'

// ─── The service call fee, on an LD quote, work order or invoice ─────────────
//
// One input: the amount, pre-filled from Settings on a new document and editable on
// this one. The tax treatment is the document's own record (or the shop's setting on a
// new document) and is stated, not asked - it is a shop-wide answer that depends on
// the state, set once in Settings. Clearing the amount removes the fee.

import type { ServiceCallTax } from '@/lib/service-call'

export default function ServiceCallField({
  fee, tax, onFee, disabled,
}: {
  fee:      number
  tax:      ServiceCallTax
  onFee:    (n: number) => void
  disabled?: boolean
}) {
  return (
    <label className="block" data-testid="service-call-field">
      <span className="text-white/50 text-xs">Service call fee ($)</span>
      <input
        type="number" min="0" step="0.01" inputMode="decimal" disabled={disabled}
        className="nwi-input text-sm w-full mt-1"
        value={fee > 0 ? fee : ''}
        placeholder="0.00"
        onChange={e => onFee(Math.max(0, Math.round((Number(e.target.value) || 0) * 100) / 100))}
        data-testid="service-call-fee"
      />
      <span className="block text-white/35 text-[11px] mt-1">
        A flat fee on its own line. {tax === 'none' ? 'Not taxed.' : 'Taxed as labor.'}
      </span>
    </label>
  )
}
