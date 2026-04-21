'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Quote, QuoteStatus } from '@/types/financials'

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

// ─── Detail modal ─────────────────────────────────────────────────────────────

function QuoteDetailModal({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const customerName = quote.customer
    ? `${quote.customer.first_name} ${quote.customer.last_name}`
    : '—'

  const vehicleLabel = quote.vehicle
    ? [quote.vehicle.year, quote.vehicle.make, quote.vehicle.model].filter(Boolean).join(' ')
    : '—'

  const jobDesc = [quote.job_category, quote.job_subtype].filter(Boolean).join(' / ') || '—'

  const timeline: { label: string; ts: string | null }[] = [
    { label: 'Created',   ts: quote.created_at },
    { label: 'Sent',      ts: quote.sent_at },
    { label: 'Approved',  ts: quote.approved_at },
    { label: 'Declined',  ts: quote.declined_at },
    { label: 'Converted', ts: quote.converted_at },
  ].filter(e => e.ts)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative w-full max-w-2xl bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-white/10">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-condensed font-bold text-2xl text-white tracking-wide">
                {quote.quote_number}
              </span>
              <StatusBadge status={quote.status as QuoteStatus} />
            </div>
            <p className="text-white/40 text-sm mt-1">{fmtDate(quote.created_at)}</p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Customer + Vehicle */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-white/30 text-xs uppercase tracking-widest">Customer</p>
              <p className="text-white font-medium">{customerName}</p>
              {quote.customer?.phone && (
                <p className="text-white/50 text-sm">{quote.customer.phone}</p>
              )}
              {quote.customer?.email && (
                <p className="text-white/50 text-sm">{quote.customer.email}</p>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-white/30 text-xs uppercase tracking-widest">Vehicle</p>
              <p className="text-white font-medium">{vehicleLabel}</p>
              {quote.vehicle?.vin && (
                <p className="text-white/40 text-xs font-mono">{quote.vehicle.vin}</p>
              )}
            </div>
          </div>

          {/* Job */}
          <div className="space-y-1">
            <p className="text-white/30 text-xs uppercase tracking-widest">Job Description</p>
            <p className="text-white">{jobDesc}</p>
          </div>

          {/* Line items */}
          {Array.isArray(quote.line_items) && quote.line_items.length > 0 && (
            <div className="space-y-2">
              <p className="text-white/30 text-xs uppercase tracking-widest">Line Items</p>
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
                    {quote.line_items.map((li, i) => (
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
            </div>
          )}

          {/* Financial breakdown */}
          <div className="bg-white/5 rounded-xl p-4 space-y-2.5">
            <p className="text-white/30 text-xs uppercase tracking-widest mb-3">Financial Breakdown</p>
            {quote.parts_subtotal != null && (
              <div className="flex justify-between text-sm">
                <span className="text-white/60">Parts Subtotal</span>
                <span className="text-white">{fmt(quote.parts_subtotal)}</span>
              </div>
            )}
            {quote.parts_markup_percent != null && (
              <div className="flex justify-between text-sm">
                <span className="text-white/40">Parts Markup ({quote.parts_markup_percent}%)</span>
                <span className="text-white/60">
                  {quote.parts_subtotal != null
                    ? fmt(quote.parts_subtotal * (quote.parts_markup_percent / 100))
                    : '—'}
                </span>
              </div>
            )}
            {quote.labor_subtotal != null && (
              <div className="flex justify-between text-sm">
                <span className="text-white/60">
                  Labor{quote.labor_hours != null && quote.labor_rate != null
                    ? ` (${quote.labor_hours}h × ${fmt(quote.labor_rate)}/hr)`
                    : ''}
                </span>
                <span className="text-white">{fmt(quote.labor_subtotal)}</span>
              </div>
            )}
            {quote.tax_amount != null && (
              <div className="flex justify-between text-sm border-t border-white/10 pt-2.5">
                <span className="text-white/40">
                  Tax{quote.tax_percent != null ? ` (${quote.tax_percent}%)` : ''}
                </span>
                <span className="text-white/60">{fmt(quote.tax_amount)}</span>
              </div>
            )}
            <div className="flex justify-between items-baseline border-t border-white/10 pt-3">
              <span className="font-condensed font-bold text-white text-lg tracking-wide">GRAND TOTAL</span>
              <span className="font-condensed font-bold text-orange text-3xl">{fmt(quote.grand_total)}</span>
            </div>
          </div>

          {/* Notes */}
          {quote.notes && (
            <div className="space-y-1">
              <p className="text-white/30 text-xs uppercase tracking-widest">Notes</p>
              <p className="text-white/70 text-sm whitespace-pre-wrap">{quote.notes}</p>
            </div>
          )}

          {/* Status timeline */}
          {timeline.length > 0 && (
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
        </div>
      </div>
    </div>
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
                      onClick={() => setSelected(q)}
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
                  onClick={() => setSelected(q)}
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
        <QuoteDetailModal quote={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
