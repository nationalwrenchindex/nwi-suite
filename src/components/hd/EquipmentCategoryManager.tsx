'use client'

import { useState } from 'react'
import type { EquipmentCategory } from '@/lib/hd/equipment-categories'
import { tint } from '@/lib/hd/text-tone'

const HD_ORANGE = '#E85D24'

type Call = { method: 'POST' | 'PATCH'; body: Record<string, unknown> }

/**
 * Rename, reorder, deactivate / reactivate and add the shop's equipment categories.
 *
 * Every change goes to /api/hd/equipment-categories, which answers with the full list
 * as saved; the screen re-renders from that answer rather than from what was typed, so
 * it never shows an order or a name the server refused. A 409 (a name already taken,
 * in any letter case) comes back as a sentence and is shown as-is.
 */
export default function EquipmentCategoryManager({
  initialCategories,
  unitCounts,
  uncategorizedCount,
}: {
  initialCategories:  EquipmentCategory[]
  unitCounts:         Record<string, number>
  uncategorizedCount: number
}) {
  const [cats,    setCats]    = useState(initialCategories)
  const [drafts,  setDrafts]  = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [notice,  setNotice]  = useState<string | null>(null)

  async function call({ method, body }: Call, done: string): Promise<boolean> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res  = await fetch('/api/hd/equipment-categories', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not save')
      setCats(json.categories as EquipmentCategory[])
      setNotice(done)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function rename(c: EquipmentCategory) {
    const name = (drafts[c.id] ?? c.name).trim()
    if (name === c.name) return
    if (await call({ method: 'PATCH', body: { id: c.id, name } }, `Renamed to ${name}`)) {
      setDrafts(d => { const n = { ...d }; delete n[c.id]; return n })
    }
  }

  function move(index: number, delta: -1 | 1) {
    const to = index + delta
    if (to < 0 || to >= cats.length) return
    const order = cats.map(c => c.id)
    ;[order[index], order[to]] = [order[to], order[index]]
    call({ method: 'PATCH', body: { order } }, 'Order saved')
  }

  async function add() {
    const name = newName.trim()
    if (!name) return
    if (await call({ method: 'POST', body: { name } }, `Added ${name}`)) setNewName('')
  }

  const inputStyle = { background: 'var(--hd-inner)', border: '1px solid var(--hd-border)' }
  const smallBtn   = { color: 'rgba(var(--hd-ink-rgb), 0.7)', border: '1px solid var(--hd-border)' }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm px-4 py-2.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--hd-negative)', border: '1px solid rgba(239,68,68,0.3)' }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm px-4 py-2.5 rounded-lg" style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--hd-positive)', border: '1px solid rgba(34,197,94,0.3)' }}>
          ✓ {notice}
        </p>
      )}

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--hd-border)', background: 'var(--hd-card)' }}>
        {cats.length === 0 && (
          <p className="px-4 py-6 text-sm text-center" style={{ color: 'var(--hd-text-faint)' }}>
            No categories yet — add your first one below.
          </p>
        )}
        {cats.map((c, i) => {
          const draft = drafts[c.id] ?? c.name
          const dirty = draft.trim() !== c.name
          const count = unitCounts[c.id] ?? 0
          return (
            <div
              key={c.id}
              data-category-row={c.name}
              className="flex flex-wrap items-center gap-2 px-4 py-3"
              style={{ borderTop: i > 0 ? '1px solid var(--hd-border)' : undefined, opacity: c.is_active ? 1 : 0.6 }}
            >
              <div className="flex flex-col">
                <button type="button" aria-label={`Move ${c.name} up`} disabled={busy || i === 0}
                  onClick={() => move(i, -1)} className="text-xs px-1.5 leading-none disabled:opacity-30" style={{ color: 'var(--hd-text-muted)' }}>▲</button>
                <button type="button" aria-label={`Move ${c.name} down`} disabled={busy || i === cats.length - 1}
                  onClick={() => move(i, 1)} className="text-xs px-1.5 leading-none disabled:opacity-30" style={{ color: 'var(--hd-text-muted)' }}>▼</button>
              </div>
              <input
                aria-label={`Name for ${c.name}`}
                value={draft}
                maxLength={60}
                onChange={e => setDrafts(d => ({ ...d, [c.id]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); rename(c) } }}
                className="flex-1 min-w-[160px] px-3 py-2 rounded-lg text-sm text-white"
                style={inputStyle}
              />
              {dirty && (
                <button type="button" disabled={busy || !draft.trim()} onClick={() => rename(c)}
                  className="text-xs font-semibold px-3 py-2 rounded-lg text-on-accent disabled:opacity-50" style={{ background: HD_ORANGE }}>
                  Rename
                </button>
              )}
              <span className="text-xs w-20 text-right" style={{ color: 'var(--hd-text-faint)' }}>
                {count} unit{count !== 1 ? 's' : ''}
              </span>
              {!c.is_active && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(var(--hd-ink-rgb), 0.1)', color: 'var(--hd-text-muted)' }}>
                  Inactive
                </span>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => call(
                  { method: 'PATCH', body: { id: c.id, is_active: !c.is_active } },
                  `${c.name} ${c.is_active ? 'deactivated' : 'reactivated'}`,
                )}
                className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
                style={smallBtn}
              >
                {c.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          )
        })}
      </div>

      <p className="text-xs" style={{ color: 'var(--hd-text-faint)' }}>
        {uncategorizedCount} unit{uncategorizedCount !== 1 ? 's are' : ' is'} Uncategorized. Set them from the Category column on the units list.
      </p>

      <form
        onSubmit={e => { e.preventDefault(); add() }}
        className="flex flex-wrap items-center gap-2 rounded-xl px-4 py-3"
        style={{ background: 'var(--hd-card)', border: `1px solid ${tint(HD_ORANGE, 31)}` }}
      >
        <input
          name="new_category"
          aria-label="New category name"
          value={newName}
          maxLength={60}
          onChange={e => setNewName(e.target.value)}
          placeholder="e.g. Crane, Chipper"
          className="flex-1 min-w-[160px] px-3 py-2 rounded-lg text-sm text-white placeholder-white/20"
          style={inputStyle}
        />
        <button type="submit" disabled={busy || !newName.trim()}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-on-accent disabled:opacity-50" style={{ background: HD_ORANGE }}>
          Add category
        </button>
      </form>
    </div>
  )
}
