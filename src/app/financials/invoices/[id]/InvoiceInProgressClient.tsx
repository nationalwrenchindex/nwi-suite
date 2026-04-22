'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Invoice, ShopSupplyItem, AdditionalPartItem, AdditionalLaborItem } from '@/types/financials'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function uuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ msg, type }: { msg: string; type: 'success' | 'error' }) {
  return (
    <div className={`fixed bottom-24 sm:bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl border shadow-2xl text-sm font-semibold whitespace-nowrap ${
      type === 'success'
        ? 'border-success/40 bg-success/10 text-success'
        : 'border-danger/40 bg-danger/10 text-danger'
    }`}>
      {msg}
    </div>
  )
}

// ─── Section card wrapper ─────────────────────────────────────────────────────

function Section({ label, children, action }: {
  label: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="bg-[#222222] border border-white/8 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/8 bg-white/[0.02]">
        <p className="text-white/50 text-xs font-semibold uppercase tracking-widest">{label}</p>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ─── Diagnostics panel ───────────────────────────────────────────────────────

function DiagnosticsPanel({ vin, onClose }: { vin: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  function copyVin() {
    if (!vin) return
    navigator.clipboard.writeText(vin).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const tools = [
    { label: 'DTC Lookup',     icon: '🔍', hint: 'Diagnostic trouble codes' },
    { label: 'Recall Lookup',  icon: '⚠️', hint: 'NHTSA recall database' },
    { label: 'Known Issues',   icon: '📋', hint: 'Common complaints by model' },
    { label: 'Fluid Specs',    icon: '🛢️', hint: 'Oil, coolant, brake fluid' },
    { label: 'Tire Specs',     icon: '⭕', hint: 'Size, torque, pressure' },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <p className="text-white font-semibold">Diagnostic Tools</p>
            <p className="text-white/40 text-xs mt-0.5">Opens QuickWrench with this vehicle</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-white/40 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {vin && (
          <div className="mx-5 mt-4 flex items-center gap-3 px-4 py-3 bg-white/5 rounded-xl border border-white/10">
            <div className="flex-1 min-w-0">
              <p className="text-white/30 text-[10px] uppercase tracking-widest">VIN</p>
              <p className="text-white font-mono text-sm truncate">{vin}</p>
            </div>
            <button
              onClick={copyVin}
              className="flex-shrink-0 text-xs px-3 py-1.5 border border-white/20 hover:border-orange/40 text-white/60 hover:text-orange rounded-lg transition-colors"
            >
              {copied ? '✓' : 'Copy'}
            </button>
          </div>
        )}

        <div className="p-5 space-y-2">
          {tools.map(t => (
            <a
              key={t.label}
              href={vin ? `/quickwrench?vin=${encodeURIComponent(vin)}` : '/quickwrench'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/8 hover:border-orange/30 hover:bg-orange/5 transition-colors group"
            >
              <span className="text-lg">{t.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium group-hover:text-orange transition-colors">{t.label}</p>
                <p className="text-white/30 text-xs">{t.hint}</p>
              </div>
              <svg className="w-4 h-4 text-white/20 group-hover:text-orange/60 transition-colors" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Shop Supply row ──────────────────────────────────────────────────────────

function SupplyRow({
  item,
  onChange,
  onRemove,
}: {
  item: ShopSupplyItem
  onChange: (updated: ShopSupplyItem) => void
  onRemove: () => void
}) {
  function update(field: keyof ShopSupplyItem, val: string | number) {
    const updated = { ...item, [field]: val }
    updated.total = round2(Number(updated.qty) * Number(updated.unit_cost))
    onChange(updated)
  }

  return (
    <div className="grid grid-cols-[1fr_64px_88px_84px_32px] gap-2 items-center">
      <input
        className="nwi-input py-2 text-sm"
        placeholder="Name"
        value={item.name}
        onChange={e => update('name', e.target.value)}
      />
      <input
        type="number" min="0" step="1"
        className="nwi-input py-2 text-sm text-center"
        value={item.qty}
        onChange={e => update('qty', Number(e.target.value))}
      />
      <input
        type="number" min="0" step="0.01"
        className="nwi-input py-2 text-sm text-right"
        placeholder="0.00"
        value={item.unit_cost}
        onChange={e => update('unit_cost', Number(e.target.value))}
      />
      <div className="nwi-input py-2 text-sm text-right bg-white/5 text-white/60 cursor-default">
        {fmt(item.total)}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-white/25 hover:text-danger transition-colors text-xl leading-none flex items-center justify-center"
      >
        ×
      </button>
    </div>
  )
}

// ─── Additional Part row ──────────────────────────────────────────────────────

function PartRow({
  item,
  markupPct,
  onChange,
  onRemove,
}: {
  item: AdditionalPartItem
  markupPct: number
  onChange: (updated: AdditionalPartItem) => void
  onRemove: () => void
}) {
  function update(field: keyof AdditionalPartItem, val: string | number) {
    const updated = { ...item, [field]: val }
    updated.total = round2(Number(updated.qty) * Number(updated.unit_cost) * (1 + markupPct / 100))
    onChange(updated)
  }

  return (
    <div className="grid grid-cols-[1fr_64px_88px_84px_32px] gap-2 items-center">
      <input
        className="nwi-input py-2 text-sm"
        placeholder="Part description"
        value={item.description}
        onChange={e => update('description', e.target.value)}
      />
      <input
        type="number" min="0" step="1"
        className="nwi-input py-2 text-sm text-center"
        value={item.qty}
        onChange={e => update('qty', Number(e.target.value))}
      />
      <input
        type="number" min="0" step="0.01"
        className="nwi-input py-2 text-sm text-right"
        placeholder="Cost"
        value={item.unit_cost}
        onChange={e => update('unit_cost', Number(e.target.value))}
      />
      <div className="nwi-input py-2 text-sm text-right bg-white/5 text-white/60 cursor-default">
        {fmt(item.total)}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-white/25 hover:text-danger transition-colors text-xl leading-none flex items-center justify-center"
      >
        ×
      </button>
    </div>
  )
}

// ─── Additional Labor row ─────────────────────────────────────────────────────

function LaborRow({
  item,
  onChange,
  onRemove,
}: {
  item: AdditionalLaborItem
  onChange: (updated: AdditionalLaborItem) => void
  onRemove: () => void
}) {
  function update(field: keyof AdditionalLaborItem, val: string | number) {
    const updated = { ...item, [field]: val }
    updated.subtotal = round2(Number(updated.hours) * Number(updated.rate))
    onChange(updated)
  }

  return (
    <div className="grid grid-cols-[1fr_72px_88px_84px_32px] gap-2 items-center">
      <input
        className="nwi-input py-2 text-sm"
        placeholder="Description"
        value={item.description}
        onChange={e => update('description', e.target.value)}
      />
      <input
        type="number" min="0" step="0.25"
        className="nwi-input py-2 text-sm text-center"
        value={item.hours}
        onChange={e => update('hours', Number(e.target.value))}
      />
      <input
        type="number" min="0" step="5"
        className="nwi-input py-2 text-sm text-right"
        placeholder="Rate"
        value={item.rate}
        onChange={e => update('rate', Number(e.target.value))}
      />
      <div className="nwi-input py-2 text-sm text-right bg-white/5 text-white/60 cursor-default">
        {fmt(item.subtotal)}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-white/25 hover:text-danger transition-colors text-xl leading-none flex items-center justify-center"
      >
        ×
      </button>
    </div>
  )
}

// ─── Column headers for editable lists ────────────────────────────────────────

function ListHeader({ cols }: { cols: string[] }) {
  return (
    <div className={`hidden sm:grid gap-2 px-1 mb-1`}
      style={{ gridTemplateColumns: cols.map((_, i) => i === 0 ? '1fr' : i === cols.length - 1 ? '32px' : (cols[i] === 'Total' ? '84px' : cols[i] === 'Rate' || cols[i] === 'Cost' ? '88px' : '64px')).join(' ') }}>
      {cols.map(c => (
        <span key={c} className={`text-white/25 text-[10px] uppercase tracking-widest ${c === 'Total' || c === 'Rate' || c === 'Cost' ? 'text-right' : c === 'Qty' || c === 'Hrs' ? 'text-center' : ''}`}>
          {c}
        </span>
      ))}
    </div>
  )
}

// ─── Finalize Confirm Modal ───────────────────────────────────────────────────

function FinalizeConfirmModal({
  grandTotal,
  onConfirm,
  onCancel,
  loading,
}: {
  grandTotal: number
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-orange/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-orange" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            </svg>
          </div>
          <div>
            <h2 className="text-white font-bold text-lg">Finalize this invoice?</h2>
            <p className="text-white/60 text-sm mt-1">
              Once finalized, the invoice is locked from further edits. The grand total will be{' '}
              <span className="text-orange font-semibold">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(grandTotal)}
              </span>.
              Only finalize when the job is complete.
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-3 bg-[#FF6600] hover:bg-orange-600 disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-xl transition-colors"
          >
            {loading ? 'Finalizing…' : 'Yes, Finalize'}
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-3 border border-white/15 text-white/60 hover:text-white rounded-xl transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function InvoiceInProgressClient({ invoice }: { invoice: Invoice }) {
  const router = useRouter()

  // Editable state
  const [jobNotes,        setJobNotes]        = useState(invoice.job_notes ?? '')
  const [shopSupplies,    setShopSupplies]    = useState<ShopSupplyItem[]>(
    Array.isArray(invoice.shop_supplies)    ? invoice.shop_supplies    : []
  )
  const [additionalParts, setAdditionalParts] = useState<AdditionalPartItem[]>(
    Array.isArray(invoice.additional_parts) ? invoice.additional_parts : []
  )
  const [additionalLabor, setAdditionalLabor] = useState<AdditionalLaborItem[]>(
    Array.isArray(invoice.additional_labor) ? invoice.additional_labor : []
  )

  // UI state
  const [saving,          setSaving]          = useState(false)
  const [finalizing,      setFinalizing]      = useState(false)
  const [showFinalizeModal, setShowFinalizeModal] = useState(false)
  const [toast,           setToast]           = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [estimateOpen,    setEstimateOpen]    = useState(false)
  const [showDiagPanel,   setShowDiagPanel]   = useState(false)

  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    if (toastRef.current) clearTimeout(toastRef.current)
    setToast({ msg, type })
    toastRef.current = setTimeout(() => setToast(null), 3500)
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const sq          = invoice.source_quote
  const markupPct   = sq?.parts_markup_percent ?? 0
  const taxRate     = invoice.tax_rate          // decimal, e.g. 0.0875

  // Original quote totals (what was estimated)
  const quotedPartsSubtotal  = sq
    ? round2(Number(sq.parts_subtotal ?? 0) * (1 + markupPct / 100))
    : 0
  const quotedLaborSubtotal  = Number(sq?.labor_subtotal ?? 0)
  const originalSubtotal     = invoice.subtotal  // baseline from quote conversion

  // Additional items totals
  const shopSuppliesTotal   = round2(shopSupplies.reduce((s, i) => s + i.total, 0))
  const additionalPartsTotal = round2(additionalParts.reduce((s, i) => s + i.total, 0))
  const additionalLaborTotal = round2(additionalLabor.reduce((s, i) => s + i.subtotal, 0))

  // Running total
  const newSubtotal  = round2(originalSubtotal + shopSuppliesTotal + additionalPartsTotal + additionalLaborTotal)
  const newTaxAmount = round2(newSubtotal * taxRate)
  const grandTotal   = round2(newSubtotal + newTaxAmount)

  // ── Shop supply helpers ────────────────────────────────────────────────────

  function addSupply() {
    setShopSupplies(p => [...p, { id: uuid(), name: '', qty: 1, unit_cost: 0, total: 0 }])
  }

  const updateSupply = useCallback((id: string, updated: ShopSupplyItem) => {
    setShopSupplies(p => p.map(s => s.id === id ? updated : s))
  }, [])

  const removeSupply = useCallback((id: string) => {
    setShopSupplies(p => p.filter(s => s.id !== id))
  }, [])

  // ── Additional parts helpers ───────────────────────────────────────────────

  function addPart() {
    setAdditionalParts(p => [...p, { id: uuid(), description: '', qty: 1, unit_cost: 0, total: 0 }])
  }

  const updatePart = useCallback((id: string, updated: AdditionalPartItem) => {
    setAdditionalParts(p => p.map(x => x.id === id ? updated : x))
  }, [])

  const removePart = useCallback((id: string) => {
    setAdditionalParts(p => p.filter(x => x.id !== id))
  }, [])

  // ── Additional labor helpers ───────────────────────────────────────────────

  function addLabor() {
    const defaultRate = Number(sq?.labor_rate ?? 95)
    setAdditionalLabor(p => [...p, { id: uuid(), description: '', hours: 0, rate: defaultRate, subtotal: 0 }])
  }

  const updateLabor = useCallback((id: string, updated: AdditionalLaborItem) => {
    setAdditionalLabor(p => p.map(x => x.id === id ? updated : x))
  }, [])

  const removeLabor = useCallback((id: string) => {
    setAdditionalLabor(p => p.filter(x => x.id !== id))
  }, [])

  // ── Finalize invoice ───────────────────────────────────────────────────────

  async function handleFinalize() {
    setFinalizing(true)
    try {
      // Save current progress first, then finalize
      await fetch(`/api/invoices/${invoice.id}/progress`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          job_notes:        jobNotes || null,
          shop_supplies:    shopSupplies,
          additional_parts: additionalParts,
          additional_labor: additionalLabor,
          subtotal:         newSubtotal,
          tax_amount:       newTaxAmount,
          total:            grandTotal,
        }),
      })
      const res  = await fetch(`/api/invoices/${invoice.id}/finalize`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Finalize failed')
      showToast('Invoice finalized. Ready to send to customer.')
      setShowFinalizeModal(false)
      // Navigate to the same page — server will now render FinalizedInvoiceClient
      setTimeout(() => router.push(`/financials/invoices/${invoice.id}`), 1200)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Finalize failed', 'error')
      setShowFinalizeModal(false)
    } finally {
      setFinalizing(false)
    }
  }

  // ── Save progress ──────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/progress`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          job_notes:        jobNotes || null,
          shop_supplies:    shopSupplies,
          additional_parts: additionalParts,
          additional_labor: additionalLabor,
          subtotal:         newSubtotal,
          tax_amount:       newTaxAmount,
          total:            grandTotal,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      showToast('Progress saved')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Vehicle & customer data ────────────────────────────────────────────────

  const vehicle     = invoice.vehicle
  const customer    = invoice.customer
  const vehicleLabel = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
    : '—'

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 pb-24 sm:pb-8">

      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
              {invoice.invoice_number}
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold" style={{ backgroundColor: '#f59e0b', color: '#ffffff' }}>
              In Progress
            </span>
          </div>
          <p className="text-white/40 text-sm mt-1">
            Started {invoice.started_at
              ? new Date(invoice.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : '—'}
          </p>
        </div>
        <button
          onClick={() => router.push('/financials?tab=invoices')}
          className="flex items-center gap-2 px-4 py-2 border border-white/15 hover:border-white/30 text-white/50 hover:text-white text-sm rounded-lg transition-colors"
        >
          ← Return to Invoices
        </button>
      </div>

      {/* ── SECTION A: Source quote banner ── */}
      {sq && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-orange/25 bg-orange/8">
          <svg className="w-4 h-4 text-orange/70 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
          </svg>
          <span className="text-orange/80 text-sm">
            Based on approved quote{' '}
            <button
              onClick={() => router.push(`/financials?tab=quotes&quote=${sq.id}`)}
              className="font-mono font-semibold text-orange hover:underline"
            >
              {sq.quote_number}
            </button>
          </span>
        </div>
      )}

      {/* ── SECTION B: Vehicle & customer ── */}
      <Section label="Vehicle & Customer">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1">
            <p className="text-white/30 text-xs uppercase tracking-widest">Vehicle</p>
            <p className="text-white font-medium">{vehicleLabel}</p>
            {vehicle?.vin && (
              <p className="text-white/40 text-xs font-mono">{vehicle.vin}</p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-white/30 text-xs uppercase tracking-widest">Customer</p>
            {customer ? (
              <>
                <p className="text-white font-medium">{customer.first_name} {customer.last_name}</p>
                {customer.phone && <p className="text-white/50 text-sm">{customer.phone}</p>}
                {customer.email && <p className="text-white/50 text-sm">{customer.email}</p>}
              </>
            ) : (
              <p className="text-white/40">—</p>
            )}
          </div>
        </div>
        {invoice.job_category && (
          <div className="mt-4 pt-4 border-t border-white/8 space-y-1">
            <p className="text-white/30 text-xs uppercase tracking-widest">Job</p>
            <p className="text-white/70 text-sm">
              {[invoice.job_category, invoice.job_subtype].filter(Boolean).join(' / ')}
            </p>
          </div>
        )}
      </Section>

      {/* ── SECTION C: Original estimate (accordion) ── */}
      <div className="bg-[#222222] border border-white/8 rounded-2xl overflow-hidden">
        <button
          onClick={() => setEstimateOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3 border-b border-white/8 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
        >
          <p className="text-white/50 text-xs font-semibold uppercase tracking-widest">Original Estimate</p>
          <div className="flex items-center gap-2">
            {sq?.grand_total != null && (
              <span className="text-white/60 text-sm font-mono">
                {fmt(Number(sq.grand_total))}
              </span>
            )}
            <svg
              className={`w-4 h-4 text-white/30 transition-transform ${estimateOpen ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </button>
        {estimateOpen && sq && (
          <div className="p-5 space-y-3">
            {/* Original line items */}
            {Array.isArray(sq.line_items) && sq.line_items.length > 0 && (
              <div className="rounded-xl border border-white/8 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/8 bg-white/[0.02]">
                      <th className="text-left px-4 py-2 text-white/40 font-medium">Description</th>
                      <th className="text-right px-4 py-2 text-white/40 font-medium">Qty</th>
                      <th className="text-right px-4 py-2 text-white/40 font-medium">Unit</th>
                      <th className="text-right px-4 py-2 text-white/40 font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sq.line_items.map((li, i) => (
                      <tr key={i} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-2.5 text-white/70">{li.description}</td>
                        <td className="px-4 py-2.5 text-white/50 text-right">{li.quantity}</td>
                        <td className="px-4 py-2.5 text-white/50 text-right">{fmt(li.unit_price)}</td>
                        <td className="px-4 py-2.5 text-white font-medium text-right">{fmt(li.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {/* Financial breakdown */}
            <div className="space-y-1.5 border-t border-white/8 pt-3">
              {quotedPartsSubtotal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">
                    Parts{markupPct > 0 ? ` (incl. ${markupPct}% markup)` : ''}
                  </span>
                  <span className="text-white">{fmt(quotedPartsSubtotal)}</span>
                </div>
              )}
              {quotedLaborSubtotal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">
                    Labor{sq?.labor_hours && sq?.labor_rate
                      ? ` (${sq.labor_hours}h × ${fmt(sq.labor_rate)}/hr)`
                      : ''}
                  </span>
                  <span className="text-white">{fmt(quotedLaborSubtotal)}</span>
                </div>
              )}
              {Number(sq?.tax_amount ?? 0) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-white/40">Tax ({sq?.tax_percent}%)</span>
                  <span className="text-white/60">{fmt(Number(sq.tax_amount))}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline border-t border-white/8 pt-2 mt-1">
                <span className="text-white font-medium">Estimate Total</span>
                <span className="font-condensed font-bold text-orange text-xl">{fmt(Number(sq.grand_total ?? 0))}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── SECTION D: Job notes ── */}
      <Section label="Job Notes">
        <textarea
          rows={5}
          className="nwi-input resize-y text-sm w-full font-mono"
          placeholder="Log observations, what was done, issues encountered, additional approvals from customer…"
          value={jobNotes}
          onChange={e => setJobNotes(e.target.value)}
        />
      </Section>

      {/* ── SECTION E: Shop supplies ── */}
      <Section
        label="Shop Supplies"
        action={
          <button
            onClick={addSupply}
            className="flex items-center gap-1.5 text-xs text-orange hover:text-orange/80 font-semibold transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Supply
          </button>
        }
      >
        {shopSupplies.length === 0 ? (
          <button
            onClick={addSupply}
            className="w-full py-6 text-white/25 hover:text-white/50 text-sm text-center border border-dashed border-white/10 hover:border-white/20 rounded-xl transition-colors"
          >
            + Add brake cleaner, shop rags, thread locker…
          </button>
        ) : (
          <div className="space-y-2">
            <ListHeader cols={['Name', 'Qty', 'Cost', 'Total', '']} />
            {shopSupplies.map(item => (
              <SupplyRow
                key={item.id}
                item={item}
                onChange={updated => updateSupply(item.id, updated)}
                onRemove={() => removeSupply(item.id)}
              />
            ))}
            {shopSupplies.length > 0 && (
              <div className="flex justify-end pt-2 border-t border-white/8">
                <div className="flex gap-6 text-sm">
                  <span className="text-white/40">Supplies Subtotal</span>
                  <span className="text-white font-medium w-20 text-right">{fmt(shopSuppliesTotal)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ── SECTION F: Additional parts ── */}
      <Section
        label={`Additional Parts${markupPct > 0 ? ` (${markupPct}% markup applied)` : ''}`}
        action={
          <button
            onClick={addPart}
            className="flex items-center gap-1.5 text-xs text-orange hover:text-orange/80 font-semibold transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Part
          </button>
        }
      >
        {additionalParts.length === 0 ? (
          <button
            onClick={addPart}
            className="w-full py-6 text-white/25 hover:text-white/50 text-sm text-center border border-dashed border-white/10 hover:border-white/20 rounded-xl transition-colors"
          >
            + Add parts not in the original quote…
          </button>
        ) : (
          <div className="space-y-2">
            <ListHeader cols={['Description', 'Qty', 'Cost', 'Total', '']} />
            {additionalParts.map(item => (
              <PartRow
                key={item.id}
                item={item}
                markupPct={markupPct}
                onChange={updated => updatePart(item.id, updated)}
                onRemove={() => removePart(item.id)}
              />
            ))}
            {additionalParts.length > 0 && (
              <div className="flex justify-end pt-2 border-t border-white/8">
                <div className="flex gap-6 text-sm">
                  <span className="text-white/40">Additional Parts Subtotal</span>
                  <span className="text-white font-medium w-20 text-right">{fmt(additionalPartsTotal)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ── SECTION G: Additional labor ── */}
      <Section
        label="Additional Labor"
        action={
          <button
            onClick={addLabor}
            className="flex items-center gap-1.5 text-xs text-orange hover:text-orange/80 font-semibold transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Labor
          </button>
        }
      >
        {additionalLabor.length === 0 ? (
          <button
            onClick={addLabor}
            className="w-full py-6 text-white/25 hover:text-white/50 text-sm text-center border border-dashed border-white/10 hover:border-white/20 rounded-xl transition-colors"
          >
            + Add extra diagnostic time, wire brushing, additional repairs…
          </button>
        ) : (
          <div className="space-y-2">
            <ListHeader cols={['Description', 'Hrs', 'Rate', 'Subtotal', '']} />
            {additionalLabor.map(item => (
              <LaborRow
                key={item.id}
                item={item}
                onChange={updated => updateLabor(item.id, updated)}
                onRemove={() => removeLabor(item.id)}
              />
            ))}
            {additionalLabor.length > 0 && (
              <div className="flex justify-end pt-2 border-t border-white/8">
                <div className="flex gap-6 text-sm">
                  <span className="text-white/40">Additional Labor Subtotal</span>
                  <span className="text-white font-medium w-20 text-right">{fmt(additionalLaborTotal)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ── SECTION H: Running total (desktop, inline) ── */}
      <div className="hidden sm:block bg-[#222222] border border-white/8 rounded-2xl p-5">
        <p className="text-white/50 text-xs font-semibold uppercase tracking-widest mb-4">Running Total</p>
        <div className="space-y-2">
          {quotedPartsSubtotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Quoted Parts</span>
              <span className="text-white">{fmt(quotedPartsSubtotal)}</span>
            </div>
          )}
          {additionalPartsTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Additional Parts</span>
              <span className="text-white">{fmt(additionalPartsTotal)}</span>
            </div>
          )}
          {shopSuppliesTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Shop Supplies</span>
              <span className="text-white">{fmt(shopSuppliesTotal)}</span>
            </div>
          )}
          {quotedLaborSubtotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Quoted Labor</span>
              <span className="text-white">{fmt(quotedLaborSubtotal)}</span>
            </div>
          )}
          {additionalLaborTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Additional Labor</span>
              <span className="text-white">{fmt(additionalLaborTotal)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm border-t border-white/8 pt-2">
            <span className="text-white/50">Subtotal</span>
            <span className="text-white">{fmt(newSubtotal)}</span>
          </div>
          {newTaxAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/40">Tax ({Math.round(taxRate * 10000) / 100}%)</span>
              <span className="text-white/60">{fmt(newTaxAmount)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline border-t border-white/8 pt-3 mt-1">
            <span className="font-condensed font-bold text-white text-lg tracking-wide">GRAND TOTAL</span>
            <span className="font-condensed font-bold text-orange text-4xl">{fmt(grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* ── SECTION I: Action buttons (desktop) ── */}
      <div className="hidden sm:flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white font-condensed font-bold text-sm tracking-wide rounded-xl transition-colors border border-white/15"
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
              Save Progress
            </>
          )}
        </button>
        <button
          onClick={() => setShowFinalizeModal(true)}
          disabled={saving || finalizing}
          className="flex items-center gap-2 px-6 py-3 bg-[#FF6600] hover:bg-orange-600 disabled:opacity-50 text-white font-condensed font-bold text-sm tracking-wide rounded-xl transition-colors shadow-md shadow-orange/20"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          Finalize Invoice
        </button>
        <button
          onClick={() => router.push('/financials?tab=invoices')}
          className="px-5 py-3 border border-white/15 hover:border-white/30 text-white/50 hover:text-white text-sm font-medium rounded-xl transition-colors"
        >
          Return to Invoices List
        </button>
      </div>

      {/* ── Sticky mobile footer (total + save + finalize) ── */}
      <div className="fixed bottom-0 inset-x-0 z-30 sm:hidden bg-[#1a1a1a]/95 backdrop-blur-sm border-t border-white/10 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-white/30 text-[10px] uppercase tracking-widest">Grand Total</p>
            <p className="font-condensed font-bold text-orange text-2xl leading-none">{fmt(grandTotal)}</p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-1.5 px-4 py-3 bg-white/10 hover:bg-white/15 disabled:opacity-50 text-white font-condensed font-bold text-xs tracking-wide rounded-xl transition-colors border border-white/15"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => setShowFinalizeModal(true)}
            disabled={saving || finalizing}
            className="flex items-center justify-center gap-1.5 px-4 py-3 bg-[#FF6600] hover:bg-orange-600 disabled:opacity-50 text-white font-condensed font-bold text-xs tracking-wide rounded-xl transition-colors"
          >
            Finalize
          </button>
        </div>
      </div>

      {/* ── Floating diagnostics button ── */}
      <button
        onClick={() => setShowDiagPanel(true)}
        className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-20 flex items-center gap-2 px-4 py-3 bg-[#2969B0] hover:bg-blue-700 text-white font-semibold text-sm rounded-xl shadow-xl shadow-blue-900/30 transition-colors"
        title="Diagnostic Tools"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
        </svg>
        <span className="hidden sm:inline">Diagnostics</span>
      </button>

      {/* ── Modals ── */}
      {showDiagPanel && (
        <DiagnosticsPanel
          vin={invoice.vehicle?.vin ?? null}
          onClose={() => setShowDiagPanel(false)}
        />
      )}

      {showFinalizeModal && (
        <FinalizeConfirmModal
          grandTotal={grandTotal}
          onConfirm={handleFinalize}
          onCancel={() => setShowFinalizeModal(false)}
          loading={finalizing}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}
