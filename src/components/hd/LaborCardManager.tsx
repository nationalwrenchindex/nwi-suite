'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { tint } from '@/lib/hd/text-tone'
import {
  EMPTY_DRAFT, EQUIPMENT_TYPES, LABOR_CODE_PREFIX, cardNamed, cleanLaborCard, draftFromCard, equipmentTypeLabel,
  filterLaborCards, hoursText, type EquipmentType, type LaborCard, type LaborCardDraft, type LaborCardSort,
} from '@/lib/hd/labor-cards'

const HD_ORANGE = '#E85D24'
const STICKY_KEY = 'nwi.hd.laborCards.lastEquipment'

/**
 * The labor card builder: add, edit and delete the shop's own labor operations.
 *
 * Built for typing a few hundred in a sitting:
 *   - Enter (or Ctrl+Enter from anywhere in the form) saves, with no confirmation, and
 *     the form clears for the next card with the cursor back in the description.
 *   - The equipment type and category stay as they were for the next card.
 *   - Every field is reachable by Tab, in reading order. Escape leaves an edit.
 *
 * The list re-renders from what the server answered, never from what was typed, so a
 * card on screen is a card in the database.
 */
export default function LaborCardManager({
  initialCards,
  categories,
  reeferOnly = false,
}: {
  initialCards: LaborCard[]
  categories: { id: string; name: string }[]
  /** Reefer Standalone: every card is a reefer card. The type picker and type filter are
   *  hidden and the type is fixed at reefer; the API enforces the same. */
  reeferOnly?: boolean
}) {
  const [cards,     setCards]     = useState(initialCards)
  const [draft,     setDraftRaw]  = useState<LaborCardDraft>(reeferOnly ? { ...EMPTY_DRAFT, equipment_type: 'reefer' } : EMPTY_DRAFT)
  // Every draft change passes through here, so in reefer-only mode no path (a restored
  // sticky type, a cleared form, an edit) can leave the type anything but reefer.
  const setDraft = useCallback<typeof setDraftRaw>(v => setDraftRaw(d => {
    const next = typeof v === 'function' ? v(d) : v
    return reeferOnly && next.equipment_type !== 'reefer' ? { ...next, equipment_type: 'reefer' } : next
  }), [reeferOnly])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [notice,    setNotice]    = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const [search,     setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [catFilter,  setCatFilter]  = useState('')
  const [sort,       setSort]       = useState<LaborCardSort>('edited')

  const descRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // The last-used equipment survives a reload too. Per-browser convenience only.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STICKY_KEY)
      if (!raw) return
      const s = JSON.parse(raw) as { equipment_type?: string; equipment_category_id?: string }
      const type = EQUIPMENT_TYPES.some(t => t.value === s.equipment_type) ? s.equipment_type! : ''
      const cat  = categories.some(c => c.id === s.equipment_category_id) ? s.equipment_category_id! : ''
      setDraft(d => ({ ...d, equipment_type: type, equipment_category_id: cat }))
    } catch { /* storage unavailable */ }
  }, [categories, setDraft])

  const editing  = editingId ? cards.find(c => c.id === editingId) ?? null : null
  // Display only: a hint that the name is already taken, never a block or a merge.
  const sameName = cardNamed(cards, draft.description, editingId)
  // A code never changes, so a new type on an existing card keeps the old prefix.
  const newPrefix = LABOR_CODE_PREFIX[draft.equipment_type as EquipmentType]
  const prefixKept = editing && newPrefix && !editing.labor_code.startsWith(`${newPrefix}-`) ? editing.labor_code : null

  const catName = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])
  const shown = useMemo(
    () => filterLaborCards(cards, { search, equipmentType: typeFilter, categoryId: catFilter, sort }),
    [cards, search, typeFilter, catFilter, sort],
  )

  const set = (k: keyof LaborCardDraft) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft(d => ({ ...d, [k]: e.target.value }))

  function blankKeepingEquipment(d: LaborCardDraft): LaborCardDraft {
    return { ...EMPTY_DRAFT, equipment_type: d.equipment_type, equipment_category_id: d.equipment_category_id }
  }

  function focusDescription() {
    requestAnimationFrame(() => descRef.current?.focus())
  }

  async function save() {
    if (busy) return
    // The same rules the route applies, so a bad figure is caught before the round trip.
    const clean = cleanLaborCard(draft as unknown as Record<string, unknown>)
    if (!clean.ok) { setError(clean.error); setNotice(null); return }

    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(editingId ? `/api/hd/labor-cards/${editingId}` : '/api/hd/labor-cards', {
        method:  editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(draft),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.card) throw new Error(json.error ?? 'Could not save')
      const saved = json.card as LaborCard
      setCards(cs => [saved, ...cs.filter(c => c.id !== saved.id)])
      setNotice(`${editingId ? 'Updated' : 'Saved'}: ${saved.description}`)
      try {
        localStorage.setItem(STICKY_KEY, JSON.stringify({
          equipment_type: draft.equipment_type, equipment_category_id: draft.equipment_category_id,
        }))
      } catch { /* storage unavailable */ }
      setDraft(blankKeepingEquipment)
      setEditingId(null)
      focusDescription()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(c: LaborCard) {
    setEditingId(c.id)
    setDraft(draftFromCard(c))
    setError(null)
    setNotice(null)
    setConfirmId(null)
    formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    focusDescription()
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft(blankKeepingEquipment)
    setError(null)
    focusDescription()
  }

  async function remove(c: LaborCard) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/hd/labor-cards/${c.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not delete')
      setCards(cs => cs.filter(x => x.id !== c.id))
      if (editingId === c.id) { setEditingId(null); setDraft(blankKeepingEquipment) }
      setNotice(`Deleted: ${c.description}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete')
    } finally {
      setBusy(false)
      setConfirmId(null)
    }
  }

  // Ctrl/Cmd+Enter saves from any field; plain Enter on a select saves too, since a
  // select swallows Enter instead of submitting. Escape leaves an edit.
  function onFormKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (e.target as HTMLElement).tagName === 'SELECT')) {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape' && editingId) {
      e.preventDefault()
      cancelEdit()
    }
  }

  const inputStyle = { background: 'var(--hd-inner)', border: '1px solid var(--hd-border)' }
  const labelStyle = { color: 'var(--hd-text-muted)' }
  const muted      = { color: 'var(--hd-text-muted)' }
  const smallBtn   = { color: 'rgba(var(--hd-ink-rgb), 0.7)', border: '1px solid var(--hd-border)' }
  const field      = 'w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/20'
  const hours      = 'w-24 px-3 py-2 rounded-lg text-sm text-white placeholder-white/20'

  return (
    <div className="space-y-5">
      <form
        ref={formRef}
        data-testid="labor-card-form"
        onSubmit={e => { e.preventDefault(); save() }}
        onKeyDown={onFormKeyDown}
        className="rounded-xl p-4 space-y-3"
        style={{ background: 'var(--hd-card)', border: `1px solid ${editingId ? HD_ORANGE : `${HD_ORANGE}50`}` }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--hd-accent-text)' }}>
            {editing ? `Edit operation ${editing.labor_code}` : 'New operation'}
          </h2>
          <span className="text-xs" style={muted}>Enter saves · Esc cancels an edit</span>
        </div>

        <label className="block">
          <span className="text-xs font-semibold" style={labelStyle}>Operation</span>
          <input
            ref={descRef}
            name="description"
            autoFocus
            autoComplete="off"
            value={draft.description}
            onChange={set('description')}
            placeholder="e.g. R&R evaporator fan motor"
            maxLength={500}
            className={field}
            style={inputStyle}
          />
          {sameName && (
            <span data-testid="labor-card-same-name" className="block text-xs mt-1" style={{ color: 'var(--hd-warn)' }}>
              {`You already have a card named this (${sameName.labor_code}). Saving makes a second card with its own code.`}
            </span>
          )}
        </label>

        <div className="grid sm:grid-cols-2 gap-3">
          <fieldset>
            <legend className="text-xs font-semibold" style={labelStyle}>Field time (hrs) — no lift, no bay</legend>
            <div className="flex items-center gap-2 mt-1">
              <input name="mobile_low" aria-label="Field time hours, or low end of a range" inputMode="decimal" autoComplete="off"
                value={draft.mobile_low} onChange={set('mobile_low')} placeholder="1.5" className={hours} style={inputStyle} />
              <span className="text-xs" style={muted}>to</span>
              <input name="mobile_high" aria-label="Field time high end of a range (optional)" inputMode="decimal" autoComplete="off"
                value={draft.mobile_high} onChange={set('mobile_high')} placeholder="optional" className={hours} style={inputStyle} />
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-xs font-semibold" style={labelStyle}>Shop time (hrs) — in a bay with a lift</legend>
            <div className="flex items-center gap-2 mt-1">
              <input name="shop_low" aria-label="Shop time hours, or low end of a range" inputMode="decimal" autoComplete="off"
                value={draft.shop_low} onChange={set('shop_low')} placeholder="1.0" className={hours} style={inputStyle} />
              <span className="text-xs" style={muted}>to</span>
              <input name="shop_high" aria-label="Shop time high end of a range (optional)" inputMode="decimal" autoComplete="off"
                value={draft.shop_high} onChange={set('shop_high')} placeholder="optional" className={hours} style={inputStyle} />
            </div>
          </fieldset>
        </div>
        <p className="text-xs" style={muted}>
          One number is a single value; fill both boxes for a range. Leave a pair empty when the job never happens there.
        </p>

        <label className="block">
          <span className="text-xs font-semibold" style={labelStyle}>Detail (prints under the operation)</span>
          <input name="detail" autoComplete="off" value={draft.detail} onChange={set('detail')} maxLength={500}
            placeholder="e.g. Adds 1.5 to 2.5 hrs to mobile field time" className={field} style={inputStyle} />
        </label>

        <label className="block">
          <span className="text-xs font-semibold" style={labelStyle}>Suggested related operation</span>
          <input name="suggested_related" autoComplete="off" value={draft.suggested_related} onChange={set('suggested_related')} maxLength={500}
            placeholder="e.g. Add refrigeration recovery & recharge" className={field} style={inputStyle} />
        </label>

        <div className="grid sm:grid-cols-2 gap-3">
          {!reeferOnly && <label className="block">
            <span className="text-xs font-semibold" style={labelStyle}>Equipment type (required, sets the code)</span>
            <select name="equipment_type" required value={draft.equipment_type} onChange={set('equipment_type')} className={field} style={inputStyle}>
              <option value="" disabled>Pick one</option>
              {EQUIPMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>}
          <label className="block">
            <span className="text-xs font-semibold" style={labelStyle}>My category</span>
            <select name="equipment_category_id" value={draft.equipment_category_id} onChange={set('equipment_category_id')} className={field} style={inputStyle}>
              <option value="">None</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        {prefixKept && (
          <p className="text-xs" style={{ color: 'var(--hd-warn)' }}>
            {`The code stays ${prefixKept}. A labor code never changes once given.`}
          </p>
        )}

        <label className="block">
          <span className="text-xs font-semibold" style={labelStyle}>OEM labor code (optional, your reference only)</span>
          <input name="oem_labor_code" autoComplete="off" value={draft.oem_labor_code} onChange={set('oem_labor_code')} maxLength={60}
            placeholder="e.g. the manufacturer's SRT number" className={field} style={inputStyle} />
        </label>

        {error && (
          <p role="alert" className="text-sm px-4 py-2.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--hd-negative)', border: '1px solid rgba(239,68,68,0.3)' }}>
            {error}
          </p>
        )}
        <p aria-live="polite" className="text-sm min-h-[1.25rem]" style={{ color: 'var(--hd-positive)' }}>
          {notice ? `✓ ${notice}` : ''}
        </p>

        <div className="flex items-center gap-2">
          <button type="submit" disabled={busy} data-testid="labor-card-save"
            className="px-4 py-2 rounded-lg text-sm font-semibold text-on-accent disabled:opacity-50" style={{ background: HD_ORANGE }}>
            {editingId ? 'Save changes' : 'Save and next'}
          </button>
          {editingId && (
            <button type="button" onClick={cancelEdit} disabled={busy}
              className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50" style={smallBtn}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="flex flex-wrap items-end gap-2">
        <p data-testid="labor-card-count" className="text-sm font-semibold text-white mr-auto">
          {/* One text node, so the count reads as one phrase in the HTML. */}
          {`${cards.length} operation${cards.length !== 1 ? 's' : ''} written`}
          {shown.length !== cards.length && <span className="font-normal" style={muted}>{` · showing ${shown.length}`}</span>}
        </p>
        <input aria-label="Search labor cards" type="search" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name or code" className="px-3 py-2 rounded-lg text-sm text-white placeholder-white/20 w-48" style={inputStyle} />
        {!reeferOnly && <select aria-label="Filter by equipment type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm text-white" style={inputStyle}>
          <option value="">All equipment types</option>
          {EQUIPMENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>}
        <select aria-label="Filter by my category" value={catFilter} onChange={e => setCatFilter(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm text-white" style={inputStyle}>
          <option value="">All my categories</option>
          <option value="none">No category</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Sort labor cards" value={sort} onChange={e => setSort(e.target.value as LaborCardSort)}
          className="px-3 py-2 rounded-lg text-sm text-white" style={inputStyle}>
          <option value="edited">Recently edited</option>
          <option value="description">Operation A–Z</option>
        </select>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--hd-border)', background: 'var(--hd-card)' }}>
        {shown.length === 0 && (
          <p className="px-4 py-6 text-sm text-center" style={muted}>
            {cards.length === 0 ? 'No operations yet. Type your first one above.' : 'No operations match.'}
          </p>
        )}
        {shown.map((c, i) => {
          const fieldText = hoursText(c.mobile_hours, c.mobile_hours_high)
          const shopText  = hoursText(c.shop_hours, c.shop_hours_high)
          const cat       = c.equipment_category_id ? catName.get(c.equipment_category_id) : null
          const type      = equipmentTypeLabel(c.equipment_type)
          return (
            <div key={c.id} data-testid="labor-card-row" data-card-id={c.id}
              className="flex flex-wrap items-start gap-3 px-4 py-3"
              style={{ borderTop: i > 0 ? '1px solid var(--hd-border)' : undefined, background: editingId === c.id ? `${HD_ORANGE}10` : undefined }}>
              <div className="flex-1 min-w-[220px]">
                <p className="text-sm font-semibold text-white">
                  <span data-testid="labor-card-code" className="font-mono text-xs mr-2 px-1.5 py-0.5 rounded"
                    style={{ color: 'var(--hd-accent-text)', border: `1px solid ${tint(HD_ORANGE, 31)}` }}>{c.labor_code}</span>
                  {c.description}
                </p>
                {c.detail && <p className="text-xs mt-0.5" style={{ color: 'rgba(var(--hd-ink-rgb), 0.65)' }}>{c.detail}</p>}
                {c.suggested_related && <p className="text-xs mt-0.5" style={muted}>Related: {c.suggested_related}</p>}
                <p className="text-xs mt-1" style={muted}>
                  Field: {fieldText || 'none'} · Shop: {shopText || 'none'}
                  {type && <> · {type}</>}
                  {cat && <> · {cat}</>}
                  {c.oem_labor_code && <> · {`OEM ${c.oem_labor_code}`}</>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => startEdit(c)} disabled={busy}
                  className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50" style={smallBtn}>
                  Edit
                </button>
                {confirmId === c.id ? (
                  <>
                    <button type="button" onClick={() => remove(c)} disabled={busy} autoFocus
                      className="text-xs font-semibold px-3 py-2 rounded-lg text-on-fill disabled:opacity-50" style={{ background: '#DC2626' }}>
                      Confirm delete
                    </button>
                    <button type="button" onClick={() => setConfirmId(null)} disabled={busy}
                      className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50" style={smallBtn}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmId(c.id)} disabled={busy}
                    className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50" style={smallBtn}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
