'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Invoice, InvoiceStatus, LineItem, PaymentMethod } from '@/types/financials'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const fmtDate = (s: string) =>
  new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function genInvoiceNumber() {
  const d = new Date()
  const y = d.getFullYear().toString().slice(2)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const r = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `INV-${y}${m}-${r}`
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_META: Record<InvoiceStatus, { label: string; cls: string }> = {
  draft:     { label: 'Draft',     cls: 'bg-white/10 text-white/50' },
  sent:      { label: 'Sent',      cls: 'bg-blue/20 text-blue' },
  viewed:    { label: 'Viewed',    cls: 'bg-blue/20 text-blue' },
  paid:      { label: 'Paid',      cls: 'bg-success/20 text-success' },
  overdue:   { label: 'Overdue',   cls: 'bg-danger/20 text-danger' },
  cancelled: { label: 'Cancelled', cls: 'bg-white/5 text-white/30' },
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const { label, cls } = STATUS_META[status] ?? STATUS_META.draft
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>
  )
}

// ─── Empty line item ──────────────────────────────────────────────────────────

const emptyLine = (): LineItem => ({ description: '', quantity: 1, unit_price: 0, total: 0 })

// ─── Status filter tabs ───────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { value: '',          label: 'All' },
  { value: 'draft',     label: 'Draft' },
  { value: 'sent',      label: 'Sent' },
  { value: 'paid',      label: 'Paid' },
  { value: 'overdue',   label: 'Overdue' },
  { value: 'cancelled', label: 'Cancelled' },
]

const SOURCE_FILTERS = [
  { value: '',             label: 'All Sources' },
  { value: 'manual',      label: 'Manual' },
  { value: 'quickwrench', label: 'QuickWrench' },
]

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash',   label: 'Cash' },
  { value: 'card',   label: 'Card' },
  { value: 'check',  label: 'Check' },
  { value: 'venmo',  label: 'Venmo' },
  { value: 'zelle',  label: 'Zelle' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'other',  label: 'Other' },
]

// ─── Main component ───────────────────────────────────────────────────────────

export default function InvoicesTab() {
  const [invoices,      setInvoices]      = useState<Invoice[]>([])
  const [loading,       setLoading]       = useState(true)
  const [statusFilter,  setStatusFilter]  = useState('')
  const [sourceFilter,  setSourceFilter]  = useState('')
  const [error,         setError]         = useState<string | null>(null)
  const [showForm,      setShowForm]      = useState(false)
  const [formError,     setFormError]     = useState<string | null>(null)
  const [submitting,    setSubmitting]    = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Action menu state
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [payMethodMap, setPayMethodMap] = useState<Record<string, PaymentMethod>>({})

  // ── New invoice form state ──
  const [form, setForm] = useState(() => ({
    invoice_number:  genInvoiceNumber(),
    invoice_date:    today(),
    due_date:        '',
    customer_id:     '',
    line_items:      [emptyLine()] as LineItem[],
    tax_rate:        0,
    discount_amount: 0,
    notes:           '',
    terms:           'Payment due upon receipt.',
    status:          'draft' as InvoiceStatus,
  }))

  // ── Computed totals ──
  const subtotal = form.line_items.reduce((s, l) => s + l.total, 0)
  const taxAmt   = subtotal * (form.tax_rate / 100)
  const total    = Math.max(0, subtotal + taxAmt - form.discount_amount)

  // ── Fetch invoices ──
  const fetchInvoices = useCallback(async (status: string, source: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (source) params.set('source', source)
      const url  = params.size > 0 ? `/api/invoices?${params}` : '/api/invoices'
      const res  = await fetch(url)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load invoices')
      setInvoices(json.invoices)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchInvoices(statusFilter, sourceFilter) }, [statusFilter, sourceFilter, fetchInvoices])

  // ── Line item helpers ──
  function updateLine(index: number, field: keyof LineItem, value: string | number) {
    setForm(prev => {
      const items = prev.line_items.map((item, i) => {
        if (i !== index) return item
        const updated = { ...item, [field]: value }
        updated.total = Number(updated.quantity) * Number(updated.unit_price)
        return updated
      })
      return { ...prev, line_items: items }
    })
  }

  function addLine() {
    setForm(prev => ({ ...prev, line_items: [...prev.line_items, emptyLine()] }))
  }

  function removeLine(index: number) {
    setForm(prev => ({
      ...prev,
      line_items: prev.line_items.filter((_, i) => i !== index),
    }))
  }

  // ── Submit new invoice ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (form.line_items.length === 0) {
      setFormError('Add at least one line item.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_number:  form.invoice_number,
          invoice_date:    form.invoice_date,
          due_date:        form.due_date || null,
          customer_id:     form.customer_id || null,
          line_items:      form.line_items,
          subtotal,
          tax_rate:        form.tax_rate / 100,
          tax_amount:      taxAmt,
          discount_amount: form.discount_amount,
          total,
          status:          form.status,
          notes:           form.notes || null,
          terms:           form.terms || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to create invoice')
      setInvoices(prev => [json.invoice, ...prev])
      setShowForm(false)
      setForm({
        invoice_number:  genInvoiceNumber(),
        invoice_date:    today(),
        due_date:        '',
        customer_id:     '',
        line_items:      [emptyLine()],
        tax_rate:        0,
        discount_amount: 0,
        notes:           '',
        terms:           'Payment due upon receipt.',
        status:          'draft',
      })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Update invoice status ──
  async function updateStatus(
    invoiceId: string,
    status: 'paid' | 'unpaid' | 'overdue',
    payment_method?: PaymentMethod
  ) {
    setActionLoading(invoiceId)
    setOpenMenu(null)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, payment_method: payment_method ?? null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to update invoice')
      setInvoices(prev => prev.map(inv => inv.id === invoiceId ? json.invoice : inv))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters + New Invoice button */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          {/* Status filters */}
          <div className="flex items-center gap-1 overflow-x-auto">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  statusFilter === f.value
                    ? 'bg-orange/15 text-orange'
                    : 'text-white/40 hover:text-white hover:bg-white/5'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {/* Source filter */}
          <div className="flex items-center gap-1 overflow-x-auto">
            <span className="text-white/25 text-[10px] uppercase tracking-widest mr-1">Source</span>
            {SOURCE_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setSourceFilter(f.value)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  sourceFilter === f.value
                    ? 'bg-blue/15 text-blue-light'
                    : 'text-white/30 hover:text-white hover:bg-white/5'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => { setShowForm(v => !v); setFormError(null) }}
          className="flex items-center gap-1.5 px-4 py-2 bg-orange hover:bg-orange-hover text-white font-condensed font-semibold text-sm tracking-wide rounded-lg transition-colors whitespace-nowrap"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Invoice
        </button>
      </div>

      {/* ── Create invoice form ── */}
      {showForm && (
        <div className="nwi-card border-orange/30">
          <h3 className="font-condensed font-bold text-lg text-white tracking-wide mb-4">New Invoice</h3>
          {formError && <div className="alert-error mb-4">{formError}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Row 1 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="nwi-label">Invoice #</label>
                <input className="nwi-input" value={form.invoice_number}
                  onChange={e => setForm(p => ({ ...p, invoice_number: e.target.value }))} required />
              </div>
              <div>
                <label className="nwi-label">Invoice Date</label>
                <input type="date" className="nwi-input" value={form.invoice_date}
                  onChange={e => setForm(p => ({ ...p, invoice_date: e.target.value }))} required />
              </div>
              <div>
                <label className="nwi-label">Due Date</label>
                <input type="date" className="nwi-input" value={form.due_date}
                  onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))} />
              </div>
            </div>

            {/* Row 2 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="nwi-label">Customer ID <span className="normal-case text-white/20">(optional)</span></label>
                <input className="nwi-input" placeholder="UUID from Intel Hub"
                  value={form.customer_id}
                  onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))} />
              </div>
              <div>
                <label className="nwi-label">Status</label>
                <select className="nwi-input" value={form.status}
                  onChange={e => setForm(p => ({ ...p, status: e.target.value as InvoiceStatus }))}>
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="paid">Paid</option>
                </select>
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="nwi-label mb-0">Line Items</label>
                <button type="button" onClick={addLine}
                  className="text-orange text-xs hover:underline">
                  + Add item
                </button>
              </div>

              <div className="space-y-2">
                {/* Header */}
                <div className="hidden sm:grid grid-cols-[1fr_80px_100px_90px_28px] gap-2 px-1">
                  {['Description', 'Qty', 'Unit Price', 'Total', ''].map(h => (
                    <span key={h} className="text-white/30 text-xs uppercase tracking-widest">{h}</span>
                  ))}
                </div>

                {form.line_items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_80px_100px_90px_28px] gap-2 items-center">
                    <input
                      className="nwi-input py-2 text-sm"
                      placeholder="Description"
                      value={item.description}
                      onChange={e => updateLine(idx, 'description', e.target.value)}
                      required
                    />
                    <input
                      type="number" min="1" step="1"
                      className="nwi-input py-2 text-sm text-center"
                      value={item.quantity}
                      onChange={e => updateLine(idx, 'quantity', Number(e.target.value))}
                    />
                    <input
                      type="number" min="0" step="0.01"
                      className="nwi-input py-2 text-sm text-right"
                      value={item.unit_price}
                      onChange={e => updateLine(idx, 'unit_price', Number(e.target.value))}
                    />
                    <div className="nwi-input py-2 text-sm text-right bg-dark-card/50 cursor-default">
                      {fmt(item.total)}
                    </div>
                    <button type="button" onClick={() => removeLine(idx)}
                      className="text-white/20 hover:text-danger transition-colors text-lg leading-none">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Totals row */}
            <div className="flex flex-col items-end gap-1 border-t border-dark-border pt-4">
              <div className="flex gap-8 text-sm">
                <span className="text-white/40">Subtotal</span>
                <span className="text-white w-24 text-right">{fmt(subtotal)}</span>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-white/40">Tax</span>
                <input
                  type="number" min="0" max="100" step="0.1"
                  className="nwi-input py-1 text-xs text-right w-20"
                  value={form.tax_rate}
                  onChange={e => setForm(p => ({ ...p, tax_rate: Number(e.target.value) }))}
                  placeholder="0"
                />
                <span className="text-white/40 text-xs">%</span>
                <span className="text-white w-24 text-right">{fmt(taxAmt)}</span>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-white/40">Discount</span>
                <input
                  type="number" min="0" step="0.01"
                  className="nwi-input py-1 text-xs text-right w-24"
                  value={form.discount_amount}
                  onChange={e => setForm(p => ({ ...p, discount_amount: Number(e.target.value) }))}
                  placeholder="0.00"
                />
                <span className="text-white w-24 text-right text-danger">-{fmt(form.discount_amount)}</span>
              </div>
              <div className="flex gap-8 text-base font-bold border-t border-dark-border pt-2 mt-1">
                <span className="text-white">Total</span>
                <span className="text-orange w-24 text-right">{fmt(total)}</span>
              </div>
            </div>

            {/* Notes & Terms */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="nwi-label">Notes <span className="normal-case text-white/20">(customer-facing)</span></label>
                <textarea rows={2} className="nwi-input resize-none" value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
              <div>
                <label className="nwi-label">Terms</label>
                <textarea rows={2} className="nwi-input resize-none" value={form.terms}
                  onChange={e => setForm(p => ({ ...p, terms: e.target.value }))} />
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={submitting}
                className="px-6 py-2.5 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors">
                {submitting ? 'Creating…' : 'Create Invoice'}
              </button>
              <button type="button" onClick={() => setShowForm(false)}
                className="px-6 py-2.5 border border-dark-border hover:border-white/20 text-white/50 hover:text-white text-sm rounded-lg transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {error && <div className="alert-error">{error}</div>}

      {/* ── Invoice list ── */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="nwi-card animate-pulse h-14 bg-dark-card/50" />
          ))}
        </div>
      ) : invoices.length === 0 ? (
        <div className="nwi-card text-center py-12">
          <svg className="w-10 h-10 text-white/10 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <p className="text-white/30 text-sm">No invoices{statusFilter ? ` with status "${statusFilter}"` : ''}.</p>
          <button onClick={() => setShowForm(true)}
            className="mt-3 text-orange text-xs hover:underline">
            Create your first invoice →
          </button>
        </div>
      ) : (
        <div className="nwi-card p-0 overflow-hidden">
          {/* Table header */}
          <div className="hidden sm:grid grid-cols-[140px_1fr_120px_90px_100px_44px] gap-4 px-5 py-3 border-b border-dark-border">
            {['Invoice #', 'Customer', 'Date', 'Total', 'Status', ''].map(h => (
              <span key={h} className="text-white/30 text-xs uppercase tracking-widest">{h}</span>
            ))}
          </div>

          <div className="divide-y divide-dark-border">
            {invoices.map(inv => {
              const customerName = inv.customer
                ? `${inv.customer.first_name} ${inv.customer.last_name}`
                : '—'

              return (
                <div key={inv.id}
                  className="grid grid-cols-1 sm:grid-cols-[140px_1fr_120px_90px_100px_44px] gap-2 sm:gap-4 px-5 py-4 hover:bg-white/2 transition-colors items-center">
                  {/* Invoice # */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-xs text-white truncate">{inv.invoice_number}</span>
                    {inv.source === 'quickwrench' && (
                      <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange/15 text-orange border border-orange/20 uppercase tracking-wide">
                        QW
                      </span>
                    )}
                  </div>
                  {/* Customer */}
                  <span className="text-white/60 text-sm truncate">{customerName}</span>
                  {/* Date */}
                  <span className="text-white/40 text-xs">{fmtDate(inv.invoice_date)}</span>
                  {/* Total */}
                  <span className="font-condensed font-bold text-white">{fmt(inv.total)}</span>
                  {/* Status */}
                  <StatusBadge status={inv.status} />
                  {/* Actions */}
                  <div className="relative">
                    <button
                      disabled={!!actionLoading}
                      onClick={() => setOpenMenu(openMenu === inv.id ? null : inv.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 text-white/30 hover:text-white transition-colors disabled:opacity-40"
                    >
                      {actionLoading === inv.id ? (
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
                        </svg>
                      )}
                    </button>

                    {openMenu === inv.id && (
                      <div className="absolute right-0 top-9 z-20 w-48 bg-dark-card border border-dark-border rounded-xl shadow-xl overflow-hidden">
                        {inv.status !== 'paid' && (
                          <div className="border-b border-dark-border">
                            <p className="px-3 pt-2 pb-1 text-white/30 text-xs uppercase tracking-widest">Mark as Paid</p>
                            {PAYMENT_METHODS.map(pm => (
                              <button key={pm.value}
                                onClick={() => updateStatus(inv.id, 'paid', pm.value)}
                                className="w-full text-left px-4 py-2 text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors">
                                {pm.label}
                              </button>
                            ))}
                          </div>
                        )}
                        {inv.status !== 'overdue' && (
                          <button onClick={() => updateStatus(inv.id, 'overdue')}
                            className="w-full text-left px-4 py-2.5 text-sm text-danger hover:bg-danger/5 transition-colors">
                            Mark Overdue
                          </button>
                        )}
                        {inv.status === 'paid' && (
                          <button onClick={() => updateStatus(inv.id, 'unpaid')}
                            className="w-full text-left px-4 py-2.5 text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors">
                            Mark Unpaid
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Close menu on outside click */}
      {openMenu && (
        <div className="fixed inset-0 z-10" onClick={() => setOpenMenu(null)} />
      )}
    </div>
  )
}
