'use client'

import { useState, useRef, useCallback } from 'react'
import ShareBookingModal from '@/components/ShareBookingModal'

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

export default function SettingsClient({
  slug,
  businessName,
  techName,
  initialTemplates,
  defaultPaymentInstructions: initialPaymentInstr = '',
  initialAverageMpg   = null,
  initialFuelType     = 'gasoline',
  hasQwAccess         = false,
  initialOfferMpi     = false,
}: {
  slug:                        string | null
  businessName:                string
  techName:                    string
  initialTemplates:            Partial<ShareTemplates>
  defaultPaymentInstructions?: string
  initialAverageMpg?:          number | null
  initialFuelType?:            string
  hasQwAccess?:                boolean
  initialOfferMpi?:            boolean
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

      {/* ── Vehicle & Fuel Tracking ── */}
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

      {/* ── QuickWrench: 25-Point Inspection ── */}
      {hasQwAccess ? (
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
