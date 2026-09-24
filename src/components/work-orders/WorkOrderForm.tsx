'use client'

// ─── Work order create / edit ─────────────────────────────────────────────────
// One component for both, because a work order is edited far more than it is
// created — it is open while the job is on the lift — and two forms would drift.
//
// Money maths comes from components/shared/line-items, the same module the quote
// editor uses, so a work order and the quote it came from agree to the cent.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import LineItemEditor from '@/components/shared/LineItemEditor'
import {
  fromLineItems, computeTotals, lineMoneyColumns, validateLines,
  type EditItem,
} from '@/components/shared/line-items'
import {
  STATUS_META, NEXT_STATUS,
  type WorkOrder, type WorkOrderStatus,
} from '@/types/work-orders'
import CustomerUnitPicker from './CustomerUnitPicker'

const fmt = (n: number | null | undefined) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0)

export default function WorkOrderForm({
  workOrder,
  defaults,
}: {
  workOrder?: WorkOrder
  defaults:   { labor_rate: number; markup_percent: number; tax_percent: number }
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

  const initialMarkup = workOrder?.parts_markup_percent ?? defaults.markup_percent
  const [items, setItems] = useState<EditItem[]>(
    () => fromLineItems(workOrder?.line_items, initialMarkup),
  )
  const [laborHours, setLaborHours] = useState(workOrder?.labor_hours ?? 0)
  const [laborRate,  setLaborRate]  = useState(workOrder?.labor_rate  ?? defaults.labor_rate)
  const [markupPct,  setMarkupPct]  = useState(initialMarkup)
  const [taxPct,     setTaxPct]     = useState(workOrder?.tax_percent ?? defaults.tax_percent)

  const [saving,   setSaving]   = useState(false)
  const [busy,     setBusy]     = useState(false)
  const [err,      setErr]      = useState<string | null>(null)
  const [msg,      setMsg]      = useState<string | null>(null)

  const inputs = { items, markupPct, laborHours, laborRate, taxPct }
  const totals = computeTotals(inputs)
  const status = (workOrder?.status ?? 'open') as WorkOrderStatus
  const next   = NEXT_STATUS[status]

  function flash(m: string) {
    setMsg(m)
    setTimeout(() => setMsg(null), 3000)
  }

  function body() {
    return {
      customer_id:     customerId,
      vehicle_id:      vehicleId,
      unit_label:      unitLabel,
      job_description: jobDesc,
      po_number:       poNumber,
      tech_notes:      techNotes,
      ...lineMoneyColumns(inputs),
    }
  }

  async function save() {
    const v = validateLines({ items, laborHours, laborRate, grandTotal: totals.grandTotal })
    if (v) { setErr(v); return }
    if (!customerId)                    { setErr('Pick or create a customer.'); return }
    if (!vehicleId && !unitLabel.trim()) { setErr('Pick a vehicle or describe the unit.'); return }
    if (!jobDesc.trim())                { setErr('A job description is required.'); return }

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

      {/* ── Parts and labor ── */}
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
              onChange={e => setMarkupPct(Number(e.target.value) || 0)} />
          </div>
          <div>
            <label className="nwi-label text-[10px]">Tax %</label>
            <input type="number" min={0} step={0.01} className="nwi-input text-sm"
              value={taxPct} disabled={isLocked}
              onChange={e => setTaxPct(Number(e.target.value) || 0)} />
          </div>
        </div>

        <div className="space-y-1.5 pt-2 border-t border-white/10">
          <Row label="Parts Base"                    value={fmt(totals.partsBase)} />
          <Row label={`Parts Markup (${markupPct}%)`} value={fmt(totals.markupAmt)} dim />
          {totals.laborSubtotal > 0 && <Row label="Labor" value={fmt(totals.laborSubtotal)} />}
          <Row label={`Tax (${taxPct}%)`}             value={fmt(totals.taxAmount)} dim />
          <div className="flex items-center justify-between pt-2">
            <span className="text-white/60 text-sm">Total</span>
            <span className="font-condensed font-bold text-2xl text-orange">{fmt(totals.grandTotal)}</span>
          </div>
        </div>
      </section>

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
          <button onClick={save} disabled={saving} className="btn-primary w-auto px-6 disabled:opacity-50">
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
