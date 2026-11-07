'use client'

// Drive time, mileage, shop supplies and the service call fee on an HD work order.
// One set per work order - one trip - whatever its number of jobs.
//
// Saved through PUT /api/hd/work-orders/[id]/extras, which prices with
// workOrderExtrasUpdate and previews through the converter itself: the totals below are
// the server's figures for the invoice this work order will become, re-asked as the
// tech types (dry_run), never a second calculation in the browser.
//
// Shop supplies has no input. It is a percentage of the parts lines from Settings, and
// it re-prices when the parts card saves.
//
// NOTHING TYPED HERE IS LOST (lib/hd/wo-pending). Save Lines saves what is typed here
// with the lines; Create Invoice saves it before it converts; and the reload after a
// line save keeps any value typed and not yet saved. Before Nov 6 the reload re-seeded
// these boxes from the server and Create Invoice converted only what was stored, so
// WO-2026-1571's 1.0 h and 50 miles never reached INV-2026-0027.
//
// NO TOTAL FROM STALE LINES. The preview is priced on the SAVED lines, so while the
// parts card holds unsaved edits the totals block says so instead of printing an
// "Invoice total" that leaves them out ($281.24 shown beside $297.80 of lines).

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { extrasDisplayRows, extrasFromDocument, type ExtrasSettings } from '@/lib/billable-extras'
import { feeRows } from '@/lib/invoice-document'
import { discountPrintLabel, parseDiscount } from '@/lib/document-discount'
import { parseBreakdown, taxDisplayRows } from '@/lib/tax'
import { extrasTotalsState, feeInputsAfterReload, pendingCards, registerPending, LINES_DIRTY_EVENT, LINES_SAVED_EVENT } from '@/lib/hd/wo-pending'

interface Settings {
  extras: ExtrasSettings
  labor_rate: number | null
  service_call: { bill: boolean; fee: number | null; tax: 'labor' | 'none'; available: boolean }
  untouched: boolean
  shop_bills_supplies?: boolean
}
interface Answer {
  state: { travelHours: number; mileageMiles: number; serviceCallFee: number | null }
  settings: Settings
  invoice: Record<string, unknown>
  discount_error: string | null
  locked?: boolean
  error?: string
}

const usd = (n: unknown) => `$${(Number(n) || 0).toFixed(2)}`
const key = (h: string, m: string, f: string) => `${h}|${m}|${f}`
const field = { background: 'var(--hd-inner)', border: '1px solid var(--hd-border)' }

export default function WorkOrderExtras({ workOrderId, locked }: { workOrderId: string; locked: boolean }) {
  const router = useRouter()
  const settingsHref = usePathname().startsWith('/reefer') ? '/reefer/settings' : '/hd/settings'
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [hours, setHours] = useState('')
  const [miles, setMiles] = useState('')
  const [fee, setFee] = useState('')
  const [saved, setSaved] = useState({ hours: '', miles: '', fee: '' })
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // The parts card has unsaved edits: the preview below is priced without them.
  const [linesDirty, setLinesDirty] = useState(false)
  // The inputs the shown preview was priced for, so a total is never printed for
  // values the server has not priced yet.
  const [pricedFor, setPricedFor] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The latest typed and saved values, for a reload that must keep what was typed.
  const live = useRef({ hours: '', miles: '', fee: '', saved: { hours: '', miles: '', fee: '' } })
  live.current = { hours, miles, fee, saved }

  const seed = useCallback((a: Answer, keepTyped = false) => {
    const s = a.state
    // A work order nobody has priced extras on yet starts with the shop's service call fee.
    const prefill = a.settings.untouched && a.settings.service_call.available && a.settings.service_call.bill
      && s.serviceCallFee == null && a.settings.service_call.fee != null && a.settings.service_call.fee > 0
    const next = {
      hours: s.travelHours ? String(s.travelHours) : '',
      miles: s.mileageMiles ? String(s.mileageMiles) : '',
      fee: s.serviceCallFee != null ? String(s.serviceCallFee) : '',
    }
    // A box typed into and not saved keeps what was typed; the rest show the server's.
    const was = live.current
    const shown = feeInputsAfterReload(was, was.saved,
      { ...next, fee: prefill ? String(a.settings.service_call.fee) : next.fee }, keepTyped)
    setSaved(next)
    setHours(shown.hours); setMiles(shown.miles); setFee(shown.fee)
    setPricedFor(shown.kept ? '' : key(shown.hours, shown.miles, shown.fee))
  }, [])

  const load = useCallback(async (keepTyped = false) => {
    try {
      const res = await fetch(`/api/hd/work-orders/${workOrderId}/extras`)
      const j = await res.json() as Answer
      if (!res.ok) { setError(j.error ?? 'Could not load drive time and mileage.'); return }
      setAnswer(j); seed(j, keepTyped)
    } catch { setError('Could not reach the server.') }
  }, [workOrderId, seed])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const onSaved = (e: Event) => { if ((e as CustomEvent).detail?.workOrderId === workOrderId) void load(true) }
    const onDirty = (e: Event) => {
      const d = (e as CustomEvent).detail
      if (d?.workOrderId === workOrderId) setLinesDirty(!!d.dirty)
    }
    setLinesDirty(pendingCards(workOrderId).includes('lines'))
    window.addEventListener(LINES_SAVED_EVENT, onSaved)
    window.addEventListener(LINES_DIRTY_EVENT, onDirty)
    return () => {
      window.removeEventListener(LINES_SAVED_EVENT, onSaved)
      window.removeEventListener(LINES_DIRTY_EVENT, onDirty)
    }
  }, [workOrderId, load])

  const dirty = hours !== saved.hours || miles !== saved.miles || fee !== saved.fee
  const body = (dryRun: boolean) => JSON.stringify({
    travel_hours: hours === '' ? 0 : Number(hours),
    mileage_miles: miles === '' ? 0 : Number(miles),
    service_call_fee: fee === '' ? null : Number(fee),
    dry_run: dryRun,
  })

  // Re-ask the server for the totals as the tech types (and after a reload that kept
  // typed values, which the stored preview does not include).
  useEffect(() => {
    if (!answer || !dirty) return
    if (timer.current) clearTimeout(timer.current)
    const asked = key(hours, miles, fee)
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/hd/work-orders/${workOrderId}/extras`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body(true) })
        const j = await res.json() as Answer
        if (!res.ok) { setError(j.error ?? 'Could not price that.'); return }
        setError(null)
        setAnswer(a => (a ? { ...a, invoice: j.invoice, discount_error: j.discount_error } : a))
        setPricedFor(asked)
      } catch { /* the save reports it */ }
    }, 300)
    return () => { if (timer.current) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, miles, fee, answer?.state])

  // Resolves to the error, or null when saved. Save Lines and Create Invoice call this
  // through lib/hd/wo-pending when the boxes hold unsaved values.
  async function save(): Promise<string | null> {
    setSaving(true); setError(null); setNote(null)
    try {
      const res = await fetch(`/api/hd/work-orders/${workOrderId}/extras`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body(false) })
      const j = await res.json() as Answer
      if (!res.ok) { const msg = j.error ?? 'Nothing was saved.'; setError(msg); return msg }
      setAnswer(a => ({ ...j, locked: a?.locked })); seed({ ...j, settings: { ...j.settings, untouched: false } })
      setNote('Saved.')
      router.refresh()
      return null
    } catch {
      const msg = 'Could not reach the server. Nothing was saved.'
      setError(msg)
      return msg
    } finally {
      setSaving(false)
    }
  }

  const dirtyRef = useRef(false)
  dirtyRef.current = dirty && !locked
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => registerPending(workOrderId, 'extras', {
    dirty: () => dirtyRef.current,
    flush: () => saveRef.current(),
  }), [workOrderId])

  if (!answer) {
    return (
      <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}>
        <p className="font-condensed font-bold text-white text-sm tracking-widest">DRIVE TIME, MILEAGE &amp; FEES</p>
        <p className="text-xs mt-2" style={{ color: error ? 'var(--hd-warn)' : 'var(--hd-text-muted)' }}>{error ?? 'Loading...'}</p>
      </div>
    )
  }

  const s = answer.settings
  const inv = answer.invoice
  const totalsState = extrasTotalsState({ linesDirty, feesDirty: dirty, pricedFor, showing: key(hours, miles, fee) })
  const showTravel = s.extras.billTravel || Number(saved.hours) > 0
  const showMiles = s.extras.billMileage || Number(saved.miles) > 0
  const showFee = s.service_call.available && (s.service_call.bill || saved.fee !== '')
  const travelRate = s.extras.travelRatePerHour ?? s.labor_rate
  const off = !showTravel && !showMiles && !showFee && !s.extras.billShopSupplies && !s.shop_bills_supplies
  const disabled = locked || saving
  const d = parseDiscount(inv.discount)
  const taxRows = taxDisplayRows(parseBreakdown(inv.tax_breakdown))
  const rows: Array<{ label: string; val: number }> = [
    { label: 'Labor Subtotal', val: Number(inv.subtotal_labor) || 0 },
    { label: 'Parts Subtotal', val: Number(inv.subtotal_parts) || 0 },
    ...feeRows(inv).map(r => ({ label: r.label, val: r.amount })),
    ...extrasDisplayRows(extrasFromDocument(inv)).map(r => ({ label: r.detail ? `${r.label} (${r.detail})` : r.label, val: r.amount })),
    ...(d ? [{ label: 'Subtotal', val: d.subtotal_before }, { label: discountPrintLabel(d), val: -d.amount }] : []),
    ...(taxRows.length > 0
      ? taxRows.filter(r => r.taxed && r.amount > 0).map(r => ({ label: r.text, val: r.amount }))
      : Number(inv.tax_amount) > 0 ? [{ label: `Tax (${inv.tax_rate}%)`, val: Number(inv.tax_amount) }] : []),
  ]

  return (
    <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }} data-testid="wo-extras">
      <p className="font-condensed font-bold text-white text-sm tracking-widest mb-1">DRIVE TIME, MILEAGE &amp; FEES</p>
      <p className="text-xs mb-4" style={{ color: 'var(--hd-text-muted)' }}>
        One trip per work order. Each charge prints on its own line and carries to the invoice. The discount never applies to these.
      </p>

      {off ? (
        <p className="text-sm" style={{ color: 'var(--hd-text-muted)' }}>
          Drive time, mileage, shop supplies and the service call fee are all off. Turn them on in <a href={settingsHref} className="underline">Settings</a>.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {showTravel && (
            <label className="block">
              <span className="text-xs" style={{ color: 'var(--hd-text-muted)' }}>Drive time (hours)</span>
              <input type="number" min="0" step="0.25" inputMode="decimal" value={hours} disabled={disabled}
                onChange={e => setHours(e.target.value)} data-testid="wo-extras-hours"
                className="w-full mt-1 px-3 py-2.5 rounded-lg text-base sm:text-sm text-white" style={field} />
              <span className="block text-[11px] mt-1" style={{ color: 'var(--hd-text-faint)' }}>{usd(travelRate)}/hr, taxed as labor</span>
            </label>
          )}
          {showMiles && (
            <label className="block">
              <span className="text-xs" style={{ color: 'var(--hd-text-muted)' }}>Mileage (miles)</span>
              <input type="number" min="0" step="1" inputMode="decimal" value={miles} disabled={disabled}
                onChange={e => setMiles(e.target.value)} data-testid="wo-extras-miles"
                className="w-full mt-1 px-3 py-2.5 rounded-lg text-base sm:text-sm text-white" style={field} />
              <span className="block text-[11px] mt-1" style={{ color: 'var(--hd-text-faint)' }}>${(s.extras.mileageRatePerMile ?? 0).toFixed(2)}/mi, never taxed</span>
            </label>
          )}
          {showFee && (
            <label className="block">
              <span className="text-xs" style={{ color: 'var(--hd-text-muted)' }}>Service call fee ($)</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" value={fee} disabled={disabled}
                onChange={e => setFee(e.target.value)} data-testid="wo-extras-fee"
                className="w-full mt-1 px-3 py-2.5 rounded-lg text-base sm:text-sm text-white" style={field} />
              <span className="block text-[11px] mt-1" style={{ color: 'var(--hd-text-faint)' }}>
                {s.service_call.tax === 'none' ? 'Not taxed' : 'Taxed as labor'}. Clear it for none.
              </span>
            </label>
          )}
        </div>
      )}
      {s.extras.billShopSupplies && (
        <p className="text-xs mt-3" style={{ color: 'var(--hd-text-muted)' }}>
          Shop supplies: {s.extras.shopSuppliesPercent ?? 0}% of parts
          {s.extras.shopSuppliesCap != null ? `, capped at ${usd(s.extras.shopSuppliesCap)}` : ''}, figured automatically. Taxed as parts. None on a labor-only job.
        </p>
      )}
      {!s.extras.billShopSupplies && s.shop_bills_supplies && (
        <p className="text-xs mt-3" style={{ color: 'var(--hd-text-muted)' }}>
          Shop supplies: none on this work order. It was opened before work orders recorded a supplies percentage, or its quote had none - and a charge is never added to terms already set.
        </p>
      )}

      <div className="flex justify-end mt-4">
        {totalsState === 'lines-unsaved' ? (
          // The preview is priced on the SAVED lines; with edits above unsaved, any total
          // here would leave them out. Said, never computed.
          <p className="text-sm text-right" style={{ width: 320, maxWidth: '100%', color: 'var(--hd-warn)' }} data-testid="wo-extras-totals-pending">
            Totals appear once the parts &amp; labor lines above are saved. Save Lines saves drive time, mileage and fees with them.
          </p>
        ) : (
          <div style={{ width: 320, maxWidth: '100%' }} data-testid="wo-extras-totals">
            {rows.map(r => (
              <div key={r.label} className="flex justify-between py-1 text-sm" style={{ color: 'var(--hd-text-muted)' }}>
                <span>{r.label}</span><span>{usd(r.val)}</span>
              </div>
            ))}
            <div className="flex justify-between py-2 mt-1 text-sm font-semibold text-white" style={{ borderTop: '1px solid var(--hd-border)' }}>
              <span>Invoice total</span>
              <span data-testid="wo-extras-total">{totalsState === 'priced' ? usd(inv.total) : 'updating...'}</span>
            </div>
          </div>
        )}
      </div>

      {answer.discount_error && <p className="text-xs mt-2" style={{ color: 'var(--hd-warn)' }}>{answer.discount_error}</p>}
      {error && <p className="text-xs mt-2" style={{ color: 'var(--hd-warn)' }}>{error}</p>}
      {note && !dirty && <p className="text-xs mt-2" style={{ color: 'var(--hd-text-muted)' }}>{note}</p>}
      {dirty && !locked && (
        <button type="button" onClick={save} disabled={saving}
          className="mt-3 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--hd-inner)', border: '1px solid var(--hd-border)', minHeight: 40 }}>
          {saving ? 'Saving...' : 'Save drive time, mileage & fees'}
        </button>
      )}
      {locked && (
        <p className="text-xs mt-2" style={{ color: 'var(--hd-text-muted)' }}>Invoiced - change these on the invoice.</p>
      )}
    </div>
  )
}
