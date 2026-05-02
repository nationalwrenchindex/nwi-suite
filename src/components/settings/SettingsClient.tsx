'use client'

import { useState, useRef, useCallback } from 'react'
import ShareBookingModal from '@/components/ShareBookingModal'
import DetailerPricingEditor, { type PricingRow } from '@/components/detailer/DetailerPricingEditor'
import type { AdjustmentPreset } from '@/types/financials'

const BOOKING_BASE = 'https://tools.nationalwrenchindex.com/book'

const DEFAULT_SMS = "Hey, thanks for reaching out! Easiest way to book your service is this link — pick any time that works for you and I'll get it on the calendar. {booking_url}"
const DEFAULT_EMAIL_SUBJECT = 'Book your service with {business_name}'
const DEFAULT_EMAIL_BODY =
  'Hi there,\n\nThanks for reaching out about your vehicle. The easiest way to get on the schedule is to use my online booking page — you can pick any available time that works for you, and I\'ll confirm the appointment right away.\n\nBook here: {booking_url}\n\nLooking forward to helping you out.\n\n— {tech_name}\n{business_name}'

const SHARE_VARS = ['{booking_url}', '{business_name}', '{tech_name}', '{first_name}']

interface ShareTemplates {
  share_sms_template:  string
  share_email_subject: string
  share_email_body:    string
}

// ─── Template editor card ─────────────────────────────────────────────────────

function TemplateEditor({
  label,
  badge,
  showSubject,
  subject,
  body,
  onSubjectChange,
  onBodyChange,
  onSave,
  saving,
}: {
  label:          string
  badge:          string
  showSubject:    boolean
  subject:        string
  body:           string
  onSubjectChange:(v: string) => void
  onBodyChange:   (v: string) => void
  onSave:         () => void
  saving:         boolean
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  function insertVar(v: string) {
    const el = bodyRef.current
    if (!el) { onBodyChange(body + v); return }
    const start = el.selectionStart ?? body.length
    const end   = el.selectionEnd   ?? body.length
    onBodyChange(body.slice(0, start) + v + body.slice(end))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + v.length, start + v.length)
    })
  }

  return (
    <div className="rounded-xl border border-[#333] bg-[#222] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold border ${badge}`}>
            {label}
          </span>
        </div>
        <span className="text-white/25 text-xs">{body.length} chars</span>
      </div>

      {showSubject && (
        <div>
          <label className="nwi-label">Email Subject</label>
          <input
            className="nwi-input"
            value={subject}
            onChange={e => onSubjectChange(e.target.value)}
            placeholder="Book your service with {business_name}"
          />
        </div>
      )}

      <div>
        <label className="nwi-label">Message Body</label>
        <textarea
          ref={bodyRef}
          rows={showSubject ? 6 : 3}
          className="nwi-input resize-none"
          value={body}
          onChange={e => onBodyChange(e.target.value)}
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {SHARE_VARS.map(v => (
            <button
              key={v}
              type="button"
              onClick={() => insertVar(v)}
              className="text-[10px] rounded-full border border-[#333] text-white/50 hover:text-white hover:border-white/30 px-2 py-0.5 transition-colors"
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={onSave}
        disabled={saving}
        className="px-5 py-2 bg-[#FF6600] hover:bg-[#E55A00] disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-lg transition-colors"
      >
        {saving ? 'Saving…' : 'Save Template'}
      </button>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  mechanic: 'Mobile Mechanic',
  detailer: 'Mobile Detailer',
}

export default function SettingsClient({
  slug,
  businessName,
  techName,
  businessType = 'mechanic',
  initialTemplates,
  defaultPaymentInstructions: initialPaymentInstr = '',
  initialAverageMpg   = null,
  initialFuelType     = 'gasoline',
  hasQwAccess         = false,
  initialOfferMpi     = false,
  initialLaborRate    = 125,
  initialMarkupPct    = 20,
  initialTaxPct       = 8.5,
  initialPricingRows  = [],
  initialBillConsumables = false,
  initialAdjustmentPresets = [] as AdjustmentPreset[],
}: {
  slug:                        string | null
  businessName:                string
  techName:                    string
  businessType?:               string
  initialTemplates:            Partial<ShareTemplates>
  defaultPaymentInstructions?: string
  initialAverageMpg?:          number | null
  initialFuelType?:            string
  hasQwAccess?:                boolean
  initialOfferMpi?:            boolean
  initialLaborRate?:           number
  initialMarkupPct?:           number
  initialTaxPct?:              number
  initialPricingRows?:         PricingRow[]
  initialBillConsumables?:     boolean
  initialAdjustmentPresets?:   AdjustmentPreset[]
}) {
  const [shareOpen, setShareOpen] = useState(false)

  const [smsTpl,    setSmsTpl]    = useState(initialTemplates.share_sms_template  || DEFAULT_SMS)
  const [emailSubj, setEmailSubj] = useState(initialTemplates.share_email_subject || DEFAULT_EMAIL_SUBJECT)
  const [emailBody, setEmailBody] = useState(initialTemplates.share_email_body    || DEFAULT_EMAIL_BODY)

  const [paymentInstr,        setPaymentInstr]        = useState(initialPaymentInstr)
  const [savingPaymentInstr,  setSavingPaymentInstr]  = useState(false)

  const [mpg,         setMpg]         = useState(initialAverageMpg != null ? String(initialAverageMpg) : '')
  const [fuelType,    setFuelType]    = useState(initialFuelType)
  const [savingFuel,  setSavingFuel]  = useState(false)

  const [offerMpi,    setOfferMpi]    = useState(initialOfferMpi)
  const [savingMpi,   setSavingMpi]   = useState(false)

  const [billConsumables,      setBillConsumables]      = useState(initialBillConsumables)
  const [savingBillConsumables, setSavingBillConsumables] = useState(false)

  const [laborRate,     setLaborRate]     = useState(String(initialLaborRate))
  const [markupPct,     setMarkupPct]     = useState(String(initialMarkupPct))
  const [taxPct,        setTaxPct]        = useState(String(initialTaxPct))
  const [savingRates,   setSavingRates]   = useState(false)

  const [adjPresets,     setAdjPresets]     = useState<AdjustmentPreset[]>(initialAdjustmentPresets)
  const [adjEdits,       setAdjEdits]       = useState<{ id: string; name: string; price_cents: number }[]>(
    initialAdjustmentPresets.map(p => ({ id: p.id, name: p.name, price_cents: p.price_cents }))
  )
  const [addingPreset,   setAddingPreset]   = useState(false)
  const [newPresetVals,  setNewPresetVals]  = useState({ name: '', price_cents: 0 })
  const [savingPresets,  setSavingPresets]  = useState(false)

  const [savingSMS,   setSavingSMS]   = useState(false)
  const [savingEmail, setSavingEmail] = useState(false)
  const [savedMsg,    setSavedMsg]    = useState<string | null>(null)

  const bookingUrl = slug ? `${BOOKING_BASE}/${slug}` : null

  async function saveTemplates(fields: Partial<ShareTemplates>, done: () => void) {
    try {
      const res = await fetch('/api/user/share-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      if (res.ok) {
        setSavedMsg('Template saved.')
        setTimeout(() => setSavedMsg(null), 3000)
      }
    } catch { /* network error - silently fail */ }
    done()
  }

  async function savePaymentInstructions() {
    setSavingPaymentInstr(true)
    try {
      await fetch('/api/user/share-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_payment_instructions: paymentInstr || null }),
      })
      setSavedMsg('Default payment instructions saved.')
      setTimeout(() => setSavedMsg(null), 3000)
    } catch { /* silently fail */ }
    setSavingPaymentInstr(false)
  }

  async function saveMpiSetting(value: boolean) {
    setSavingMpi(true)
    try {
      const res = await fetch('/api/user/profile', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ offer_mpi_on_booking: value }),
      })
      if (res.ok) {
        setOfferMpi(value)
        setSavedMsg(value ? '25-Point Inspection enabled on booking page.' : '25-Point Inspection removed from booking page.')
        setTimeout(() => setSavedMsg(null), 3000)
      }
    } catch { /* silently fail */ }
    setSavingMpi(false)
  }

  async function saveBillConsumables(value: boolean) {
    setSavingBillConsumables(true)
    try {
      const res = await fetch('/api/user/profile', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ bill_consumables_separately: value }),
      })
      if (res.ok) {
        setBillConsumables(value)
        setSavedMsg(value ? 'Consumables will appear as separate invoice lines.' : 'Consumable costs absorbed into service price.')
        setTimeout(() => setSavedMsg(null), 3000)
      }
    } catch { /* silently fail */ }
    setSavingBillConsumables(false)
  }

  async function savePricingRates() {
    setSavingRates(true)
    try {
      const lr = parseFloat(laborRate)
      const mp = parseFloat(markupPct)
      const tp = parseFloat(taxPct)
      if (isNaN(lr) || lr < 0) { setSavedMsg('Enter a valid labor rate.'); setTimeout(() => setSavedMsg(null), 3000); setSavingRates(false); return }
      if (isNaN(mp) || mp < 0) { setSavedMsg('Enter a valid markup %.'); setTimeout(() => setSavedMsg(null), 3000); setSavingRates(false); return }
      if (isNaN(tp) || tp < 0) { setSavedMsg('Enter a valid tax %.'); setTimeout(() => setSavedMsg(null), 3000); setSavingRates(false); return }
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default_labor_rate:           lr,
          default_parts_markup_percent: mp,
          default_tax_percent:          tp,
        }),
      })
      if (res.ok) {
        setSavedMsg('Pricing defaults saved.')
        setTimeout(() => setSavedMsg(null), 3000)
      }
    } catch { /* silently fail */ }
    setSavingRates(false)
  }

  async function saveAdjPresets() {
    setSavingPresets(true)
    try {
      const rows = adjEdits
        .filter(e => e.name.trim().length > 0)
        .map((e, i) => ({ name: e.name.trim(), price_cents: e.price_cents, sort_order: i }))
      const res  = await fetch('/api/detailer-adjustments', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ presets: rows }),
      })
      const json = res.ok ? await res.json() : null
      if (res.ok && json?.presets) {
        setAdjPresets(json.presets)
        setAdjEdits(json.presets.map((p: AdjustmentPreset) => ({ id: p.id, name: p.name, price_cents: p.price_cents })))
        setSavedMsg('Adjustment presets saved.')
        setTimeout(() => setSavedMsg(null), 3000)
      }
    } catch { /* silently fail */ }
    setSavingPresets(false)
  }

  async function saveFuelSettings() {
    setSavingFuel(true)
    try {
      const body: Record<string, unknown> = { fuel_type: fuelType }
      if (mpg.trim() === '') {
        body.average_mpg = null
      } else {
        const n = parseFloat(mpg)
        if (isNaN(n) || n <= 0) {
          setSavedMsg('Enter a valid MPG (e.g. 18).')
          setTimeout(() => setSavedMsg(null), 3000)
          setSavingFuel(false)
          return
        }
        body.average_mpg = n
      }
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setSavedMsg('Vehicle & fuel settings saved.')
        setTimeout(() => setSavedMsg(null), 3000)
      }
    } catch { /* silently fail */ }
    setSavingFuel(false)
  }

  return (
    <div className="space-y-8">

      {savedMsg && (
        <div className="alert-success" role="status" aria-live="polite">{savedMsg}</div>
      )}

      {/* ── Business Info ── */}
      <section>
        <p className="text-white/40 text-xs uppercase tracking-widest mb-4">Business Info</p>
        <div className="nwi-card space-y-4">
          <div>
            <p className="nwi-label">Business Name</p>
            <p className="text-white text-sm">{businessName || '—'}</p>
          </div>
          <div>
            <p className="nwi-label">Your Name</p>
            <p className="text-white text-sm">{techName || '—'}</p>
          </div>
          <div>
            <p className="nwi-label">Business Type</p>
            <p className="text-white text-sm">{BUSINESS_TYPE_LABELS[businessType] ?? 'Mobile Mechanic'}</p>
            <p className="text-white/30 text-xs mt-0.5">Contact support to change your business type.</p>
          </div>
          <div>
            <p className="nwi-label">Booking URL</p>
            {bookingUrl ? (
              <p className="text-white/70 text-sm break-all">{bookingUrl}</p>
            ) : (
              <p className="text-white/30 text-sm">Not set —{' '}
                <a href="/onboarding" className="text-[#FF6600] hover:text-[#FF8533] underline">complete onboarding</a>
              </p>
            )}
          </div>

          <div className="pt-2 border-t border-[#333] flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => setShareOpen(true)}
              aria-label="Share your booking link"
              className="flex items-center justify-center gap-2 bg-[#FF6600] hover:bg-[#E55A00] text-white font-condensed font-bold text-base tracking-wide rounded-xl px-6 py-3 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
              Share My Booking Link
            </button>
            {bookingUrl && (
              <a
                href={`/book/${slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 border border-[#333] hover:border-white/20 text-white/50 hover:text-white font-condensed font-bold text-base rounded-xl px-5 py-3 transition-colors"
              >
                Preview Page
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                </svg>
              </a>
            )}
          </div>
        </div>
      </section>

      {/* ── Share Link Templates ── */}
      <section>
        <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Share Link Templates</p>
        <p className="text-white/30 text-xs mb-4">
          Customize the messages sent when you share your booking link via SMS or email.
        </p>

        <div className="space-y-4">
          <TemplateEditor
            label="SMS Template"
            badge="bg-orange/15 text-orange border-orange/30"
            showSubject={false}
            subject=""
            body={smsTpl}
            onSubjectChange={() => {}}
            onBodyChange={setSmsTpl}
            onSave={() => {
              setSavingSMS(true)
              saveTemplates({ share_sms_template: smsTpl }, () => setSavingSMS(false))
            }}
            saving={savingSMS}
          />

          <TemplateEditor
            label="Email Template"
            badge="bg-blue/15 text-blue-light border-blue/30"
            showSubject={true}
            subject={emailSubj}
            body={emailBody}
            onSubjectChange={setEmailSubj}
            onBodyChange={setEmailBody}
            onSave={() => {
              setSavingEmail(true)
              saveTemplates({ share_email_subject: emailSubj, share_email_body: emailBody }, () => setSavingEmail(false))
            }}
            saving={savingEmail}
          />
        </div>
      </section>

      {/* ── Default Payment Instructions ── */}
      <section>
        <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Default Payment Instructions</p>
        <p className="text-white/30 text-xs mb-4">
          Pre-filled into each invoice when you finalize it. Edit per-invoice in the invoice view.
        </p>
        <div className="rounded-xl border border-[#333] bg-[#222] p-5 space-y-4">
          <textarea
            rows={6}
            className="nwi-input resize-y text-sm w-full"
            placeholder="Payment accepted via Venmo (@username), Zelle (your-phone), Cash App ($cashtag), or cash. Please pay within 7 days of receiving this invoice."
            value={paymentInstr}
            onChange={e => setPaymentInstr(e.target.value)}
          />
          <button
            onClick={savePaymentInstructions}
            disabled={savingPaymentInstr}
            className="px-5 py-2 bg-[#FF6600] hover:bg-[#E55A00] disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-lg transition-colors"
          >
            {savingPaymentInstr ? 'Saving…' : 'Save Default Instructions'}
          </button>
        </div>
      </section>

      {/* ── Detailer: Service Pricing ── */}
      {businessType === 'detailer' && (
        <section>
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Detailer Services &amp; Pricing</p>
          <p className="text-white/30 text-xs mb-4">
            Toggle services on or off and set your base prices per vehicle type. Customers will only see services you have turned on.
          </p>
          <DetailerPricingEditor
            initialRows={initialPricingRows}
            onSave={async (rows) => {
              const res = await fetch('/api/detailer-pricing', {
                method:  'PUT',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ rows }),
              })
              if (!res.ok) throw new Error('Failed to save pricing')
            }}
            saveLabel="Save Detailer Pricing"
          />
        </section>
      )}

      {/* ── Detailer: Adjustment Presets ── */}
      {businessType === 'detailer' && (
        <section>
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Adjustment Presets</p>
          <p className="text-white/30 text-xs mb-4">
            Quick-add chips shown when building a quote. Negative amounts are discounts.
          </p>
          <div className="rounded-xl border border-[#333] bg-[#222] p-5 space-y-3">
            {adjEdits.map((p, i) => (
              <div key={p.id || i} className="flex items-center gap-2">
                <input
                  className="nwi-input text-sm flex-1"
                  placeholder="Name"
                  value={p.name}
                  onChange={e => setAdjEdits(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                />
                <div className="relative w-32">
                  <input
                    type="number" step={1}
                    className="nwi-input text-sm w-full pl-6"
                    placeholder="0.00"
                    value={(p.price_cents / 100).toFixed(2)}
                    onChange={e => setAdjEdits(prev => prev.map((x, j) => j === i ? { ...x, price_cents: Math.round((Number(e.target.value) || 0) * 100) } : x))}
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">$</span>
                </div>
                <button
                  onClick={() => setAdjEdits(prev => prev.filter((_, j) => j !== i))}
                  className="p-2 text-white/25 hover:text-danger transition-colors rounded flex-shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            ))}

            {addingPreset ? (
              <div className="flex items-center gap-2 pt-1">
                <input
                  autoFocus
                  className="nwi-input text-sm flex-1"
                  placeholder="Preset name"
                  value={newPresetVals.name}
                  onChange={e => setNewPresetVals(v => ({ ...v, name: e.target.value }))}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newPresetVals.name.trim()) {
                      setAdjEdits(prev => [...prev, { id: `new-${Date.now()}`, name: newPresetVals.name.trim(), price_cents: newPresetVals.price_cents }])
                      setNewPresetVals({ name: '', price_cents: 0 })
                      setAddingPreset(false)
                    }
                  }}
                />
                <div className="relative w-32">
                  <input
                    type="number" step={1}
                    className="nwi-input text-sm w-full pl-6"
                    placeholder="0.00"
                    value={(newPresetVals.price_cents / 100).toFixed(2)}
                    onChange={e => setNewPresetVals(v => ({ ...v, price_cents: Math.round((Number(e.target.value) || 0) * 100) }))}
                  />
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">$</span>
                </div>
                <div className="flex gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => {
                      if (!newPresetVals.name.trim()) return
                      setAdjEdits(prev => [...prev, { id: `new-${Date.now()}`, name: newPresetVals.name.trim(), price_cents: newPresetVals.price_cents }])
                      setNewPresetVals({ name: '', price_cents: 0 })
                      setAddingPreset(false)
                    }}
                    className="px-3 py-1.5 bg-orange hover:bg-orange-hover text-white text-xs font-semibold rounded-lg transition-colors"
                  >Add</button>
                  <button
                    onClick={() => { setAddingPreset(false); setNewPresetVals({ name: '', price_cents: 0 }) }}
                    className="px-3 py-1.5 border border-white/15 text-white/50 hover:text-white text-xs rounded-lg transition-colors"
                  >Cancel</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingPreset(true)}
                className="flex items-center gap-2 text-white/40 hover:text-orange text-xs transition-colors pt-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Add Preset
              </button>
            )}

            <button
              onClick={saveAdjPresets}
              disabled={savingPresets}
              className="mt-2 px-5 py-2 bg-[#FF6600] hover:bg-[#E55A00] disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-lg transition-colors"
            >
              {savingPresets ? 'Saving…' : 'Save Adjustment Presets'}
            </button>
          </div>
        </section>
      )}

      {/* ── Pricing & Rates (mechanic only) ── */}
      {businessType !== 'detailer' && (
      <section>
        <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Pricing &amp; Rates</p>
        <p className="text-white/30 text-xs mb-4">
          Default values pre-filled in QuickWrench quotes and MPI-generated quotes. Edit per-quote any time.
        </p>
        <div className="rounded-xl border border-[#333] bg-[#222] p-5 space-y-4">
          <div>
            <label className="nwi-label">Labor Rate ($/hr)</label>
            <input
              type="number"
              min="0"
              max="9999"
              step="1"
              className="nwi-input text-sm w-full"
              placeholder="125"
              value={laborRate}
              onChange={e => setLaborRate(e.target.value)}
            />
          </div>
          <div>
            <label className="nwi-label">Parts Markup (%)</label>
            <input
              type="number"
              min="0"
              max="999"
              step="1"
              className="nwi-input text-sm w-full"
              placeholder="20"
              value={markupPct}
              onChange={e => setMarkupPct(e.target.value)}
            />
          </div>
          <div>
            <label className="nwi-label">Tax Rate (%)</label>
            <input
              type="number"
              min="0"
              max="99"
              step="0.1"
              className="nwi-input text-sm w-full"
              placeholder="8.5"
              value={taxPct}
              onChange={e => setTaxPct(e.target.value)}
            />
          </div>
          <button
            onClick={savePricingRates}
            disabled={savingRates}
            className="px-5 py-2 bg-[#FF6600] hover:bg-[#E55A00] disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-lg transition-colors"
          >
            {savingRates ? 'Saving…' : 'Save Pricing Defaults'}
          </button>
        </div>
      </section>
      )}

      {/* ── Vehicle & Fuel Tracking (mechanic only) ── */}
      {businessType !== 'detailer' && (
      <section>
        <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Vehicle &amp; Fuel Tracking</p>
        <p className="text-white/30 text-xs mb-4">
          Used to auto-calculate fuel cost per job when you mark invoices as paid. Enter miles driven at payment time.
        </p>
        <div className="rounded-xl border border-[#333] bg-[#222] p-5 space-y-4">
          <div>
            <label className="nwi-label">Average MPG</label>
            <input
              type="number"
              min="1"
              max="200"
              step="0.1"
              className="nwi-input text-sm w-full"
              placeholder="e.g. 18"
              value={mpg}
              onChange={e => setMpg(e.target.value)}
            />
            <p className="text-white/30 text-xs mt-1.5">
              Your work vehicle&apos;s average fuel economy. Used to calculate per-job fuel costs when you mark invoices as paid.
            </p>
          </div>
          <div>
            <label className="nwi-label">Fuel Type</label>
            <select
              className="nwi-input text-sm w-full"
              value={fuelType}
              onChange={e => setFuelType(e.target.value)}
            >
              <option value="gasoline">Gasoline</option>
              <option value="diesel">Diesel</option>
            </select>
            <p className="text-white/30 text-xs mt-1.5">Affects which current fuel price is used in the calculation.</p>
          </div>
          <button
            onClick={saveFuelSettings}
            disabled={savingFuel}
            className="px-5 py-2 bg-[#FF6600] hover:bg-[#E55A00] disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-lg transition-colors"
          >
            {savingFuel ? 'Saving…' : 'Save Vehicle Settings'}
          </button>
        </div>
      </section>
      )}

      {/* ── QuickWrench: 25-Point Inspection (mechanic only) ── */}
      {businessType !== 'detailer' && (
        hasQwAccess ? (
          <section>
            <p className="text-white/40 text-xs uppercase tracking-widest mb-1">QuickWrench — 25-Point Inspection</p>
            <p className="text-white/30 text-xs mb-4">
              When enabled, customers will see a checkbox on your booking page to add the 25-point inspection.
              This adds 0.5 labor hours to their invoice. You can waive the charge per-job.
            </p>
            <div className="rounded-xl border border-[#333] bg-[#222] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-white text-sm font-medium">Offer 25-Point Inspection on Booking Page</p>
                  <p className="text-white/40 text-xs mt-1">
                    {offerMpi ? 'Customers will see the inspection add-on checkbox.' : 'Inspection add-on is hidden from your booking page.'}
                  </p>
                </div>
                <button
                  disabled={savingMpi}
                  onClick={() => saveMpiSetting(!offerMpi)}
                  aria-pressed={offerMpi}
                  className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                    offerMpi ? 'border-[#FF6600] bg-[#FF6600]' : 'border-[#444] bg-[#333]'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
                      offerMpi ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
              <p className={`mt-3 text-xs font-semibold ${offerMpi ? 'text-success' : 'text-white/30'}`}>
                {offerMpi ? 'YES — Offering on booking page' : 'NO — Not offering'}
              </p>
            </div>
          </section>
        ) : (
          <section>
            <p className="text-white/40 text-xs uppercase tracking-widest mb-1">QuickWrench — 25-Point Inspection</p>
            <div className="rounded-xl border border-[#333] bg-[#222]/50 p-5 flex items-center gap-4 opacity-60">
              <div className="flex-1">
                <p className="text-white/50 text-sm font-medium">Offer 25-Point Inspection on Booking Page</p>
                <p className="text-white/30 text-xs mt-1">Available on QuickWrench ($69/mo) and Elite ($99/mo) plans.</p>
              </div>
              <a
                href="/billing"
                className="flex-shrink-0 px-4 py-2 bg-[#FF6600] hover:bg-[#E55A00] text-white font-condensed font-bold text-xs rounded-lg transition-colors"
              >
                Upgrade
              </a>
            </div>
          </section>
        )
      )}

      {/* ── Bill Consumables Separately (detailer only) ── */}
      {businessType === 'detailer' && (
        <section>
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Inventory &amp; Consumables</p>
          <p className="text-white/30 text-xs mb-4">
            When enabled, products used per job appear as separate line items on invoices visible to the customer.
            When disabled (default), consumable costs are absorbed into your service price — P&amp;L tracking is unaffected.
          </p>
          <div className="rounded-xl border border-[#333] bg-[#222] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-white text-sm font-medium">Bill Consumables Separately</p>
                <p className="text-white/40 text-xs mt-1">
                  {billConsumables
                    ? 'Products like ceramic coating, wax, etc. will show as separate invoice line items.'
                    : 'Consumable costs are absorbed into your service price (default).'}
                </p>
              </div>
              <button
                disabled={savingBillConsumables}
                onClick={() => saveBillConsumables(!billConsumables)}
                aria-pressed={billConsumables}
                className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                  billConsumables ? 'border-[#FF6600] bg-[#FF6600]' : 'border-[#444] bg-[#333]'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
                    billConsumables ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
            <p className={`mt-3 text-xs font-semibold ${billConsumables ? 'text-success' : 'text-white/30'}`}>
              {billConsumables ? 'ON — Consumables billed separately' : 'OFF — Absorbed into service price'}
            </p>
          </div>
        </section>
      )}

      <ShareBookingModal
        slug={slug}
        businessName={businessName}
        techName={techName}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
    </div>
  )
}
