'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Quote, QuoteStatus, LineItem } from '@/types/financials'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined) =>
  n == null
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—'
  return new Date(s + (s.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric',
  })
}

const fmtDateTime = (s: string | null | undefined) => {
  if (!s) return null
  return new Date(s).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function isLaborItem(li: LineItem): boolean {
  return /^labor/i.test((li.description ?? '').trim())
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface EditItem {
  _id:         string
  description: string
  quantity:    number
  unit_price:  number   // BASE price (pre-markup), what the tech paid/sourced
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_META: Record<QuoteStatus, { label: string; bg: string; text: string }> = {
  draft:     { label: 'Draft',     bg: '#6b7280', text: '#ffffff' },
  sent:      { label: 'Sent',      bg: '#2969B0', text: '#ffffff' },
  approved:  { label: 'Approved',  bg: '#10b981', text: '#ffffff' },
  declined:  { label: 'Declined',  bg: '#ef4444', text: '#ffffff' },
  converted: { label: 'Converted', bg: '#8b5cf6', text: '#ffffff' },
  expired:   { label: 'Expired',   bg: '#FF6600', text: '#ffffff' },
}

function StatusBadge({ status }: { status: QuoteStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft
  return (
    <span
      className="px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"
      style={{ backgroundColor: meta.bg, color: meta.text }}
    >
      {meta.label}
    </span>
  )
}

// ─── Filter options ───────────────────────────────────────────────────────────

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '',          label: 'All Statuses' },
  { value: 'draft',     label: 'Draft' },
  { value: 'sent',      label: 'Sent' },
  { value: 'approved',  label: 'Approved' },
  { value: 'declined',  label: 'Declined' },
  { value: 'converted', label: 'Converted' },
  { value: 'expired',   label: 'Expired' },
]

const DATE_RANGE_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '7d',  label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
]

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ msg, type }: { msg: string; type: 'success' | 'error' }) {
  const bg = type === 'success' ? 'border-success/40 bg-success/10 text-success' : 'border-danger/40 bg-danger/10 text-danger'
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl border shadow-2xl text-sm font-semibold whitespace-nowrap ${bg}`}>
      {msg}
    </div>
  )
}

// ─── Vehicle Change Modal ─────────────────────────────────────────────────────

function VehicleChangeModal({
  customerId,
  currentVehicleId,
  onSelect,
  onClose,
}: {
  customerId:       string | null
  currentVehicleId: string | null
  onSelect:         (v: { id: string; year: number | null; make: string; model: string; vin: string | null }) => void
  onClose:          () => void
}) {
  const [vehicles, setVehicles] = useState<{ id: string; year: number | null; make: string; model: string; vin: string | null }[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!customerId) { setLoading(false); return }
    fetch(`/api/vehicles?customer_id=${customerId}&limit=20`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.vehicles) setVehicles(d.vehicles) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [customerId])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-white font-semibold">Change Vehicle</p>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors p-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {loading ? (
          <p className="text-white/30 text-sm text-center py-4">Loading vehicles…</p>
        ) : !customerId ? (
          <p className="text-white/40 text-sm text-center py-4">No customer linked to this quote.</p>
        ) : vehicles.length === 0 ? (
          <p className="text-white/40 text-sm text-center py-4">No vehicles on file for this customer.</p>
        ) : (
          <div className="space-y-2">
            {vehicles.map(v => (
              <button
                key={v.id}
                onClick={() => { onSelect(v); onClose() }}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                  v.id === currentVehicleId
                    ? 'border-orange/50 bg-orange/10'
                    : 'border-white/10 hover:border-white/25 hover:bg-white/5'
                }`}
              >
                <p className="text-white text-sm font-medium">
                  {[v.year, v.make, v.model].filter(Boolean).join(' ')}
                </p>
                {v.vin && <p className="text-white/30 text-[10px] font-mono mt-0.5">{v.vin}</p>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

function QuoteDetailModal({
  quote:      initialQuote,
  onClose,
  onUpdated,
  onDeleted,
}: {
  quote:      Quote
  onClose:    () => void
  onUpdated:  (q: Quote) => void
  onDeleted:  (id: string) => void
}) {
  const isDraft  = initialQuote.status === 'draft'
  const isLocked = !isDraft

  // ── Derive base prices from stored post-markup unit prices ──────────────────
  const initMarkupPct = initialQuote.parts_markup_percent ?? 0
  const [initialItems] = useState<EditItem[]>(() =>
    (initialQuote.line_items ?? [])
      .filter(li => !isLaborItem(li))
      .map((li, i) => ({
        _id:         `li-${i}`,
        description: li.description,
        quantity:    li.quantity,
        unit_price:  initMarkupPct > 0
          ? round2(li.unit_price / (1 + initMarkupPct / 100))
          : li.unit_price,
      }))
  )
  const [initLaborHours] = useState(initialQuote.labor_hours ?? 0)
  const [initLaborRate]  = useState(initialQuote.labor_rate  ?? 125)
  const [initMarkup]     = useState(initialQuote.parts_markup_percent ?? 20)
  const [initTaxPct]     = useState(initialQuote.tax_percent ?? 8.5)
  const [initNotes]      = useState(initialQuote.notes ?? '')
  const [initCustName]   = useState(
    initialQuote.customer
      ? `${initialQuote.customer.first_name} ${initialQuote.customer.last_name}`.trim()
      : ''
  )
  const [initCustPhone]  = useState(initialQuote.customer?.phone ?? '')

  // ── Edit state ─────────────────────────────────────────────────────────────
  const [items,       setItems]       = useState<EditItem[]>(initialItems)
  const [laborHours,  setLaborHours]  = useState(initLaborHours)
  const [laborRate,   setLaborRate]   = useState(initLaborRate)
  const [markupPct,   setMarkupPct]   = useState(initMarkup)
  const [taxPct,      setTaxPct]      = useState(initTaxPct)
  const [notes,       setNotes]       = useState(initNotes)
  const [custName,    setCustName]    = useState(initCustName)
  const [custPhone,   setCustPhone]   = useState(initCustPhone)
  const [vehicleId,   setVehicleId]   = useState<string | null>(initialQuote.vehicle_id)
  const [vehicle,     setVehicle]     = useState(initialQuote.vehicle)

  // ── Inline line-item editing ───────────────────────────────────────────────
  const [editingId,     setEditingId]     = useState<string | null>(null)
  const [editingVals,   setEditingVals]   = useState({ description: '', quantity: 1, unit_price: 0 })
  const [addingNew,     setAddingNew]     = useState(false)
  const [newItemVals,   setNewItemVals]   = useState({ description: '', quantity: 1, unit_price: 0 })

  // ── Vehicle change modal ───────────────────────────────────────────────────
  const [showVehicleModal, setShowVehicleModal] = useState(false)

  // ── UI state ───────────────────────────────────────────────────────────────
  const [saving,            setSaving]            = useState(false)
  const [cloning,           setCloning]           = useState(false)
  const [deleting,          setDeleting]           = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [toast,             setToast]             = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [validationErr,     setValidationErr]     = useState<string | null>(null)

  // ── Dirty detection ────────────────────────────────────────────────────────
  function makeHash(
    its: EditItem[], lh: number, lr: number, mp: number, tp: number,
    n: string, cn: string, cp: string, vid: string | null,
  ) {
    return JSON.stringify({ its: its.map(x => ({ d: x.description, q: x.quantity, p: x.unit_price })), lh, lr, mp, tp, n, cn, cp, vid })
  }
  const [savedHash, setSavedHash] = useState(() =>
    makeHash(initialItems, initLaborHours, initLaborRate, initMarkup, initTaxPct, initNotes, initCustName, initCustPhone, initialQuote.vehicle_id)
  )
  const currentHash = makeHash(items, laborHours, laborRate, markupPct, taxPct, notes, custName, custPhone, vehicleId)
  const isDirty = isDraft && currentHash !== savedHash

  // ── Live calculations ──────────────────────────────────────────────────────
  const partsBase     = items.reduce((s, li) => s + li.quantity * li.unit_price, 0)
  const markupAmt     = partsBase * (markupPct / 100)
  const partsTotal    = partsBase + markupAmt
  const laborSubtotal = (laborHours || 0) * (laborRate || 0)
  const subtotal      = partsTotal + laborSubtotal
  const taxAmount     = subtotal * ((taxPct || 0) / 100)
  const grandTotal    = subtotal + taxAmount

  // ── Prevent accidental navigation when dirty ───────────────────────────────
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // ── Toast helper ───────────────────────────────────────────────────────────
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    if (toastRef.current) clearTimeout(toastRef.current)
    setToast({ msg, type })
    toastRef.current = setTimeout(() => setToast(null), 3500)
  }

  // ── Item editing helpers ───────────────────────────────────────────────────
  function startEditItem(item: EditItem) {
    setEditingId(item._id)
    setEditingVals({ description: item.description, quantity: item.quantity, unit_price: item.unit_price })
  }

  function commitEditItem() {
    if (!editingVals.description.trim()) return
    setItems(prev => prev.map(li =>
      li._id === editingId
        ? { ...li, description: editingVals.description.trim(), quantity: editingVals.quantity, unit_price: editingVals.unit_price }
        : li
    ))
    setEditingId(null)
  }

  function removeItem(id: string) {
    setItems(prev => prev.filter(li => li._id !== id))
    if (editingId === id) setEditingId(null)
  }

  function commitNewItem() {
    if (!newItemVals.description.trim()) return
    setItems(prev => [...prev, {
      _id:         `new-${Date.now()}`,
      description: newItemVals.description.trim(),
      quantity:    newItemVals.quantity,
      unit_price:  newItemVals.unit_price,
    }])
    setNewItemVals({ description: '', quantity: 1, unit_price: 0 })
    setAddingNew(false)
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate(): string | null {
    if (grandTotal < 0)
      return 'Grand total cannot be negative.'
    if (items.some(li => li.quantity < 0 || li.unit_price < 0))
      return 'Line items cannot have negative quantity or price.'
    if (laborHours < 0 || laborRate < 0)
      return 'Labor hours and rate cannot be negative.'
    if (items.length === 0 && (laborHours || 0) <= 0)
      return 'At least one line item or labor time is required.'
    return null
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    const err = validate()
    if (err) { setValidationErr(err); return }
    setValidationErr(null)
    setSaving(true)

    const markup = markupPct / 100
    const savedLineItems = [
      ...items.map(li => ({
        description: li.description,
        quantity:    li.quantity,
        unit_price:  round2(li.unit_price * (1 + markup)),
        total:       round2(li.quantity * li.unit_price * (1 + markup)),
      })),
      ...(laborHours > 0 ? [{
        description: 'Labor',
        quantity:    laborHours,
        unit_price:  laborRate,
        total:       round2(laborHours * laborRate),
      }] : []),
    ]

    try {
      const res  = await fetch(`/api/quotes/${initialQuote.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          line_items:           savedLineItems,
          labor_hours:          laborHours,
          labor_rate:           laborRate,
          parts_subtotal:       round2(partsBase),
          parts_markup_percent: markupPct,
          labor_subtotal:       round2(laborSubtotal),
          tax_percent:          taxPct,
          tax_amount:           round2(taxAmount),
          grand_total:          round2(grandTotal),
          notes,
          customer_name:        custName,
          customer_phone:       custPhone,
          vehicle_id:           vehicleId,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setSavedHash(currentHash)
      showToast(`Quote updated — ${json.quote.quote_number}`)
      onUpdated(json.quote)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Cancel ─────────────────────────────────────────────────────────────────
  function handleCancel() {
    if (isDirty) {
      if (!window.confirm('Discard unsaved changes?')) return
    }
    setItems(initialItems)
    setLaborHours(initLaborHours)
    setLaborRate(initLaborRate)
    setMarkupPct(initMarkup)
    setTaxPct(initTaxPct)
    setNotes(initNotes)
    setCustName(initCustName)
    setCustPhone(initCustPhone)
    setVehicleId(initialQuote.vehicle_id)
    setVehicle(initialQuote.vehicle)
    setEditingId(null)
    setAddingNew(false)
    setValidationErr(null)
  }

  // ── Clone to new version ───────────────────────────────────────────────────
  async function handleClone() {
    setCloning(true)
    try {
      const res  = await fetch(`/api/quotes/${initialQuote.id}/clone`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Clone failed')
      showToast(`New version created — ${json.quote.quote_number}`)
      onUpdated(json.quote)  // open the new clone in the modal
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to create new version', 'error')
    } finally {
      setCloning(false)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/quotes/${initialQuote.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Delete failed')
      }
      onDeleted(initialQuote.id)
      onClose()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to delete', 'error')
      setShowDeleteConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  // ── Reopen in QuickWrench ──────────────────────────────────────────────────
  function handleReopenInQW() {
    if (isDirty) {
      if (!window.confirm('You have unsaved changes. Discard and open in QuickWrench?')) return
    }
    window.location.href = `/quickwrench?loadQuoteId=${initialQuote.id}`
  }

  // ── Close guard ────────────────────────────────────────────────────────────
  function handleClose() {
    if (isDirty && !window.confirm('You have unsaved changes. Discard?')) return
    onClose()
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  const vehicleLabel = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
    : '—'

  const jobDesc = [initialQuote.job_category, initialQuote.job_subtype].filter(Boolean).join(' / ') || '—'

  const timeline: { label: string; ts: string | null }[] = [
    { label: 'Created',   ts: initialQuote.created_at },
    { label: 'Sent',      ts: initialQuote.sent_at },
    { label: 'Approved',  ts: initialQuote.approved_at },
    { label: 'Declined',  ts: initialQuote.declined_at },
    { label: 'Converted', ts: initialQuote.converted_at },
  ].filter(e => e.ts)

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
        onClick={e => { if (e.target === e.currentTarget) handleClose() }}
      >
        <div className="relative w-full max-w-2xl bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl my-8">

          {/* ── Header ── */}
          <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-white/10">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-condensed font-bold text-2xl text-white tracking-wide">
                  {initialQuote.quote_number}
                </span>
                <StatusBadge status={initialQuote.status as QuoteStatus} />
                {isDirty && (
                  <span className="flex items-center gap-1 text-xs text-orange/80 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange animate-pulse" />
                    Editing
                  </span>
                )}
              </div>
              <p className="text-white/40 text-sm mt-1">{fmtDate(initialQuote.created_at)}</p>
            </div>
            <button
              onClick={handleClose}
              className="flex-shrink-0 p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* ── Parent version banner ── */}
          {initialQuote.parent_quote_id && (
            <div className="mx-6 mt-4 flex items-center gap-2 px-4 py-2.5 rounded-lg border border-orange/20 bg-orange/5">
              <svg className="w-3.5 h-3.5 text-orange/60 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <polyline points="15 10 20 15 15 20" />
                <path d="M4 4v7a4 4 0 0 0 4 4h12" />
              </svg>
              <p className="text-orange/70 text-xs">New version — edited from a previous quote</p>
            </div>
          )}

          {/* ── Locked-quote banner ── */}
          {isLocked && (
            <div className="mx-6 mt-4 flex items-center gap-2 px-4 py-2.5 rounded-lg border border-white/10 bg-white/5">
              <svg className="w-3.5 h-3.5 text-white/40 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <p className="text-white/40 text-xs">This quote is locked. Use &ldquo;Edit as New Version&rdquo; to make changes.</p>
            </div>
          )}

          <div className="px-6 py-5 space-y-6">

            {/* ── Customer ── */}
            <div className="space-y-2">
              <p className="text-white/30 text-xs uppercase tracking-widest">Customer</p>
              {isDraft ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="nwi-label">Name <span className="normal-case text-white/20">(optional)</span></label>
                    <input
                      className="nwi-input"
                      placeholder="John Smith"
                      value={custName}
                      onChange={e => setCustName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="nwi-label">Phone <span className="normal-case text-white/20">(optional)</span></label>
                    <input
                      className="nwi-input"
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      value={custPhone}
                      onChange={e => setCustPhone(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-white font-medium">
                    {initialQuote.customer
                      ? `${initialQuote.customer.first_name} ${initialQuote.customer.last_name}`
                      : '—'}
                  </p>
                  {initialQuote.customer?.phone && (
                    <p className="text-white/50 text-sm">{initialQuote.customer.phone}</p>
                  )}
                  {initialQuote.customer?.email && (
                    <p className="text-white/50 text-sm">{initialQuote.customer.email}</p>
                  )}
                </div>
              )}
            </div>

            {/* ── Vehicle ── */}
            <div className="space-y-2">
              <p className="text-white/30 text-xs uppercase tracking-widest">Vehicle</p>
              {isDraft ? (
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium">{vehicleLabel}</p>
                    {vehicle?.vin && (
                      <p className="text-white/30 text-xs font-mono mt-0.5">{vehicle.vin}</p>
                    )}
                  </div>
                  {initialQuote.customer_id && (
                    <button
                      onClick={() => setShowVehicleModal(true)}
                      className="flex-shrink-0 px-3 py-1.5 text-xs border border-white/20 hover:border-orange/40 hover:text-orange text-white/60 rounded-lg transition-colors"
                    >
                      Change Vehicle
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-white font-medium">{vehicleLabel}</p>
                  {initialQuote.vehicle?.vin && (
                    <p className="text-white/40 text-xs font-mono">{initialQuote.vehicle.vin}</p>
                  )}
                </div>
              )}
            </div>

            {/* ── Job ── */}
            <div className="space-y-1">
              <p className="text-white/30 text-xs uppercase tracking-widest">Job Description</p>
              <p className="text-white">{jobDesc}</p>
            </div>

            {/* ── Line Items ── */}
            <div className="space-y-3">
              <p className="text-white/30 text-xs uppercase tracking-widest">Line Items</p>

              {isDraft ? (
                <div className="rounded-xl border border-white/10 overflow-hidden">
                  {/* Header row */}
                  <div className="grid grid-cols-[1fr_56px_80px_80px_52px] gap-1 px-3 py-2 border-b border-white/10 bg-white/5">
                    <span className="text-white/30 text-[10px] uppercase tracking-wider">Part / Description</span>
                    <span className="text-white/30 text-[10px] uppercase tracking-wider text-right">Qty</span>
                    <span className="text-white/30 text-[10px] uppercase tracking-wider text-right">Base Price</span>
                    <span className="text-white/30 text-[10px] uppercase tracking-wider text-right">Total</span>
                    <span />
                  </div>

                  {/* Existing items */}
                  {items.length === 0 && !addingNew && (
                    <div className="px-4 py-4 text-white/25 text-sm text-center">
                      No parts — add one below or skip if labor-only.
                    </div>
                  )}

                  {items.map(li => (
                    <div key={li._id} className="border-b border-white/5 last:border-0">
                      {editingId === li._id ? (
                        /* Inline edit form */
                        <div className="p-3 space-y-2 bg-orange/5">
                          <input
                            autoFocus
                            className="nwi-input text-sm w-full"
                            placeholder="Part name"
                            value={editingVals.description}
                            onChange={e => setEditingVals(v => ({ ...v, description: e.target.value }))}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="nwi-label text-[10px]">Qty</label>
                              <input
                                type="number" min={0} step={1}
                                className="nwi-input text-sm"
                                value={editingVals.quantity}
                                onChange={e => setEditingVals(v => ({ ...v, quantity: Number(e.target.value) || 0 }))}
                              />
                            </div>
                            <div>
                              <label className="nwi-label text-[10px]">Base Price ($)</label>
                              <input
                                type="number" min={0} step={0.01}
                                className="nwi-input text-sm"
                                value={editingVals.unit_price}
                                onChange={e => setEditingVals(v => ({ ...v, unit_price: Number(e.target.value) || 0 }))}
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={commitEditItem}
                              className="px-3 py-1.5 bg-orange hover:bg-orange-hover text-white text-xs font-semibold rounded-lg transition-colors"
                            >
                              Apply
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="px-3 py-1.5 border border-white/15 text-white/50 hover:text-white text-xs rounded-lg transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* View row */
                        <div className="grid grid-cols-[1fr_56px_80px_80px_52px] gap-1 items-center px-3 py-2.5 hover:bg-white/[0.03]">
                          <span className="text-white/80 text-sm truncate">{li.description}</span>
                          <span className="text-white/50 text-sm text-right">{li.quantity}</span>
                          <span className="text-white/50 text-sm text-right">{fmt(li.unit_price)}</span>
                          <span className="text-white text-sm font-medium text-right">
                            {fmt(li.quantity * li.unit_price)}
                          </span>
                          <div className="flex items-center justify-end gap-0.5">
                            <button
                              onClick={() => startEditItem(li)}
                              className="p-1.5 text-white/25 hover:text-orange transition-colors rounded"
                              title="Edit item"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </button>
                            <button
                              onClick={() => removeItem(li._id)}
                              className="p-1.5 text-white/25 hover:text-danger transition-colors rounded"
                              title="Remove item"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                <path d="M10 11v6M14 11v6"/>
                                <path d="M9 6V4h6v2"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Add new item row */}
                  {addingNew ? (
                    <div className="p-3 space-y-2 bg-white/5 border-t border-white/10">
                      <input
                        autoFocus
                        className="nwi-input text-sm w-full"
                        placeholder="Part name or description"
                        value={newItemVals.description}
                        onChange={e => setNewItemVals(v => ({ ...v, description: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') commitNewItem() }}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="nwi-label text-[10px]">Qty</label>
                          <input
                            type="number" min={0} step={1}
                            className="nwi-input text-sm"
                            value={newItemVals.quantity}
                            onChange={e => setNewItemVals(v => ({ ...v, quantity: Number(e.target.value) || 0 }))}
                          />
                        </div>
                        <div>
                          <label className="nwi-label text-[10px]">Base Price ($)</label>
                          <input
                            type="number" min={0} step={0.01}
                            className="nwi-input text-sm"
                            value={newItemVals.unit_price}
                            onChange={e => setNewItemVals(v => ({ ...v, unit_price: Number(e.target.value) || 0 }))}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={commitNewItem}
                          className="px-3 py-1.5 bg-orange hover:bg-orange-hover text-white text-xs font-semibold rounded-lg transition-colors"
                        >
                          Add Item
                        </button>
                        <button
                          onClick={() => { setAddingNew(false); setNewItemVals({ description: '', quantity: 1, unit_price: 0 }) }}
                          className="px-3 py-1.5 border border-white/15 text-white/50 hover:text-white text-xs rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAddingNew(true); setEditingId(null) }}
                      className="w-full flex items-center gap-2 px-4 py-3 text-white/40 hover:text-orange hover:bg-white/5 text-xs transition-colors border-t border-white/5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Add Line Item
                    </button>
                  )}
                </div>
              ) : (
                /* Locked: read-only table */
                Array.isArray(initialQuote.line_items) && initialQuote.line_items.length > 0 && (
                  <div className="bg-white/5 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left px-4 py-2.5 text-white/40 font-medium">Description</th>
                          <th className="text-right px-4 py-2.5 text-white/40 font-medium">Qty</th>
                          <th className="text-right px-4 py-2.5 text-white/40 font-medium">Unit</th>
                          <th className="text-right px-4 py-2.5 text-white/40 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {initialQuote.line_items.map((li, i) => (
                          <tr key={i} className="border-b border-white/5 last:border-0">
                            <td className="px-4 py-2.5 text-white/80">{li.description}</td>
                            <td className="px-4 py-2.5 text-white/60 text-right">{li.quantity}</td>
                            <td className="px-4 py-2.5 text-white/60 text-right">{fmt(li.unit_price)}</td>
                            <td className="px-4 py-2.5 text-white font-medium text-right">{fmt(li.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>

            {/* ── Labor ── */}
            {isDraft ? (
              <div className="space-y-2">
                <p className="text-white/30 text-xs uppercase tracking-widest">Labor</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="nwi-label">Hours</label>
                    <input
                      type="number" min={0} step={0.25}
                      className="nwi-input"
                      value={laborHours}
                      onChange={e => setLaborHours(Number(e.target.value) || 0)}
                    />
                  </div>
                  <div>
                    <label className="nwi-label">Rate $/hr</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">$</span>
                      <input
                        type="number" min={0} step={5}
                        className="nwi-input pl-7"
                        value={laborRate}
                        onChange={e => setLaborRate(Number(e.target.value) || 0)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="nwi-label">Subtotal</label>
                    <div className="nwi-input bg-white/5 text-white/60 pointer-events-none">
                      {fmt(laborSubtotal)}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              initialQuote.labor_subtotal != null && (
                <div className="space-y-1">
                  <p className="text-white/30 text-xs uppercase tracking-widest">Labor</p>
                  <p className="text-white/70 text-sm">
                    {initialQuote.labor_hours != null && initialQuote.labor_rate != null
                      ? `${initialQuote.labor_hours}h × ${fmt(initialQuote.labor_rate)}/hr = `
                      : ''}
                    <span className="text-white font-medium">{fmt(initialQuote.labor_subtotal)}</span>
                  </p>
                </div>
              )
            )}

            {/* ── Pricing settings (draft only) ── */}
            {isDraft && (
              <div className="space-y-2">
                <p className="text-white/30 text-xs uppercase tracking-widest">Pricing Settings</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="nwi-label">Parts Markup %</label>
                    <div className="relative">
                      <input
                        type="number" min={0} step={1}
                        className="nwi-input pr-7"
                        value={markupPct}
                        onChange={e => setMarkupPct(Number(e.target.value) || 0)}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">%</span>
                    </div>
                  </div>
                  <div>
                    <label className="nwi-label">Tax Rate %</label>
                    <div className="relative">
                      <input
                        type="number" min={0} step={0.25}
                        className="nwi-input pr-7"
                        value={taxPct}
                        onChange={e => setTaxPct(Number(e.target.value) || 0)}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">%</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Notes ── */}
            {isDraft ? (
              <div className="space-y-2">
                <p className="text-white/30 text-xs uppercase tracking-widest">Notes</p>
                <textarea
                  rows={3}
                  className="nwi-input resize-y text-sm w-full"
                  placeholder="Add notes for this quote…"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>
            ) : (
              initialQuote.notes && (
                <div className="space-y-1">
                  <p className="text-white/30 text-xs uppercase tracking-widest">Notes</p>
                  <p className="text-white/70 text-sm whitespace-pre-wrap">{initialQuote.notes}</p>
                </div>
              )
            )}

            {/* ── Financial breakdown ── */}
            <div className="bg-white/5 rounded-xl p-4 space-y-2.5">
              <p className="text-white/30 text-xs uppercase tracking-widest mb-3">Financial Breakdown</p>

              {isDraft ? (
                /* Live-updating edit-mode breakdown */
                <>
                  {partsBase > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-white/60">Parts Base</span>
                      <span className="text-white">{fmt(partsBase)}</span>
                    </div>
                  )}
                  {markupPct > 0 && partsBase > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-white/40">Parts Markup ({markupPct}%)</span>
                      <span className="text-white/60">+{fmt(markupAmt)}</span>
                    </div>
                  )}
                  {laborSubtotal > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-white/60">
                        Labor ({laborHours}h × {fmt(laborRate)}/hr)
                      </span>
                      <span className="text-white">{fmt(laborSubtotal)}</span>
                    </div>
                  )}
                  {taxPct > 0 && (
                    <div className="flex justify-between text-sm border-t border-white/10 pt-2.5">
                      <span className="text-white/40">Tax ({taxPct}%)</span>
                      <span className="text-white/60">{fmt(taxAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-baseline border-t border-white/10 pt-3">
                    <span className="font-condensed font-bold text-white text-lg tracking-wide">GRAND TOTAL</span>
                    <span className={`font-condensed font-bold text-3xl ${grandTotal < 0 ? 'text-danger' : 'text-orange'}`}>
                      {fmt(grandTotal)}
                    </span>
                  </div>
                </>
              ) : (
                /* Static read-only breakdown from DB values */
                <>
                  {initialQuote.parts_subtotal != null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-white/60">Parts Subtotal</span>
                      <span className="text-white">{fmt(initialQuote.parts_subtotal)}</span>
                    </div>
                  )}
                  {initialQuote.parts_markup_percent != null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-white/40">Parts Markup ({initialQuote.parts_markup_percent}%)</span>
                      <span className="text-white/60">
                        {initialQuote.parts_subtotal != null
                          ? fmt(initialQuote.parts_subtotal * (initialQuote.parts_markup_percent / 100))
                          : '—'}
                      </span>
                    </div>
                  )}
                  {initialQuote.labor_subtotal != null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-white/60">
                        Labor{initialQuote.labor_hours != null && initialQuote.labor_rate != null
                          ? ` (${initialQuote.labor_hours}h × ${fmt(initialQuote.labor_rate)}/hr)`
                          : ''}
                      </span>
                      <span className="text-white">{fmt(initialQuote.labor_subtotal)}</span>
                    </div>
                  )}
                  {initialQuote.tax_amount != null && (
                    <div className="flex justify-between text-sm border-t border-white/10 pt-2.5">
                      <span className="text-white/40">
                        Tax{initialQuote.tax_percent != null ? ` (${initialQuote.tax_percent}%)` : ''}
                      </span>
                      <span className="text-white/60">{fmt(initialQuote.tax_amount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-baseline border-t border-white/10 pt-3">
                    <span className="font-condensed font-bold text-white text-lg tracking-wide">GRAND TOTAL</span>
                    <span className="font-condensed font-bold text-orange text-3xl">{fmt(initialQuote.grand_total)}</span>
                  </div>
                </>
              )}
            </div>

            {/* ── Validation error ── */}
            {validationErr && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-danger/30 bg-danger/10 text-danger text-sm">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {validationErr}
              </div>
            )}

            {/* ── Status timeline (locked) ── */}
            {isLocked && timeline.length > 0 && (
              <div className="space-y-2">
                <p className="text-white/30 text-xs uppercase tracking-widest">Timeline</p>
                <div className="space-y-1.5">
                  {timeline.map(({ label, ts }) => (
                    <div key={label} className="flex items-center justify-between text-sm">
                      <span className="text-white/50">{label}</span>
                      <span className="text-white/70">{fmtDateTime(ts)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Action buttons ── */}
            <div className="flex flex-wrap gap-3 pt-2 border-t border-white/10">
              {isDraft ? (
                <>
                  {/* Save Changes */}
                  <button
                    onClick={handleSave}
                    disabled={saving || grandTotal < 0}
                    className={`flex items-center gap-2 px-5 py-2.5 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-all ${
                      isDirty
                        ? 'bg-orange hover:bg-orange-hover shadow-lg shadow-orange/20'
                        : 'bg-orange/60 hover:bg-orange/80'
                    } disabled:opacity-40`}
                  >
                    {saving ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        Saving…
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                          <polyline points="17 21 17 13 7 13 7 21"/>
                          <polyline points="7 3 7 8 15 8"/>
                        </svg>
                        Save Changes
                      </>
                    )}
                  </button>

                  {/* Cancel */}
                  {isDirty && (
                    <button
                      onClick={handleCancel}
                      className="px-4 py-2.5 border border-white/15 text-white/60 hover:text-white hover:border-white/30 text-sm font-medium rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  )}

                  {/* Reopen in QuickWrench */}
                  <button
                    onClick={handleReopenInQW}
                    className="flex items-center gap-2 px-4 py-2.5 border border-blue/30 bg-blue/10 hover:bg-blue/20 text-blue-light text-sm font-medium rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                    </svg>
                    Reopen in QuickWrench
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="ml-auto flex items-center gap-1.5 px-3 py-2.5 text-danger/60 hover:text-danger text-sm rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    </svg>
                    Delete
                  </button>
                </>
              ) : (
                <>
                  {/* Edit as New Version */}
                  <button
                    onClick={handleClone}
                    disabled={cloning}
                    className="flex items-center gap-2 px-5 py-2.5 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors"
                  >
                    {cloning ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        Creating…
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        Edit as New Version
                      </>
                    )}
                  </button>

                  {/* Reopen in QuickWrench */}
                  <button
                    onClick={handleReopenInQW}
                    className="flex items-center gap-2 px-4 py-2.5 border border-blue/30 bg-blue/10 hover:bg-blue/20 text-blue-light text-sm font-medium rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                    </svg>
                    Reopen in QuickWrench
                  </button>
                </>
              )}
            </div>

          </div>{/* end scrollable content */}
        </div>{/* end modal card */}
      </div>{/* end overlay */}

      {/* ── Delete confirmation ── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm bg-[#1a1a1a] border border-danger/30 rounded-2xl p-6 space-y-4">
            <p className="text-white font-semibold">Delete this quote?</p>
            <p className="text-white/50 text-sm">
              <span className="font-mono text-orange">{initialQuote.quote_number}</span> will be permanently removed. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-danger hover:bg-danger/80 disabled:opacity-50 text-white font-semibold text-sm rounded-lg transition-colors"
              >
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2.5 border border-white/15 text-white/60 hover:text-white text-sm rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Vehicle change modal ── */}
      {showVehicleModal && (
        <VehicleChangeModal
          customerId={initialQuote.customer_id}
          currentVehicleId={vehicleId}
          onSelect={v => {
            setVehicleId(v.id)
            setVehicle({ id: v.id, year: v.year, make: v.make, model: v.model, vin: v.vin })
          }}
          onClose={() => setShowVehicleModal(false)}
        />
      )}

      {/* ── Toast ── */}
      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function QuotesTab({ initialQuoteId }: { initialQuoteId?: string }) {
  const [quotes,       setQuotes]       = useState<Quote[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [dateRange,    setDateRange]    = useState('all')
  const [search,       setSearch]       = useState('')
  const [selected,     setSelected]     = useState<Quote | null>(null)
  const [modalKey,     setModalKey]     = useState(0)

  const loadQuotes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (dateRange && dateRange !== 'all') params.set('date_range', dateRange)

      const res  = await fetch(`/api/quotes?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load quotes')
      setQuotes(json.quotes ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, dateRange])

  useEffect(() => { loadQuotes() }, [loadQuotes])

  // Open initial quote if navigated here with ?quote=
  useEffect(() => {
    if (initialQuoteId && quotes.length > 0 && !selected) {
      const match = quotes.find(q => q.id === initialQuoteId)
      if (match) setSelected(match)
    }
  }, [initialQuoteId, quotes, selected])

  // When an in-modal save returns an updated quote, swap it into the list and
  // force the modal to remount so its state re-derives from the fresh quote.
  function handleQuoteUpdated(updatedQuote: Quote) {
    setQuotes(qs => qs.map(q => q.id === updatedQuote.id ? updatedQuote : q))
    setSelected(updatedQuote)
    setModalKey(k => k + 1)
  }

  function handleQuoteDeleted(deletedId: string) {
    setQuotes(qs => qs.filter(q => q.id !== deletedId))
    setSelected(null)
  }

  // Client-side search filtering
  const visible = quotes.filter(q => {
    if (!search.trim()) return true
    const s = search.toLowerCase()
    const customerName = q.customer
      ? `${q.customer.first_name} ${q.customer.last_name}`.toLowerCase()
      : ''
    const vin = q.vehicle?.vin?.toLowerCase() ?? ''
    return (
      q.quote_number.toLowerCase().includes(s) ||
      customerName.includes(s) ||
      vin.includes(s)
    )
  })

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="nwi-input text-sm py-2 min-w-[140px]"
        >
          {STATUS_FILTERS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        <select
          value={dateRange}
          onChange={e => setDateRange(e.target.value)}
          className="nwi-input text-sm py-2 min-w-[140px]"
        >
          {DATE_RANGE_FILTERS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[200px]">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30"
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            placeholder="Search by customer, quote #, or VIN…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="nwi-input pl-9 text-sm py-2 w-full"
          />
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-white/30 text-sm">
          Loading quotes…
        </div>
      ) : error ? (
        <div className="px-4 py-3 rounded-lg border border-danger/30 bg-danger/10 text-danger text-sm">
          {error}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <svg className="w-10 h-10 text-white/20" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
          </svg>
          <p className="text-white/40 text-sm">
            {quotes.length === 0
              ? 'No quotes yet. Build one in QuickWrench and save as a quote.'
              : 'No quotes match your current filters.'}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/5 border-b border-white/10">
                  <th className="text-left px-4 py-3 text-white/40 font-medium whitespace-nowrap">Quote #</th>
                  <th className="text-left px-4 py-3 text-white/40 font-medium whitespace-nowrap">Date</th>
                  <th className="text-left px-4 py-3 text-white/40 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 text-white/40 font-medium">Vehicle</th>
                  <th className="text-left px-4 py-3 text-white/40 font-medium">Job</th>
                  <th className="text-right px-4 py-3 text-white/40 font-medium whitespace-nowrap">Total</th>
                  <th className="text-left px-4 py-3 text-white/40 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((q, i) => {
                  const customerName = q.customer
                    ? `${q.customer.first_name} ${q.customer.last_name}`
                    : '—'
                  const vehicleLabel = q.vehicle
                    ? [q.vehicle.year, q.vehicle.make, q.vehicle.model].filter(Boolean).join(' ')
                    : '—'
                  const jobDesc = [q.job_category, q.job_subtype].filter(Boolean).join(' / ') || '—'

                  return (
                    <tr
                      key={q.id}
                      onClick={() => { setSelected(q); setModalKey(0) }}
                      className={`
                        border-b border-white/5 last:border-0 cursor-pointer transition-colors
                        hover:bg-white/5
                        ${i % 2 === 0 ? '' : 'bg-white/[0.02]'}
                      `}
                    >
                      <td className="px-4 py-3 font-mono text-orange text-xs font-medium">{q.quote_number}</td>
                      <td className="px-4 py-3 text-white/60 whitespace-nowrap">{fmtDate(q.created_at)}</td>
                      <td className="px-4 py-3 text-white">{customerName}</td>
                      <td className="px-4 py-3 text-white/70 whitespace-nowrap">{vehicleLabel}</td>
                      <td className="px-4 py-3 text-white/60 max-w-[200px] truncate">{jobDesc}</td>
                      <td className="px-4 py-3 text-white font-medium text-right whitespace-nowrap">
                        {fmt(q.grand_total)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={q.status as QuoteStatus} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {visible.map(q => {
              const customerName = q.customer
                ? `${q.customer.first_name} ${q.customer.last_name}`
                : '—'
              const vehicleLabel = q.vehicle
                ? [q.vehicle.year, q.vehicle.make, q.vehicle.model].filter(Boolean).join(' ')
                : '—'
              const jobDesc = [q.job_category, q.job_subtype].filter(Boolean).join(' / ') || '—'

              return (
                <button
                  key={q.id}
                  onClick={() => { setSelected(q); setModalKey(0) }}
                  className="w-full text-left nwi-card hover:border-white/20 transition-colors min-h-[48px]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-mono text-orange text-xs font-medium">{q.quote_number}</span>
                        <StatusBadge status={q.status as QuoteStatus} />
                      </div>
                      <p className="text-white font-medium text-sm truncate">{customerName}</p>
                      <p className="text-white/50 text-xs">{vehicleLabel}</p>
                      <p className="text-white/40 text-xs truncate">{jobDesc}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-condensed font-bold text-orange text-lg">{fmt(q.grand_total)}</p>
                      <p className="text-white/30 text-xs">{fmtDate(q.created_at)}</p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          <p className="text-white/20 text-xs text-right">
            {visible.length} quote{visible.length !== 1 ? 's' : ''}
            {visible.length !== quotes.length ? ` (${quotes.length} total)` : ''}
          </p>
        </>
      )}

      {selected && (
        <QuoteDetailModal
          key={`${selected.id}-${modalKey}`}
          quote={selected}
          onClose={() => setSelected(null)}
          onUpdated={handleQuoteUpdated}
          onDeleted={handleQuoteDeleted}
        />
      )}
    </div>
  )
}
