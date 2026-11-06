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

import { useEffect, useState } from 'react'
import CustomerUnitPicker from '@/components/work-orders/CustomerUnitPicker'
import LineItemEditor from '@/components/shared/LineItemEditor'
import { totalLaborHours, type EditItem } from '@/components/shared/line-items'
import { documentMoney } from '@/lib/document-money'
import {
  DiscountEditor, EMPTY_DISCOUNT, discountFromDraft, type DiscountDraft,
} from '@/components/shared/DiscountEditor'
import { useTaxSettings } from '@/lib/use-tax-settings'
import { useExtrasSettingsState } from '@/lib/use-extras-settings'
import { BLANK_QUOTE_SEED, seedNotes, type QuoteSeed } from '@/types/quote-seed'
import { useServiceCallSettingsState } from '@/lib/use-service-call-settings'
import { serviceCallSeed } from '@/lib/service-call'
import ServiceCallField from '@/components/shared/ServiceCallField'
import DocumentTotals from '@/components/shared/DocumentTotals'

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
  const { settings: extrasSettings, loaded: extrasLoaded } = useExtrasSettingsState()
  // Hours and miles are the only inputs. A percentage is not a question.
  const [travelHours,  setTravelHours]  = useState(0)
  const [mileageMiles, setMileageMiles] = useState(0)
  // The service call fee (migration 180): seeded from Settings once they arrive, then
  // the tech's to change. null until seeded, so a save cannot slip in before it.
  const callState = useServiceCallSettingsState()
  const [callFee, setCallFee] = useState<number | null>(null)
  useEffect(() => {
    if (callState.loaded && callFee === null) setCallFee(serviceCallSeed(callState.settings).fee)
  }, [callState.loaded, callState.settings, callFee])
  const serviceCall = callState.available ? { fee: callFee ?? 0, tax: callState.settings.tax } : null
  const showCall = callState.available && (callState.settings.bill || (callFee ?? 0) > 0)

  const [customerId, setCustomerId] = useState<string | null>(seed.customerId ?? null)
  // CustomerUnitPicker hands over the whole customer and every caller was taking the
  // id and dropping the rest. quotes has no name/phone/email columns -- the id is
  // what carries them, through the join -- but the EDITOR re-resolves a customer from
  // the typed name and phone on save, so holding them here means the quote arrives in
  // the editor already matching its own customer instead of being re-derived.
  const [customer, setCustomer] = useState<{
    first_name: string; last_name: string; phone: string | null; email: string | null
  } | null>(null)
  const [vehicleId,  setVehicleId]  = useState<string | null>(seed.vehicleId ?? null)
  const [unitLabel,  setUnitLabel]  = useState('')
  const [notes,      setNotes]      = useState(seedNotes(seed))

  // Parts and labour are LINES, in the same editor the quote and the work order use -
  // several labour lines if the job has several, each with what the work involves.
  const [items, setItems] = useState<EditItem[]>(() => [
    ...(seed.lines ?? []).map((l, i) => ({
      _id: `seed-${i}`, description: l.description, quantity: l.quantity, unit_price: l.unit_price,
      part_number: l.part_number ?? '',
    })),
    ...((seed.laborHours ?? 0) > 0 ? [{
      _id: 'seed-labor', kind: 'labor' as const, description: 'Labor', part_number: '',
      quantity: seed.laborHours ?? 0, unit_price: defaults.labor_rate,
    }] : []),
  ])
  // The rate a new labour line starts at, stored as the quote's labor_rate.
  const [laborRate,  setLaborRate]  = useState(defaults.labor_rate)
  const [markupPct,  setMarkupPct]  = useState(defaults.markup_percent)
  const [taxPct,     setTaxPct]     = useState(defaults.tax_percent)
  const [discountDraft, setDiscountDraft] = useState<DiscountDraft>(EMPTY_DISCOUNT)

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  // One calculator, the same one the quote editor and the work order use. A NEW quote
  // is priced under the shop's current settings, which it then stores. Until the tax
  // fetch resolves this falls back to the single rate, so nothing on screen is ever
  // briefly wrong in the exempt direction. Shop supplies is a percentage of the PARTS
  // TOTAL AS QUOTED - post-markup - so a quote and the invoice it becomes agree.
  const docMoney = documentMoney({
    items, markupPct, laborRate, taxPct, taxSettings,
    extrasSettings, extras: { travelHours, mileageMiles },
    discount: discountFromDraft(discountDraft),
    serviceCall,
  })
  const withExtras   = docMoney
  const laborHours   = totalLaborHours({ items, laborHours: 0 })

  async function submit() {
    setError(null)
    if (items.length === 0) {
      setError('Add a labor or part line before saving.')
      return
    }
    if (docMoney.discountError) {
      setError(docMoney.discountError)
      return
    }
    if (withExtras.grandTotal < 0) {
      setError('Grand total cannot be negative.')
      return
    }
    // The fee is seeded from Settings; saving before they arrive would record none.
    if (!callState.loaded) {
      setError('Your shop settings are still loading. Try again in a moment.')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/quotes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          // The ID IS the prefill. quotes has no name/phone/email columns -- those
          // reach every reader through the customers join, and the editor picks them
          // up from it. Sending them as well would be three keys the route ignores.
          customer_id: customerId,
          vehicle_id:  vehicleId,
          notes:       notes.trim() || null,
          // Every money column from lib/document-money: lines stored post-markup in
          // the order arranged, labour hours summed off the labour lines, the extras
          // inside tax_amount and grand_total, and what was taxed.
          ...docMoney.columns,
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
        onCustomerChange={(id, c) => {
          setCustomerId(id)
          setCustomer(c ? {
            first_name: c.first_name, last_name: c.last_name, phone: c.phone, email: c.email,
          } : null)
        }}
        vehicleId={vehicleId}
        onVehicleChange={setVehicleId}
        unitLabel={unitLabel}
        onUnitLabelChange={setUnitLabel}
        disabled={saving}
      />

      {/* The picker shows name and phone-OR-email; a customer with both never sees
          their email. Shown in full here because this is the screen where a tech
          confirms they are quoting the right person. */}
      {customer && (customer.phone || customer.email) && (
        <p className="text-white/35 text-xs -mt-2">
          {[customer.phone, customer.email].filter(Boolean).join('  ·  ')}
        </p>
      )}

      {/* ── Lines: labour and parts ── */}
      <div className="space-y-2">
        <p className="nwi-label">Labor and parts</p>
        <LineItemEditor items={items} onChange={setItems} allowLabor laborRate={laborRate} />
        <p className="text-white/25 text-[11px]">
          Parts: enter what you pay. The {markupPct}% markup is added for the customer.
          Labor: hours at the rate on the line.
        </p>
      </div>

      {/* ── Rates ── */}
      <div className="grid grid-cols-3 gap-3">
        {([
          ['Rate for new labor lines', laborRate,  setLaborRate,  1],
          ['Markup %',                 markupPct,  setMarkupPct,  1],
          ['Tax %',                    taxPct,     setTaxPct,     0.001],
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

      {/* ── Travel and mileage. HOURS AND MILES ONLY. ──
          Hidden unless the shop bills one of them: an input for something that is
          not charged invites a tech to type hours that are silently dropped.
          Shop supplies has no input - it is a percentage of parts. */}
      {(!extrasLoaded || extrasSettings.billTravel || extrasSettings.billMileage) && (
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-white/8">
          {(!extrasLoaded || extrasSettings.billTravel) && (
            <label className="block">
              <span className="text-white/50 text-xs">Travel hours</span>
              <input
                type="number" min="0" step="0.25" inputMode="decimal"
                className="nwi-input text-sm w-full mt-1"
                value={travelHours || ''}
                onChange={e => setTravelHours(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          )}
          {(!extrasLoaded || extrasSettings.billMileage) && (
            <label className="block">
              <span className="text-white/50 text-xs">Miles</span>
              <input
                type="number" min="0" step="1" inputMode="decimal"
                className="nwi-input text-sm w-full mt-1"
                value={mileageMiles || ''}
                onChange={e => setMileageMiles(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          )}
        </div>
      )}

      {/* ── The service call fee: a flat fee, its own line, shown when the shop bills
          one or this quote has one. ── */}
      {showCall && (
        <div className="pt-3 border-t border-white/8">
          <ServiceCallField fee={callFee ?? 0} tax={callState.settings.tax} taxFrom="settings" loaded={callState.loaded} onFee={setCallFee} disabled={saving} />
        </div>
      )}

      <div className="pt-3 border-t border-white/8">
        <DiscountEditor value={discountDraft} onChange={setDiscountDraft}
          applied={docMoney.discount} error={docMoney.discountError} />
      </div>

      {/* ── Totals: the shared calculator's answer in the shared rows - the same rows the
          quote editor and the work order print (lib/document-totals). ── */}
      <div className="pt-3 border-t border-white/8">
        <DocumentTotals money={docMoney} markupText={`${markupPct}%`} laborHours={laborHours} taxPct={taxPct} />
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
