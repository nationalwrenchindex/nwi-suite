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
}: {
  slug:             string | null
  businessName:     string
  techName:         string
  initialTemplates: Partial<ShareTemplates>
}) {
  const [shareOpen, setShareOpen] = useState(false)

  const [smsTpl,    setSmsTpl]    = useState(initialTemplates.share_sms_template  || DEFAULT_SMS)
  const [emailSubj, setEmailSubj] = useState(initialTemplates.share_email_subject || DEFAULT_EMAIL_SUBJECT)
  const [emailBody, setEmailBody] = useState(initialTemplates.share_email_body    || DEFAULT_EMAIL_BODY)

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
