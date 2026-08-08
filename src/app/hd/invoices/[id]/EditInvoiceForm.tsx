'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const ORANGE = '#FF6600'
const BLUE   = '#2969B0'
const BG     = '#F4F5F7'
const CARD   = '#FFFFFF'
const BORDER = '#E5E7EB'
const TEXT   = '#1A1A1A'
const MUTED  = '#6B7280'

interface LineItem {
  id: string
  type: 'labor' | 'parts'
  description: string
  book_hours?: number
  mobile_hours: number
  part_number: string
  quantity: number
  unit_cost: number
  amount: number
}

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

const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export default function EditInvoiceForm({ invoice }: { invoice: Record<string, unknown> }) {
  const router = useRouter()
  const id = String(invoice.id)

  const [saving, setSaving] = useState(false)
  const [toast, setToast]   = useState('')
  const [laborModal, setLaborModal] = useState(false)
  const [partsModal, setPartsModal] = useState(false)
  const [labor, setLabor] = useState({ description: '', hours: '1.0' })
  const [parts, setParts] = useState({ part_number: '', description: '', quantity: '1', unit_cost: '0.00' })

  const [lineItems, setLineItems] = useState<LineItem[]>(() => {
    const raw = Array.isArray(invoice.line_items) ? invoice.line_items as Record<string, unknown>[] : []
    return raw.map(li => ({
      id: str(li.id) || crypto.randomUUID(),
      type: li.type === 'parts' ? 'parts' : 'labor',
      description: str(li.description),
      book_hours: li.book_hours != null ? num(li.book_hours) : undefined,
      mobile_hours: num(li.mobile_hours),
      part_number: str(li.part_number),
      quantity: num(li.quantity),
      unit_cost: num(li.unit_cost),
      amount: num(li.amount),
    }))
  })

  const [form, setForm] = useState({
    customer_name:  str(invoice.customer_name),
    customer_phone: str(invoice.customer_phone),
    customer_email: str(invoice.customer_email),
    unit_manufacturer: str(invoice.unit_manufacturer),
    unit_model:     str(invoice.unit_model),
    unit_serial:    str(invoice.unit_serial),
    labor_rate:     num(invoice.labor_rate, 125),
    diagnostic_fee: num(invoice.diagnostic_fee),
    road_call_fee:  num(invoice.road_call_fee),
    tax_rate:       num(invoice.tax_rate),
    notes:          str(invoice.notes),
    payment_terms:  str(invoice.payment_terms) || 'net30',
  })
  function setField(k: string, v: string | number) { setForm(f => ({ ...f, [k]: v })) }
  function fmt(n: number) { return `$${n.toFixed(2)}` }

  // Inline edit of a labor line's hours → recompute amount from the current rate.
  function updateHours(itemId: string, raw: string) {
    const h = Math.max(0, parseFloat(raw) || 0)
    setLineItems(l => l.map(i => i.id === itemId ? { ...i, mobile_hours: h, amount: parseFloat((h * form.labor_rate).toFixed(2)) } : i))
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
    const hours = Math.max(0, parseFloat(labor.hours) || 0)
    setLineItems(l => [...l, {
      id: crypto.randomUUID(), type: 'labor', description,
      mobile_hours: hours, part_number: '', quantity: 0, unit_cost: 0,
      amount: parseFloat((hours * form.labor_rate).toFixed(2)),
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

  const subtotalLabor = lineItems.filter(i => i.type === 'labor').reduce((s, i) => s + i.amount, 0)
  const subtotalParts = lineItems.filter(i => i.type === 'parts').reduce((s, i) => s + i.amount, 0)
  const taxBase = subtotalLabor + subtotalParts + form.diagnostic_fee + form.road_call_fee
  const taxAmount = taxBase * (form.tax_rate / 100)
  const total = taxBase + taxAmount

  async function save() {
    if (!form.customer_name.trim()) { setToast('Customer name is required.'); return }
    setSaving(true)
    try {
      const body = {
        customer_name:  form.customer_name,
        customer_phone: form.customer_phone || null,
        customer_email: form.customer_email || null,
        unit_manufacturer: form.unit_manufacturer || null,
        unit_model:     form.unit_model || null,
        unit_serial:    form.unit_serial || null,
        line_items:     lineItems,
        labor_rate:     form.labor_rate,
        subtotal_labor: parseFloat(subtotalLabor.toFixed(2)),
        subtotal_parts: parseFloat(subtotalParts.toFixed(2)),
        diagnostic_fee: parseFloat(form.diagnostic_fee.toFixed(2)),
        road_call_fee:  parseFloat(form.road_call_fee.toFixed(2)),
        tax_rate:       form.tax_rate,
        tax_amount:     parseFloat(taxAmount.toFixed(2)),
        total:          parseFloat(total.toFixed(2)),
        notes:          form.notes || null,
        payment_terms:  form.payment_terms || 'net30',
      }
      const res = await fetch(`/api/hd/invoices/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (data.invoice) router.push(`/hd/invoices/${id}`)
      else setToast(data.error ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ background: BG, minHeight: '100dvh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div className="flex items-center gap-3 mb-6">
          <Link href={`/hd/invoices/${id}`} style={{ color: MUTED, fontSize: 13 }}>← Invoice</Link>
          <span style={{ color: BORDER }}>/</span>
          <span className="font-condensed font-bold text-2xl" style={{ color: TEXT }}>EDIT INVOICE</span>
        </div>

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
            <button onClick={() => setLaborModal(true)} className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: ORANGE, minHeight: 44 }}>+ Add Labor</button>
            <button onClick={() => setPartsModal(true)} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: '#EBF5FF', color: BLUE, border: `1px solid #BFDBFE`, minHeight: 44 }}>+ Add Parts</button>
            <div className="ml-auto">
              <Field label="Labor Rate / Hour">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
                  <input style={{ ...inp, paddingLeft: 24, width: 140 }} type="number" min={0} value={form.labor_rate}
                    onChange={e => {
                      const r = parseFloat(e.target.value) || 0
                      setField('labor_rate', r)
                      // Re-price labor lines to the new rate.
                      setLineItems(l => l.map(i => i.type === 'labor' ? { ...i, amount: parseFloat((i.mobile_hours * r).toFixed(2)) } : i))
                    }} />
                </div>
              </Field>
            </div>
          </div>

          {lineItems.length > 0 ? (
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
              {lineItems.map(item => (
                <div key={item.id} className="px-4 py-3" style={{ borderBottom: `1px solid #F9FAFB` }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs px-1.5 py-0.5 rounded font-semibold shrink-0" style={item.type === 'labor' ? { background: '#FFF7ED', color: ORANGE } : { background: '#EBF5FF', color: BLUE }}>
                      {item.type === 'labor' ? 'LAB' : 'PRT'}
                    </span>
                    <input value={item.description} onChange={e => updateDescription(item.id, e.target.value)} style={{ ...inp, minHeight: 36, padding: '6px 10px' }} />
                    <button onClick={() => removeItem(item.id)} style={{ color: '#9CA3AF' }}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-xs" style={{ color: MUTED }}>
                    {item.type === 'labor' ? (
                      <label className="flex items-center gap-1">Hours
                        <input type="number" min={0} step={0.25} value={item.mobile_hours} onChange={e => updateHours(item.id, e.target.value)}
                          style={{ width: 80, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 8px', fontSize: 13, textAlign: 'right' }} />
                        <span>× {fmt(form.labor_rate)}/hr</span>
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
            <div style={{ width: 280 }}>
              {[{ label: 'Labor Subtotal', val: subtotalLabor }, { label: 'Parts Subtotal', val: subtotalParts }].map(r => (
                <div key={r.label} className="flex justify-between py-1.5 text-sm" style={{ color: MUTED }}><span>{r.label}</span><span>{fmt(r.val)}</span></div>
              ))}
              <div className="flex items-center gap-3 py-2" style={{ borderTop: `1px solid ${BORDER}`, marginTop: 4 }}>
                <span className="text-sm flex-1" style={{ color: MUTED }}>Tax %</span>
                <input type="number" min={0} max={30} step={0.1} value={form.tax_rate} onChange={e => setField('tax_rate', parseFloat(e.target.value) || 0)}
                  style={{ width: 70, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 8px', fontSize: 13, textAlign: 'right' }} />
                <span className="text-sm" style={{ color: MUTED }}>{fmt(taxAmount)}</span>
              </div>
              <div className="flex justify-between items-center pt-3" style={{ borderTop: `2px solid ${ORANGE}`, marginTop: 4 }}>
                <span className="font-bold text-base" style={{ color: TEXT }}>TOTAL</span>
                <span className="font-bold text-2xl" style={{ color: ORANGE }}>{fmt(total)}</span>
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
          <button onClick={save} disabled={saving} className="flex-1 py-3 rounded-lg font-semibold text-sm text-white disabled:opacity-50" style={{ background: ORANGE, minHeight: 48 }}>
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
              <p className="text-sm" style={{ color: MUTED }}>Amount: <strong style={{ color: TEXT }}>{fmt((parseFloat(labor.hours) || 0) * form.labor_rate)}</strong></p>
              <div className="flex gap-3">
                <button onClick={() => setLaborModal(false)} className="flex-1 py-2.5 rounded-lg font-semibold text-sm" style={{ background: '#F3F4F6', color: '#374151' }}>Cancel</button>
                <button onClick={addLabor} className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white" style={{ background: ORANGE }}>Add Line</button>
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
                <button onClick={addParts} className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white" style={{ background: BLUE }}>Add Line</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-semibold text-white shadow-xl" style={{ background: '#1A1A1A' }}>
          {toast}
          <button className="ml-4 opacity-60 hover:opacity-100" onClick={() => setToast('')}>×</button>
        </div>
      )}
    </div>
  )
}
