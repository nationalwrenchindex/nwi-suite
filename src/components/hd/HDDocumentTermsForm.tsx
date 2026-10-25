'use client'

// The terms block, on the HD settings screen: payment terms, how to pay, the pay link,
// warranty terms and the customer-supplied parts clause.
//
// THE SAME FIVE PROFILE COLUMNS LD's settings write - one shop, one answer - through
// the same two routes LD uses (/api/user/profile, which validates the terms and the
// https pay link, and /api/user/share-templates for the instructions).
//
// RECORDED VALUES BEAT CURRENT SETTINGS. A quote records these when it is first sent,
// an invoice when it is first sent (or carries its quote's), and the customer's copy
// prints what the document recorded. A field left empty prints nothing.

import { useState } from 'react'
import { normalisePaymentTerms, PAYMENT_TERMS, PAYMENT_TERMS_LABEL } from '@/lib/hd/payment-terms'

export interface HDDocumentTerms {
  default_payment_terms:         string | null
  default_payment_instructions:  string | null
  pay_link_url:                  string | null
  warranty_terms:                string | null
  customer_supplied_parts_clause: string | null
}

const label = 'text-xs font-semibold uppercase tracking-wider block mb-1'
const labelStyle = { color: 'var(--hd-text-muted)' }
const hint = { color: 'var(--hd-text-faint)' }

export default function HDDocumentTermsForm({ initial }: { initial: HDDocumentTerms }) {
  // Normalised for the picker; sent only if the shop changes it, so a stored spelling
  // is never rewritten by saving the other fields.
  const initialTerms = normalisePaymentTerms(initial.default_payment_terms) ?? ''
  const [terms, setTerms] = useState(initialTerms)
  const [instructions, setInstructions] = useState(initial.default_payment_instructions ?? '')
  const [payLink, setPayLink] = useState(initial.pay_link_url ?? '')
  const [warranty, setWarranty] = useState(initial.warranty_terms ?? '')
  const [clause, setClause] = useState(initial.customer_supplied_parts_clause ?? '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function put(url: string, body: Record<string, unknown>): Promise<string | null> {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) return null
    const j = await res.json().catch(() => ({}))
    return String((j as { error?: string }).error ?? 'Not saved.')
  }

  async function save() {
    setSaving(true); setMsg(null)
    try {
      const err1 = await put('/api/user/profile', {
        ...(terms && terms !== initialTerms ? { default_payment_terms: terms } : {}),
        pay_link_url: payLink.trim() || null,
        warranty_terms: warranty.trim() || null,
        customer_supplied_parts_clause: clause.trim() || null,
      })
      if (err1) { setMsg({ ok: false, text: err1 }); return }
      const err2 = await put('/api/user/share-templates', { default_payment_instructions: instructions.trim() || null })
      if (err2) { setMsg({ ok: false, text: `The terms saved, but the payment instructions did not: ${err2}` }); return }
      setMsg({ ok: true, text: 'Saved. New quotes and invoices record these when they are sent.' })
    } catch {
      setMsg({ ok: false, text: 'Could not reach the server. Nothing was saved.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={label} style={labelStyle} htmlFor="hd-default-terms">Default payment terms</label>
        <select id="hd-default-terms" name="default_payment_terms" className="nwi-input text-sm w-full" value={terms} onChange={e => setTerms(e.target.value)}>
          {!terms && <option value="">Not set</option>}
          {PAYMENT_TERMS.map(t => <option key={t} value={t}>{PAYMENT_TERMS_LABEL[t]}</option>)}
        </select>
      </div>
      <div>
        <label className={label} style={labelStyle} htmlFor="hd-pay-instructions">How to pay - remit address and instructions</label>
        <textarea id="hd-pay-instructions" name="default_payment_instructions" rows={4} className="nwi-input resize-y text-sm w-full"
          placeholder="Checks payable to Your Shop LLC, 123 Main St, City, ST 00000. Zelle: (555) 555-5555."
          value={instructions} onChange={e => setInstructions(e.target.value)} />
      </div>
      <div>
        <label className={label} style={labelStyle} htmlFor="hd-pay-link">Pay link (optional)</label>
        <input id="hd-pay-link" name="pay_link_url" type="url" inputMode="url" className="nwi-input text-sm w-full"
          placeholder="https://pay.example.com/your-shop" value={payLink} onChange={e => setPayLink(e.target.value)} />
        <p className="text-[11px] mt-1" style={hint}>A full https:// payment page - Square, Stripe, PayPal or similar.</p>
      </div>
      <div>
        <label className={label} style={labelStyle} htmlFor="hd-warranty">Warranty terms</label>
        <textarea id="hd-warranty" name="warranty_terms" rows={3} className="nwi-input resize-y text-sm w-full"
          placeholder="90 days on workmanship. Parts carry the manufacturer's warranty."
          value={warranty} onChange={e => setWarranty(e.target.value)} />
      </div>
      <div>
        <label className={label} style={labelStyle} htmlFor="hd-clause">Customer-supplied parts</label>
        <textarea id="hd-clause" name="customer_supplied_parts_clause" rows={3} className="nwi-input resize-y text-sm w-full"
          placeholder="Parts supplied by the customer are installed without warranty. Re-diagnosis and re-installation are billable."
          value={clause} onChange={e => setClause(e.target.value)} />
      </div>
      <p className="text-[11px]" style={hint}>
        Shared with your LD settings. Each quote and invoice keeps the terms in force when it was
        sent - changing them here does not rewrite a document a customer already has. A field
        left empty prints nothing.
      </p>
      <button type="button" onClick={save} disabled={saving}
        className="px-5 py-2.5 rounded-lg text-sm font-semibold text-on-accent disabled:opacity-50" style={{ background: '#E85D24' }}>
        {saving ? 'Saving...' : 'Save terms'}
      </button>
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>}
    </div>
  )
}
