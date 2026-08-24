'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { computeDueDate } from '@/lib/hd/payment-terms'
import { useDefaultTaxPercent } from '@/lib/hd/use-default-tax-rate'

// Direct-invoice fast path: skip the quote/approval step and bill a trusted
// customer directly. Mirrors the quote form but posts straight to /api/hd/invoices.

const ORANGE = '#FF6600'
const BLUE   = '#2969B0'
const BG     = '#F4F5F7'
const CARD   = '#FFFFFF'
const BORDER = '#E5E7EB'
const TEXT   = '#1A1A1A'
const MUTED  = '#6B7280'

// The manufacturer picker only ships the two reefer brands. A work order can bill
// any machine (tractor, box truck, aerial lift), so a prefilled value outside this
// list is surfaced as an extra option rather than silently dropped.
const REEFER_BRANDS = ['Thermo King', 'Carrier Transicold']

interface LineItem {
  id: string
  type: 'labor' | 'parts'
  description: string
  mobile_hours: number
  part_number: string
  quantity: number
  unit_cost: number
  amount: number
}

interface CustomerHit {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  email: string | null
}

const inp = {
  width: '100%', border: `1px solid ${BORDER}`, borderRadius: 8, padding: '10px 12px',
  fontSize: 14, color: TEXT, background: CARD, outline: 'none', minHeight: 44,
} as React.CSSProperties

const cardStyle = {
  background: CARD, borderRadius: 12, border: `1px solid ${BORDER}`, padding: 24, marginBottom: 20,
} as React.CSSProperties

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

export default function NewInvoicePage() {
  const router = useRouter()

  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState('')
  const [lineItems, setLineItems] = useState<LineItem[]>([])
  const [laborModal, setLaborModal] = useState(false)
  const [partsModal, setPartsModal] = useState(false)

  const [labor, setLabor] = useState({ description: '', hours: '1.0' })
  const [parts, setParts] = useState({ part_number: '', description: '', quantity: '1', unit_cost: '0.00' })

  const [customerSearch, setCustomerSearch]   = useState('')
  const [customerResults, setCustomerResults] = useState<CustomerHit[]>([])
  const [showResults, setShowResults]         = useState(false)

  const [form, setForm] = useState({
    work_order_id: '', work_order_number: '',
    fleet_account_id: '',
    company_name: '',
    customer_name: '', customer_phone: '', customer_email: '',
    address_line1: '', address_line2: '', city: '', state: '', zip: '',
    corp_address_line1: '', corp_address_line2: '', corp_city: '', corp_state: '', corp_zip: '',
    has_corp_address: false,
    payment_terms: 'net30',
    unit_manufacturer: '', unit_model: '', unit_serial: '', unit_year: '',
    truck_make: '', truck_model: '', truck_year: '', vin: '',
    complaint: '', diagnosis: '',
    labor_rate: 125, diagnostic_fee: 125, include_diagnostic: false,
    road_call_fee: 0, include_road_call: false,
    tax_rate: 0, notes: '',
  })

  function setField(k: string, v: string | number | boolean) { setForm(f => ({ ...f, [k]: v })) }

  // Seed the tax rate from the tech's saved default. Only fills while the field is
  // still untouched at 0, so a rate typed while the fetch was in flight survives.
  const defaultTaxPct = useDefaultTaxPercent()
  useEffect(() => {
    if (defaultTaxPct == null) return
    setForm(f => (f.tax_rate === 0 ? { ...f, tax_rate: defaultTaxPct } : f))
  }, [defaultTaxPct])

  // Prefill from a PM Schedules interval tap (?pm_type=...&unit_manufacturer=...) or
  // from the "Create Invoice" button on a work order, which carries the whole job in
  // the query string (?work_order_id=...&labor_hours=...).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const pmType = sp.get('pm_type')
    const mfr    = sp.get('unit_manufacturer')
    const woId   = sp.get('work_order_id')
    if (!pmType && !mfr && !woId) return

    const text = (k: string) => sp.get(k) ?? ''
    const num  = (k: string) => {
      const v = parseFloat(sp.get(k) ?? '')
      return Number.isFinite(v) ? v : null
    }

    const isReeferBrand = !!mfr && REEFER_BRANDS.includes(mfr)
    const serviceType   = text('service_type')
    const laborRate     = num('labor_rate')
    const laborHours    = num('labor_hours')

    setForm(f => ({
      ...f,
      work_order_id:     woId ?? '',
      work_order_number: text('work_order_number') || f.work_order_number,
      customer_name:     text('customer_name')  || f.customer_name,
      company_name:      text('company_name')   || f.company_name,
      customer_phone:    text('customer_phone') || f.customer_phone,
      customer_email:    text('customer_email') || f.customer_email,
      fleet_account_id:  text('fleet_account_id') || f.fleet_account_id,
      address_line1:     text('address_line1') || f.address_line1,
      city:              text('city')  || f.city,
      state:             text('state') || f.state,
      zip:               text('zip')   || f.zip,
      // A work order's manufacturer always lands in the field now that the select
      // carries prefilled values. The PM path keeps its original behavior of naming
      // a non-reefer brand in the complaint line instead.
      unit_manufacturer: (woId || isReeferBrand) ? (mfr || f.unit_manufacturer) : f.unit_manufacturer,
      unit_model:        text('unit_model')  || f.unit_model,
      unit_serial:       text('unit_serial') || f.unit_serial,
      unit_year:         text('unit_year')   || f.unit_year,
      labor_rate:        laborRate ?? f.labor_rate,
      complaint: text('complaint') || (pmType
        ? `Preventive Maintenance — ${pmType}${mfr && !isReeferBrand ? ` (${mfr})` : ''}`
        : f.complaint),
      diagnosis: text('diagnosis') || f.diagnosis,
    }))

    // Work orders have no line items of their own — the billable record is
    // labor_hours × labor_rate, so seed the invoice with that single labor line.
    if (woId && laborHours && laborHours > 0) {
      const rate = laborRate ?? 125
      setLineItems(l => l.length ? l : [{
        id: crypto.randomUUID(), type: 'labor',
        description: serviceType || 'Service labor',
        mobile_hours: laborHours, part_number: '', quantity: 0, unit_cost: 0,
        amount: parseFloat((laborHours * rate).toFixed(2)),
      }])
    } else if (pmType) {
      setLineItems(l => l.length ? l : [{
        id: crypto.randomUUID(), type: 'labor',
        description: `Preventive Maintenance — ${pmType}`,
        mobile_hours: 0, part_number: '', quantity: 0, unit_cost: 0, amount: 0,
      }])
    }
  }, [])

  // Prefill from a QuickWrench diagnostic push. Same payload the quote form reads;
  // the key is cleared on read so only the destination the tech chose consumes it.
  // The diagnostic fee arrives as a dedicated field here rather than a labor line,
  // which is what the invoice form actually bills it with.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('hd_guided_diagnostic_prefill')
      if (!raw) return
      localStorage.removeItem('hd_guided_diagnostic_prefill')
      const p = JSON.parse(raw) as {
        complaint?: string; diagnosis?: string; notes?: string
        unit_manufacturer?: string; unit_model?: string; unit_serial?: string; unit_year?: string
        truck_make?: string; truck_model?: string; truck_year?: string; vin?: string
        labor_rate?: number; include_diagnostic?: boolean; diagnostic_fee?: number
        lineItems?: Array<{ description: string; mobile_hours: number }>
      }
      const rate = Number.isFinite(p.labor_rate) && (p.labor_rate as number) > 0 ? p.labor_rate as number : 125

      setForm(f => ({
        ...f,
        ...(p.complaint ? { complaint: p.complaint } : {}),
        ...(p.diagnosis ? { diagnosis: p.diagnosis } : {}),
        ...(p.notes     ? { notes:     p.notes     } : {}),
        ...(p.unit_manufacturer ? { unit_manufacturer: p.unit_manufacturer } : {}),
        ...(p.unit_model  ? { unit_model:  p.unit_model  } : {}),
        ...(p.unit_serial ? { unit_serial: p.unit_serial } : {}),
        ...(p.unit_year   ? { unit_year:   p.unit_year   } : {}),
        ...(p.truck_make  ? { truck_make:  p.truck_make  } : {}),
        ...(p.truck_model ? { truck_model: p.truck_model } : {}),
        ...(p.truck_year  ? { truck_year:  p.truck_year  } : {}),
        ...(p.vin         ? { vin:         p.vin         } : {}),
        labor_rate:         rate,
        include_diagnostic: !!p.include_diagnostic,
        diagnostic_fee:     Number.isFinite(p.diagnostic_fee) ? p.diagnostic_fee as number : f.diagnostic_fee,
      }))

      if (p.lineItems?.length) {
        setLineItems(p.lineItems.map(li => ({
          id: crypto.randomUUID(), type: 'labor' as const,
          description:  li.description,
          mobile_hours: li.mobile_hours,
          part_number: '', quantity: 0, unit_cost: 0,
          amount: parseFloat((li.mobile_hours * rate).toFixed(2)),
        })))
      }
    } catch { /* ignore */ }
  }, [])

  // ── Customer picker ──
  useEffect(() => {
    const q = customerSearch.trim()
    if (q.length < 2) { setCustomerResults([]); return }
    const t = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/customers?search=${encodeURIComponent(q)}&limit=8`)
        const data = await res.json()
        setCustomerResults((data.customers ?? []) as CustomerHit[])
        setShowResults(true)
      } catch { /* ignore */ }
    }, 300)
    return () => clearTimeout(t)
  }, [customerSearch])

  async function pickCustomer(hit: CustomerHit) {
    setShowResults(false)
    setCustomerSearch(`${hit.first_name} ${hit.last_name}`.trim())
    try {
      const res  = await fetch(`/api/customers/${hit.id}`)
      const data = await res.json()
      const c = data.customer ?? {}
      setForm(f => ({
        ...f,
        customer_name:  `${hit.first_name} ${hit.last_name}`.trim(),
        customer_phone: c.phone ?? hit.phone ?? '',
        customer_email: c.email ?? hit.email ?? '',
        address_line1:  c.address_line1 ?? '', address_line2: c.address_line2 ?? '',
        city: c.city ?? '', state: c.state ?? '', zip: c.zip ?? '',
        has_corp_address:   !!c.has_corp_address,
        corp_address_line1: c.corp_address_line1 ?? '', corp_address_line2: c.corp_address_line2 ?? '',
        corp_city: c.corp_city ?? '', corp_state: c.corp_state ?? '', corp_zip: c.corp_zip ?? '',
        payment_terms: c.payment_terms ?? 'net30',
      }))
    } catch {
      setForm(f => ({ ...f, customer_name: `${hit.first_name} ${hit.last_name}`.trim(), customer_phone: hit.phone ?? '', customer_email: hit.email ?? '' }))
    }
  }

  // ── Line items ──
  function fmt(n: number) { return `$${n.toFixed(2)}` }

  function addLabor() {
    const description = labor.description.trim()
    if (!description) { setToast('Enter a labor description.'); return }
    const hours = Math.max(0, parseFloat(labor.hours) || 0)
    setLineItems(l => [...l, {
      id: crypto.randomUUID(), type: 'labor', description,
      mobile_hours: hours, part_number: '', quantity: 0, unit_cost: 0,
      amount: parseFloat((hours * form.labor_rate).toFixed(2)),
    }])
    setLabor({ description: '', hours: '1.0' })
    setLaborModal(false)
  }

  function addParts() {
    const description = parts.description.trim()
    if (!description) { setToast('Enter a part description.'); return }
    const qty  = parseFloat(parts.quantity)  || 1
    const cost = parseFloat(parts.unit_cost) || 0
    setLineItems(l => [...l, {
      id: crypto.randomUUID(), type: 'parts', description,
      mobile_hours: 0, part_number: parts.part_number.trim(),
      quantity: qty, unit_cost: cost, amount: parseFloat((qty * cost).toFixed(2)),
    }])
    setParts({ part_number: '', description: '', quantity: '1', unit_cost: '0.00' })
    setPartsModal(false)
  }

  function removeItem(id: string) { setLineItems(l => l.filter(i => i.id !== id)) }

  // ── Totals ──
  const subtotalLabor = lineItems.filter(i => i.type === 'labor').reduce((s, i) => s + i.amount, 0)
  const subtotalParts = lineItems.filter(i => i.type === 'parts').reduce((s, i) => s + i.amount, 0)
  const diagFee = form.include_diagnostic ? form.diagnostic_fee : 0
  const roadFee = form.include_road_call  ? form.road_call_fee  : 0
  const taxBase = subtotalLabor + subtotalParts + diagFee + roadFee
  const taxAmount = taxBase * (form.tax_rate / 100)
  const total = taxBase + taxAmount

  // ── Save ──
  async function save(status: 'unpaid' | 'sent') {
    if (!form.customer_name.trim()) { setToast('Customer name is required.'); return }
    setSaving(true)
    try {
      const sentAt = status === 'sent' ? new Date().toISOString() : null
      const body = {
        // Only sent when this invoice was converted from a work order. The POST route
        // spreads the body straight into the insert, so omitting these keys entirely
        // keeps direct invoices working on databases where 102 has not been run yet.
        ...(form.work_order_id
          ? { work_order_id: form.work_order_id, work_order_number: form.work_order_number || null }
          : {}),
        // Same omit-when-empty rule: the column arrives with migration 105. The server
        // re-resolves and overrides this from the work order, so it is a hint, not a
        // trusted value — it only matters for a direct invoice with no work order.
        ...(form.fleet_account_id ? { fleet_account_id: form.fleet_account_id } : {}),
        company_name:      form.company_name || null,
        customer_name:     form.customer_name,
        customer_phone:    form.customer_phone || null,
        customer_email:    form.customer_email || null,
        address_line1:     form.address_line1 || null,
        address_line2:     form.address_line2 || null,
        city:              form.city || null,
        state:             form.state || null,
        zip:               form.zip || null,
        has_corp_address:  form.has_corp_address,
        corp_address_line1: form.has_corp_address ? (form.corp_address_line1 || null) : null,
        corp_address_line2: form.has_corp_address ? (form.corp_address_line2 || null) : null,
        corp_city:         form.has_corp_address ? (form.corp_city || null) : null,
        corp_state:        form.has_corp_address ? (form.corp_state || null) : null,
        corp_zip:          form.has_corp_address ? (form.corp_zip || null) : null,
        payment_terms:     form.payment_terms || 'net30',
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
        status,
        // On direct send, stamp the sent timestamp + due date now (POST inserts as-is;
        // no quote→invoice PUT transition happens on this fast path).
        ...(sentAt ? { sent_at: sentAt, due_date: computeDueDate(sentAt, form.payment_terms) } : {}),
      }
      const res  = await fetch('/api/hd/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (data.invoice?.id) {
        router.push(`/hd/invoices/${data.invoice.id}`)
      } else {
        setToast(data.error ?? 'Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  const billingAddr = [form.address_line1, form.address_line2, [form.city, form.state].filter(Boolean).join(', '), form.zip].filter(Boolean).join(', ')

  return (
    <div style={{ background: BG, minHeight: '100dvh', padding: '24px 20px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/hd/invoices" style={{ color: MUTED, fontSize: 13 }}>← Invoices</Link>
          <span style={{ color: BORDER }}>/</span>
          <span className="font-condensed font-bold text-2xl" style={{ color: TEXT }}>NEW INVOICE</span>
          {form.work_order_number ? (
            <Link href={`/hd/work-orders/${form.work_order_id}`} className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: '#FFF7ED', color: ORANGE }}>
              From {form.work_order_number}
            </Link>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: '#EBF5FF', color: BLUE }}>Direct — no quote</span>
          )}
        </div>

        {/* Customer & Unit */}
        <div style={cardStyle}>
          <SectionTitle>Customer &amp; Unit Info</SectionTitle>

          <div className="mb-4" style={{ position: 'relative' }}>
            <Field label="Link Intel Hub Customer (optional)">
              <input style={inp} value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
                onFocus={() => { if (customerResults.length) setShowResults(true) }}
                placeholder="Search saved customers by name, phone, or email" />
            </Field>
            {showResults && customerResults.length > 0 && (
              <div style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, marginTop: 4, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', maxHeight: 240, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                {customerResults.map(hit => (
                  <button key={hit.id} type="button" onClick={() => pickCustomer(hit)} className="w-full text-left px-4 py-2.5 hover:bg-gray-50" style={{ borderBottom: `1px solid #F9FAFB` }}>
                    <p className="text-sm font-medium" style={{ color: TEXT }}>{hit.first_name} {hit.last_name}</p>
                    <p className="text-xs" style={{ color: MUTED }}>{[hit.phone, hit.email].filter(Boolean).join(' · ') || '—'}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mb-4">
            <Field label="Business Name">
              <input style={inp} value={form.company_name} onChange={e => setField('company_name', e.target.value)} placeholder="Fleet company or business name (optional)" />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <Field label="Customer Name *">
              <input style={inp} value={form.customer_name} onChange={e => setField('customer_name', e.target.value)} placeholder="Fleet name or customer" />
            </Field>
            <Field label="Phone">
              <input style={inp} value={form.customer_phone} onChange={e => setField('customer_phone', e.target.value)} placeholder="(555) 000-0000" />
            </Field>
            <Field label="Email">
              <input style={inp} value={form.customer_email} onChange={e => setField('customer_email', e.target.value)} placeholder="customer@email.com" type="email" />
            </Field>
          </div>

          {/* Billing address. Prefilled from the Intel Hub customer record or the work
              order's fleet account, but always editable — a fleet's registered address
              is often not where the invoice needs to go. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <Field label="Address Line 1">
              <input style={inp} value={form.address_line1} onChange={e => setField('address_line1', e.target.value)} placeholder="123 Main St" />
            </Field>
            <Field label="Address Line 2">
              <input style={inp} value={form.address_line2} onChange={e => setField('address_line2', e.target.value)} placeholder="Suite / Unit (optional)" />
            </Field>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div className="col-span-2">
              <Field label="City">
                <input style={inp} value={form.city} onChange={e => setField('city', e.target.value)} placeholder="Wauchula" />
              </Field>
            </div>
            <Field label="State">
              <input style={inp} value={form.state} onChange={e => setField('state', e.target.value)} placeholder="FL" maxLength={2} />
            </Field>
            <Field label="Zip">
              <input style={inp} value={form.zip} onChange={e => setField('zip', e.target.value)} placeholder="33873" inputMode="numeric" />
            </Field>
          </div>

          {billingAddr && (
            <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#F9FAFB', border: `1px solid ${BORDER}` }}>
              <p style={{ color: TEXT }}>📍 {billingAddr}</p>
              <p className="mt-1 text-xs" style={{ color: MUTED }}>Payment Terms: <strong style={{ color: TEXT }}>{form.payment_terms.replace('net', 'Net ')}</strong></p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <Field label="Manufacturer">
              <select style={inp} value={form.unit_manufacturer} onChange={e => setField('unit_manufacturer', e.target.value)}>
                <option value="">Select...</option>
                {REEFER_BRANDS.map(b => <option key={b}>{b}</option>)}
                {form.unit_manufacturer && !REEFER_BRANDS.includes(form.unit_manufacturer) && (
                  <option>{form.unit_manufacturer}</option>
                )}
              </select>
            </Field>
            <Field label="Unit Model"><input style={inp} value={form.unit_model} onChange={e => setField('unit_model', e.target.value)} placeholder="e.g. S-600" /></Field>
            <Field label="Serial Number"><input style={inp} value={form.unit_serial} onChange={e => setField('unit_serial', e.target.value)} placeholder="10-digit serial" /></Field>
            <Field label="Unit Year"><input style={inp} value={form.unit_year} onChange={e => setField('unit_year', e.target.value)} placeholder="2018" /></Field>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Field label="Truck Make"><input style={inp} value={form.truck_make} onChange={e => setField('truck_make', e.target.value)} placeholder="Freightliner" /></Field>
            <Field label="Truck Model"><input style={inp} value={form.truck_model} onChange={e => setField('truck_model', e.target.value)} placeholder="Cascadia" /></Field>
            <Field label="Truck Year"><input style={inp} value={form.truck_year} onChange={e => setField('truck_year', e.target.value)} placeholder="2020" /></Field>
            <Field label="VIN"><input style={inp} value={form.vin} onChange={e => setField('vin', e.target.value)} placeholder="17-digit VIN" /></Field>
          </div>
        </div>

        {/* Complaint & Diagnosis */}
        <div style={cardStyle}>
          <SectionTitle>Work Performed</SectionTitle>
          <div className="grid grid-cols-1 gap-4">
            <Field label="Complaint / Reason">
              <textarea style={{ ...inp, minHeight: 70, resize: 'vertical' }} value={form.complaint} onChange={e => setField('complaint', e.target.value)} placeholder="What was the issue?" />
            </Field>
            <Field label="Work Done / Diagnosis">
              <textarea style={{ ...inp, minHeight: 90, resize: 'vertical' }} value={form.diagnosis} onChange={e => setField('diagnosis', e.target.value)} placeholder="Describe the work performed..." />
            </Field>
          </div>
        </div>

        {/* Labor rate + fees */}
        <div style={cardStyle}>
          <SectionTitle>Rate &amp; Fees</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Labor Rate / Hour">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
                <input style={{ ...inp, paddingLeft: 24 }} type="number" min={0} value={form.labor_rate} onChange={e => setField('labor_rate', parseFloat(e.target.value) || 0)} />
              </div>
            </Field>
            <div>
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input type="checkbox" checked={form.include_diagnostic} onChange={e => setField('include_diagnostic', e.target.checked)} className="w-4 h-4 rounded" style={{ accentColor: ORANGE }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Diagnostic Fee</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
                <input style={{ ...inp, paddingLeft: 24, opacity: form.include_diagnostic ? 1 : 0.4 }} type="number" min={0} value={form.diagnostic_fee} disabled={!form.include_diagnostic} onChange={e => setField('diagnostic_fee', parseFloat(e.target.value) || 0)} />
              </div>
            </div>
            <div>
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input type="checkbox" checked={form.include_road_call} onChange={e => setField('include_road_call', e.target.checked)} className="w-4 h-4 rounded" style={{ accentColor: ORANGE }} />
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUTED }}>Road Call Fee</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
                <input style={{ ...inp, paddingLeft: 24, opacity: form.include_road_call ? 1 : 0.4 }} type="number" min={0} value={form.road_call_fee} disabled={!form.include_road_call} onChange={e => setField('road_call_fee', parseFloat(e.target.value) || 0)} />
              </div>
            </div>
          </div>
        </div>

        {/* Line items */}
        <div style={cardStyle}>
          <SectionTitle>Line Items</SectionTitle>
          <div className="flex gap-3 mb-4">
            <button onClick={() => setLaborModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: ORANGE, minHeight: 44 }}>+ Add Labor</button>
            <button onClick={() => setPartsModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: '#EBF5FF', color: BLUE, border: `1px solid #BFDBFE`, minHeight: 44 }}>+ Add Parts</button>
          </div>

          {lineItems.length > 0 ? (
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
              {lineItems.map(item => (
                <div key={item.id} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid #F9FAFB` }}>
                  <span className="text-xs px-1.5 py-0.5 rounded font-semibold shrink-0" style={item.type === 'labor' ? { background: '#FFF7ED', color: ORANGE } : { background: '#EBF5FF', color: BLUE }}>
                    {item.type === 'labor' ? 'LAB' : 'PRT'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm" style={{ color: TEXT }}>{item.description}</p>
                    <p className="text-xs" style={{ color: MUTED }}>
                      {item.type === 'labor' ? `${item.mobile_hours} hrs × ${fmt(form.labor_rate)}/hr` : `${item.quantity} × ${fmt(item.unit_cost)}${item.part_number ? ` · ${item.part_number}` : ''}`}
                    </p>
                  </div>
                  <span className="text-sm font-semibold" style={{ color: TEXT }}>{fmt(item.amount)}</span>
                  <button onClick={() => removeItem(item.id)} style={{ color: '#9CA3AF' }}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8" style={{ border: `2px dashed ${BORDER}`, borderRadius: 8 }}>
              <p className="text-sm" style={{ color: MUTED }}>No line items yet — add labor or parts above</p>
            </div>
          )}

          {/* Totals */}
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

        {/* Notes & terms */}
        <div style={cardStyle}>
          <SectionTitle>Notes &amp; Terms</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <Field label="Notes">
                <textarea style={{ ...inp, minHeight: 70, resize: 'vertical' }} value={form.notes} onChange={e => setField('notes', e.target.value)} placeholder="Payment instructions, disclaimers, additional info..." />
              </Field>
            </div>
            <Field label="Payment Terms">
              <select style={inp} value={form.payment_terms} onChange={e => setField('payment_terms', e.target.value)}>
                <option value="net15">Net 15 (due in 15 days)</option>
                <option value="net30">Net 30 (due in 30 days)</option>
                <option value="net45">Net 45 (due in 45 days)</option>
              </select>
            </Field>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 pb-8">
          <button onClick={() => save('unpaid')} disabled={saving} className="flex-1 py-3 rounded-lg font-semibold text-sm disabled:opacity-50" style={{ background: '#F3F4F6', color: '#374151', border: `1px solid ${BORDER}`, minHeight: 48 }}>
            {saving ? 'Saving...' : 'Save as Unpaid'}
          </button>
          <button onClick={() => save('sent')} disabled={saving} className="flex-1 py-3 rounded-lg font-semibold text-sm text-white disabled:opacity-50" style={{ background: ORANGE, minHeight: 48 }}>
            {saving ? 'Sending...' : 'Save & Send Invoice'}
          </button>
        </div>
      </div>

      {/* Labor modal */}
      {laborModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div style={{ background: CARD, borderRadius: 12, padding: 24, width: '100%', maxWidth: 460 }}>
            <h3 className="font-condensed font-bold text-xl mb-4" style={{ color: TEXT }}>ADD LABOR LINE</h3>
            <div className="flex flex-col gap-4">
              <Field label="Description">
                <input style={inp} autoFocus value={labor.description} onChange={e => setLabor(d => ({ ...d, description: e.target.value }))} placeholder="e.g. R&R Fuel Filter Primary" />
              </Field>
              <Field label="Hours">
                <input style={inp} type="number" min={0} step={0.25} value={labor.hours} onChange={e => setLabor(d => ({ ...d, hours: e.target.value }))} />
              </Field>
              <p className="text-sm" style={{ color: MUTED }}>Amount: <strong style={{ color: TEXT }}>{fmt((parseFloat(labor.hours) || 0) * form.labor_rate)}</strong></p>
              <div className="flex gap-3">
                <button onClick={() => setLaborModal(false)} className="flex-1 py-2.5 rounded-lg font-semibold text-sm" style={{ background: '#F3F4F6', color: '#374151' }}>Cancel</button>
                <button onClick={addLabor} className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white" style={{ background: ORANGE }}>Add Line</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Parts modal */}
      {partsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
          <div style={{ background: CARD, borderRadius: 12, padding: 24, width: '100%', maxWidth: 520 }}>
            <h3 className="font-condensed font-bold text-xl mb-4" style={{ color: TEXT }}>ADD PARTS LINE</h3>
            <div className="flex flex-col gap-4">
              <Field label="Part Number"><input style={inp} value={parts.part_number} onChange={e => setParts(d => ({ ...d, part_number: e.target.value }))} placeholder="e.g. 37-33-6021" autoFocus /></Field>
              <Field label="Description"><input style={inp} value={parts.description} onChange={e => setParts(d => ({ ...d, description: e.target.value }))} placeholder="Part description" /></Field>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Quantity"><input style={inp} type="number" min={1} value={parts.quantity} onChange={e => setParts(d => ({ ...d, quantity: e.target.value }))} /></Field>
                <Field label="Unit Cost">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: MUTED }}>$</span>
                    <input style={{ ...inp, paddingLeft: 24 }} type="number" min={0} step={0.01} value={parts.unit_cost} onChange={e => setParts(d => ({ ...d, unit_cost: e.target.value }))} />
                  </div>
                </Field>
                <Field label="Total">
                  <div className="flex items-center" style={{ height: 44, paddingLeft: 12, fontWeight: 600, color: TEXT }}>{fmt((parseFloat(parts.quantity) || 1) * (parseFloat(parts.unit_cost) || 0))}</div>
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
