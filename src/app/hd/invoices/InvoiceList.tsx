'use client'

import { useState } from 'react'
import Link from 'next/link'
import { HD_INVOICE_PAGE_SIZE, type HDInvoiceListRow } from '@/app/api/hd/invoices/list'
import InvoiceListActions from './InvoiceListActions'

const ORANGE = '#FF6600'

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  unpaid:  { bg: '#FEE2E2', color: '#dc2626' },
  sent:    { bg: '#DBEAFE', color: '#2563eb' },
  overdue: { bg: '#FEE2E2', color: '#b91c1c' },
  paid:    { bg: '#DCFCE7', color: '#16a34a' },
  partial: { bg: '#FEF3C7', color: '#d97706' },
  void:    { bg: '#F3F4F6', color: '#6B7280' },
}

const GRID_COLS = '160px 1fr 1fr 90px 90px 120px auto'

function fmt(n: number | null) {
  return `$${(n ?? 0).toFixed(2)}`
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * The invoice table (desktop grid + mobile cards) plus its "Load More" control.
 *
 * The first page is server-rendered; every page after it comes from
 * GET /api/hd/invoices under the same ordering and the same `filter`, so the
 * offsets line up. `total` is the server's exact count for that same filter and
 * is what decides whether more rows remain — a first page that happens to be
 * exactly PAGE_SIZE long tells us nothing on its own.
 *
 * Switching between all/overdue is a URL navigation, and the page remounts this
 * component on that change, so the accumulated rows reset to the new first page
 * rather than mixing two filters' results in one table.
 */
export default function InvoiceList({
  initialRows,
  total,
  filter,
}: {
  initialRows: HDInvoiceListRow[]
  total:       number
  filter:      string | null
}) {
  const [rows,      setRows]      = useState(initialRows)
  const [exhausted, setExhausted] = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const hasMore = !exhausted && rows.length < total

  async function loadMore() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        limit:  String(HD_INVOICE_PAGE_SIZE),
        offset: String(rows.length),
      })
      if (filter) params.set('filter', filter)

      const res  = await fetch(`/api/hd/invoices?${params}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to load more invoices')
      const next = (body.invoices ?? []) as HDInvoiceListRow[]
      setRows(prev => [...prev, ...next])
      // A short page means the table is exhausted.
      if (next.length < HD_INVOICE_PAGE_SIZE) setExhausted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more invoices')
    } finally {
      setLoading(false)
    }
  }

  if (rows.length === 0) {
    return (
      <div style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
        <div className="text-center py-16">
          <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="#D1D5DB" strokeWidth={1.5} viewBox="0 0 24 24">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <p style={{ color: '#6B7280', fontSize: 15 }}>
            {filter === 'overdue' ? 'No overdue invoices' : 'No invoices yet'}
          </p>
          <p style={{ color: '#9CA3AF', fontSize: 13, marginTop: 4 }}>Create a direct invoice, or build a quote and convert it</p>
          <div className="flex items-center justify-center gap-3 mt-4">
            <Link
              href="/hd/invoices/new"
              className="inline-block px-5 py-2 rounded-lg font-semibold text-sm text-white"
              style={{ background: ORANGE }}
            >
              Create an invoice
            </Link>
            <Link
              href="/hd/quotes/new"
              className="inline-block px-5 py-2 rounded-lg font-semibold text-sm"
              style={{ background: '#FFFFFF', color: ORANGE, border: `1px solid ${ORANGE}` }}
            >
              Create a quote
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div style={{ background: '#FFFFFF', borderRadius: 12, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
        {/* Desktop table (md+) */}
        <div className="hidden md:block">
          <div
            className="grid gap-3 px-4 py-3 text-xs font-semibold uppercase tracking-wide"
            style={{ gridTemplateColumns: GRID_COLS, background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', color: '#6B7280' }}
          >
            <span>Invoice #</span>
            <span>Customer</span>
            <span>Unit</span>
            <span>Total</span>
            <span>Status</span>
            <span>Date</span>
            <span>Actions</span>
          </div>
          {rows.map(inv => {
            const st = STATUS_STYLE[inv.status] ?? STATUS_STYLE.unpaid
            return (
              <div
                key={inv.id}
                className="grid gap-3 px-4 py-3 items-center"
                style={{ gridTemplateColumns: GRID_COLS, borderBottom: '1px solid #F3F4F6' }}
              >
                <span className="font-mono text-xs font-semibold" style={{ color: ORANGE }}>{inv.invoice_number}</span>
                <span className="text-sm font-medium truncate" style={{ color: '#1A1A1A' }}>{inv.customer_name}</span>
                <span className="text-sm truncate" style={{ color: '#6B7280' }}>
                  {[inv.unit_manufacturer, inv.unit_model].filter(Boolean).join(' ') || '—'}
                </span>
                <span className="text-sm font-semibold" style={{ color: '#1A1A1A' }}>{fmt(inv.total)}</span>
                <span>
                  <span className="text-xs font-semibold px-2 py-1 rounded-full capitalize" style={{ background: st.bg, color: st.color }}>
                    {inv.status}
                  </span>
                </span>
                <span className="text-xs" style={{ color: '#9CA3AF' }}>
                  {inv.status === 'paid' && inv.paid_at ? fmtDate(inv.paid_at) : fmtDate(inv.created_at)}
                </span>
                <InvoiceListActions invoiceId={inv.id} invoiceNumber={inv.invoice_number} currentStatus={inv.status} />
              </div>
            )
          })}
        </div>

        {/* Mobile cards (below md) */}
        <div className="block md:hidden">
          {rows.map(inv => {
            const st = STATUS_STYLE[inv.status] ?? STATUS_STYLE.unpaid
            const unit = [inv.unit_manufacturer, inv.unit_model].filter(Boolean).join(' ')
            return (
              <div key={inv.id} className="p-4" style={{ borderBottom: '1px solid #F3F4F6' }}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-mono text-xs font-semibold" style={{ color: ORANGE }}>{inv.invoice_number}</span>
                  <span className="text-xs font-semibold px-2 py-1 rounded-full capitalize" style={{ background: st.bg, color: st.color }}>{inv.status}</span>
                </div>
                <p className="text-sm font-medium" style={{ color: '#1A1A1A' }}>{inv.customer_name}</p>
                {unit && <p className="text-xs" style={{ color: '#6B7280' }}>{unit}</p>}
                <p className="text-sm mt-1" style={{ color: '#1A1A1A' }}>
                  <span className="font-semibold">{fmt(inv.total)}</span>
                  <span style={{ color: '#9CA3AF' }}> • {inv.status === 'paid' && inv.paid_at ? fmtDate(inv.paid_at) : fmtDate(inv.created_at)}</span>
                </p>
                <div className="mt-3">
                  <InvoiceListActions invoiceId={inv.id} invoiceNumber={inv.invoice_number} currentStatus={inv.status} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {error && (
        <p className="text-sm mt-3 px-4 py-2.5 rounded-lg" style={{ background: '#FEE2E2', color: '#b91c1c', border: '1px solid #FECACA' }}>
          {error}
        </p>
      )}

      {hasMore && (
        <div className="flex flex-col items-center gap-2 mt-4">
          <p className="text-xs" style={{ color: '#9CA3AF' }}>
            Showing {rows.length.toLocaleString()} of {total.toLocaleString()}
          </p>
          <button
            onClick={loadMore}
            disabled={loading}
            className="px-5 py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50"
            style={{ background: '#FFFFFF', color: ORANGE, border: `1px solid ${ORANGE}`, minHeight: 44 }}
          >
            {loading ? 'Loading…' : 'Load More'}
          </button>
        </div>
      )}
    </>
  )
}
