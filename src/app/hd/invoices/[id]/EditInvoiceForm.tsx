'use client'

import { useMemo, useState } from 'react'
import { ExtrasInputs } from '@/components/shared/ExtrasFields'
import { extrasDisplayRows, extrasAgree } from '@/lib/billable-extras'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { money } from '@/lib/format'
import { taxDisplayRows } from '@/lib/tax'
import { type EditLine } from '@/lib/hd/invoice-edit-lines'
import {
  openInvoiceEdit, priceInvoiceEdit, invoiceSaveBody, invoiceExtrasSettings,
  invoiceDoesNotAddUp, doesNotAddUpMessage, correctionBody, type InvoiceEditState,
} from '@/lib/hd/invoice-edit-save'
import { discountPrintLabel } from '@/lib/document-discount'
import {
  DiscountEditor, draftFrom, discountFromDraft, type DiscountDraft,
} from '@/components/shared/DiscountEditor'

const ORANGE = '#FF6600'
const BLUE   = '#2969B0'
const BG     = '#F4F5F7'
const CARD   = '#FFFFFF'
const BORDER = '#E5E7EB'
const TEXT   = '#1A1A1A'
const MUTED  = 'var(--paper-muted)'

type LineItem = EditLine

const inp = {
  width: '100%', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 12px',
  fontSize: 14, color: TEXT, background: CARD, outline: 'none', minHeight: 44,
} as React.CSSProperties

const cardStyle = { background: CARD, borderRadius: 12, border: `1px solid ${BORDER}`, padding: 24, marginBottom: 20 } as React.CSSProperties

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{label}</label>
      {children}
    </div>
  )
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-condensed font-bold text-xl mb-4" style={{ color: TEXT, letterSpacing: '0.5px' }}>{children}</h2>
}

/**
 * Editing a saved HD invoice. The money rules live in lib/hd/invoice-edit-save, which
 * the replay (scripts/replay-hd-invoice-save.ts) runs against every stored invoice:
 * recorded extras only, tax carried rather than re-derived, and only changed fields
 * written. `shopLaborRate` is the shop's HD rate, used only when the invoice recorded
 * none - and then shown as assumed and noted on save.
 */
export default function EditInvoiceForm({ invoice, shopLaborRate }: {
  invoice: Record<string, unknown>
  shopLaborRate: number | null
}) {
  const router = useRouter()
  const id = String(invoice.id)

  // The invoice as opened. Every price is carried from this, so it never changes.
  const [opened] = useState(() => openInvoiceEdit(invoice, shopLaborRate))
  // An invoice whose stored total is not its own lines + fees + extras + tax is never
  // saved silently. The tech is offered one deliberate correction instead.
  const notAddingUp = useMemo(() => invoiceDoesNotAddUp(invoice), [invoice])

  const [saving, setSaving] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  // The extras this invoice BILLS: exactly the rates it recorded. A travel, mileage or
  // supplies rate it never recorded is off, whatever Settings say today.
  const extrasSettings = useMemo(() => invoiceExtrasSettings(invoice), [invoice])
  const [travelHours,  setTravelHours]  = useState(opened.state.travelHours)
  const [mileageMiles, setMileageMiles] = useState(opened.state.mileageMiles)
  const [toast, setToast]   = useState('')
  const [laborModal, setLaborModal] = useState(false)
  const [partsModal, setPartsModal] = useState(false)
  const [labor, setLabor] = useState({ description: '', hours: '1.0' })
  const [parts, setParts] = useState({ part_number: '', description: '', quantity: '1', unit_cost: '0.00' })

  // Every stored key survives, unit_cost_base and markup_percent above all. See
  // editableLines.
  const [lineItems, setLineItems] = useState<LineItem[]>(() => opened.state.lines)

  type FormFields = Omit<InvoiceEditState, 'lines' | 'travelHours' | 'mileageMiles' | 'discount'>
  const [form, setForm] = useState<FormFields>(() => Object.fromEntries(
    Object.entries(opened.state).filter(([k]) => !['lines', 'travelHours', 'mileageMiles', 'discount'].includes(k)),
  ) as FormFields)
  // The discount it recorded (migration 168), as the editor's four answers.
  const [discountDraft, setDiscountDraft] = useState<DiscountDraft>(() => draftFrom(opened.state.discount))
  function setField(k: keyof FormFields, v: string | number) { setForm(f => ({ ...f, [k]: v })) }
  function fmt(n: number) { return `${money(n)}` }
  // NULL only when the invoice recorded no rate and the shop has none set either.
  const rate = form.labor_rate ?? 0

  // Inline edit of a labor line's hours → recompute amount from the current rate.
  function updateHours(itemId: string, raw: string) {
    const h = Math.max(0, parseFloat(raw) || 0)
    setLineItems(l => l.map(i => i.id === itemId ? { ...i, mobile_hours: h, amount: parseFloat((h * rate).toFixed(2)) } : i))
  }
  function updateDescription(itemId: string, v: string) {
    setLineItems(l => l.map(i => i.id === itemId ? { ...i, description: v } : i))
  }
  function updatePartsAmount(itemId: string, field: 'quantity' | 'unit_cost', raw: string) {
    const v = Math.max(0, parseFloat(raw) || 0)
    setLineItems(l => l.map(i => {
      if (i.id !== itemId) return i
      const qty = field === 'quantity' ? v : i.quantity
      const cost = field === 'unit_cost' ? v : i.unit_cost
      return { ...i, quantity: qty, unit_cost: cost, amount: parseFloat((qty * cost).toFixed(2)) }
    }))
  }
  function removeItem(itemId: string) { setLineItems(l => l.filter(i => i.id !== itemId)) }

  function addLabor() {
    const description = labor.description.trim()
    if (!description) { setToast('Enter a labor description.'); return }
    if (form.labor_rate == null) { setToast('This invoice has no labor rate. Enter one above first.'); return }
    const hours = Math.max(0, parseFloat(labor.hours) || 0)
    setLineItems(l => [...l, {
      id: crypto.randomUUID(), type: 'labor', description,
      mobile_hours: hours, part_number: '', quantity: 0, unit_cost: 0,
      amount: parseFloat((hours * rate).toFixed(2)),
    }])
    setLabor({ description: '', hours: '1.0' }); setLaborModal(false)
  }
  function addParts() {
    const description = parts.description.trim()
    if (!description) { setToast('Enter a part description.'); return }
    const qty = parseFloat(parts.quantity) || 1
    const cost = parseFloat(parts.unit_cost) || 0
    setLineItems(l => [...l, {
      id: crypto.randomUUID(), type: 'parts', description, mobile_hours: 0,
      part_number: parts.part_number.trim(), quantity: qty, unit_cost: cost,
      amount: parseFloat((qty * cost).toFixed(2)),
    }])
    setParts({ part_number: '', description: '', quantity: '1', unit_cost: '0.00' }); setPartsModal(false)
  }

  // ── Money ────────────────────────────────────────────────────────────────
  // Priced against the invoice as opened: the extras at the rates it recorded, the
  // tax carried from what it stored plus the tax on whatever the edit changed. An
  // untouched invoice prices to exactly its stored figures.
  const edited: InvoiceEditState = { ...form, lines: lineItems, travelHours, mileageMiles, discount: discountFromDraft(discountDraft) }
  const price = priceInvoiceEdit(invoice, opened.state, edited)
  const subtotalLabor = price.subtotalLabor
  const subtotalParts = price.subtotalParts
  const extrasResult  = price.extras
  const taxWithExtras   = price.taxAmount
  const totalWithExtras = price.total
  const taxBase = subtotalLabor + subtotalParts + form.diagnostic_fee + form.road_call_fee
  // An HD invoice must not display a charge outside its total either.
  const extrasMismatch = extrasAgree(extrasResult, price.subtotal, taxBase)

  async function save() {
    if (notAddingUp) { setToast(doesNotAddUpMessage(notAddingUp)); return }
    if (!form.customer_name.trim()) { setToast('Customer name is required.'); return }
    // Refuse rather than bill a figure that does not add up. Loud on purpose.
    if (extrasMismatch) { setToast('Cannot save: ' + extrasMismatch); return }
    if (price.discountError) { setToast('Cannot save: ' + price.discountError); return }
    // Only the fields this edit changed. Nothing changed means nothing is written.
    const body = invoiceSaveBody(invoice, opened, edited)
    if (Object.keys(body).length === 0) { router.push(`/hd/invoices/${id}`); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/hd/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (data.invoice) router.push(`/hd/invoices/${id}`)
      else setToast(data.error ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // The deliberate correction. Recalculates from the invoice's own lines, fees and
  // extras at the rates it recorded, and records what changed in internal_notes.
  async function correct() {
    setCorrecting(true)
    try {
      const res = await fetch(`/api/hd/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(correctionBody(invoice)) })
      const data = await res.json()
      if (data.invoice) window.location.reload()
      else setToast(data.error ?? 'Correction failed')
    } finally {
      setCorrecting(false)
    }
  }

  return (
    <div style={{ background: BG, color: TEXT, minHeight: '100dvh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div className="flex items-center gap-3 mb-6">
          <Link href={`/hd/invoices/${id}`} style={{ color: MUTED, fontSize: 13 }}>← Invoice</Link>
          <span style={{ color: 'var(--paper-muted)' }}>/</span>
          <span className="font-condensed font-bold text-2xl" style={{ color: TEXT }}>EDIT INVOICE</span>
        </div>

        {/* A stored invoice that does not add up is never saved silently. One explicit
            action corrects it, and nothing changes unless the tech takes it. */}
        {notAddingUp && (
          <div role="alert" style={{ ...cardStyle, background: '#FFFBEB', border: '1px solid #FCD34D' }}>
            <p className="text-sm font-semibold mb-3" style={{ color: '#92400E' }}>{doesNotAddUpMessage(notAddingUp)}</p>
            <p className="text-xs mb-3" style={{ color: '#92400E' }}>{`Saving is off until this is settled. Bringing it to ${fmt(notAddingUp.own)} recalculates the total from this invoice's own lines, fees and extras at the rates it recorded, changes nothing else, and records the change in the internal notes.`}</p>
            <button onClick={correct} disabled={correcting} className="px-4 py-2 rounded-lg text-sm font-semibold text-on-accent disabled:opacity-50" style={{ background: ORANGE, minHeight: 44 }}>
              {correcting ? 'Correcting...' : `Bring it to ${fmt(notAddingUp.own)}`}
            </button>
          </div>
        )}

        <div style={cardStyle}>
          <SectionTitle>Customer &amp; Unit</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <Field label="Customer Name *"><input style={inp} value={form.customer_name} onChange={e => setField('customer_name', e.target.value)} /></Field>
            <Field label="Phone"><input style={inp} value={form.customer_phone} onChange={e => setField('customer_phone', e.target.value)} /></Field>
            <Field label="Email"><input style={inp} type="email" value={form.customer_email} onChange={e => setField('customer_email', e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Manufacturer"><input style={inp} value={form.unit_manufacturer} onChange={e => setField('unit_manufacturer', e.target.value)} /></Field>
            <Field label="Model"><input style={inp} value={form.unit_model} onChange={e => setField('unit_model', e.target.value)} /></Field>
            <Field label="Serial"><input style={inp} value={form.unit_serial} onChange={e => setField('unit_serial', e.target.value)} /></Field>
          </div>
        </div>

        <div style={cardStyle}>
          <SectionTitle>Line Items</SectionTitle>
          <div className="flex flex-wrap gap-3 mb-4 items-end">
            <button onClick={() => setLaborModal(true)} className="px-4 py-2 rounded-lg text-sm font-semibold text-on-accent" style={{ background: ORANGE, minHeight: 44 }}>+ Add Labor</button>
            <button onClick={() => setPartsModal(true)} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: '#EBF5FF', color: BLUE, border: `1px solid #BFDBFE`, minHeight: 44 }}>+ Add Parts</button>
            <div className="ml-auto">
              <Field label="Labor Rate / Hour">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
                  <input style={{ ...inp, paddingLeft: 24, width: 140 }} type="number" min={0} value={form.labor_rate ?? ''}
                    onChange={e => {
                      const r = parseFloat(e.target.value) || 0
                      setField('labor_rate', r)
                      // Re-price labor lines to the new rate.
                      setLineItems(l => l.map(i => i.type === 'labor' ? { ...i, amount: parseFloat((i.mobile_hours * r).toFixed(2)) } : i))
                    }} />
                </div>
              </Field>
              {/* A4: a rate the invoice never recorded is shown as assumed, never invented. */}
              {opened.laborRateAssumed && form.labor_rate === opened.state.labor_rate && (
                <p className="text-xs mt-1" style={{ color: '#92400E', maxWidth: 220 }}>{`Assumed rate: ${fmt(rate)}/hr from your settings. This invoice recorded none; saving records it.`}</p>
              )}
              {form.labor_rate == null && (
                <p className="text-xs mt-1" style={{ color: '#92400E', maxWidth: 220 }}>No labor rate on this invoice and none in your settings. Enter one to price labor.</p>
              )}
            </div>
          </div>

          {lineItems.length > 0 ? (
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
              {lineItems.map(item => (
                <div key={item.id} className="px-4 py-3" style={{ borderBottom: `1px solid #F9FAFB` }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs px-1.5 py-0.5 rounded font-semibold shrink-0" style={item.type === 'labor' ? { background: '#FFF7ED', color: 'var(--paper-accent)' } : { background: '#EBF5FF', color: BLUE }}>
                      {item.type === 'labor' ? 'LAB' : 'PRT'}
                    </span>
                    <input value={item.description} onChange={e => updateDescription(item.id, e.target.value)} style={{ ...inp, minHeight: 36, padding: '6px 10px' }} />
                    <button onClick={() => removeItem(item.id)} style={{ color: 'var(--paper-muted)' }}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-xs" style={{ color: MUTED }}>
                    {item.type === 'labor' ? (
                      <label className="flex items-center gap-1">Hours
                        <input type="number" min={0} step={0.25} value={item.mobile_hours} onChange={e => updateHours(item.id, e.target.value)}
                          style={{ width: 80, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 8px', fontSize: 13, textAlign: 'right' }} />
                        <span>× {fmt(rate)}/hr</span>
                      </label>
                    ) : (
                      <>
                        <label className="flex items-center gap-1">Qty
                          <input type="number" min={0} value={item.quantity} onChange={e => updatePartsAmount(item.id, 'quantity', e.target.value)}
                            style={{ width: 64, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 8px', fontSize: 13, textAlign: 'right' }} />
                        </label>
                        <label className="flex items-center gap-1">Unit $
                          <input type="number" min={0} step={0.01} value={item.unit_cost} onChange={e => updatePartsAmount(item.id, 'unit_cost', e.target.value)}
                            style={{ width: 90, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 8px', fontSize: 13, textAlign: 'right' }} />
                        </label>
                      </>
                    )}
                    <span className="ml-auto text-sm font-semibold" style={{ color: TEXT }}>{fmt(item.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8" style={{ border: `2px dashed ${BORDER}`, borderRadius: 8 }}>
              <p className="text-sm" style={{ color: MUTED }}>No line items — add labor or parts above</p>
            </div>
          )}

          <div className="flex justify-end mt-6">
            {/* Hours and miles. Hidden entirely unless the shop bills one of them.
                Shop supplies has no input - it is a percentage of parts. */}
            <div style={{ width: 280, marginBottom: 12 }}>
              <ExtrasInputs
                settings={extrasSettings}
                loaded
                travelHours={travelHours}
                mileageMiles={mileageMiles}
                onTravelHours={setTravelHours}
                onMileageMiles={setMileageMiles}
                laborRate={rate}
              />
            </div>
            <div style={{ width: 280 }}>
              {[
                { label: 'Labor Subtotal', val: subtotalLabor },
                { label: 'Parts Subtotal', val: subtotalParts },
                // Travel, mileage and shop supplies. A zero extra prints no row.
                ...extrasDisplayRows(extrasResult).map(r => ({
                  label: r.detail ? `${r.label} (${r.detail})` : r.label,
                  val:   r.amount,
                })),
              ].map(r => (
                <div key={r.label} className="flex justify-between py-1.5 text-sm" style={{ color: MUTED }}><span>{r.label}</span><span>{fmt(r.val)}</span></div>
              ))}
              {/* The discount sits between the subtotal and the tax: it comes off the
                  labor and parts lines, and the tax below is on what is left. */}
              {price.discount && (
                <>
                  <div className="flex justify-between py-1.5 text-sm" style={{ color: TEXT, borderTop: `1px solid ${BORDER}`, marginTop: 4 }}>
                    <span>Subtotal</span><span>{fmt(price.subtotal)}</span>
                  </div>
                  <div className="flex justify-between py-1.5 text-sm" style={{ color: '#047857' }} data-testid="discount-row">
                    <span>{discountPrintLabel(price.discount)}</span><span>{'-' + fmt(price.discount.amount)}</span>
                  </div>
                </>
              )}
              <div className="flex items-center gap-3 py-2" style={{ borderTop: `1px solid ${BORDER}`, marginTop: 4 }}>
                <span className="text-sm flex-1" style={{ color: MUTED }}>Tax %</span>
                <input type="number" min={0} max={30} step={0.1} value={form.tax_rate_parts}
                  onChange={e => {
                    const v = parseFloat(e.target.value) || 0
                    // The parts rate and the column move together; labor follows only
                    // when it was taxed at the same rate.
                    setForm(f => ({ ...f, tax_rate: v, tax_rate_parts: v, tax_rate_labor: f.tax_rate_labor === f.tax_rate_parts ? v : f.tax_rate_labor }))
                  }}
                  style={{ width: 70, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 8px', fontSize: 13, textAlign: 'right' }} />
                <span className="text-sm" style={{ color: MUTED }}>{fmt(taxWithExtras)}</span>
              </div>
              {taxDisplayRows(price.breakdown).map(r => (
                <div key={r.category} className="flex justify-between text-xs py-0.5" style={{ color: MUTED }}>
                  <span>{r.text}</span><span>{fmt(r.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between items-center pt-3" style={{ borderTop: `2px solid ${ORANGE}`, marginTop: 4 }}>
                <span className="font-bold text-base" style={{ color: TEXT }}>TOTAL</span>
                <span className="font-bold text-2xl" style={{ color: 'var(--paper-text)' }}>{fmt(totalWithExtras)}</span>
              </div>
              {/* Labor and parts lines only. Travel, mileage, supplies and the fees are
                  never discounted. */}
              <div className="mt-4">
                <DiscountEditor theme="light" value={discountDraft} onChange={setDiscountDraft}
                  applied={price.discount} error={price.discountError} notice={price.discountNotice} />
              </div>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <SectionTitle>Notes</SectionTitle>
          <textarea style={{ ...inp, minHeight: 80, resize: 'vertical' }} value={form.notes} onChange={e => setField('notes', e.target.value)} placeholder="Notes for this invoice..." />
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pb-8">
          <Link href={`/hd/invoices/${id}`} className="flex-1 py-3 rounded-lg font-semibold text-sm text-center" style={{ background: '#F3F4F6', color: '#374151', border: `1px solid ${BORDER}`, minHeight: 48, lineHeight: '24px' }}>Cancel</Link>
          <button onClick={save} disabled={saving} className="flex-1 py-3 rounded-lg font-semibold text-sm text-on-accent disabled:opacity-50" style={{ background: ORANGE, minHeight: 48 }}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {laborModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div style={{ background: CARD, borderRadius: 12, padding: 24, width: '100%', maxWidth: 460 }}>
            <h3 className="font-condensed font-bold text-xl mb-4" style={{ color: TEXT }}>ADD LABOR LINE</h3>
            <div className="flex flex-col gap-4">
              <Field label="Description"><input style={inp} autoFocus value={labor.description} onChange={e => setLabor(d => ({ ...d, description: e.target.value }))} /></Field>
              <Field label="Hours"><input style={inp} type="number" min={0} step={0.25} value={labor.hours} onChange={e => setLabor(d => ({ ...d, hours: e.target.value }))} /></Field>
              <p className="text-sm" style={{ color: MUTED }}>Amount: <strong style={{ color: TEXT }}>{fmt((parseFloat(labor.hours) || 0) * rate)}</strong></p>
              <div className="flex gap-3">
                <button onClick={() => setLaborModal(false)} className="flex-1 py-2.5 rounded-lg font-semibold text-sm" style={{ background: '#F3F4F6', color: '#374151' }}>Cancel</button>
                <button onClick={addLabor} className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-on-accent" style={{ background: ORANGE }}>Add Line</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {partsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div style={{ background: CARD, borderRadius: 12, padding: 24, width: '100%', maxWidth: 520 }}>
            <h3 className="font-condensed font-bold text-xl mb-4" style={{ color: TEXT }}>ADD PARTS LINE</h3>
            <div className="flex flex-col gap-4">
              <Field label="Part Number"><input style={inp} value={parts.part_number} onChange={e => setParts(d => ({ ...d, part_number: e.target.value }))} autoFocus /></Field>
              <Field label="Description"><input style={inp} value={parts.description} onChange={e => setParts(d => ({ ...d, description: e.target.value }))} /></Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Quantity"><input style={inp} type="number" min={1} value={parts.quantity} onChange={e => setParts(d => ({ ...d, quantity: e.target.value }))} /></Field>
                <Field label="Unit Cost">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
                    <input style={{ ...inp, paddingLeft: 24 }} type="number" min={0} step={0.01} value={parts.unit_cost} onChange={e => setParts(d => ({ ...d, unit_cost: e.target.value }))} />
                  </div>
                </Field>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setPartsModal(false)} className="flex-1 py-2.5 rounded-lg font-semibold text-sm" style={{ background: '#F3F4F6', color: '#374151' }}>Cancel</button>
                <button onClick={addParts} className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-on-fill" style={{ background: BLUE }}>Add Line</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-semibold text-on-fill shadow-xl" style={{ background: '#1A1A1A' }}>
          {toast}
          <button className="ml-4 opacity-60 hover:opacity-100" onClick={() => setToast('')}>×</button>
        </div>
      )}
    </div>
  )
}
