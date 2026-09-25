'use client'

import { useState } from 'react'
import Link from 'next/link'
import { WORK_ORDER_PAGE_SIZE, type WorkOrderListRow } from '@/app/api/hd/work-orders/list'
import { money } from '@/lib/format'

const HD_ORANGE = '#E85D24'

function statusColor(s: string) {
  return s === 'in_progress' ? HD_ORANGE : s === 'completed' ? '#22C55E' : s === 'invoiced' ? '#3B82F6' : 'rgba(var(--hd-ink-rgb), 0.4)'
}
function statusLabel(s: string) {
  return s === 'in_progress' ? 'In Progress' : s === 'completed' ? 'Completed' : s === 'invoiced' ? 'Invoiced' : 'Open'
}

/**
 * The work-order table plus its "Load More" control.
 *
 * The first page is rendered on the server; every page after it comes from
 * GET /api/hd/work-orders with the same ordering, so offsets line up exactly.
 * `total` is the server's exact count, which is what decides whether there is
 * more to fetch — a first page that happens to be exactly PAGE_SIZE long tells
 * us nothing on its own.
 */
export default function WorkOrderList({
  initialRows,
  total,
}: {
  initialRows: WorkOrderListRow[]
  total:       number
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
      const res = await fetch(`/api/hd/work-orders?limit=${WORK_ORDER_PAGE_SIZE}&offset=${rows.length}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to load more work orders')
      const next = (body.work_orders ?? []) as WorkOrderListRow[]
      setRows(prev => [...prev, ...next])
      // A short page means the table is exhausted.
      if (next.length < WORK_ORDER_PAGE_SIZE) setExhausted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more work orders')
    } finally {
      setLoading(false)
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--hd-border)' }}>
        <div className="py-16 text-center" style={{ background: 'var(--hd-card)' }}>
          <p className="text-sm mb-2" style={{ color: 'rgba(var(--hd-ink-rgb), 0.3)' }}>No work orders yet</p>
          <p className="text-xs" style={{ color: 'rgba(var(--hd-ink-rgb), 0.2)' }}>Create a work order to track service on a fleet unit</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--hd-border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]" style={{ background: 'var(--hd-card)' }}>
            <thead style={{ background: 'var(--hd-inner)' }}>
              <tr>
                {['WO #', 'Fleet / Unit', 'Service', 'Tech', 'Status', 'Total', 'Date'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((wo, i) => (
                <tr key={wo.id} className="cursor-pointer hover:bg-white/[0.02] transition-colors" style={{ borderTop: i > 0 ? '1px solid var(--hd-border)' : undefined }}>
                  <td className="px-4 py-3 text-sm text-white font-medium">
                    <Link href={`/hd/work-orders/${wo.id}`} className="hover:underline">
                      {wo.work_order_number ?? `WO-${wo.id.slice(0, 6).toUpperCase()}`}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'rgba(var(--hd-ink-rgb), 0.7)' }}>
                    <Link href={`/hd/work-orders/${wo.id}`} className="block">
                      {wo.fleet?.fleet_name ?? '—'}
                      {wo.unit && <span className="block text-xs" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>{wo.unit.unit_number} — {wo.unit.manufacturer}</span>}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'rgba(var(--hd-ink-rgb), 0.6)' }}>
                    <Link href={`/hd/work-orders/${wo.id}`} className="block">{wo.service_type ?? '—'}</Link>
                  </td>
                  <td className="px-4 py-3 text-sm" style={{ color: 'rgba(var(--hd-ink-rgb), 0.6)' }}>
                    <Link href={`/hd/work-orders/${wo.id}`} className="block">{wo.tech_name ?? '—'}</Link>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/hd/work-orders/${wo.id}`} className="block">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: `${statusColor(wo.status)}20`, color: statusColor(wo.status) }}>
                        {statusLabel(wo.status)}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-white">
                    <Link href={`/hd/work-orders/${wo.id}`} className="block">
                      {wo.total_amount ? `${money(Number(wo.total_amount))}` : '—'}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>
                    <Link href={`/hd/work-orders/${wo.id}`} className="block">
                      {new Date(wo.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error && (
        <p className="text-sm mt-3 px-4 py-2.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)' }}>
          {error}
        </p>
      )}

      {hasMore && (
        <div className="flex flex-col items-center gap-2 mt-4">
          <p className="text-xs" style={{ color: 'rgba(var(--hd-ink-rgb), 0.3)' }}>
            Showing {rows.length.toLocaleString()} of {total.toLocaleString()}
          </p>
          <button
            onClick={loadMore}
            disabled={loading}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ color: 'rgba(var(--hd-ink-rgb), 0.7)', background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}
          >
            {loading ? 'Loading…' : 'Load More'}
          </button>
        </div>
      )}
    </>
  )
}
