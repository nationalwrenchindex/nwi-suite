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

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { extrasDisplayRows, extrasFromDocument, type ExtrasSettings } from '@/lib/billable-extras'
import { feeRows } from '@/lib/invoice-document'
import { discountPrintLabel, parseDiscount } from '@/lib/document-discount'
import { parseBreakdown, taxDisplayRows } from '@/lib/tax'

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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const seed = useCallback((a: Answer) => {
    const s = a.state
    // A work order nobody has priced extras on yet starts with the shop's service call fee.
    const prefill = a.settings.untouched && a.settings.service_call.available && a.settings.service_call.bill
      && s.serviceCallFee == null && a.settings.service_call.fee != null && a.settings.service_call.fee > 0
    const next = {
      hours: s.travelHours ? String(s.travelHours) : '',
      miles: s.mileageMiles ? String(s.mileageMiles) : '',
      fee: s.serviceCallFee != null ? String(s.serviceCallFee) : '',
    }
    setSaved(next)
    setHours(next.hours); setMiles(next.miles)
    setFee(prefill ? String(a.settings.service_call.fee) : next.fee)
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/hd/work-orders/${workOrderId}/extras`)
      const j = await res.json() as Answer
      if (!res.ok) { setError(j.error ?? 'Could not load drive time and mileage.'); return }
      setAnswer(j); seed(j)
    } catch { setError('Could not reach the server.') }
  }, [workOrderId, seed])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail?.workOrderId === workOrderId) void load() }
    window.addEventListener('hd-wo-lines-saved', on)
    return () => window.removeEventListener('hd-wo-lines-saved', on)
  }, [workOrderId, load])

  const dirty = hours !== saved.hours || miles !== saved.miles || fee !== saved.fee
  const body = (dryRun: boolean) => JSON.stringify({
    travel_hours: hours === '' ? 0 : Number(hours),
    mileage_miles: miles === '' ? 0 : Number(miles),
    service_call_fee: fee === '' ? null : Number(fee),
    dry_run: dryRun,
  })

  // Re-ask the server for the totals as the tech types.
  useEffect(() => {
    if (!answer || !dirty) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/hd/work-orders/${workOrderId}/extras`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body(true) })
        const j = await res.json() as Answer
        if (!res.ok) { setError(j.error ?? 'Could not price that.'); return }
        setError(null)
        setAnswer(a => (a ? { ...a, invoice: j.invoice, discount_error: j.discount_error } : a))
      } catch { /* the save reports it */ }
    }, 300)
    return () => { if (timer.current) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours, miles, fee])

  async function save() {
    setSaving(true); setError(null); setNote(null)
    try {
      const res = await fetch(`/api/hd/work-orders/${workOrderId}/extras`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body(false) })
      const j = await res.json() as Answer
      if (!res.ok) { setError(j.error ?? 'Nothing was saved.'); return }
      setAnswer(a => ({ ...j, locked: a?.locked })); seed({ ...j, settings: { ...j.settings, untouched: false } })
      setNote('Saved.')
      router.refresh()
    } catch {
      setError('Could not reach the server. Nothing was saved.')
    } finally {
      setSaving(false)
    }
  }

  if (!answer) {
    return (
      <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}>
        <p className="font-condensed font-bold text-white text-sm tracking-widest">DRIVE TIME, MILEAGE &amp; FEES</p>
        <p className="text-xs mt-2" style={{ color: error ? '#FBBF24' : 'var(--hd-text-muted)' }}>{error ?? 'Loading...'}</p>
      </div>
    )
  }

  const s = answer.settings
  const inv = answer.invoice
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
        <div style={{ width: 320, maxWidth: '100%' }} data-testid="wo-extras-totals">
          {rows.map(r => (
            <div key={r.label} className="flex justify-between py-1 text-sm" style={{ color: 'var(--hd-text-muted)' }}>
              <span>{r.label}</span><span>{usd(r.val)}</span>
            </div>
          ))}
          <div className="flex justify-between py-2 mt-1 text-sm font-semibold text-white" style={{ borderTop: '1px solid var(--hd-border)' }}>
            <span>Invoice total</span><span data-testid="wo-extras-total">{usd(inv.total)}</span>
          </div>
        </div>
      </div>

      {answer.discount_error && <p className="text-xs mt-2" style={{ color: '#FBBF24' }}>{answer.discount_error}</p>}
      {error && <p className="text-xs mt-2" style={{ color: '#FBBF24' }}>{error}</p>}
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
