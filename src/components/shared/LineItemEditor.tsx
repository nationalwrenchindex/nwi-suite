'use client'

// ─── Line editor, shared by LD quotes, work orders and new quotes ─────────────
// The markup lives with the totals, not here: this table edits BASE prices (what
// the tech paid) and the caller applies markup when it saves. See line-items.ts.
//
// Controlled on purpose. A work order can save on a status change while a quote
// saves on a button, so ownership of the rows has to stay with the caller or the
// two callers would end up needing different copies of this component.
//
// LABOUR LINES (allowLabor). A labour line is hours x rate, no markup, and a document
// can carry as many as the job needs - "Labor: Clock Spring Replacement" with what the
// work involves written under it. New labour lines start at the document's own rate.
//
// SPEC 2.5 (docs/NWI-ESTIMATE-DOCUMENT-SPEC.md): every line takes an optional `detail`,
// can be marked "included", and a part can be marked customer-supplied. Both of those
// charge nothing and still print.

import { useState } from 'react'
import type { LineItem } from '@/types/financials'
import { chargesNothing, isLaborEdit, type EditItem, type LineKind } from './line-items'
import { money } from '@/lib/format'

const fmt = (n: number | null | undefined) =>
  money(n ?? 0)

// Part # sits between the description and the quantity, because that is the order
// a tech reads a parts invoice in.
const GRID = 'grid-cols-[1fr_104px_56px_80px_80px_84px]'

interface RowVals {
  description:       string
  part_number:       string
  quantity:          number
  unit_price:        number
  detail:            string
  included:          boolean
  customer_supplied: boolean
}

/** A blank row's editable fields, in one place so the reset sites agree. */
const blankVals = (kind: LineKind, laborRate: number): RowVals => ({
  description: kind === 'labor' ? 'Labor' : '', part_number: '',
  quantity: 1, unit_price: kind === 'labor' ? laborRate : 0,
  detail: '', included: false, customer_supplied: false,
})

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

function ArrowIcon({ up }: { up?: boolean }) {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      {up ? <polyline points="18 15 12 9 6 15" /> : <polyline points="6 9 12 15 18 9" />}
    </svg>
  )
}

/** "included" / "customer supplied" - said in words, never a blank or a dash. */
function FlagTag({ text }: { text: string }) {
  return (
    <span className="inline-block ml-1.5 px-1.5 py-px rounded text-[10px] uppercase tracking-wider bg-white/10 text-white/50 align-middle">
      {text}
    </span>
  )
}

/** The line's detail paragraph, indented under the description in smaller type. */
export function LineDetail({ text, className = '' }: { text?: string | null; className?: string }) {
  if (!text?.trim()) return null
  return (
    <span data-testid="line-detail" className={`block pl-3 mt-0.5 text-xs text-white/45 whitespace-pre-line ${className}`}>
      {text.trim()}
    </span>
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
              <td className="px-4 py-2.5 text-white/80">
                {li.description}
                {li.customer_supplied && <FlagTag text="customer supplied" />}
                {li.part_number && (
                  <span className="block text-white/40 text-xs font-mono mt-0.5">{li.part_number}</span>
                )}
                <LineDetail text={li.detail} />
              </td>
              <td className="px-4 py-2.5 text-white/60 text-right">{li.quantity}</td>
              <td className="px-4 py-2.5 text-white/60 text-right">{li.is_included ? 'included' : fmt(li.unit_price)}</td>
              <td className="px-4 py-2.5 text-white font-medium text-right">{fmt(li.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The edit / add form for one row. */
function RowForm({
  kind, vals, setVals, onApply, onCancel, applyLabel,
}: {
  kind:       LineKind
  vals:       RowVals
  setVals:    (f: (v: RowVals) => RowVals) => void
  onApply:    () => void
  onCancel:   () => void
  applyLabel: string
}) {
  const labor = kind === 'labor'
  const free  = vals.included || (!labor && vals.customer_supplied)
  return (
    <div className="p-3 space-y-2 bg-orange/5">
      <p className="text-[10px] uppercase tracking-wider text-white/35">{labor ? 'Labor line' : 'Part line'}</p>
      <input
        autoFocus
        className="nwi-input text-sm w-full"
        placeholder={labor ? 'Labor description, e.g. Labor: Clock Spring Replacement' : 'Part name'}
        value={vals.description}
        onChange={e => setVals(v => ({ ...v, description: e.target.value }))}
      />
      {!labor && (
        <input
          className="nwi-input text-sm w-full font-mono"
          placeholder="Part number (optional)"
          value={vals.part_number}
          onChange={e => setVals(v => ({ ...v, part_number: e.target.value }))}
        />
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="nwi-label text-[10px]">{labor ? 'Hours' : 'Qty'}</label>
          <input
            type="number" min={0} step={labor ? 0.1 : 1}
            className="nwi-input text-sm"
            value={vals.quantity}
            onChange={e => setVals(v => ({ ...v, quantity: Number(e.target.value) || 0 }))}
          />
        </div>
        <div>
          <label className="nwi-label text-[10px]">{labor ? 'Rate ($/hr)' : 'Base Price ($)'}</label>
          <input
            type="number" min={0} step={0.01}
            className="nwi-input text-sm disabled:opacity-40"
            value={vals.unit_price}
            disabled={free}
            onChange={e => setVals(v => ({ ...v, unit_price: Number(e.target.value) || 0 }))}
          />
        </div>
      </div>
      <div>
        <label className="nwi-label text-[10px]">Detail - what the work involves (optional, prints under the line)</label>
        <textarea
          rows={3}
          className="nwi-input text-sm w-full resize-y"
          placeholder="e.g. Disarm the SRS system, remove the steering wheel, transfer the sensor and reassemble the column."
          value={vals.detail}
          onChange={e => setVals(v => ({ ...v, detail: e.target.value }))}
        />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/60">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={vals.included}
            onChange={e => setVals(v => ({ ...v, included: e.target.checked }))} />
          Included - prints &quot;included&quot;, charges nothing
        </label>
        {!labor && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={vals.customer_supplied}
              onChange={e => setVals(v => ({ ...v, customer_supplied: e.target.checked }))} />
            Customer supplied - prints at $0.00
          </label>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={onApply} className="px-3 py-1.5 bg-orange hover:bg-orange-hover text-white text-xs font-semibold rounded-lg transition-colors">{applyLabel}</button>
        <button onClick={onCancel} className="px-3 py-1.5 border border-white/15 text-white/50 hover:text-white text-xs rounded-lg transition-colors">Cancel</button>
      </div>
    </div>
  )
}

/** The figure a row adds before markup: 0 for an included or customer-supplied line. */
function rowAmount(li: EditItem): number {
  return chargesNothing(li) ? 0 : li.quantity * li.unit_price
}

export default function LineItemEditor({
  items,
  onChange,
  emptyHint,
  allowLabor = false,
  laborRate = 0,
}: {
  items:       EditItem[]
  onChange:    (next: EditItem[]) => void
  emptyHint?:  string
  /** Labour as lines (hours x rate) alongside parts. Off: parts only, as before. */
  allowLabor?: boolean
  /** The document's own rate, which a new labour line starts at. */
  laborRate?:  number
}) {
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [editingVals, setEditingVals] = useState<RowVals>(blankVals('part', laborRate))
  const [adding,      setAdding]      = useState<LineKind | null>(null)
  const [newVals,     setNewVals]     = useState<RowVals>(blankVals('part', laborRate))

  const hint = emptyHint ?? (allowLabor
    ? 'No lines yet - add a labor or part line below.'
    : 'No parts — add one below or skip if labor-only.')

  function startEdit(item: EditItem) {
    setAdding(null)
    setEditingId(item._id)
    setEditingVals({
      description:       item.description,
      part_number:       item.part_number ?? '',
      quantity:          item.quantity,
      unit_price:        item.unit_price,
      detail:            item.detail ?? '',
      included:          !!item.included,
      customer_supplied: !!item.customer_supplied,
    })
  }

  /** Only the fields that are set, so an untouched optional stays absent. */
  function applied(base: EditItem, v: RowVals): EditItem {
    const labor = isLaborEdit(base)
    const next: EditItem = {
      ...base,
      description: v.description.trim(),
      part_number: labor ? '' : v.part_number.trim(),
      quantity:    v.quantity,
      unit_price:  v.unit_price,
    }
    delete next.detail; delete next.included; delete next.customer_supplied
    if (v.detail.trim()) next.detail = v.detail
    if (v.included) next.included = true
    if (!labor && v.customer_supplied) next.customer_supplied = true
    return next
  }

  function commitEdit() {
    if (!editingVals.description.trim()) return
    onChange(items.map(li => li._id === editingId ? applied(li, editingVals) : li))
    setEditingId(null)
  }

  function remove(id: string) {
    onChange(items.filter(li => li._id !== id))
    if (editingId === id) setEditingId(null)
  }

  function move(index: number, by: -1 | 1) {
    const to = index + by
    if (to < 0 || to >= items.length) return
    const next = [...items]
    ;[next[index], next[to]] = [next[to], next[index]]
    onChange(next)
  }

  function startAdd(kind: LineKind) {
    setEditingId(null)
    setNewVals(blankVals(kind, laborRate))
    setAdding(kind)
  }

  function commitNew() {
    if (!adding || !newVals.description.trim()) return
    const base: EditItem = {
      _id: `new-${Date.now()}`, description: '', part_number: '', quantity: 0, unit_price: 0,
      ...(adding === 'labor' ? { kind: 'labor' as const } : {}),
    }
    onChange([...items, applied(base, newVals)])
    setAdding(null)
  }

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden" data-testid="line-item-editor">
      <div className={`hidden md:grid ${GRID} gap-1 px-3 py-2 border-b border-white/10 bg-white/5`}>
        <span className="text-white/30 text-[10px] uppercase tracking-wider">{allowLabor ? 'Description' : 'Part / Description'}</span>
        <span className="text-white/30 text-[10px] uppercase tracking-wider">Part #</span>
        <span className="text-white/30 text-[10px] uppercase tracking-wider text-right">{allowLabor ? 'Qty / Hrs' : 'Qty'}</span>
        <span className="text-white/30 text-[10px] uppercase tracking-wider text-right">{allowLabor ? 'Base / Rate' : 'Base Price'}</span>
        <span className="text-white/30 text-[10px] uppercase tracking-wider text-right">Total</span>
        <span />
      </div>

      {items.length === 0 && !adding && (
        <div className="px-4 py-4 text-white/25 text-sm text-center">{hint}</div>
      )}

      {items.map((li, index) => (
        <div key={li._id} className="border-b border-white/5 last:border-0">
          {editingId === li._id ? (
            <RowForm
              kind={isLaborEdit(li) ? 'labor' : 'part'}
              vals={editingVals} setVals={setEditingVals}
              onApply={commitEdit} onCancel={() => setEditingId(null)} applyLabel="Apply"
            />
          ) : (() => {
            const labor = isLaborEdit(li)
            const rate  = li.included ? 'included' : fmt(chargesNothing(li) ? 0 : li.unit_price)
            const qty   = labor ? `${li.quantity}h` : String(li.quantity)
            const label = (
              <>
                {labor && allowLabor && <span className="text-[10px] uppercase tracking-wider text-orange/70 mr-1.5">Labor</span>}
                <span className="text-white/80 text-sm break-words">{li.description}</span>
                {li.customer_supplied && !labor && <FlagTag text="customer supplied" />}
              </>
            )
            const rowActions = (
              <>
                <button onClick={() => move(index, -1)} disabled={index === 0} className="p-1 text-white/25 hover:text-white disabled:opacity-20 transition-colors rounded" title="Move up">
                  <ArrowIcon up />
                </button>
                <button onClick={() => move(index, 1)} disabled={index === items.length - 1} className="p-1 text-white/25 hover:text-white disabled:opacity-20 transition-colors rounded" title="Move down">
                  <ArrowIcon />
                </button>
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
                    <div className="min-w-0 flex-1">
                      {label}
                      {li.part_number && (
                        <span className="block text-white/40 text-xs font-mono mt-0.5">{li.part_number}</span>
                      )}
                      <LineDetail text={li.detail} />
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">{rowActions}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
                    <span className="text-white/40">{labor ? 'Hours' : 'Qty'} <span className="text-white/70">{qty}</span></span>
                    <span className="text-white/40">{labor ? 'Rate' : 'Base'} <span className="text-white/70">{rate}</span></span>
                    <span className="text-white/40">Total <span className="text-white font-medium">{fmt(rowAmount(li))}</span></span>
                  </div>
                </div>
                {/* Desktop: aligned column grid */}
                <div className={`hidden md:grid ${GRID} gap-1 items-start`}>
                  <div className="min-w-0">
                    {label}
                    <LineDetail text={li.detail} />
                  </div>
                  <span className="text-white/45 text-xs font-mono truncate pt-0.5">{li.part_number || (labor ? '' : '—')}</span>
                  <span className="text-white/50 text-sm text-right">{qty}</span>
                  <span className="text-white/50 text-sm text-right">{rate}</span>
                  <span className="text-white text-sm font-medium text-right">{fmt(rowAmount(li))}</span>
                  <div className="flex items-center justify-end gap-0">{rowActions}</div>
                </div>
              </div>
            )
          })()}
        </div>
      ))}

      {adding ? (
        <div className="border-t border-white/10">
          <RowForm
            kind={adding} vals={newVals} setVals={setNewVals}
            onApply={commitNew} onCancel={() => setAdding(null)}
            applyLabel={adding === 'labor' ? 'Add Labor' : 'Add Item'}
          />
        </div>
      ) : (
        <div className="flex border-t border-white/5">
          {allowLabor && (
            <button onClick={() => startAdd('labor')} className="flex-1 flex items-center gap-2 px-4 py-3 text-white/40 hover:text-orange hover:bg-white/5 text-xs transition-colors border-r border-white/5">
              <PlusIcon />
              Add Labor Line
            </button>
          )}
          <button onClick={() => startAdd('part')} className="flex-1 flex items-center gap-2 px-4 py-3 text-white/40 hover:text-orange hover:bg-white/5 text-xs transition-colors">
            <PlusIcon />
            {allowLabor ? 'Add Part Line' : 'Add Line Item'}
          </button>
        </div>
      )}
    </div>
  )
}
