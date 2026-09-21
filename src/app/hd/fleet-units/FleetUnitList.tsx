'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FLEET_UNIT_PAGE_SIZE, type FleetUnitListRow } from '@/app/api/hd/fleet-units/list'

const HD_ORANGE = '#E85D24'

function pmBadge(totalHours: number | null, nextDue: number | null): { label: string; color: string } | null {
  if (nextDue == null || totalHours == null) return null
  const t = Number(totalHours), n = Number(nextDue)
  if (t > n)       return { label: 'PM OVERDUE',  color: '#EF4444' }
  if (t > n - 150) return { label: 'PM DUE SOON', color: '#F59E0B' }
  return { label: 'PM Current', color: '#22C55E' }
}

/**
 * The fleet-units table plus its "Load More" control.
 *
 * The first page is server-rendered; every page after it comes from
 * GET /api/hd/fleet-units under the same ordering and the same fleet-account
 * filter, so the offsets line up. `total` is the server's exact count for that
 * same filter, and is what decides whether more rows remain.
 *
 * Switching fleet accounts is a URL navigation, and the page remounts this
 * component on that change, which resets the accumulated rows to the new first
 * page — appending across a filter change would mix two fleets in one table.
 */
export default function FleetUnitList({
  initialRows,
  total,
  fleetAccountId,
  fleetAccountName,
  scopedAccountId,
}: {
  initialRows:      FleetUnitListRow[]
  total:            number
  fleetAccountId:   string | null
  fleetAccountName: string | null
  scopedAccountId:  string | null
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
        limit:  String(FLEET_UNIT_PAGE_SIZE),
        offset: String(rows.length),
      })
      if (fleetAccountId) params.set('fleet_account_id', fleetAccountId)

      const res  = await fetch(`/api/hd/fleet-units?${params}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to load more units')
      const next = (body.units ?? []) as FleetUnitListRow[]
      setRows(prev => [...prev, ...next])
      // A short page means the table is exhausted.
      if (next.length < FLEET_UNIT_PAGE_SIZE) setExhausted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more units')
    } finally {
      setLoading(false)
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--hd-border)' }}>
        <div className="py-16 text-center" style={{ background: 'var(--hd-card)' }}>
          <svg className="w-10 h-10 mx-auto mb-3" style={{ color: 'rgba(var(--hd-ink-rgb), 0.15)' }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <rect x="1" y="3" width="15" height="13" rx="2" />
            <path d="M16 8h4l3 5v3h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
          <p className="text-sm mb-1" style={{ color: 'rgba(var(--hd-ink-rgb), 0.3)' }}>
            {fleetAccountName ? `No units for ${fleetAccountName} yet` : 'No fleet units yet'}
          </p>
          <p className="text-xs mb-3" style={{ color: 'rgba(var(--hd-ink-rgb), 0.2)' }}>Add your refrigerated units to start tracking PMs and work orders</p>
          <Link href={scopedAccountId ? `?new=1&fleet_account_id=${scopedAccountId}` : '?new=1'} className="text-xs px-4 py-2 rounded-lg font-semibold" style={{ background: HD_ORANGE, color: 'var(--hd-text)' }}>
            + Add First Unit
          </Link>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--hd-border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]" style={{ background: 'var(--hd-card)' }}>
            <thead style={{ background: 'var(--hd-inner)' }}>
              <tr>
                {['Unit #', 'Fleet', 'Manufacturer / Model', 'Serial / BM', 'Total Hours', 'Next PM', 'PM Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((u, i) => {
                const hoursUntil = u.next_pm_due_hours !== null && u.total_hours !== null
                  ? Number(u.next_pm_due_hours) - Number(u.total_hours)
                  : null
                const badge = pmBadge(u.total_hours, u.next_pm_due_hours)
                return (
                  <tr key={u.id} style={{ borderTop: i > 0 ? '1px solid var(--hd-border)' : undefined }}>
                    <td className="px-4 py-3 text-sm text-white font-medium">{u.unit_number}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'rgba(var(--hd-ink-rgb), 0.6)' }}>{u.fleet_account?.fleet_name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-white">{u.manufacturer} {u.model}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'rgba(var(--hd-ink-rgb), 0.5)' }}>
                      {u.serial_number ?? '—'}{u.bm_number ? ` · BM ${u.bm_number}` : ''}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'rgba(var(--hd-ink-rgb), 0.7)' }}>
                      {u.total_hours !== null ? `${Number(u.total_hours).toFixed(0)} hrs` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {hoursUntil !== null ? (
                        <span style={{ color: hoursUntil <= 0 ? '#EF4444' : hoursUntil <= 150 ? HD_ORANGE : '#22C55E' }}>
                          {hoursUntil <= 0 ? 'OVERDUE' : `${hoursUntil.toFixed(0)} hrs`}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {badge ? (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${badge.color}20`, color: badge.color }}>
                          {badge.label}
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: 'rgba(var(--hd-ink-rgb), 0.3)' }}>—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 justify-end">
                        <Link
                          href={`/hd/fleet-units/${u.id}/inspections`}
                          className="text-xs font-semibold px-3 py-1 rounded-lg whitespace-nowrap"
                          style={{ color: 'rgba(var(--hd-ink-rgb), 0.6)', border: '1px solid var(--hd-border)' }}
                        >
                          Inspections
                        </Link>
                        <Link
                          href={scopedAccountId ? `?edit=${u.id}&fleet_account_id=${scopedAccountId}` : `?edit=${u.id}`}
                          className="text-xs font-semibold px-3 py-1 rounded-lg"
                          style={{ color: '#60A5FA', border: '1px solid var(--hd-border)' }}
                        >
                          Edit
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
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
