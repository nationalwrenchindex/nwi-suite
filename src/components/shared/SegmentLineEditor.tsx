'use client'

// ─── Canonical line editor, shared by LD and HD segments ──────────────────────
// Controlled: the parent owns the rows. A segment saves as a unit, so ownership has
// to sit with whatever is doing the saving.
//
// Every derived number here comes from src/lib/shared/work-order-lines — the same
// module HD's parent line items price through and the same one the server recomputes
// with. A total the tech watches add up in the browser is the total that gets stored.
//
// NOT the same editor as components/shared/LineItemEditor. That one edits LD's older
// record-level-markup shape for quotes and legacy parent-priced work orders. This one
// edits the canonical per-line shape: cost and markup per row, so a segment's margin
// is recoverable. Both exist because both shapes exist; neither reimplements the
// other's arithmetic.

import { useState } from 'react'
import { money } from '@/lib/format'
import {
  lineTotal, lineUnitPrice, MAX_WORK_ORDER_LINES,
  type WorkOrderLineType,
} from '@/lib/shared/work-order-lines'
import { sumLines } from '@/lib/shared/work-order-lines'
import type { SegmentLine } from '@/types/segments'
import { surfaceFor, type ProductVariant } from './segment-theme'

const blankLine = (type: WorkOrderLineType, sortOrder: number, defaultMarkup: number): SegmentLine => ({
  type,
  description:    '',
  part_number:    null,
  quantity:       type === 'labor' ? 1 : 1,
  unit_cost:      type === 'part' ? 0 : null,
  unit_price:     null,
  markup_percent: type === 'part' ? defaultMarkup : null,
  total:          0,
  sort_order:     sortOrder,
})

/** Re-derive unit_price and total for one row. Kept here so a row edited in the
 *  browser and a row normalised on the server land on the same numbers. */
function reprice(line: SegmentLine): SegmentLine {
  const unit_price = line.type === 'part' && line.unit_cost != null && line.markup_percent != null
    ? lineUnitPrice(line.unit_cost, line.markup_percent)
    : line.unit_price
  return { ...line, unit_price, total: lineTotal({ ...line, unit_price }) }
}

export default function SegmentLineEditor({
  lines,
  onChange,
  variant,
  defaultMarkup = 20,
  laborRate = 125,
  disabled = false,
}: {
  lines:          SegmentLine[]
  onChange:       (next: SegmentLine[]) => void
  variant:        ProductVariant
  defaultMarkup?: number
  laborRate?:     number
  disabled?:      boolean
}) {
  const s = surfaceFor(variant)
  const [err, setErr] = useState<string | null>(null)
  const totals = sumLines(lines)

  function update(index: number, patch: Partial<SegmentLine>) {
    onChange(lines.map((l, i) => (i === index ? reprice({ ...l, ...patch }) : l)))
  }

  function add(type: WorkOrderLineType) {
    if (lines.length >= MAX_WORK_ORDER_LINES) {
      setErr(`A segment holds up to ${MAX_WORK_ORDER_LINES} lines.`)
      return
    }
    setErr(null)
    const line = blankLine(type, lines.length, defaultMarkup)
    if (type === 'labor') line.unit_price = laborRate
    onChange([...lines, reprice(line)])
  }

  function remove(index: number) {
    // sort_order is renumbered so it always matches display order; nothing else
    // references these rows, so there is no stored id to preserve.
    onChange(lines.filter((_, i) => i !== index).map((l, i) => ({ ...l, sort_order: i })))
  }

  return (
    <div className="space-y-2">
      {err && <p className="text-xs text-danger">{err}</p>}

      {lines.length === 0 && (
        <p className="text-xs px-1" style={s.faint}>
          No parts or labor on this segment yet.
        </p>
      )}

      {lines.map((line, i) => (
        <div key={i} className="rounded-lg p-3 space-y-2" style={s.inner}>
          <div className="flex items-center justify-between gap-2">
            <span
              className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
              style={{ background: line.type === 'labor' ? '#2969B0' : s.accent, color: '#fff' }}
            >
              {line.type === 'labor' ? 'Labor' : 'Part'}
            </span>
            <span className="text-sm font-medium" style={s.text}>{money(line.total)}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(i)}
                title="Remove line"
                className="p-1 rounded hover:text-danger transition-colors"
                style={s.faint}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
              </button>
            )}
          </div>

          <input
            className="nwi-input text-sm w-full"
            placeholder={line.type === 'labor' ? 'What was done' : 'Part description'}
            value={line.description ?? ''}
            disabled={disabled}
            onChange={e => update(i, { description: e.target.value })}
          />

          {line.type === 'labor' ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="nwi-label text-[10px]">Hours</label>
                <input
                  type="number" min={0} step={0.25} className="nwi-input text-sm"
                  value={line.quantity} disabled={disabled}
                  onChange={e => update(i, { quantity: Number(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="nwi-label text-[10px]">Rate ($/hr)</label>
                <input
                  type="number" min={0} step={1} className="nwi-input text-sm"
                  value={line.unit_price ?? 0} disabled={disabled}
                  onChange={e => update(i, { unit_price: Number(e.target.value) || 0 })}
                />
              </div>
            </div>
          ) : (
            <>
              <input
                className="nwi-input text-sm w-full"
                placeholder="Part number (optional)"
                value={line.part_number ?? ''}
                disabled={disabled}
                onChange={e => update(i, { part_number: e.target.value })}
              />
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="nwi-label text-[10px]">Qty</label>
                  <input
                    type="number" min={0} step={1} className="nwi-input text-sm"
                    value={line.quantity} disabled={disabled}
                    onChange={e => update(i, { quantity: Number(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="nwi-label text-[10px]">Your cost</label>
                  <input
                    type="number" min={0} step={0.01} className="nwi-input text-sm"
                    value={line.unit_cost ?? 0} disabled={disabled}
                    onChange={e => update(i, { unit_cost: Number(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="nwi-label text-[10px]">Markup %</label>
                  <input
                    type="number" min={0} step={1} className="nwi-input text-sm"
                    value={line.markup_percent ?? 0} disabled={disabled}
                    onChange={e => update(i, { markup_percent: Number(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <p className="text-[11px]" style={s.faint}>
                Customer pays {money(line.unit_price)} each — your cost {money(line.unit_cost)} plus {line.markup_percent ?? 0}%.
              </p>
            </>
          )}
        </div>
      ))}

      {!disabled && (
        <div className="flex gap-2">
          <button
            type="button" onClick={() => add('labor')}
            className="flex-1 px-3 py-2 rounded-lg text-xs transition-colors hover:opacity-80"
            style={{ ...s.inner, ...s.muted }}
          >
            + Labor
          </button>
          <button
            type="button" onClick={() => add('part')}
            className="flex-1 px-3 py-2 rounded-lg text-xs transition-colors hover:opacity-80"
            style={{ ...s.inner, ...s.muted }}
          >
            + Part
          </button>
        </div>
      )}

      {lines.length > 0 && (
        <div className="flex items-center justify-between pt-1 text-xs">
          <span style={s.faint}>
            Parts {money(totals.parts)} · Labor {money(totals.labor)}
          </span>
          <span className="font-medium" style={s.text}>{money(totals.total)} before tax</span>
        </div>
      )}
    </div>
  )
}
