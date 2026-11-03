'use client'

// HD's drive time, mileage, shop supplies and service call defaults (migration 178).
// The same four answers LD's "Travel, Mileage & Supplies" asks, kept on HD's own
// columns so the two products can bill differently. Reefer Standalone mounts this
// screen too.
//
// These seed NEW quotes, work orders and invoices. A document records the rates it was
// priced with, so changing a figure here never re-prices one already saved.

import { useEffect, useState } from 'react'

const inputCls = 'w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder-white/20'
const field = { background: 'var(--hd-inner)', border: '1px solid var(--hd-border)' }
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))

function Check({ checked, onChange, label, hint, testid }: { checked: boolean; onChange: (b: boolean) => void; label: string; hint: string; testid: string }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input type="checkbox" className="mt-1" checked={checked} onChange={e => onChange(e.target.checked)} data-testid={testid} />
      <span className="text-sm text-white">
        {label}
        <span className="block text-xs mt-0.5" style={{ color: 'var(--hd-text-faint)' }}>{hint}</span>
      </span>
    </label>
  )
}

function Num({ label, value, onChange, placeholder, step, testid, hint }: { label: string; value: string; onChange: (s: string) => void; placeholder: string; step: string; testid: string; hint?: string }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'var(--hd-text-faint)' }}>{label}</label>
      <input type="number" min="0" step={step} inputMode="decimal" value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} className={inputCls} style={field} data-testid={testid} />
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--hd-text-faint)' }}>{hint}</p>}
    </div>
  )
}

export default function HDExtrasSettingsForm({ laborRate }: { laborRate: string | null }) {
  const [loaded, setLoaded] = useState(false)
  const [available, setAvailable] = useState(true)
  const [billTravel, setBillTravel] = useState(false)
  const [travelRate, setTravelRate] = useState('')
  const [billMileage, setBillMileage] = useState(false)
  const [mileageRate, setMileageRate] = useState('')
  const [billSupplies, setBillSupplies] = useState(false)
  const [suppliesPct, setSuppliesPct] = useState('')
  const [suppliesCap, setSuppliesCap] = useState('')
  const [billCall, setBillCall] = useState(false)
  const [callFee, setCallFee] = useState('')
  const [callTax, setCallTax] = useState<'labor' | 'none'>('labor')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/hd/settings')
        const j = await res.json() as { extras?: Record<string, unknown> | null; extras_available?: boolean }
        if (cancelled) return
        const e = j.extras ?? {}
        setAvailable(j.extras_available === true)
        setBillTravel(e.hd_bill_travel === true); setTravelRate(str(e.hd_travel_rate_per_hour))
        setBillMileage(e.hd_bill_mileage === true); setMileageRate(str(e.hd_mileage_rate_per_mile))
        setBillSupplies(e.hd_bill_shop_supplies === true); setSuppliesPct(str(e.hd_shop_supplies_percent)); setSuppliesCap(str(e.hd_shop_supplies_cap))
        setBillCall(e.hd_bill_service_call === true); setCallFee(str(e.hd_service_call_fee))
        setCallTax(e.hd_service_call_tax === 'none' ? 'none' : 'labor')
      } catch {
        if (!cancelled) setError('Could not load these settings.')
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError(null); setSaved(false)
    const n = (s: string) => (s.trim() === '' ? null : Number(s))
    try {
      const res = await fetch('/api/hd/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hd_bill_travel: billTravel, hd_travel_rate_per_hour: n(travelRate),
          hd_bill_mileage: billMileage, hd_mileage_rate_per_mile: n(mileageRate),
          hd_bill_shop_supplies: billSupplies, hd_shop_supplies_percent: n(suppliesPct), hd_shop_supplies_cap: n(suppliesCap),
          hd_bill_service_call: billCall, hd_service_call_fee: n(callFee), hd_service_call_tax: callTax,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!loaded) return <p className="text-xs" style={{ color: 'var(--hd-text-faint)' }}>Loading...</p>
  if (!available) {
    return (
      <p className="text-xs" style={{ color: 'var(--hd-text-faint)' }} data-testid="hd-extras-unavailable">
        These settings need migration 178. Until it is applied, HD bills drive time, mileage and shop supplies from the
        Travel, Mileage &amp; Supplies settings on the LD settings screen.
      </p>
    )
  }

  return (
    <form onSubmit={save} className="space-y-4" data-testid="hd-extras-settings">
      <Check checked={billTravel} onChange={setBillTravel} testid="hd-bill-travel" label="Bill drive time"
        hint="Hours x rate, its own line on the document. Taxed at your labor tax rate." />
      {billTravel && (
        <Num label="Drive Time Rate ($/hr)" value={travelRate} onChange={setTravelRate} step="0.01" testid="hd-travel-rate"
          placeholder={laborRate ?? ''} hint="Leave blank to bill drive time at your labor rate. Enter 0 if it is free." />
      )}

      <Check checked={billMileage} onChange={setBillMileage} testid="hd-bill-mileage" label="Bill mileage"
        hint="Miles x rate, entered by hand. Never taxed." />
      {billMileage && (
        <Num label="Mileage Rate ($/mile)" value={mileageRate} onChange={setMileageRate} step="0.0001" testid="hd-mileage-rate" placeholder="2.00" />
      )}

      <Check checked={billSupplies} onChange={setBillSupplies} testid="hd-bill-supplies" label="Bill shop supplies"
        hint="A percentage of parts sales only - never labor, drive time, mileage or a fee. A labor-only job is charged nothing. Taxed as parts." />
      {billSupplies && (
        <div className="grid grid-cols-2 gap-3">
          <Num label="Shop Supplies (%)" value={suppliesPct} onChange={setSuppliesPct} step="0.1" testid="hd-supplies-pct" placeholder="5" />
          <Num label="Cap ($, optional)" value={suppliesCap} onChange={setSuppliesCap} step="0.01" testid="hd-supplies-cap" placeholder="No cap" />
        </div>
      )}

      <Check checked={billCall} onChange={setBillCall} testid="hd-bill-service-call" label="Bill a service call fee"
        hint="A flat fee on each new work order, separate from the road call fee. The tech can change or clear it on the job." />
      {billCall && (
        <div className="grid grid-cols-2 gap-3">
          <Num label="Service Call Fee ($)" value={callFee} onChange={setCallFee} step="0.01" testid="hd-service-call-fee" placeholder="0.00" />
          <div>
            <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'var(--hd-text-faint)' }}>Tax</label>
            <select value={callTax} onChange={e => setCallTax(e.target.value === 'none' ? 'none' : 'labor')}
              className={inputCls} style={field} data-testid="hd-service-call-tax">
              <option value="labor">Taxed as labor</option>
              <option value="none">Not taxed</option>
            </select>
          </div>
          <p className="col-span-2 text-xs" style={{ color: 'var(--hd-text-faint)' }}>
            &quot;Taxed as labor&quot; follows your labor tax setting below. Check your state&apos;s rule; every shop differs.
          </p>
        </div>
      )}

      <p className="text-xs" style={{ color: 'var(--hd-text-faint)' }}>
        These seed new quotes, work orders and invoices. Changing them never re-prices a document you already saved.
        The diagnostic and road call fees are always taxed as labor.
      </p>
      {error && <p className="text-xs" style={{ color: '#FBBF24' }}>{error}</p>}
      <button type="submit" disabled={saving}
        className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
        style={{ background: 'var(--hd-inner)', border: '1px solid var(--hd-border)', minHeight: 40 }}>
        {saving ? 'Saving...' : saved ? 'Saved' : 'Save drive time, mileage & fees'}
      </button>
    </form>
  )
}
