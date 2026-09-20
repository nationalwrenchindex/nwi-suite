'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FLEET_ACCOUNT_PAGE_SIZE, type FleetAccountListRow } from '@/app/api/hd/fleet-accounts/list'

const HD_ORANGE = '#E85D24'

/**
 * The fleet-account card grid plus its "Load More" control.
 *
 * The first page is server-rendered; every page after it comes from
 * GET /api/hd/fleet-accounts under the same ordering, so the offsets line up.
 * `total` is the server's exact count and is what decides whether more remain —
 * a first page that is exactly PAGE_SIZE long tells us nothing on its own.
 */
export default function FleetAccountList({
  initialRows,
  total,
}: {
  initialRows: FleetAccountListRow[]
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
      const res = await fetch(`/api/hd/fleet-accounts?limit=${FLEET_ACCOUNT_PAGE_SIZE}&offset=${rows.length}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to load more fleet accounts')
      const next = (body.fleet_accounts ?? []) as FleetAccountListRow[]
      setRows(prev => [...prev, ...next])
      // A short page means the table is exhausted.
      if (next.length < FLEET_ACCOUNT_PAGE_SIZE) setExhausted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more fleet accounts')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.length === 0 ? (
          <div className="col-span-full py-16 text-center rounded-xl" style={{ background: '#111920', border: '1px solid #1e3040' }}>
            <p className="text-sm mb-1" style={{ color: 'rgba(255,255,255,0.3)' }}>No fleet accounts yet</p>
            <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.2)' }}>Add commercial fleet customers to organize your service accounts</p>
            <Link href="?new=1" className="text-xs px-4 py-2 rounded-lg font-semibold" style={{ background: HD_ORANGE, color: '#fff' }}>
              + Add First Account
            </Link>
          </div>
        ) : (
          rows.map(a => (
            <div key={a.id} className="relative rounded-xl p-5 transition-colors hover:border-white/20" style={{ background: '#111920', border: '1px solid #1e3040' }}>
              {/* Full-card link to the detail page */}
              <Link href={`/hd/fleet-accounts/${a.id}`} className="absolute inset-0 rounded-xl" aria-label={`View ${a.fleet_name}`} />
              {/* Edit link sits above the overlay */}
              <Link
                href={`/hd/fleet-accounts/${a.id}?edit=1`}
                className="absolute top-3 right-3 z-10 text-xs font-semibold px-2.5 py-1 rounded-lg"
                style={{ color: '#60A5FA', border: '1px solid #1e3040', background: '#111920' }}
              >
                Edit
              </Link>
              <div className="relative pointer-events-none pr-12">
                <p className="font-condensed font-bold text-white text-lg tracking-wide">{a.fleet_name}</p>
                {a.contact_name  && <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>{a.contact_name}</p>}
                {a.contact_phone && <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{a.contact_phone}</p>}
                {a.contact_email && <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{a.contact_email}</p>}
                {a.address       && <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.3)' }}>📍 {a.address}</p>}
              </div>
            </div>
          ))
        )}
      </div>

      {error && (
        <p className="text-sm mt-3 px-4 py-2.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: '#EF4444', border: '1px solid rgba(239,68,68,0.3)' }}>
          {error}
        </p>
      )}

      {hasMore && (
        <div className="flex flex-col items-center gap-2 mt-4">
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Showing {rows.length.toLocaleString()} of {total.toLocaleString()}
          </p>
          <button
            onClick={loadMore}
            disabled={loading}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50"
            style={{ color: 'rgba(255,255,255,0.7)', background: '#111920', border: '1px solid #1e3040' }}
          >
            {loading ? 'Loading…' : 'Load More'}
          </button>
        </div>
      )}
    </>
  )
}
