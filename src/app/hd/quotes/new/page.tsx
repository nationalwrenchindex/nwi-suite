'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { LABOR_GUIDE, type LaborGuideItem } from '@/lib/hd/labor-guide'

const ORANGE  = '#16a34a'
const BLUE    = '#15803d'
const BG      = '#F4F5F7'
const CARD    = '#FFFFFF'
const BORDER  = '#E5E7EB'
const TEXT    = '#1A1A1A'
const MUTED   = '#6B7280'

// HD Suite dark theme — used by the labor modal
const D_BG       = '#0d1820'
const D_BORDER   = '#1e3040'
const D_INPUT_BG = '#162030'

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineItem {
  id: string
  type: 'labor' | 'parts'
  description: string
  // labor — supports time ranges
  book_hours: number
  book_hours_max: number
  mobile_hours: number
  mobile_hours_max: number
  requires_refrigeration: boolean
  recharge_added: boolean
  // parts
  part_number: string
  quantity: number
  unit_cost: number
  // billing amount uses mobile_hours (lower); amount_max for display
  amount: number
  amount_max: number
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

// A row from the personal labor library (hd_repair_items)
interface LibraryItem {
  id: string
  description: string
  mobile_hours: number | string | null
  shop_hours: number | string | null
  requires_refrigeration: boolean
  refrigeration_service: string | null
  refrigeration_hours: number | string | null
  is_master: boolean
}

const dInp = {
  width: '100%',
  border: `1px solid ${D_BORDER}`,
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 14,
  color: '#FFFFFF',
  background: D_INPUT_BG,
  outline: 'none',
  minHeight: 44,
} as React.CSSProperties

// Subtle inline-edit input for existing labor line rows (light row style)
const lineInp = {
  width: '100%',
  border: '1px solid transparent',
  borderBottom: `1px solid ${BORDER}`,
  borderRadius: 4,
  padding: '4px 6px',
  fontSize: 14,
  color: TEXT,
  background: 'transparent',
  outline: 'none',
} as React.CSSProperties

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtHrs(min: number, max: number, shopOnly = false): string {
  if (shopOnly) return 'Shop only'
  if (Math.abs(min - max) < 0.01) return `${min} hrs`
  return `${min} to ${max} hrs`
}

function fmtAmtRange(min: number, max: number): string {
  if (Math.abs(min - max) < 0.5) return `$${min.toFixed(0)}`
  return `$${Math.floor(min)} to $${Math.ceil(max)}`
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
  const [customerToast, setCustomerToast] = useState(false)
  const [laborModal, setLaborModal]       = useState(false)
  const [partsModal, setPartsModal]       = useState(false)
  const [lineItems, setLineItems]         = useState<LineItem[]>([])
  const [qwAvailable, setQwAvailable]     = useState(false)
  const [qwPulledNote, setQwPulledNote]   = useState('')
  const [partsResults, setPartsResults]   = useState<PartResult[]>([])
  const [partsSearching, setPartsSearching] = useState(false)

  // Labor modal state — free-text description + editable hours + personal library
  const [laborDesc, setLaborDesc]           = useState('')
  const [laborBookMin, setLaborBookMin]     = useState('1.0')
  const [laborBookMax, setLaborBookMax]     = useState('1.0')
  const [laborMobileMin, setLaborMobileMin] = useState('1.5')
  const [laborMobileMax, setLaborMobileMax] = useState('1.5')
  const [laborRecharge, setLaborRecharge]   = useState(false)
  const [saveToLibrary, setSaveToLibrary]   = useState(true)
  const [laborLibrary, setLaborLibrary]     = useState<LibraryItem[]>([])
  const [laborSelectedKey, setLaborSelectedKey] = useState('')
  // Set only when a library item carries explicit refrigeration_hours — its
  // recovery time becomes a SEPARATE labor line (matches buildRepairLines()).
  const [laborRefrig, setLaborRefrig] = useState<{ hours: number; service: string | null } | null>(null)

  const [parts, setParts] = useState<PartsDraft>({ part_number: '', description: '', quantity: '1', unit_cost: '0.00' })

  const [form, setForm] = useState({
    company_name: '',
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
      const raw = localStorage.getItem('hd_last_quickwrench_result')
      if (raw) {
        const stored = JSON.parse(raw) as { timestamp: string }
        const age = Date.now() - new Date(stored.timestamp).getTime()
        setQwAvailable(age < 24 * 60 * 60 * 1000)
      }
    } catch {}
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('hd_guided_diagnostic_prefill')
      if (!raw) return
      localStorage.removeItem('hd_guided_diagnostic_prefill')
      const prefill = JSON.parse(raw) as {
        complaint?: string
        diagnosis?: string
        notes?: string
        lineItems?: Array<{
          description: string
          book_hours: number; book_hours_max: number
          mobile_hours: number; mobile_hours_max: number
        }>
      }
      setForm(f => ({
        ...f,
        ...(prefill.complaint ? { complaint:  prefill.complaint  } : {}),
        ...(prefill.diagnosis ? { diagnosis:  prefill.diagnosis  } : {}),
        ...(prefill.notes     ? { notes:      prefill.notes      } : {}),
      }))
      if (prefill.lineItems?.length) {
        const rate = 125
        setLineItems(prefill.lineItems.map(li => ({
          id:                     crypto.randomUUID(),
          type:                   'labor' as const,
          description:            li.description,
          book_hours:             li.book_hours,
          book_hours_max:         li.book_hours_max,
          mobile_hours:           li.mobile_hours,
          mobile_hours_max:       li.mobile_hours_max,
          requires_refrigeration: false,
          recharge_added:         false,
          part_number: '', quantity: 0, unit_cost: 0,
          amount:     parseFloat((li.mobile_hours     * rate).toFixed(2)),
          amount_max: parseFloat((li.mobile_hours_max * rate).toFixed(2)),
        })))
      }
    } catch {}
  }, [])

  async function fetchLibrary() {
    try {
      const res  = await fetch('/api/hd/repair-items')
      const data = await res.json()
      setLaborLibrary((data.items ?? []) as LibraryItem[])
    } catch {}
  }

  useEffect(() => { fetchLibrary() }, [])

  function pullFromQW() {
    try {
      const raw = localStorage.getItem('hd_last_quickwrench_result')
      if (!raw) {
        setToast('No recent QuickWrench results — run a diagnosis first.')
        return
      }
      const stored = JSON.parse(raw) as { analysis: string; timestamp: string; model?: string }
      const age = Date.now() - new Date(stored.timestamp).getTime()
      if (age >= 24 * 60 * 60 * 1000) {
        setToast('No recent QuickWrench results — run a diagnosis first.')
        setQwAvailable(false)
        return
      }
      setForm(f => ({ ...f, diagnosis: stored.analysis }))
      const ts = new Date(stored.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      setQwPulledNote(`Pulled from QuickWrench — ${stored.model ?? ''} at ${ts}`)
    } catch {
      setToast('No recent QuickWrench results — run a diagnosis first.')
    }
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

  // ── Labor modal helpers ──────────────────────────────────────────────────

  const libNum = (v: number | string | null): number | null =>
    v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v)

  const laborTerm = laborDesc.trim().toLowerCase()
  // Personal library first (own items then master), then LABOR_GUIDE fallbacks.
  const libMatches = laborTerm
    ? laborLibrary.filter(i => i.description.toLowerCase().includes(laborTerm)).slice(0, 8)
    : []
  const guideMatches = laborTerm
    ? LABOR_GUIDE.filter(i => i.label.toLowerCase().includes(laborTerm)).slice(0, 8)
    : []
  const showLaborResults = laborTerm.length > 0 && (libMatches.length > 0 || guideMatches.length > 0)

  function selectLibraryItem(i: LibraryItem) {
    const book = libNum(i.shop_hours)   ?? 1.0
    const mob  = libNum(i.mobile_hours) ?? 1.5
    setLaborDesc(i.description)
    setLaborBookMin(String(book));  setLaborBookMax(String(book))
    setLaborMobileMin(String(mob)); setLaborMobileMax(String(mob))
    const refrigHrs = libNum(i.refrigeration_hours)
    if (i.requires_refrigeration && refrigHrs && refrigHrs > 0) {
      // Explicit refrigeration service → its own separate line; base mobile stays as-is.
      setLaborRefrig({ hours: refrigHrs, service: i.refrigeration_service ?? null })
      setLaborRecharge(false)
    } else {
      // Library items store complete mobile_hours — never auto-add fixed recovery
      // (e.g. "Service Refrigeration A" is 2.6 hrs on its own, not 2.6 + 1.5). The
      // recovery checkbox stays available below for manual opt-in. The fixed-recovery
      // checkbox auto-fires only for old LABOR_GUIDE items (see selectGuideItem).
      setLaborRefrig(null)
      setLaborRecharge(false)
    }
    setLaborSelectedKey(`lib:${i.id}`)
  }

  function selectGuideItem(item: LaborGuideItem) {
    setLaborDesc(item.label)
    setLaborBookMin(String(item.book_min));     setLaborBookMax(String(item.book_max))
    setLaborMobileMin(String(item.mobile_min)); setLaborMobileMax(String(item.mobile_max))
    setLaborRefrig(null)
    setLaborRecharge(item.requires_refrigeration)
    setLaborSelectedKey(`guide:${item.label}`)
  }

  function closeLaborModal() {
    setLaborModal(false)
    setLaborDesc('')
    setLaborBookMin('1.0');   setLaborBookMax('1.0')
    setLaborMobileMin('1.5'); setLaborMobileMax('1.5')
    setLaborRecharge(false)
    setLaborRefrig(null)
    setSaveToLibrary(true)
    setLaborSelectedKey('')
  }

  async function saveLaborToLibrary(description: string, book: number, mobile: number, refrig: boolean) {
    try {
      await fetch('/api/hd/repair-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          shop_hours: book,
          mobile_hours: mobile,
          requires_refrigeration: refrig,
          source: 'manual',
        }),
      })
      fetchLibrary()
    } catch {}
  }

  const rechargeAddMin  = laborRecharge ? 1.5 : 0
  const rechargeAddMax  = laborRecharge ? 2.5 : 0
  const baseMobileMin   = parseFloat(laborMobileMin) || 0
  const baseMobileMax   = parseFloat(laborMobileMax) || baseMobileMin
  const totalMobileMin  = baseMobileMin + rechargeAddMin
  const totalMobileMax  = baseMobileMax + rechargeAddMax
  const previewAmtMin   = totalMobileMin * form.labor_rate
  const previewAmtMax   = totalMobileMax * form.labor_rate

  function addLaborItem() {
    const description = laborDesc.trim()
    if (!description) { setToast('Enter a labor description.'); return }
    const bookMin = parseFloat(laborBookMin) || 0
    const bookMax = parseFloat(laborBookMax) || bookMin
    const newLines: LineItem[] = []

    // Base repair line. When an explicit refrigeration service applies (laborRefrig),
    // its recovery time is a SEPARATE line below — never folded into base mobile hrs.
    // (With laborRefrig set, laborRecharge is false so totalMobile == base mobile.)
    newLines.push({
      id: crypto.randomUUID(),
      type: 'labor',
      description,
      book_hours: bookMin,
      book_hours_max: bookMax,
      mobile_hours: parseFloat(totalMobileMin.toFixed(2)),
      mobile_hours_max: parseFloat(totalMobileMax.toFixed(2)),
      requires_refrigeration: laborRecharge || laborRefrig != null,
      recharge_added: laborRecharge,
      part_number: '', quantity: 0, unit_cost: 0,
      amount: parseFloat((totalMobileMin * form.labor_rate).toFixed(2)),
      amount_max: parseFloat((totalMobileMax * form.labor_rate).toFixed(2)),
    })

    // Separate refrigeration service line (matches quickwrench buildRepairLines()).
    if (laborRefrig) {
      const rh  = laborRefrig.hours
      const svc = laborRefrig.service ? ` ${laborRefrig.service}` : ''
      const amt = parseFloat((rh * form.labor_rate).toFixed(2))
      newLines.push({
        id: crypto.randomUUID(),
        type: 'labor',
        description: `Refrigeration Service${svc} — recover, evacuate & charge`.replace(/\s+/g, ' ').trim(),
        book_hours: rh, book_hours_max: rh,
        mobile_hours: rh, mobile_hours_max: rh,
        requires_refrigeration: true,
        recharge_added: true,
        part_number: '', quantity: 0, unit_cost: 0,
        amount: amt, amount_max: amt,
      })
    }

    setLineItems(l => [...l, ...newLines])
    // Store the base labor (without the situational recovery add) in the library.
    if (saveToLibrary) saveLaborToLibrary(description, bookMin, baseMobileMin, laborRecharge || laborRefrig != null)
    closeLaborModal()
  }

  // ── Inline editing of existing labor line items ──────────────────────────
  function updateLineDescription(id: string, value: string) {
    setLineItems(l => l.map(i => i.id === id ? { ...i, description: value } : i))
  }

  function updateLineHours(id: string, field: 'book' | 'mobile', raw: string) {
    const n = Math.max(0, parseFloat(raw) || 0)
    setLineItems(l => l.map(i => {
      if (i.id !== id) return i
      if (field === 'book') {
        return { ...i, book_hours: n, book_hours_max: n }
      }
      return {
        ...i,
        mobile_hours: n,
        mobile_hours_max: n,
        amount: parseFloat((n * form.labor_rate).toFixed(2)),
        amount_max: parseFloat((n * form.labor_rate).toFixed(2)),
      }
    }))
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
      book_hours: 0, book_hours_max: 0,
      mobile_hours: 0, mobile_hours_max: 0,
      requires_refrigeration: false, recharge_added: false,
      part_number: parts.part_number.trim(),
      quantity: qty, unit_cost: cost,
      amount: parseFloat((qty * cost).toFixed(2)),
      amount_max: parseFloat((qty * cost).toFixed(2)),
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
        company_name:      form.company_name || null,
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
      if (data.quote?.id) {
        if (data.customer_id) {
          // Green confirmation that the customer was logged; auto-dismiss at 3s.
          setCustomerToast(true)
          setTimeout(() => setCustomerToast(false), 3000)
          setTimeout(() => router.push(`/hd/quotes/${data.quote.id}`), 1200)
        } else {
          router.push(`/hd/quotes/${data.quote.id}`)
        }
      } else {
        setToast(data.error ?? 'Save failed')
      }
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
          <div className="mb-4">
            <Field label="Business Name">
              <input style={inp} value={form.company_name} onChange={e => setField('company_name', e.target.value)} placeholder="Fleet company or business name (optional)" />
            </Field>
          </div>
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
              {qwPulledNote ? (
                <p className="text-xs mt-1.5 font-medium" style={{ color: BLUE }}>{qwPulledNote}</p>
              ) : (
                <p className="text-xs mt-1.5" style={{ color: MUTED }}>
                  {qwAvailable ? 'Recent QuickWrench result available (within 24 hrs).' : 'No recent QuickWrench results — run a diagnosis first.'}
                </p>
              )}
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
              <div
                className="grid text-xs font-semibold uppercase tracking-wide px-4 py-2.5"
                style={{ gridTemplateColumns: '1fr 90px 110px 80px 90px 28px', gap: 8, background: '#F9FAFB', color: MUTED, borderBottom: `1px solid ${BORDER}` }}
              >
                <span>Description</span>
                <span className="text-right">Book</span>
                <span className="text-right">Mobile</span>
                <span className="text-right">Rate</span>
                <span className="text-right">Amount</span>
                <span />
              </div>
              {lineItems.map(item => (
                <div
                  key={item.id}
                  className="grid items-center px-4 py-3 gap-2"
                  style={{ gridTemplateColumns: '1fr 90px 110px 80px 90px 28px', borderBottom: `1px solid #F9FAFB` }}
                >
                  {item.type === 'labor' ? (
                    <>
                      {/* Editable description */}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-1.5 py-0.5 rounded font-semibold shrink-0" style={{ background: '#FFF7ED', color: ORANGE }}>LAB</span>
                          <input
                            value={item.description}
                            onChange={e => updateLineDescription(item.id, e.target.value)}
                            style={{ ...lineInp }}
                            aria-label="Labor description"
                          />
                        </div>
                        {item.recharge_added && (
                          <span className="block text-xs mt-0.5 ml-7" style={{ color: '#9A3412' }}>+ refrigeration recovery &amp; recharge</span>
                        )}
                      </div>
                      {/* Editable book hours */}
                      <input
                        type="number" min={0} step={0.25}
                        value={item.book_hours}
                        onChange={e => updateLineHours(item.id, 'book', e.target.value)}
                        style={{ ...lineInp, textAlign: 'right' }}
                        aria-label="Book hours"
                      />
                      {/* Editable mobile hours */}
                      <input
                        type="number" min={0} step={0.25}
                        value={item.mobile_hours}
                        onChange={e => updateLineHours(item.id, 'mobile', e.target.value)}
                        style={{ ...lineInp, textAlign: 'right' }}
                        aria-label="Mobile hours"
                      />
                      <span className="text-xs text-right" style={{ color: MUTED }}>{`${fmt(form.labor_rate)}/hr`}</span>
                      <span className="text-sm font-semibold text-right" style={{ color: TEXT }}>{fmt(item.amount)}</span>
                    </>
                  ) : (
                    <>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-1.5 py-0.5 rounded font-semibold shrink-0" style={{ background: '#EBF5FF', color: BLUE }}>PRT</span>
                          <span className="text-sm" style={{ color: TEXT }}>{item.description}</span>
                        </div>
                        {item.part_number && (
                          <span className="block text-xs font-mono mt-0.5 ml-7" style={{ color: MUTED }}>{item.part_number}</span>
                        )}
                      </div>
                      <span className="text-xs text-right" style={{ color: MUTED }}>{`${item.quantity}×`}</span>
                      <span className="text-xs text-right" style={{ color: MUTED }}>{fmt(item.unit_cost)}</span>
                      <span className="text-xs text-right" style={{ color: MUTED }} />
                      <span className="text-sm font-semibold text-right" style={{ color: TEXT }}>{fmt(item.amount)}</span>
                    </>
                  )}
                  <button onClick={() => removeItem(item.id)} style={{ color: '#9CA3AF', lineHeight: 1 }}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
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

      {/* ─ Labor Modal (HD Suite dark theme) ─ */}
      {laborModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
        >
          <div
            style={{
              background: D_BG,
              border: `1px solid ${D_BORDER}`,
              borderRadius: '12px 12px 0 0',
              width: '100%',
              maxWidth: 540,
              maxHeight: '90dvh',
              display: 'flex',
              flexDirection: 'column',
            }}
            className="sm:rounded-xl"
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0" style={{ borderBottom: `1px solid ${D_BORDER}` }}>
              <h3 className="font-condensed font-bold text-xl" style={{ color: '#FFFFFF' }}>ADD LABOR LINE</h3>
              <button onClick={closeLaborModal} style={{ color: '#8a9bad' }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Scrollable body */}
            <div className="px-5 py-4 flex flex-col gap-4" style={{ overflowY: 'auto' }}>

              {/* Free-text description + live library/catalog results */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#8a9bad' }}>Labor Description</label>
                <input
                  autoFocus
                  style={dInp}
                  placeholder="Type a description or search your library below"
                  value={laborDesc}
                  onChange={e => { setLaborDesc(e.target.value); setLaborSelectedKey(''); setLaborRefrig(null) }}
                />

                {showLaborResults && (
                  <div
                    className="mt-1"
                    style={{ border: `1px solid ${D_BORDER}`, borderRadius: 8, overflow: 'hidden', maxHeight: 240, overflowY: 'auto' }}
                  >
                    {/* Personal library first */}
                    {libMatches.map(i => {
                      const key = `lib:${i.id}`
                      const isSel = laborSelectedKey === key
                      const book = libNum(i.shop_hours)
                      const mob  = libNum(i.mobile_hours)
                      return (
                        <button
                          key={key}
                          onClick={() => selectLibraryItem(i)}
                          className="w-full text-left px-4 py-2.5 flex items-center gap-3"
                          style={{
                            background: isSel ? '#1a2733' : 'transparent',
                            borderLeft: isSel ? `3px solid ${ORANGE}` : '3px solid transparent',
                            borderBottom: `1px solid ${D_BORDER}`,
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: isSel ? ORANGE : '#FFFFFF' }}>{i.description}</p>
                            <p className="text-xs mt-0.5" style={{ color: '#8a9bad' }}>
                              Book: {book != null ? `${book} hrs` : '—'} &nbsp;&bull;&nbsp; Mobile: {mob != null ? `${mob} hrs` : '—'}
                            </p>
                          </div>
                          {/* Only tech's own saved items get the badge; master items look native */}
                          {!i.is_master && (
                            <span className="text-xs px-1.5 py-0.5 rounded font-semibold shrink-0 text-white" style={{ background: BLUE }}>saved</span>
                          )}
                        </button>
                      )
                    })}

                    {/* LABOR_GUIDE fallback suggestions */}
                    {guideMatches.map(item => {
                      const key = `guide:${item.label}`
                      const isSel = laborSelectedKey === key
                      return (
                        <button
                          key={key}
                          onClick={() => selectGuideItem(item)}
                          className="w-full text-left px-4 py-2.5 flex items-center gap-3"
                          style={{
                            background: isSel ? '#1a2733' : 'transparent',
                            borderLeft: isSel ? `3px solid ${ORANGE}` : '3px solid transparent',
                            borderBottom: `1px solid ${D_BORDER}`,
                          }}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: isSel ? ORANGE : '#FFFFFF' }}>{item.label}</p>
                            <p className="text-xs mt-0.5" style={{ color: '#8a9bad' }}>
                              Book: {fmtHrs(item.book_min, item.book_max, item.shop_only)}
                              &nbsp;&bull;&nbsp;
                              Mobile: {fmtHrs(item.mobile_min, item.mobile_max, item.shop_only)}
                              {item.requires_refrigeration && (
                                <span className="ml-2 font-semibold" style={{ color: '#60A5FA' }}>❄ Refrig.</span>
                              )}
                            </p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Editable hours — always visible */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#8a9bad' }}>Book Hours (min / max)</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} step={0.25} value={laborBookMin} onChange={e => setLaborBookMin(e.target.value)} style={{ ...dInp, textAlign: 'center' }} />
                    <span style={{ color: '#8a9bad', fontSize: 12 }}>to</span>
                    <input type="number" min={0} step={0.25} value={laborBookMax} onChange={e => setLaborBookMax(e.target.value)} style={{ ...dInp, textAlign: 'center' }} />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#8a9bad' }}>Mobile Hours (min / max)</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} step={0.25} value={laborMobileMin} onChange={e => setLaborMobileMin(e.target.value)} style={{ ...dInp, textAlign: 'center' }} />
                    <span style={{ color: '#8a9bad', fontSize: 12 }}>to</span>
                    <input type="number" min={0} step={0.25} value={laborMobileMax} onChange={e => setLaborMobileMax(e.target.value)} style={{ ...dInp, textAlign: 'center' }} />
                  </div>
                </div>
              </div>

              {/* Refrigeration: explicit service (separate line) vs fixed-recovery checkbox */}
              {laborRefrig ? (
                <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: '#132132', border: `1px solid ${D_BORDER}` }}>
                  <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="#93C5FD" strokeWidth={2} viewBox="0 0 24 24">
                    <line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/>
                    <path d="M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1"/>
                  </svg>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: '#93C5FD' }}>
                      Separate refrigeration service line will be added
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#8a9bad' }}>
                      Refrigeration Service{laborRefrig.service ? ` ${laborRefrig.service}` : ''} — {laborRefrig.hours} hrs, billed as its own line (not added to base hours)
                    </p>
                  </div>
                </div>
              ) : (
                <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer" style={{ background: '#132132', border: `1px solid ${D_BORDER}` }}>
                  <input
                    type="checkbox"
                    checked={laborRecharge}
                    onChange={e => setLaborRecharge(e.target.checked)}
                    className="mt-0.5 w-4 h-4"
                    style={{ accentColor: BLUE }}
                  />
                  <div>
                    <p className="text-sm font-semibold" style={{ color: '#93C5FD' }}>Add refrigeration recovery &amp; recharge</p>
                    <p className="text-xs mt-0.5" style={{ color: '#8a9bad' }}>Adds 1.5 to 2.5 hrs to mobile field time</p>
                  </div>
                </label>
              )}

              {/* Filter drier reminder */}
              {(laborRecharge || laborRefrig) && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: '#2a2213', border: '1px solid #6b5417' }}>
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="#F59E0B" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  <p className="text-xs font-semibold" style={{ color: '#FCD34D' }}>Remember to add filter drier to the parts list.</p>
                </div>
              )}

              {/* Save to library */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={saveToLibrary}
                  onChange={e => setSaveToLibrary(e.target.checked)}
                  className="w-4 h-4 rounded"
                  style={{ accentColor: ORANGE }}
                />
                <span className="text-sm" style={{ color: '#c9d5e0' }}>Save to my labor library</span>
              </label>

              {/* Amount preview */}
              <div className="p-3 rounded-lg" style={{ background: '#132132', border: `1px solid ${D_BORDER}` }}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium" style={{ color: '#c9d5e0' }}>
                      Mobile: {fmtHrs(totalMobileMin, totalMobileMax)}
                      {laborRecharge && <span className="ml-1">(incl. recharge)</span>}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#8a9bad' }}>
                      Book: {fmtHrs(parseFloat(laborBookMin) || 0, parseFloat(laborBookMax) || (parseFloat(laborBookMin) || 0))} flat rate
                    </p>
                    {laborRefrig && (
                      <p className="text-xs mt-0.5" style={{ color: '#93C5FD' }}>
                        + Refrigeration Service{laborRefrig.service ? ` ${laborRefrig.service}` : ''} — {laborRefrig.hours} hrs (separate line)
                      </p>
                    )}
                  </div>
                  <p className="text-lg font-bold shrink-0" style={{ color: ORANGE }}>
                    {fmtAmtRange(previewAmtMin, previewAmtMax)}
                  </p>
                </div>
              </div>
            </div>

            {/* Footer buttons */}
            <div className="flex gap-3 px-5 pb-5 pt-3 shrink-0" style={{ borderTop: `1px solid ${D_BORDER}` }}>
              <button
                onClick={closeLaborModal}
                className="flex-1 py-2.5 rounded-lg font-semibold text-sm"
                style={{ background: D_INPUT_BG, color: '#c9d5e0', border: `1px solid ${D_BORDER}` }}
              >
                Cancel
              </button>
              <button
                onClick={addLaborItem}
                disabled={!laborDesc.trim()}
                className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white disabled:opacity-40"
                style={{ background: ORANGE }}
              >
                Add Line
              </button>
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
                <button
                  onClick={() => { setPartsModal(false); setParts({ part_number: '', description: '', quantity: '1', unit_cost: '0.00' }); setPartsResults([]) }}
                  className="flex-1 py-2.5 rounded-lg font-semibold text-sm"
                  style={{ background: '#F3F4F6', color: '#374151' }}
                >
                  Cancel
                </button>
                <button onClick={addPartsItem} className="flex-1 py-2.5 rounded-lg font-semibold text-sm text-white" style={{ background: BLUE }}>
                  Add Line
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customer-saved toast (green, auto-dismisses at 3s) */}
      {customerToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-semibold text-white shadow-xl" style={{ background: '#16A34A' }}>
          Customer saved to your contacts
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
