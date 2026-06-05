'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const ORANGE  = '#FF6600'
const BLUE    = '#2969B0'
const BG      = '#F4F5F7'
const CARD    = '#FFFFFF'
const BORDER  = '#E5E7EB'
const TEXT    = '#1A1A1A'
const MUTED   = '#6B7280'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineItem {
  id: string
  type: 'labor' | 'parts'
  description: string
  book_hours: number
  mobile_hours: number
  part_number: string
  quantity: number
  unit_cost: number
  amount: number
}

interface LaborDraft {
  description: string
  book_hours: string
  mobile_hours: string
}

interface PartsDraft {
  part_number: string
  description: string
  quantity: string
  unit_cost: string
}

interface PartResult {
  part_number: string
  description: string
  category: string
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>{label}</label>
      {children}
    </div>
  )
}

const inp = {
  width: '100%',
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 14,
  color: TEXT,
  background: CARD,
  outline: 'none',
  minHeight: 44,
} as React.CSSProperties

const cardStyle = {
  background: CARD,
  borderRadius: 12,
  border: `1px solid ${BORDER}`,
  padding: 24,
  marginBottom: 20,
} as React.CSSProperties

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-condensed font-bold text-xl mb-4" style={{ color: TEXT, letterSpacing: '0.5px' }}>
      {children}
    </h2>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function NewQuotePage() {
  const router = useRouter()

  const [saving, setSaving]               = useState(false)
  const [toast, setToast]                 = useState('')
  const [laborModal, setLaborModal]       = useState(false)
  const [partsModal, setPartsModal]       = useState(false)
  const [lineItems, setLineItems]         = useState<LineItem[]>([])
  const [qwAvailable, setQwAvailable]     = useState(false)
  const [partsResults, setPartsResults]   = useState<PartResult[]>([])
  const [partsSearching, setPartsSearching] = useState(false)

  const [labor, setLabor] = useState<LaborDraft>({ description: '', book_hours: '1.0', mobile_hours: '1.5' })
  const [parts, setParts] = useState<PartsDraft>({ part_number: '', description: '', quantity: '1', unit_cost: '0.00' })

  const [form, setForm] = useState({
    customer_name: '', customer_phone: '', customer_email: '',
    unit_manufacturer: '', unit_model: '', unit_serial: '', unit_year: '',
    truck_make: '', truck_model: '', truck_year: '', vin: '',
    complaint: '', diagnosis: '',
    labor_rate: 125, diagnostic_fee: 125, include_diagnostic: true,
    road_call_fee: 0, include_road_call: false,
    tax_rate: 0, notes: '', valid_until: '',
  })

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('hd_quickwrench_analysis') ?? localStorage.getItem('hd_quickwrench_analysis')
      setQwAvailable(!!stored)
    } catch {}
  }, [])

  function pullFromQW() {
    try {
      const stored = sessionStorage.getItem('hd_quickwrench_analysis') ?? localStorage.getItem('hd_quickwrench_analysis') ?? ''
      if (stored) setForm(f => ({ ...f, diagnosis: stored }))
      else setToast('No QuickWrench result found — run a diagnosis first.')
    } catch {}
  }

  function setField(k: string, v: string | number | boolean) {
    setForm(f => ({ ...f, [k]: v }))
  }

  // Derived totals
  const subtotalLabor = lineItems.filter(i => i.type === 'labor').reduce((s, i) => s + i.amount, 0)
  const subtotalParts = lineItems.filter(i => i.type === 'parts').reduce((s, i) => s + i.amount, 0)
  const diagFee       = form.include_diagnostic ? form.diagnostic_fee : 0
  const roadFee       = form.include_road_call  ? form.road_call_fee  : 0
  const taxBase       = subtotalLabor + subtotalParts + diagFee + roadFee
  const taxAmount     = taxBase * (form.tax_rate / 100)
  const total         = taxBase + taxAmount

  function fmt(n: number) { return `$${n.toFixed(2)}` }

  // ── Labor modal ──
  function onLaborBookChange(val: string) {
    const bh = parseFloat(val) || 0
    setLabor(l => ({ ...l, book_hours: val, mobile_hours: (bh + 0.5).toFixed(1) }))
  }

  function addLaborItem() {
    const bh  = parseFloat(labor.book_hours)  || 0
    const mh  = parseFloat(labor.mobile_hours) || 0
    if (!labor.description.trim()) { setToast('Enter a description.'); return }
    const item: LineItem = {
      id: crypto.randomUUID(),
      type: 'labor',
      description: labor.description.trim(),
      book_hours: bh, mobile_hours: mh,
      part_number: '', quantity: 0, unit_cost: 0,
      amount: parseFloat((mh * form.labor_rate).toFixed(2)),
    }
    setLineItems(l => [...l, item])
    setLabor({ description: '', book_hours: '1.0', mobile_hours: '1.5' })
    setLaborModal(false)
  }

  // ── Parts modal ──
  async function searchParts() {
    const q = parts.part_number.trim() || parts.description.trim()
    if (!q) return
    setPartsSearching(true)
    try {
      const res  = await fetch(`/api/hd/parts?search=${encodeURIComponent(q)}&manufacturer=${encodeURIComponent(form.unit_manufacturer)}`)
      const data = await res.json()
      setPartsResults((data.parts ?? []).slice(0, 6) as PartResult[])
    } finally {
      setPartsSearching(false)
    }
  }

  function selectPartResult(p: PartResult) {
    setParts(d => ({ ...d, part_number: p.part_number, description: p.description }))
    setPartsResults([])
  }

  function addPartsItem() {
    const qty  = parseFloat(parts.quantity)  || 1
    const cost = parseFloat(parts.unit_cost) || 0
    if (!parts.description.trim()) { setToast('Enter a part description.'); return }
    const item: LineItem = {
      id: crypto.randomUUID(),
      type: 'parts',
      description: parts.description.trim(),
      book_hours: 0, mobile_hours: 0,
      part_number: parts.part_number.trim(),
      quantity: qty, unit_cost: cost,
      amount: parseFloat((qty * cost).toFixed(2)),
    }
    setLineItems(l => [...l, item])
    setParts({ part_number: '', description: '', quantity: '1', unit_cost: '0.00' })
    setPartsResults([])
    setPartsModal(false)
  }

  function removeItem(id: string) {
    setLineItems(l => l.filter(i => i.id !== id))
  }

  // ── Save ──
  async function save(status: 'draft' | 'sent') {
    if (!form.customer_name.trim()) { setToast('Customer name is required.'); return }
    setSaving(true)
    try {
      const body = {
        customer_name:     form.customer_name,
        customer_phone:    form.customer_phone || null,
        customer_email:    form.customer_email || null,
        unit_manufacturer: form.unit_manufacturer || null,
        unit_model:        form.unit_model || null,
        unit_serial:       form.unit_serial || null,
        unit_year:         form.unit_year || null,
        truck_make:        form.truck_make || null,
        truck_model:       form.truck_model || null,
        truck_year:        form.truck_year || null,
        vin:               form.vin || null,
        complaint:         form.complaint || null,
        diagnosis:         form.diagnosis || null,
        line_items:        lineItems,
        labor_rate:        form.labor_rate,
        subtotal_labor:    parseFloat(subtotalLabor.toFixed(2)),
        subtotal_parts:    parseFloat(subtotalParts.toFixed(2)),
        diagnostic_fee:    parseFloat(diagFee.toFixed(2)),
        road_call_fee:     parseFloat(roadFee.toFixed(2)),
        tax_rate:          form.tax_rate,
        tax_amount:        parseFloat(taxAmount.toFixed(2)),
        total:             parseFloat(total.toFixed(2)),
        notes:             form.notes || null,
        valid_until:       form.valid_until || null,
        status,
      }
      const res  = await fetch('/api/hd/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (data.quote?.id) router.push(`/hd/quotes/${data.quote.id}`)
      else setToast(data.error ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ background: BG, minHeight: '100dvh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Page header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/hd/quotes" style={{ color: MUTED, fontSize: 13 }}>← Quotes</Link>
          <span style={{ color: BORDER }}>/</span>
          <span className="font-condensed font-bold text-2xl" style={{ color: TEXT }}>NEW QUOTE</span>
        </div>

        {/* ─ Section 1: Customer & Unit ─ */}
        <div style={cardStyle}>
          <SectionTitle>Customer &amp; Unit Info</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="sm:col-span-1">
              <Field label="Customer Name *">
                <input style={inp} value={form.customer_name} onChange={e => setField('customer_name', e.target.value)} placeholder="Fleet name or customer" />
              </Field>
            </div>
            <Field label="Phone">
              <input style={inp} value={form.customer_phone} onChange={e => setField('customer_phone', e.target.value)} placeholder="(555) 000-0000" />
            </Field>
            <Field label="Email">
              <input style={inp} value={form.customer_email} onChange={e => setField('customer_email', e.target.value)} placeholder="customer@email.com" type="email" />
            </Field>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <Field label="Manufacturer">
              <select style={inp} value={form.unit_manufacturer} onChange={e => setField('unit_manufacturer', e.target.value)}>
                <option value="">Select...</option>
                <option>Thermo King</option>
                <option>Carrier Transicold</option>
              </select>
            </Field>
            <Field label="Unit Model">
              <input style={inp} value={form.unit_model} onChange={e => setField('unit_model', e.target.value)} placeholder="e.g. S-600" />
            </Field>
            <Field label="Serial Number">
              <input style={inp} value={form.unit_serial} onChange={e => setField('unit_serial', e.target.value)} placeholder="10-digit serial" />
            </Field>
            <Field label="Unit Year">
              <input style={inp} value={form.unit_year} onChange={e => setField('unit_year', e.target.value)} placeholder="2018" />
            </Field>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="Truck Make">
              <input style={inp} value={form.truck_make} onChange={e => setField('truck_make', e.target.value)} placeholder="Freightliner" />
            </Field>
            <Field label="Truck Model">
              <input style={inp} value={form.truck_model} onChange={e => setField('truck_model', e.target.value)} placeholder="Cascadia" />
            </Field>
            <Field label="Truck Year">
              <input style={inp} value={form.truck_year} onChange={e => setField('truck_year', e.target.value)} placeholder="2020" />
            </Field>
            <Field label="VIN">
              <input style={inp} value={form.vin} onChange={e => setField('vin', e.target.value)} placeholder="17-digit VIN" />
            </Field>
          </div>
        </div>

        {/* ─ Section 2: Complaint & Diagnosis ─ */}
        <div style={cardStyle}>
          <SectionTitle>Complaint &amp; Diagnosis</SectionTitle>
          <div className="grid grid-cols-1 gap-4">
            <Field label="Complaint">
              <textarea
                style={{ ...inp, minHeight: 80, resize: 'vertical' }}
                value={form.complaint}
                onChange={e => setField('complaint', e.target.value)}
                placeholder="What is the customer reporting?"
              />
            </Field>
            <Field label="Diagnosis">
              <textarea
                style={{ ...inp, minHeight: 100, resize: 'vertical' }}
                value={form.diagnosis}
                onChange={e => setField('diagnosis', e.target.value)}
                placeholder="Technician diagnosis and findings..."
              />
            </Field>
            <div>
              <button
                onClick={pullFromQW}
                className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg"
                style={{ background: qwAvailable ? '#EBF5FF' : '#F3F4F6', color: qwAvailable ? BLUE : MUTED, border: `1px solid ${qwAvailable ? '#BFDBFE' : BORDER}`, minHeight: 44 }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                </svg>
                Pull from QuickWrench
              </button>
              <p className="text-xs mt-1.5" style={{ color: MUTED }}>
                {qwAvailable ? 'Last QuickWrench result is available.' : 'Run a QuickWrench diagnosis first to enable this.'}
              </p>
            </div>
          </div>
        </div>

        {/* ─ Section 3: Labor Rate Settings ─ */}
        <div style={cardStyle}>
          <SectionTitle>Labor Rate Settings</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Labor Rate / Hour">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
                <input
                  style={{ ...inp, paddingLeft: 24 }}
                  type="number"
                  min={0}
                  value={form.labor_rate}
                  onChange={e => setField('labor_rate', parseFloat(e.target.value) || 0)}
                />
              </div>
            </Field>
            <div>
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.include_diagnostic}
                  onChange={e => setField('include_diagnostic', e.target.checked)}
                  className="w-4 h-4 rounded"
                  style={{ accentColor: ORANGE }}
                />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Include Diagnostic Fee</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
                <input
                  style={{ ...inp, paddingLeft: 24, opacity: form.include_diagnostic ? 1 : 0.4 }}
                  type="number"
                  min={0}
                  value={form.diagnostic_fee}
                  disabled={!form.include_diagnostic}
                  onChange={e => setField('diagnostic_fee', parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
            <div>
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.include_road_call}
                  onChange={e => setField('include_road_call', e.target.checked)}
                  className="w-4 h-4 rounded"
                  style={{ accentColor: ORANGE }}
                />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Include Road Call Fee</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
                <input
                  style={{ ...inp, paddingLeft: 24, opacity: form.include_road_call ? 1 : 0.4 }}
                  type="number"
                  min={0}
                  value={form.road_call_fee}
                  disabled={!form.include_road_call}
                  onChange={e => setField('road_call_fee', parseFloat(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ─ Section 4: Line Items ─ */}
        <div style={cardStyle}>
          <SectionTitle>Line Items</SectionTitle>

          {/* Add buttons */}
          <div className="flex gap-3 mb-4">
            <button
              onClick={() => setLaborModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ background: ORANGE, minHeight: 44 }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Labor
            </button>
            <button
              onClick={() => setPartsModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ background: '#EBF5FF', color: BLUE, border: `1px solid #BFDBFE`, minHeight: 44 }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add Parts
            </button>
          </div>

          {/* Line items table */}
          {lineItems.length > 0 ? (
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
              <div className="grid text-xs font-semibold uppercase tracking-wide px-4 py-2.5" style={{ gridTemplateColumns: '80px 1fr auto auto auto', background: '#F9FAFB', color: MUTED, borderBottom: `1px solid ${BORDER}` }}>
                <span>Type</span><span>Description</span><span className="text-right pr-8">Hrs / Qty</span><span className="text-right pr-8">Rate</span><span className="text-right">Amount</span>
              </div>
              {lineItems.map(item => (
                <div key={item.id} className="grid items-center px-4 py-3 gap-2" style={{ gridTemplateColumns: '80px 1fr auto auto auto', borderBottom: `1px solid #F9FAFB` }}>
                  <span className="text-xs px-2 py-0.5 rounded-full font-semibold w-fit" style={item.type === 'labor' ? { background: '#FFF7ED', color: ORANGE } : { background: '#EBF5FF', color: BLUE }}>
                    {item.type}
                  </span>
                  <div>
                    <span className="text-sm" style={{ color: TEXT }}>{item.description}</span>
                    {item.part_number && <span className="block text-xs" style={{ color: MUTED }}>{item.part_number}</span>}
                  </div>
                  <span className="text-sm text-right pr-8" style={{ color: MUTED }}>
                    {item.type === 'labor' ? `${item.mobile_hours}h` : `${item.quantity}×`}
                  </span>
                  <span className="text-sm text-right pr-8" style={{ color: MUTED }}>
                    {item.type === 'labor' ? `${fmt(form.labor_rate)}/hr` : fmt(item.unit_cost)}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold" style={{ color: TEXT }}>{fmt(item.amount)}</span>
                    <button onClick={() => removeItem(item.id)} style={{ color: '#9CA3AF', lineHeight: 1 }}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8" style={{ border: `2px dashed ${BORDER}`, borderRadius: 8 }}>
              <p className="text-sm" style={{ color: MUTED }}>No line items yet — add labor or parts above</p>
            </div>
          )}

          {/* Running totals */}
          <div className="flex justify-end mt-6">
            <div style={{ width: 280 }}>
              {[
                { label: 'Labor Subtotal', val: subtotalLabor },
                { label: 'Parts Subtotal', val: subtotalParts },
                ...(form.include_diagnostic ? [{ label: 'Diagnostic Fee', val: diagFee }] : []),
                ...(form.include_road_call ? [{ label: 'Road Call Fee', val: roadFee }] : []),
              ].map(r => (
                <div key={r.label} className="flex justify-between py-1.5 text-sm" style={{ color: MUTED }}>
                  <span>{r.label}</span><span>{fmt(r.val)}</span>
                </div>
              ))}
              <div className="flex items-center gap-3 py-2" style={{ borderTop: `1px solid ${BORDER}`, marginTop: 4 }}>
                <span className="text-sm flex-1" style={{ color: MUTED }}>Tax %</span>
                <input
                  type="number"
                  min={0}
                  max={30}
                  step={0.1}
                  value={form.tax_rate}
                  onChange={e => setField('tax_rate', parseFloat(e.target.value) || 0)}
                  style={{ width: 70, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '4px 8px', fontSize: 13, textAlign: 'right' }}
                />
                <span className="text-sm" style={{ color: MUTED }}>{fmt(taxAmount)}</span>
              </div>
              <div className="flex justify-between items-center pt-3" style={{ borderTop: `2px solid ${ORANGE}`, marginTop: 4 }}>
                <span className="font-bold text-base" style={{ color: TEXT }}>TOTAL</span>
                <span className="font-bold text-2xl" style={{ color: ORANGE }}>{fmt(total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ─ Section 5: Notes & Validity ─ */}
        <div style={cardStyle}>
          <SectionTitle>Notes &amp; Validity</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <Field label="Notes">
                <textarea
                  style={{ ...inp, minHeight: 80, resize: 'vertical' }}
                  value={form.notes}
                  onChange={e => setField('notes', e.target.value)}
                  placeholder="Payment terms, disclaimers, additional info..."
                />
              </Field>
            </div>
            <Field label="Valid Until">
              <input style={inp} type="date" value={form.valid_until} onChange={e => setField('valid_until', e.target.value)} />
            </Field>
          </div>
        </div>

        {/* ─ Action Buttons ─ */}
        <div className="flex flex-col sm:flex-row gap-3 pb-8">
          <button
            onClick={() => save('draft')}
            disabled={saving}
            className="flex-1 py-3 rounded-lg font-semibold text-sm disabled:opacity-50"
            style={{ background: '#F3F4F6', color: '#374151', border: `1px solid ${BORDER}`, minHeight: 48 }}
          >
            {saving ? 'Saving...' : 'Save as Draft'}
          </button>
          <button
            onClick={() => save('sent')}
            disabled={saving}
            className="flex-1 py-3 rounded-lg font-semibold text-sm text-white disabled:opacity-50"
            style={{ background: ORANGE, minHeight: 48 }}
          >
            {saving ? 'Sending...' : 'Send Quote'}
          </button>
        </div>
      </div>

      {/* ─ Labor Modal ─ */}
      {laborModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div style={{ background: CARD, borderRadius: 12, padding: 24, width: '100%', maxWidth: 480 }}>
            <h3 className="font-condensed font-bold text-xl mb-4" style={{ color: TEXT }}>ADD LABOR LINE</h3>
            <div className="flex flex-col gap-4">
              <Field label="Description">
                <input style={inp} value={labor.description} onChange={e => setLabor(l => ({ ...l, description: e.target.value }))} placeholder="e.g. R&R compressor" autoFocus />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Book Time (hrs)">
                  <input style={inp} type="number" min={0} step={0.25} value={labor.book_hours} onChange={e => onLaborBookChange(e.target.value)} />
                </Field>
                <Field label="Mobile Field Time (hrs)">
                  <input style={inp} type="number" min={0} step={0.25} value={labor.mobile_hours} onChange={e => setLabor(l => ({ ...l, mobile_hours: e.target.value }))} />
                </Field>
              </div>
              <div className="p-3 rounded-lg" style={{ background: '#FFF7ED', border: `1px solid #FED7AA` }}>
                <p className="text-xs" style={{ color: '#C2410C' }}>
                  Mobile field time reflects real-world conditions. Book time is dealer flat rate.
                </p>
                <p className="text-sm font-semibold mt-1" style={{ color: TEXT }}>
                  Amount: {fmt((parseFloat(labor.mobile_hours) || 0) * form.labor_rate)}
                  <span className="text-xs font-normal ml-2" style={{ color: MUTED }}>
                    ({labor.mobile_hours} hrs × {fmt(form.labor_rate)}/hr)
                  </span>
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setLaborModal(false); setLabor({ description: '', book_hours: '1.0', mobile_hours: '1.5' }) }} className="flex-1 py-2.5 rounded-lg font-semibold text-sm" style={{ background: '#F3F4F6', color: '#374151' }}>Cancel</button>
                <button onClick={addLaborItem} className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white" style={{ background: ORANGE }}>Add Line</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─ Parts Modal ─ */}
      {partsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div style={{ background: CARD, borderRadius: 12, padding: 24, width: '100%', maxWidth: 520 }}>
            <h3 className="font-condensed font-bold text-xl mb-4" style={{ color: TEXT }}>ADD PARTS LINE</h3>
            <div className="flex flex-col gap-4">
              <div className="flex gap-2">
                <div className="flex-1">
                  <Field label="Part Number">
                    <input style={inp} value={parts.part_number} onChange={e => setParts(d => ({ ...d, part_number: e.target.value }))} placeholder="e.g. 37-33-6021" autoFocus />
                  </Field>
                </div>
                <div className="flex flex-col justify-end">
                  <button
                    onClick={searchParts}
                    disabled={partsSearching}
                    className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: BLUE, minHeight: 44 }}
                  >
                    {partsSearching ? '...' : 'Lookup'}
                  </button>
                </div>
              </div>

              {/* Search results */}
              {partsResults.length > 0 && (
                <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
                  {partsResults.map(p => (
                    <button
                      key={p.part_number}
                      onClick={() => selectPartResult(p)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-start gap-3"
                      style={{ borderBottom: `1px solid #F9FAFB` }}
                    >
                      <span className="font-mono text-xs font-semibold" style={{ color: ORANGE, minWidth: 100 }}>{p.part_number}</span>
                      <span className="text-sm" style={{ color: TEXT }}>{p.description}</span>
                    </button>
                  ))}
                </div>
              )}

              <Field label="Description">
                <input style={inp} value={parts.description} onChange={e => setParts(d => ({ ...d, description: e.target.value }))} placeholder="Part description" />
              </Field>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Quantity">
                  <input style={inp} type="number" min={1} value={parts.quantity} onChange={e => setParts(d => ({ ...d, quantity: e.target.value }))} />
                </Field>
                <Field label="Unit Cost">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
                    <input style={{ ...inp, paddingLeft: 24 }} type="number" min={0} step={0.01} value={parts.unit_cost} onChange={e => setParts(d => ({ ...d, unit_cost: e.target.value }))} />
                  </div>
                </Field>
                <Field label="Total">
                  <div className="flex items-center" style={{ height: 44, paddingLeft: 12, fontWeight: 600, color: TEXT }}>
                    {fmt((parseFloat(parts.quantity) || 1) * (parseFloat(parts.unit_cost) || 0))}
                  </div>
                </Field>
              </div>
              <div className="flex gap-3">
                <button onClick={() => { setPartsModal(false); setParts({ part_number: '', description: '', quantity: '1', unit_cost: '0.00' }); setPartsResults([]) }} className="flex-1 py-2.5 rounded-lg font-semibold text-sm" style={{ background: '#F3F4F6', color: '#374151' }}>Cancel</button>
                <button onClick={addPartsItem} className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white" style={{ background: BLUE }}>Add Line</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-semibold text-white shadow-xl" style={{ background: '#1A1A1A' }}>
          {toast}
          <button className="ml-4 opacity-60 hover:opacity-100" onClick={() => setToast('')}>×</button>
        </div>
      )}
    </div>
  )
}
