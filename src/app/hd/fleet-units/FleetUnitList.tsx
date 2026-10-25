'use client'

import { useState } from 'react'
import Link from 'next/link'
import { FLEET_UNIT_PAGE_SIZE, type FleetUnitListRow } from '@/app/api/hd/fleet-units/list'
import type { EquipmentCategory } from '@/lib/hd/equipment-categories'
import { textTone, tint } from '@/lib/hd/text-tone'

const HD_ORANGE = '#E85D24'

// The bulk picker needs a value for "Uncategorized" that is not the empty placeholder.
const UNCATEGORIZED = '__none__'

function pmBadge(totalHours: number | null, nextDue: number | null): { label: string; color: string } | null {
  if (nextDue == null || totalHours == null) return null
  const t = Number(totalHours), n = Number(nextDue)
  if (t > n)       return { label: 'PM OVERDUE',  color: 'var(--hd-negative)' }
  if (t > n - 150) return { label: 'PM DUE SOON', color: 'var(--hd-warn)' }
  return { label: 'PM Current', color: 'var(--hd-positive)' }
}

/** POST /api/hd/fleet-units/category. Throws the server's readable error. */
async function saveCategory(unitIds: string[], categoryId: string | null) {
  const res  = await fetch('/api/hd/fleet-units/category', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ unit_ids: unitIds, category_id: categoryId }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? 'Could not save the category')
  return body as { updated: number; units: { id: string; category_id: string | null }[] }
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
 *
 * Category: each row's dropdown saves on change; the checkboxes plus "Set category
 * for selected" save many at once (spec section 6). Both go through
 * POST /api/hd/fleet-units/category, which checks every id is this shop's. Only
 * active categories are offered, plus a unit's current one if it was deactivated, so
 * opening the dropdown never silently moves a unit.
 */
export default function FleetUnitList({
  initialRows,
  total,
  fleetAccountId,
  fleetAccountName,
  scopedAccountId,
  categories,
}: {
  initialRows:      FleetUnitListRow[]
  total:            number
  fleetAccountId:   string | null
  fleetAccountName: string | null
  scopedAccountId:  string | null
  categories:       EquipmentCategory[]   // every category, inactive included
}) {
  const [rows,      setRows]      = useState(initialRows)
  const [exhausted, setExhausted] = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const [selected,  setSelected]  = useState<Set<string>>(new Set())
  const [bulkCat,   setBulkCat]   = useState('')
  const [saving,    setSaving]    = useState<Set<string>>(new Set())
  const [catError,  setCatError]  = useState<string | null>(null)
  const [catNotice, setCatNotice] = useState<string | null>(null)

  const hasMore = !exhausted && rows.length < total

  const byId       = new Map(categories.map(c => [c.id, c]))
  const activeCats = categories.filter(c => c.is_active)
  const optionsFor = (currentId: string | null) => {
    const cur = currentId ? byId.get(currentId) : undefined
    return cur && !cur.is_active ? [...activeCats, cur] : activeCats
  }

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

  // Apply the saved category_id values to the rows on screen - from the server's
  // answer, not from what was picked, so the table shows what was actually stored.
  function applySaved(units: { id: string; category_id: string | null }[]) {
    const saved = new Map(units.map(u => [u.id, u.category_id]))
    setRows(prev => prev.map(r => (saved.has(r.id) ? { ...r, category_id: saved.get(r.id) ?? null } : r)))
  }

  async function setCategory(unitIds: string[], categoryId: string | null) {
    setCatError(null)
    setCatNotice(null)
    setSaving(prev => new Set([...prev, ...unitIds]))
    try {
      const out = await saveCategory(unitIds, categoryId)
      applySaved(out.units ?? [])
      return out
    } catch (e) {
      setCatError(e instanceof Error ? e.message : 'Could not save the category')
      return null
    } finally {
      setSaving(prev => {
        const next = new Set(prev)
        unitIds.forEach(id => next.delete(id))
        return next
      })
    }
  }

  async function applyBulk() {
    if (!bulkCat || selected.size === 0) return
    const ids = [...selected]
    const out = await setCategory(ids, bulkCat === UNCATEGORIZED ? null : bulkCat)
    if (out) {
      const name = bulkCat === UNCATEGORIZED ? 'Uncategorized' : byId.get(bulkCat)?.name ?? 'category'
      setCatNotice(`Set ${out.updated} unit${out.updated !== 1 ? 's' : ''} to ${name}`)
      setSelected(new Set())
      setBulkCat('')
    }
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const allLoadedSelected = rows.length > 0 && rows.every(r => selected.has(r.id))
  function toggleAll() {
    setSelected(allLoadedSelected ? new Set() : new Set(rows.map(r => r.id)))
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--hd-border)' }}>
        <div className="py-16 text-center" style={{ background: 'var(--hd-card)' }}>
          <svg className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--hd-text-faint)' }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <rect x="1" y="3" width="15" height="13" rx="2" />
            <path d="M16 8h4l3 5v3h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
          </svg>
          <p className="text-sm mb-1" style={{ color: 'var(--hd-text-faint)' }}>
            {fleetAccountName ? `No units for ${fleetAccountName} yet` : 'No fleet units yet'}
          </p>
          <p className="text-xs mb-3" style={{ color: 'var(--hd-text-faint)' }}>Add your refrigerated units to start tracking PMs and work orders</p>
          <Link href={scopedAccountId ? `?new=1&fleet_account_id=${scopedAccountId}` : '?new=1'} className="text-xs px-4 py-2 rounded-lg font-semibold" style={{ background: HD_ORANGE, color: 'var(--hd-text)' }}>
            + Add First Unit
          </Link>
        </div>
      </div>
    )
  }

  const selectStyle = { background: 'var(--hd-inner)', border: '1px solid var(--hd-border)' }

  return (
    <>
      {/* Bulk categorize - shown once anything is ticked. */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-3 px-4 py-3 rounded-xl" style={{ background: 'var(--hd-card)', border: `1px solid ${tint(HD_ORANGE, 31)}` }}>
          <span className="text-sm text-white font-semibold">{selected.size} selected</span>
          <select
            aria-label="Category for selected units"
            value={bulkCat}
            onChange={e => setBulkCat(e.target.value)}
            className="px-3 py-2 rounded-lg text-sm text-white"
            style={selectStyle}
          >
            <option value="">Choose category…</option>
            {activeCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={UNCATEGORIZED}>Uncategorized</option>
          </select>
          <button
            type="button"
            onClick={applyBulk}
            disabled={!bulkCat || saving.size > 0}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-on-accent disabled:opacity-50"
            style={{ background: HD_ORANGE }}
          >
            Set category for selected
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs underline"
            style={{ color: 'var(--hd-text-muted)' }}
          >
            Clear selection
          </button>
        </div>
      )}

      {catError && (
        <p className="text-sm mb-3 px-4 py-2.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--hd-negative)', border: '1px solid rgba(239,68,68,0.3)' }}>
          {catError}
        </p>
      )}
      {catNotice && (
        <p className="text-sm mb-3 px-4 py-2.5 rounded-lg" style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--hd-positive)', border: '1px solid rgba(34,197,94,0.3)' }}>
          ✓ {catNotice}
        </p>
      )}

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--hd-border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]" style={{ background: 'var(--hd-card)' }}>
            <thead style={{ background: 'var(--hd-inner)' }}>
              <tr>
                <th className="pl-4 pr-1 py-3 text-left w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all loaded units"
                    checked={allLoadedSelected}
                    onChange={toggleAll}
                  />
                </th>
                {['Unit #', 'Category', 'Fleet', 'Manufacturer / Model', 'Serial / BM', 'Total Hours', 'Next PM', 'PM Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs uppercase tracking-wider" style={{ color: 'var(--hd-text-faint)' }}>{h}</th>
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
                    <td className="pl-4 pr-1 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select unit ${u.unit_number}`}
                        checked={selected.has(u.id)}
                        onChange={() => toggle(u.id)}
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-white font-medium">{u.unit_number}</td>
                    <td className="px-4 py-3">
                      <select
                        name="unit_category"
                        aria-label={`Category for unit ${u.unit_number}`}
                        value={u.category_id ?? ''}
                        disabled={saving.has(u.id)}
                        onChange={e => setCategory([u.id], e.target.value || null)}
                        className="px-2 py-1.5 rounded-lg text-xs text-white disabled:opacity-50"
                        style={selectStyle}
                      >
                        <option value="">Uncategorized</option>
                        {optionsFor(u.category_id).map(c => (
                          <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : ' (inactive)'}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--hd-text-muted)' }}>{u.fleet_account?.fleet_name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-white">{u.manufacturer} {u.model}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--hd-text-muted)' }}>
                      {u.serial_number ?? '—'}{u.bm_number ? ` · BM ${u.bm_number}` : ''}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'rgba(var(--hd-ink-rgb), 0.7)' }}>
                      {u.total_hours !== null ? `${Number(u.total_hours).toFixed(0)} hrs` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {hoursUntil !== null ? (
                        <span style={{ color: textTone(hoursUntil <= 0 ? 'var(--hd-negative)' : hoursUntil <= 150 ? 'var(--hd-accent-text)' : 'var(--hd-positive)') }}>
                          {hoursUntil <= 0 ? 'OVERDUE' : `${hoursUntil.toFixed(0)} hrs`}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {badge ? (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${tint(badge.color, 13)}`, color: textTone(badge.color) }}>
                          {badge.label}
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--hd-text-faint)' }}>—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 justify-end">
                        <Link
                          href={`/hd/fleet-units/${u.id}/inspections`}
                          className="text-xs font-semibold px-3 py-1 rounded-lg whitespace-nowrap"
                          style={{ color: 'var(--hd-text-muted)', border: '1px solid var(--hd-border)' }}
                        >
                          Inspections
                        </Link>
                        <Link
                          href={scopedAccountId ? `?edit=${u.id}&fleet_account_id=${scopedAccountId}` : `?edit=${u.id}`}
                          className="text-xs font-semibold px-3 py-1 rounded-lg"
                          style={{ color: 'var(--hd-info)', border: '1px solid var(--hd-border)' }}
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
        <p className="text-sm mt-3 px-4 py-2.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--hd-negative)', border: '1px solid rgba(239,68,68,0.3)' }}>
          {error}
        </p>
      )}

      {hasMore && (
        <div className="flex flex-col items-center gap-2 mt-4">
          <p className="text-xs" style={{ color: 'var(--hd-text-faint)' }}>
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
