'use client'

// ─── Create a quote from nothing ──────────────────────────────────────────────
//
// LD had three ways to get a quote — QuickWrench, a failed multi-point inspection, and
// "Generate Quote" on a scheduled job — and every one of them required something to
// already exist. There was no way to quote a customer who was not already in the
// system as a job, which is why the Quotes tab's empty state used to read "Build one
// in QuickWrench and save as a quote".
//
// Follows InvoicesTab's showForm pattern deliberately: a panel above the list, not a
// route and not a modal, so both money tabs behave the same way.
//
// NO PRICING MATH LIVES HERE. computeTotals in components/shared/line-items owns it,
// including the parts/labor tax split, so this form and the quote editor cannot
// disagree about one job's money.

import { useState } from 'react'
import CustomerUnitPicker from '@/components/work-orders/CustomerUnitPicker'
import { computeTotals, toLineItems, round2, type EditItem } from '@/components/shared/line-items'
import { useTaxSettings } from '@/lib/use-tax-settings'
import { taxDisplayRows } from '@/lib/tax'
import { money } from '@/lib/format'
import { BLANK_QUOTE_SEED, seedNotes, type QuoteSeed } from '@/types/quote-seed'

let rowSeq = 0
const blankRow = (): EditItem => ({
  _id: `new-${rowSeq++}`, description: '', quantity: 1, unit_price: 0,
})

export default function NewQuoteForm({
  defaults,
  seed = BLANK_QUOTE_SEED,
  onCreated,
  onCancel,
}: {
  defaults: { labor_rate: number; markup_percent: number; tax_percent: number }
  /**
   * Optional origin. The blank path passes none.
   *
   * THE SEAM: a failed inspection item will pass its unit, checkpoint label and tech
   * note through here, and nothing about this form changes when it does.
   */
  seed?:     QuoteSeed
  onCreated: (quote: { id: string; quote_number: string }) => void
  onCancel:  () => void
}) {
  const taxSettings = useTaxSettings()

  const [customerId, setCustomerId] = useState<string | null>(seed.customerId ?? null)
  const [vehicleId,  setVehicleId]  = useState<string | null>(seed.vehicleId ?? null)
  const [unitLabel,  setUnitLabel]  = useState('')
  const [notes,      setNotes]      = useState(seedNotes(seed))

  const [items, setItems] = useState<EditItem[]>(() =>
    (seed.lines ?? []).length > 0
      ? (seed.lines ?? []).map((l, i) => ({
          _id: `seed-${i}`, description: l.description, quantity: l.quantity, unit_price: l.unit_price,
        }))
      : [blankRow()],
  )
  const [laborHours, setLaborHours] = useState(seed.laborHours ?? 0)
  const [laborRate,  setLaborRate]  = useState(defaults.labor_rate)
  const [markupPct,  setMarkupPct]  = useState(defaults.markup_percent)
  const [taxPct,     setTaxPct]     = useState(defaults.tax_percent)

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  // One calculator, the same one the editor uses. Parts and labor are taxed per the
  // shop's settings; until the fetch resolves this falls back to the old single rate,
  // so nothing on screen is ever briefly wrong in the exempt direction.
  const totals = computeTotals({ items, markupPct, laborHours, laborRate, taxPct, taxSettings })

  function update(id: string, patch: Partial<EditItem>) {
    setItems(prev => prev.map(r => (r._id === id ? { ...r, ...patch } : r)))
  }

  async function submit() {
    setError(null)
    const priced = items.filter(r => r.description.trim() || r.unit_price > 0 || r.quantity !== 1)
    if (priced.length === 0 && laborHours <= 0) {
      setError('Add a part or some labour hours before saving.')
      return
    }
    if (totals.grandTotal < 0) {
      setError('Grand total cannot be negative.')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/quotes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          customer_id: customerId,
          vehicle_id:  vehicleId,
          notes:       notes.trim() || null,
          // Stored post-markup, because that is the number the customer agreed to.
          // toLineItems applies it; the editor divides it back out on read.
          line_items:           toLineItems({ items: priced, markupPct, laborHours, laborRate }),
          labor_hours:          laborHours,
          labor_rate:           laborRate,
          parts_subtotal:       round2(totals.partsBase),
          parts_markup_percent: markupPct,
          labor_subtotal:       round2(totals.laborSubtotal),
          tax_percent:          taxPct,
          tax_amount:           round2(totals.taxAmount),
          grand_total:          round2(totals.grandTotal),
          tax_breakdown:        totals.taxBreakdown,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not create the quote')
      onCreated(json.quote)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the quote')
    }
    setSaving(false)
  }

  return (
    <div className="nwi-card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-condensed font-bold text-white text-lg tracking-wide">NEW QUOTE</p>
          {seed.originLabel && (
            <p className="text-white/40 text-xs mt-0.5">From {seed.originLabel}</p>
          )}
        </div>
        <button onClick={onCancel} className="text-white/40 hover:text-white text-sm">Cancel</button>
      </div>

      {/* Same picker LD work orders use, so a customer is chosen the same way in both */}
      <CustomerUnitPicker
        customerId={customerId}
        onCustomerChange={id => setCustomerId(id)}
        vehicleId={vehicleId}
        onVehicleChange={setVehicleId}
        unitLabel={unitLabel}
        onUnitLabelChange={setUnitLabel}
        disabled={saving}
      />

      {/* ── Parts ── */}
      <div className="space-y-2">
        <p className="nwi-label">Parts</p>
        {items.map(row => (
          <div key={row._id} className="grid grid-cols-[1fr_70px_100px_32px] gap-2 items-center">
            <input
              className="nwi-input text-sm" placeholder="Part description"
              value={row.description} disabled={saving}
              onChange={e => update(row._id, { description: e.target.value })}
            />
            <input
              type="number" min={0} step={1} className="nwi-input text-sm" placeholder="Qty"
              value={row.quantity} disabled={saving}
              onChange={e => update(row._id, { quantity: Number(e.target.value) || 0 })}
            />
            <input
              type="number" min={0} step={0.01} className="nwi-input text-sm" placeholder="Your cost"
              // Blank rather than a seeded zero, so typing 45 cannot produce "045".
              value={row.unit_price === 0 ? '' : row.unit_price} disabled={saving}
              onChange={e => update(row._id, { unit_price: e.target.value === '' ? 0 : Number(e.target.value) })}
            />
            <button
              onClick={() => setItems(prev => (prev.length === 1 ? [blankRow()] : prev.filter(r => r._id !== row._id)))}
              disabled={saving}
              className="text-white/30 hover:text-danger text-lg leading-none"
              title="Remove"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() => setItems(prev => [...prev, blankRow()])}
          disabled={saving}
          className="text-orange text-xs hover:underline"
        >
          + Add part
        </button>
        <p className="text-white/25 text-[11px]">
          Enter what you pay. The {markupPct}% markup is added for the customer.
        </p>
      </div>

      {/* ── Labour and rates ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {([
          ['Labour hours', laborHours, setLaborHours, 0.25],
          ['Labour rate',  laborRate,  setLaborRate,  1],
          ['Markup %',     markupPct,  setMarkupPct,  1],
          ['Tax %',        taxPct,     setTaxPct,     0.001],
        ] as const).map(([label, value, set, step]) => (
          <div key={label}>
            <label className="nwi-label">{label}</label>
            <input
              type="number" min={0} step={step} className="nwi-input text-sm w-full"
              value={value} disabled={saving}
              onChange={e => set(Number(e.target.value) || 0)}
            />
          </div>
        ))}
      </div>

      <div>
        <label className="nwi-label">Notes</label>
        <textarea
          className="nwi-input text-sm w-full" rows={2}
          value={notes} disabled={saving}
          onChange={e => setNotes(e.target.value)}
          placeholder="What the customer should see"
        />
      </div>

      {/* ── Totals, from the shared calculator ── */}
      <div className="space-y-1 pt-3 border-t border-white/8 text-sm">
        <Row label="Parts" value={money(totals.partsTotal)} />
        <Row label={`Labour (${laborHours}h)`} value={money(totals.laborSubtotal)} />
        <Row label="Subtotal" value={money(totals.subtotal)} />
        {/* One row per category, including the exempt one — same as every other
            surface since the tax split shipped. */}
        {totals.taxBreakdown
          ? taxDisplayRows(totals.taxBreakdown).map(r => (
              <Row key={r.category} label={r.text} value={r.taxed ? money(r.amount) : '—'} dim />
            ))
          : <Row label={`Tax (${taxPct}%)`} value={money(totals.taxAmount)} dim />}
        <div className="flex justify-between items-baseline pt-2 border-t border-white/8">
          <span className="text-white font-medium">Total</span>
          <span className="font-condensed font-bold text-orange text-2xl">{money(totals.grandTotal)}</span>
        </div>
      </div>

      {error && <p className="text-danger text-xs">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={submit} disabled={saving}
          className="px-5 py-2 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-lg transition-colors"
        >
          {saving ? 'Creating…' : 'Create Quote'}
        </button>
        <button
          onClick={onCancel} disabled={saving}
          className="px-5 py-2 border border-white/15 text-white/60 hover:text-white text-sm rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function Row({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={dim ? 'text-white/40' : 'text-white/60'}>{label}</span>
      <span className={dim ? 'text-white/60' : 'text-white'}>{value}</span>
    </div>
  )
}
