'use client'

// ─── Parts line editor, shared by quotes and work orders ──────────────────────
// The markup lives with the totals, not here: this table edits BASE prices (what
// the tech paid) and the caller applies markup when it saves. See line-items.ts.
//
// Controlled on purpose. A work order can save on a status change while a quote
// saves on a button, so ownership of the rows has to stay with the caller or the
// two callers would end up needing different copies of this component.

import { useState } from 'react'
import type { LineItem } from '@/types/financials'
import type { EditItem } from './line-items'
import { money } from '@/lib/format'

const fmt = (n: number | null | undefined) =>
  money(n ?? 0)

const GRID = 'grid-cols-[1fr_56px_80px_80px_52px]'

function EditIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

/** Read-only rendering of already-saved line_items (post-markup, labour included).
 *  Used once a record is past its editable stage. */
export function LineItemTable({ lineItems }: { lineItems: LineItem[] | null | undefined }) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return null
  return (
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
          {lineItems.map((li, i) => (
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
  )
}

export default function LineItemEditor({
  items,
  onChange,
  emptyHint = 'No parts — add one below or skip if labor-only.',
}: {
  items:      EditItem[]
  onChange:   (next: EditItem[]) => void
  emptyHint?: string
}) {
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [editingVals, setEditingVals] = useState({ description: '', quantity: 1, unit_price: 0 })
  const [addingNew,   setAddingNew]   = useState(false)
  const [newItemVals, setNewItemVals] = useState({ description: '', quantity: 1, unit_price: 0 })

  function startEdit(item: EditItem) {
    setEditingId(item._id)
    setEditingVals({ description: item.description, quantity: item.quantity, unit_price: item.unit_price })
  }

  function commitEdit() {
    if (!editingVals.description.trim()) return
    onChange(items.map(li =>
      li._id === editingId
        ? { ...li, description: editingVals.description.trim(), quantity: editingVals.quantity, unit_price: editingVals.unit_price }
        : li
    ))
    setEditingId(null)
  }

  function remove(id: string) {
    onChange(items.filter(li => li._id !== id))
    if (editingId === id) setEditingId(null)
  }

  function commitNew() {
    if (!newItemVals.description.trim()) return
    onChange([...items, {
      _id:         `new-${Date.now()}`,
      description: newItemVals.description.trim(),
      quantity:    newItemVals.quantity,
      unit_price:  newItemVals.unit_price,
    }])
    setNewItemVals({ description: '', quantity: 1, unit_price: 0 })
    setAddingNew(false)
  }

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden">
      <div className={`hidden md:grid ${GRID} gap-1 px-3 py-2 border-b border-white/10 bg-white/5`}>
        <span className="text-white/30 text-[10px] uppercase tracking-wider">Part / Description</span>
        <span className="text-white/30 text-[10px] uppercase tracking-wider text-right">Qty</span>
        <span className="text-white/30 text-[10px] uppercase tracking-wider text-right">Base Price</span>
        <span className="text-white/30 text-[10px] uppercase tracking-wider text-right">Total</span>
        <span />
      </div>

      {items.length === 0 && !addingNew && (
        <div className="px-4 py-4 text-white/25 text-sm text-center">{emptyHint}</div>
      )}

      {items.map(li => (
        <div key={li._id} className="border-b border-white/5 last:border-0">
          {editingId === li._id ? (
            <div className="p-3 space-y-2 bg-orange/5">
              <input
                autoFocus
                className="nwi-input text-sm w-full"
                placeholder="Part name"
                value={editingVals.description}
                onChange={e => setEditingVals(v => ({ ...v, description: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="nwi-label text-[10px]">Qty</label>
                  <input
                    type="number" min={0} step={1}
                    className="nwi-input text-sm"
                    value={editingVals.quantity}
                    onChange={e => setEditingVals(v => ({ ...v, quantity: Number(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <label className="nwi-label text-[10px]">Base Price ($)</label>
                  <input
                    type="number" min={0} step={0.01}
                    className="nwi-input text-sm"
                    value={editingVals.unit_price}
                    onChange={e => setEditingVals(v => ({ ...v, unit_price: Number(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={commitEdit} className="px-3 py-1.5 bg-orange hover:bg-orange-hover text-white text-xs font-semibold rounded-lg transition-colors">Apply</button>
                <button onClick={() => setEditingId(null)} className="px-3 py-1.5 border border-white/15 text-white/50 hover:text-white text-xs rounded-lg transition-colors">Cancel</button>
              </div>
            </div>
          ) : (() => {
            const rowActions = (
              <>
                <button onClick={() => startEdit(li)} className="p-1.5 text-white/25 hover:text-orange transition-colors rounded" title="Edit item">
                  <EditIcon />
                </button>
                <button onClick={() => remove(li._id)} className="p-1.5 text-white/25 hover:text-danger transition-colors rounded" title="Remove item">
                  <TrashIcon />
                </button>
              </>
            )
            return (
              <div className="px-3 py-2.5 hover:bg-white/[0.03]">
                {/* Mobile: stacked card so the full part / description is always visible */}
                <div className="md:hidden space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-white/80 text-sm break-words min-w-0 flex-1">{li.description}</span>
                    <div className="flex items-center gap-0.5 flex-shrink-0">{rowActions}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
                    <span className="text-white/40">Qty <span className="text-white/70">{li.quantity}</span></span>
                    <span className="text-white/40">Base <span className="text-white/70">{fmt(li.unit_price)}</span></span>
                    <span className="text-white/40">Total <span className="text-white font-medium">{fmt(li.quantity * li.unit_price)}</span></span>
                  </div>
                </div>
                {/* Desktop: aligned column grid */}
                <div className={`hidden md:grid ${GRID} gap-1 items-center`}>
                  <span className="text-white/80 text-sm truncate">{li.description}</span>
                  <span className="text-white/50 text-sm text-right">{li.quantity}</span>
                  <span className="text-white/50 text-sm text-right">{fmt(li.unit_price)}</span>
                  <span className="text-white text-sm font-medium text-right">{fmt(li.quantity * li.unit_price)}</span>
                  <div className="flex items-center justify-end gap-0.5">{rowActions}</div>
                </div>
              </div>
            )
          })()}
        </div>
      ))}

      {addingNew ? (
        <div className="p-3 space-y-2 bg-white/5 border-t border-white/10">
          <input
            autoFocus
            className="nwi-input text-sm w-full"
            placeholder="Part name or description"
            value={newItemVals.description}
            onChange={e => setNewItemVals(v => ({ ...v, description: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') commitNew() }}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="nwi-label text-[10px]">Qty</label>
              <input type="number" min={0} step={1} className="nwi-input text-sm" value={newItemVals.quantity} onChange={e => setNewItemVals(v => ({ ...v, quantity: Number(e.target.value) || 0 }))} />
            </div>
            <div>
              <label className="nwi-label text-[10px]">Base Price ($)</label>
              <input type="number" min={0} step={0.01} className="nwi-input text-sm" value={newItemVals.unit_price} onChange={e => setNewItemVals(v => ({ ...v, unit_price: Number(e.target.value) || 0 }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={commitNew} className="px-3 py-1.5 bg-orange hover:bg-orange-hover text-white text-xs font-semibold rounded-lg transition-colors">Add Item</button>
            <button onClick={() => { setAddingNew(false); setNewItemVals({ description: '', quantity: 1, unit_price: 0 }) }} className="px-3 py-1.5 border border-white/15 text-white/50 hover:text-white text-xs rounded-lg transition-colors">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => { setAddingNew(true); setEditingId(null) }} className="w-full flex items-center gap-2 px-4 py-3 text-white/40 hover:text-orange hover:bg-white/5 text-xs transition-colors border-t border-white/5">
          <PlusIcon />
          Add Line Item
        </button>
      )}
    </div>
  )
}
