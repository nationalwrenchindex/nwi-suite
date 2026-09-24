'use client'

// List + Load More. Page one arrives server-rendered; this owns everything after.
//
// The header count comes from the server's exact/head query, not from rows.length,
// so it reads the real total while only 50 rows are loaded. Changing the status
// filter resets the offset and REPLACES the rows — appending would mix one filter's
// results into another's.

import { useState } from 'react'
import Link from 'next/link'
import {
  STATUS_META, WORK_ORDER_STATUSES, unitLabelFor,
  type WorkOrder, type WorkOrderStatus,
} from '@/types/work-orders'
import { WORK_ORDER_PAGE_SIZE } from '@/app/api/work-orders/list'

const fmt = (n: number | null | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0)

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function StatusBadge({ status }: { status: WorkOrderStatus }) {
  const m = STATUS_META[status]
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide"
      style={{ backgroundColor: m.bg, color: m.text }}
    >
      {m.label}
    </span>
  )
}

export default function WorkOrderList({
  initialRows,
  total: initialTotal,
}: {
  initialRows: WorkOrder[]
  total:       number
}) {
  const [rows,   setRows]   = useState(initialRows)
  const [total,  setTotal]  = useState(initialTotal)
  const [filter, setFilter] = useState<WorkOrderStatus | 'all'>('all')
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState<string | null>(null)
  // Set the moment a page comes back short, so Load More hides on the last page
  // even when the count and the row total disagree.
  const [exhausted, setExhausted] = useState(initialRows.length < WORK_ORDER_PAGE_SIZE)

  async function load(offset: number, status: WorkOrderStatus | 'all', replace: boolean) {
    setLoading(true); setErr(null)
    try {
      const qs = new URLSearchParams({ limit: String(WORK_ORDER_PAGE_SIZE), offset: String(offset) })
      if (status !== 'all') qs.set('status', status)
      const res = await fetch(`/api/work-orders?${qs}`)
      const d   = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Could not load work orders')
      const page = (d.work_orders ?? []) as WorkOrder[]
      setRows(replace ? page : [...rows, ...page])
      setTotal(Number(d.count ?? 0))
      setExhausted(page.length < WORK_ORDER_PAGE_SIZE)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load work orders')
    }
    setLoading(false)
  }

  function changeFilter(next: WorkOrderStatus | 'all') {
    setFilter(next)
    setRows([])
    load(0, next, true)
  }

  const hasMore = !exhausted && rows.length < total

  return (
    <div className="space-y-4">
      {err && <div className="alert-error">{err}</div>}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {(['all', ...WORK_ORDER_STATUSES] as const).map(s => (
          <button
            key={s}
            onClick={() => changeFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === s
                ? 'bg-orange text-white'
                : 'border border-white/15 text-white/50 hover:text-white hover:border-white/30'
            }`}
          >
            {s === 'all' ? 'All' : STATUS_META[s].label}
          </button>
        ))}
        <span className="ml-auto text-white/40 text-xs uppercase tracking-widest">
          {total} Work Order{total !== 1 ? 's' : ''}
          {rows.length < total ? ` · showing ${rows.length}` : ''}
        </span>
      </div>

      {rows.length === 0 && !loading ? (
        <div className="py-16 text-center rounded-xl border border-white/10">
          <p className="text-white/30 text-sm">
            {filter === 'all' ? 'No work orders yet.' : `No ${STATUS_META[filter as WorkOrderStatus].label.toLowerCase()} work orders.`}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <div className="hidden md:grid grid-cols-[110px_1fr_1fr_100px_110px_90px] gap-2 px-4 py-2 border-b border-white/10 bg-white/5">
            <span className="text-white/30 text-[10px] uppercase tracking-wider">WO #</span>
            <span className="text-white/30 text-[10px] uppercase tracking-wider">Customer</span>
            <span className="text-white/30 text-[10px] uppercase tracking-wider">Unit</span>
            <span className="text-white/30 text-[10px] uppercase tracking-wider">PO #</span>
            <span className="text-white/30 text-[10px] uppercase tracking-wider">Status</span>
            <span className="text-white/30 text-[10px] uppercase tracking-wider text-right">Total</span>
          </div>

          {rows.map(wo => (
            <Link
              key={wo.id}
              href={`/work-orders/${wo.id}`}
              className="block px-4 py-3 border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors"
            >
              {/* Mobile */}
              <div className="md:hidden space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-orange font-mono text-xs">{wo.work_order_number}</span>
                  <StatusBadge status={wo.status} />
                </div>
                <p className="text-white/80 text-sm">
                  {wo.customer ? `${wo.customer.first_name} ${wo.customer.last_name}` : '—'}
                </p>
                <div className="flex flex-wrap items-center gap-x-4 text-xs">
                  <span className="text-white/40">{unitLabelFor(wo)}</span>
                  {wo.po_number && <span className="text-white/40">PO {wo.po_number}</span>}
                  <span className="text-white font-medium">{fmt(wo.grand_total)}</span>
                </div>
              </div>

              {/* Desktop */}
              <div className="hidden md:grid grid-cols-[110px_1fr_1fr_100px_110px_90px] gap-2 items-center">
                <span className="text-orange font-mono text-xs">{wo.work_order_number}</span>
                <span className="text-white/80 text-sm truncate">
                  {wo.customer ? `${wo.customer.first_name} ${wo.customer.last_name}` : '—'}
                </span>
                <span className="text-white/50 text-sm truncate">{unitLabelFor(wo)}</span>
                <span className="text-white/50 text-sm truncate">{wo.po_number ?? '—'}</span>
                <span><StatusBadge status={wo.status} /></span>
                <span className="text-white text-sm font-medium text-right">{fmt(wo.grand_total)}</span>
              </div>
            </Link>
          ))}

          {hasMore && (
            <button
              onClick={() => load(rows.length, filter, false)}
              disabled={loading}
              className="w-full px-4 py-3 text-white/40 hover:text-orange hover:bg-white/5 text-xs transition-colors border-t border-white/5 disabled:opacity-50"
            >
              {loading ? 'Loading…' : `Load More (${total - rows.length} remaining)`}
            </button>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <p className="text-white/25 text-[11px]">
          Opened {fmtDate(rows[0]?.created_at)} — most recent first.
        </p>
      )}
    </div>
  )
}
