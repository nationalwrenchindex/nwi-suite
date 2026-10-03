'use client'

// ─── Work order create / edit ─────────────────────────────────────────────────
// One component for both, because a work order is edited far more than it is
// created — it is open while the job is on the lift — and two forms would drift.
//
// Money maths comes from components/shared/line-items, the same module the quote
// editor uses, so a work order and the quote it came from agree to the cent.

import { useState } from 'react'
import { useTaxSettings } from '@/lib/use-tax-settings'
import { useExtrasSettings } from '@/lib/use-extras-settings'
import { computeExtras, extrasColumns, extrasDisplayRows, totalsWithExtras } from '@/lib/billable-extras'
import { taxDisplayRows } from '@/lib/tax'
import { useRouter } from 'next/navigation'
import LineItemEditor from '@/components/shared/LineItemEditor'
import {
  fromLineItems, computeTotals, lineMoneyColumns, validateLines,
  markupOnReopen, markupLabel,
  type EditItem,
} from '@/components/shared/line-items'
import type { PricingMode } from '@/components/shared/segments'
import {
  STATUS_META, NEXT_STATUS,
  type WorkOrder, type WorkOrderStatus,
} from '@/types/work-orders'
import CustomerUnitPicker from './CustomerUnitPicker'
import WorkOrderPhotos, { type PhotoWithUrl } from './WorkOrderPhotos'
import { money } from '@/lib/format'

const fmt = (n: number | null | undefined) =>
  money(n ?? 0)

export default function WorkOrderForm({
  workOrder,
  defaults,
  photos = [],
  ownsPricing = true,
}: {
  workOrder?: WorkOrder
  defaults:   { labor_rate: number; markup_percent: number; tax_percent: number }
  photos?:    PhotoWithUrl[]
  /** False when SEGMENTS price this work order. The form then stops rendering and
   *  stops WRITING the parent money columns — writing them would put parent line
   *  items on a segment-priced record, which is exactly what the segments guard
   *  refuses, and the record would end up carrying two totals. */
  ownsPricing?: boolean
}) {
  const router   = useRouter()
  const isNew    = !workOrder
  // Once billed, the work order is the customer's record of what they agreed to.
  const isLocked = !!workOrder?.converted_invoice_id

  const [customerId, setCustomerId] = useState<string | null>(workOrder?.customer_id ?? null)
  const [vehicleId,  setVehicleId]  = useState<string | null>(workOrder?.vehicle_id  ?? null)
  const [unitLabel,  setUnitLabel]  = useState(workOrder?.unit_label ?? '')
  const [jobDesc,    setJobDesc]    = useState(workOrder?.job_description ?? '')
  const [poNumber,   setPoNumber]   = useState(workOrder?.po_number ?? '')
  const [techNotes,  setTechNotes]  = useState(workOrder?.tech_notes ?? '')

  // ── Pricing mode ────────────────────────────────────────────────────────────
  // On a NEW work order the tech chooses before any money exists. Nothing was wrong
  // with the segments feature except that there was no way in: this form required a
  // line item, which made every new record parent-priced, which made the segments
  // guard refuse every one of them.
  //
  // Starts null so no choice is assumed. An existing record's mode is resolved by the
  // detail page — it can see the segments — and arrives as `ownsPricing`.
  const [mode, setMode] = useState<PricingMode | null>(
    isNew ? null : (workOrder?.pricing_mode ?? null),
  )
  const owns = isNew ? mode === 'single' : ownsPricing

  // THE MARKUP BUG. This was `workOrder?.parts_markup_percent ?? defaults.markup_percent`,
  // which meant a work order with no recorded markup had its stored prices divided by
  // TODAY'S Settings value and multiplied back by it on save. See markupOnReopen.
  //
  // A NEW work order still seeds from Settings — but through chooseMode(), at the
  // moment the tech picks "Single job", and it is then stored on the record.
  const storedMarkup = markupOnReopen(workOrder?.parts_markup_percent)
  const [items, setItems] = useState<EditItem[]>(
    () => fromLineItems(workOrder?.line_items, storedMarkup.percent),
  )
  // A new work order starts with NO rates seeded. The defaults land only when the tech
  // picks "Single job" — pre-filling them meant a segment-priced record still had a
  // labour rate and a markup sitting on it, waiting to be written.
  const [laborHours, setLaborHours] = useState(workOrder?.labor_hours ?? 0)
  const [laborRate,  setLaborRate]  = useState(isNew ? 0 : (workOrder?.labor_rate  ?? defaults.labor_rate))
  const [markupPct,  setMarkupPct]  = useState(isNew ? 0 : storedMarkup.percent)
  /** True until the tech types a markup on a record that never had one recorded. */
  const [markupTouched, setMarkupTouched] = useState(false)
  const [taxPct,     setTaxPct]     = useState(isNew ? 0 : (workOrder?.tax_percent ?? defaults.tax_percent))
  const taxSettings = useTaxSettings()

  // ── Billable extras ──
  // The inputs come off the work order, never recomputed from today's Settings —
  // the stored amount is what the customer was told.
  const extras = useExtrasSettings()
  const [travelHours,  setTravelHours]  = useState(Number(workOrder?.travel_hours  ?? 0))
  const [mileageMiles, setMileageMiles] = useState(Number(workOrder?.mileage_miles ?? 0))

  /** Seeds the shop's defaults at the moment "Single job" is chosen, and clears them
   *  again if the tech switches to segments before saving. */
  function chooseMode(next: PricingMode) {
    setMode(next)
    setErr(null)
    if (next === 'single') {
      setLaborRate(defaults.labor_rate)
      setMarkupPct(defaults.markup_percent)
      setTaxPct(defaults.tax_percent)
    } else {
      setItems([])
      setLaborHours(0)
      setLaborRate(0)
      setMarkupPct(0)
      setTaxPct(0)
    }
  }

  const [saving,   setSaving]   = useState(false)
  const [busy,     setBusy]     = useState(false)
  const [err,      setErr]      = useState<string | null>(null)
  const [msg,      setMsg]      = useState<string | null>(null)

  // Parts and labor are taxed per the shop's settings. Until the fetch resolves,
  // taxSettings is null and computeTotals falls back to the old single-rate maths,
  // so the figures on screen are never momentarily wrong in the exempt direction.
  const inputs = { items, markupPct, laborHours, laborRate, taxPct, taxSettings }
  const totals = computeTotals(inputs)

  // Extras ride on top of the line totals. The shop-supplies base is the parts
  // subtotal AS IT APPEARS ON THE DOCUMENT — post-markup, the figure the customer
  // reads — not the shop's raw cost. See computeExtras.
  const extrasResult = computeExtras(
    totals.partsTotal,
    { travelHours, mileageMiles },
    extras,
    laborRate,
  )
  // Re-taxed with the extras in their own buckets: travel and mileage as labour,
  // shop supplies as parts. One calculator, src/lib/tax.ts, unchanged.
  const withExtras = totalsWithExtras(
    { parts: totals.partsTotal, labor: totals.laborSubtotal },
    extrasResult,
    taxSettings ?? null,
    taxPct,
  )
  const status = (workOrder?.status ?? 'open') as WorkOrderStatus
  const next   = NEXT_STATUS[status]

  function flash(m: string) {
    setMsg(m)
    setTimeout(() => setMsg(null), 3000)
  }

  function body() {
    const base = {
      customer_id:     customerId,
      vehicle_id:      vehicleId,
      unit_label:      unitLabel,
      job_description: jobDesc,
      po_number:       poNumber,
      tech_notes:      techNotes,
    }
    // Segments own the money on a segment-priced work order. Sending the parent
    // columns anyway is how a record ends up with two totals.
    // pricing_mode is only ever sent on CREATE. Changing it later goes through the
    // dedicated PATCH path, which checks that nothing is priced on either side yet.
    const withMode = isNew && mode ? { ...base, pricing_mode: mode } : base
    if (!owns) return withMode
    // lineMoneyColumns owns parts/labour; extrasColumns owns the three extras. The
    // tax and grand total are overwritten from withExtras because the extras are
    // inside them — otherwise the stored total would exclude travel the customer
    // was shown.
    return {
      ...withMode,
      ...lineMoneyColumns(inputs),
      ...extrasColumns(extrasResult),
      tax_amount:    withExtras.taxAmount,
      grand_total:   withExtras.grandTotal,
      tax_breakdown: withExtras.taxBreakdown,
    }
  }

  async function save() {
    const v = owns
      ? validateLines({ items, laborHours, laborRate, grandTotal: totals.grandTotal })
      : null
    if (v) { setErr(v); return }
    if (!customerId)                    { setErr('Pick or create a customer.'); return }
    if (!vehicleId && !unitLabel.trim()) { setErr('Pick a vehicle or describe the unit.'); return }
    if (!jobDesc.trim())                { setErr('A job description is required.'); return }
    if (isNew && !mode)                 { setErr('Choose how this job is priced first.'); return }

    setErr(null); setSaving(true)
    try {
      const res = await fetch(isNew ? '/api/work-orders' : `/api/work-orders/${workOrder!.id}`, {
        method:  isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body()),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Save failed')
      if (isNew) router.push(`/work-orders/${d.work_order.id}`)
      else { flash('Saved.'); router.refresh() }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    }
    setSaving(false)
  }

  // notify=false is the quiet path for a tech correcting their own misclick.
  async function moveTo(to: WorkOrderStatus, notify: boolean) {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/work-orders/${workOrder!.id}/status`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: to, notify }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Could not update status')
      const sent = (d.notified as { success?: boolean } | null)?.success
      flash(notify && sent ? `Marked ${STATUS_META[to].label} — customer notified.` : `Marked ${STATUS_META[to].label}.`)
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update status')
    }
    setBusy(false)
  }

  async function createInvoice() {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(`/api/work-orders/${workOrder!.id}/convert`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Could not create invoice')
      router.push(`/financials/invoices/${d.invoice_id}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create invoice')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {err && <div className="alert-error">{err}</div>}
      {msg && <div className="alert-success">{msg}</div>}

      {isLocked && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <p className="text-white/70 text-sm">
            This work order has been invoiced and is read-only.
          </p>
        </div>
      )}

      {/* ── Who and what ── */}
      <section className="nwi-card space-y-5">
        <CustomerUnitPicker
          customerId={customerId}
          onCustomerChange={id => setCustomerId(id)}
          vehicleId={vehicleId}
          onVehicleChange={setVehicleId}
          unitLabel={unitLabel}
          onUnitLabelChange={setUnitLabel}
          disabled={isLocked}
        />

        <div>
          <label className="nwi-label">Job Description</label>
          <textarea
            className="nwi-input min-h-[80px]"
            placeholder="What is being done, in the words the customer authorised."
            value={jobDesc}
            onChange={e => setJobDesc(e.target.value)}
            disabled={isLocked}
          />
        </div>

        <div>
          <label className="nwi-label">PO Number</label>
          <input
            className="nwi-input"
            placeholder="Customer's purchase order reference"
            value={poNumber}
            onChange={e => setPoNumber(e.target.value)}
            disabled={isLocked}
          />
          <p className="text-white/30 text-[11px] mt-1">
            Carries onto the invoice, the emailed invoice and the customer&apos;s copy.
          </p>
        </div>
      </section>

      {/* Rendered only when this form owns pricing. A segment-priced work order gets
          its money from SegmentList instead. */}
      {/* ── How is this job priced? ─────────────────────────────────────────────
          Asked BEFORE any money is written, and only on a new work order. The choice
          is what decides the record's shape; inferring it from whether a line item
          happened to be entered is what left segments with no way in. */}
      {isNew && (
        <section className="nwi-card space-y-3">
          <div>
            <p className="text-white/30 text-xs uppercase tracking-widest">How is this job priced?</p>
            <p className="text-white/40 text-xs mt-1">
              Pick one. You can change it until you enter money on either side.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => chooseMode('single')}
              className={`text-left rounded-xl p-4 border transition-colors ${
                mode === 'single'
                  ? 'border-orange bg-orange/10'
                  : 'border-white/10 hover:border-white/25'
              }`}
            >
              <p className="text-white text-sm font-semibold">Single job</p>
              <p className="text-white/40 text-xs mt-1">
                One set of parts and labor on the work order. How it has always worked.
              </p>
            </button>
            <button
              type="button"
              onClick={() => chooseMode('segments')}
              className={`text-left rounded-xl p-4 border transition-colors ${
                mode === 'segments'
                  ? 'border-orange bg-orange/10'
                  : 'border-white/10 hover:border-white/25'
              }`}
            >
              <p className="text-white text-sm font-semibold">Multiple jobs</p>
              <p className="text-white/40 text-xs mt-1">
                One segment per complaint, each priced and approved on its own. The
                customer can take the PCM and decline the clutch.
              </p>
            </button>
          </div>
          {mode === 'segments' && (
            <p className="text-white/40 text-xs">
              No parts or labor go on the work order itself. Save it, then add segment 1
              with its own complaint, cause, correction and lines.
            </p>
          )}
        </section>
      )}
      {/* ── Parts and labor ── */}
      {owns && (
      <section className="nwi-card space-y-4">
        <p className="text-white/30 text-xs uppercase tracking-widest">Parts &amp; Labor</p>

        {isLocked
          ? <LineItemEditor items={items} onChange={() => {}} />
          : <LineItemEditor items={items} onChange={setItems} />}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="nwi-label text-[10px]">Labor Hours</label>
            <input type="number" min={0} step={0.25} className="nwi-input text-sm"
              value={laborHours} disabled={isLocked}
              onChange={e => setLaborHours(Number(e.target.value) || 0)} />
          </div>
          <div>
            <label className="nwi-label text-[10px]">Labor Rate ($)</label>
            <input type="number" min={0} step={1} className="nwi-input text-sm"
              value={laborRate} disabled={isLocked}
              onChange={e => setLaborRate(Number(e.target.value) || 0)} />
          </div>
          <div>
            <label className="nwi-label text-[10px]">Parts Markup %</label>
            <input type="number" min={0} step={1} className="nwi-input text-sm"
              value={markupPct} disabled={isLocked}
              onChange={e => { setMarkupPct(Number(e.target.value) || 0); setMarkupTouched(true) }} />
            {/* Said plainly rather than shown as 0%. This record predates the markup
                being stored, so nobody knows what it was — and a 0% that looks like a
                decision is worse than an admission that it was not recorded. */}
            {!isNew && !storedMarkup.recorded && !markupTouched && (
              <p className="text-[10px] mt-0.5 text-white/40">
                {markupLabel(storedMarkup)} on this work order — its prices are billed as stored.
              </p>
            )}
          </div>
          <div>
            <label className="nwi-label text-[10px]">Tax %</label>
            <input type="number" min={0} step={0.01} className="nwi-input text-sm"
              value={taxPct} disabled={isLocked}
              onChange={e => setTaxPct(Number(e.target.value) || 0)} />
          </div>
        </div>

        {/* ── Travel and mileage ──
            Shown only when the shop bills them, so a shop that does not sees
            nothing at all rather than two inputs it has to ignore. Mileage is
            typed by hand on purpose: deriving it from addresses needs a distance
            API and a monthly bill. */}
        {(extras.billTravel || extras.billMileage) && (
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/10">
            {extras.billTravel && (
              <div>
                <label className="nwi-label text-[10px]">Travel Hours</label>
                <input type="number" min={0} step={0.25} className="nwi-input text-sm"
                  value={travelHours} disabled={isLocked}
                  onChange={e => setTravelHours(Number(e.target.value) || 0)} />
              </div>
            )}
            {extras.billMileage && (
              <div>
                <label className="nwi-label text-[10px]">Miles Driven</label>
                <input type="number" min={0} step={1} className="nwi-input text-sm"
                  value={mileageMiles} disabled={isLocked}
                  onChange={e => setMileageMiles(Number(e.target.value) || 0)} />
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5 pt-2 border-t border-white/10">
          <Row label="Parts Base"                    value={fmt(totals.partsBase)} />
          <Row
            label={`Parts Markup (${!isNew && !storedMarkup.recorded && !markupTouched ? markupLabel(storedMarkup) : `${markupPct}%`})`}
            value={fmt(totals.markupAmt)}
            dim
          />
          {totals.laborSubtotal > 0 && <Row label="Labor" value={fmt(totals.laborSubtotal)} />}
          {/* A zero extra prints no row — extrasDisplayRows returns none. */}
          {extrasDisplayRows(extrasResult).map(r => (
            <Row key={r.key} label={r.detail ? `${r.label} (${r.detail})` : r.label} value={fmt(r.amount)} />
          ))}
          {extrasResult.shopSupplies.capped && (
            <p className="text-[10px] text-white/35">
              Shop supplies capped at {fmt(extrasResult.shopSupplies.rate ?? 0)}.
            </p>
          )}
          {/* One row per category when the split is known, including the exempt one,
              so a tech sees "Labor — not taxable" before a customer does. */}
          {totals.taxBreakdown
            ? taxDisplayRows(totals.taxBreakdown).map(r => (
                <Row key={r.category} label={r.text} value={r.taxed ? fmt(r.amount) : '—'} dim />
              ))
            : <Row label={`Tax (${taxPct}%)`} value={fmt(totals.taxAmount)} dim />}
          <div className="flex items-center justify-between pt-2">
            <span className="text-white/60 text-sm">Total</span>
            <span className="font-condensed font-bold text-2xl text-orange">{fmt(totals.grandTotal)}</span>
          </div>
        </div>
      </section>
      )}

      {/* ── Photos ── */}
      {/* Only once the work order exists: a photo needs a record to belong to,
          and the storage path is keyed on its id. */}
      {!isNew && (
        <section className="nwi-card space-y-3">
          <p className="text-white/30 text-xs uppercase tracking-widest">Photos</p>
          <WorkOrderPhotos
            workOrderId={workOrder!.id}
            initialPhotos={photos}
            disabled={isLocked}
          />
        </section>
      )}

      {/* ── Tech notes ── */}
      <section className="nwi-card">
        <label className="nwi-label">Tech Notes</label>
        <textarea
          className="nwi-input min-h-[80px]"
          placeholder="Internal. Never shown to the customer and never copied onto the invoice."
          value={techNotes}
          onChange={e => setTechNotes(e.target.value)}
          disabled={isLocked}
        />
      </section>

      {/* ── Actions ── */}
      {!isLocked && (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={save} disabled={saving || (isNew && !mode)} className="btn-primary w-auto px-6 disabled:opacity-50">
            {saving ? 'Saving…' : isNew ? 'Create Work Order' : 'Save Changes'}
          </button>

          {!isNew && next && (
            <button
              onClick={() => moveTo(next, true)}
              disabled={busy}
              className="px-5 py-3 rounded-lg border border-white/15 text-white/70 hover:text-white hover:border-white/30 text-sm font-semibold transition-colors disabled:opacity-50"
            >
              Mark {STATUS_META[next].label}
            </button>
          )}

          {!isNew && next && (
            <button
              onClick={() => moveTo(next, false)}
              disabled={busy}
              title="Change the status without texting the customer"
              className="text-xs text-white/35 hover:text-white/70 transition-colors disabled:opacity-50"
            >
              quietly
            </button>
          )}

          {!isNew && status === 'complete' && (
            <button
              onClick={createInvoice}
              disabled={busy}
              className="px-5 py-3 rounded-lg bg-blue hover:bg-blue-hover text-white text-sm font-semibold transition-colors disabled:opacity-50"
            >
              Create Invoice
            </button>
          )}
        </div>
      )}

      {isLocked && workOrder?.converted_invoice_id && (
        <a
          href={`/financials/invoices/${workOrder.converted_invoice_id}`}
          className="inline-block px-5 py-3 rounded-lg bg-blue hover:bg-blue-hover text-white text-sm font-semibold transition-colors"
        >
          View Invoice
        </a>
      )}
    </div>
  )
}

function Row({ label, value, dim = false }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={dim ? 'text-white/40' : 'text-white/60'}>{label}</span>
      <span className={dim ? 'text-white/60' : 'text-white'}>{value}</span>
    </div>
  )
}
