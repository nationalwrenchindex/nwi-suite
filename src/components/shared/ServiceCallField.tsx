'use client'

// ─── The service call fee, on an LD quote, work order or invoice ─────────────
//
// One input: the amount, pre-filled from Settings on a new document and editable on
// this one. The tax treatment is the document's own record (or the shop's setting on a
// new document) and is stated, not asked - it is a shop-wide answer that depends on
// the state, set once in Settings (migration 180). Clearing the amount removes the fee.
//
// The line under the field says WHICH it is reading - "(your Settings)" or "(as recorded
// on this document)" - so a tech can tell the shop's setting from a document's record,
// and says nothing while the setting has not arrived rather than printing a default.

import type { ServiceCallTax } from '@/lib/service-call'
import { serviceCallTaxText } from '@/lib/document-defaults'

export default function ServiceCallField({
  fee, tax, onFee, disabled, taxFrom, loaded = true,
}: {
  fee:      number
  tax:      ServiceCallTax
  onFee:    (n: number) => void
  disabled?: boolean
  /** Where `tax` came from: the shop's setting, or this document's own record. */
  taxFrom?: 'settings' | 'document'
  /** False while the shop's setting is still loading. */
  loaded?:  boolean
}) {
  const taxText = !loaded ? 'Tax treatment loading from your Settings…'
    : taxFrom ? serviceCallTaxText(tax, taxFrom)
    : tax === 'none' ? 'Not taxed.' : 'Taxed as labor.'
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
      <span className="block text-white/35 text-[11px] mt-1" data-testid="service-call-tax">
        A flat fee on its own line. {taxText}
      </span>
    </label>
  )
}
