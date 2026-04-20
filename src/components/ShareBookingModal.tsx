'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

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

function applyVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}

function getSmsUrl(body: string): string {
  const encoded = encodeURIComponent(body)
  const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent)
  return isIOS ? `sms:&body=${encoded}` : `sms:?body=${encoded}`
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const el = document.createElement('textarea')
    el.value = text
    el.style.cssText = 'position:fixed;opacity:0;top:0;left:0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok
  } catch {
    return false
  }
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconClipboard() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
      <rect x="9" y="3" width="6" height="4" rx="1"/>
    </svg>
  )
}

function IconMessage() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

function IconEnvelope() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  )
}

function IconQR() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/>
      <path d="M14 14h.01M14 17h3M17 14v3M20 14h.01M20 17h.01M20 20h.01M17 20h.01"/>
    </svg>
  )
}

function IconClose() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
    </svg>
  )
}

function IconDownload() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  )
}

// ─── QR View ──────────────────────────────────────────────────────────────────

function QRView({ url, onBack }: { url: string; onBack: () => void }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [qrError,   setQrError]   = useState(false)
  const [copied,    setCopied]    = useState(false)

  useEffect(() => {
    import('qrcode')
      .then(m => m.default.toDataURL(url, { width: 300, margin: 2, color: { dark: '#000000', light: '#ffffff' } }))
      .then(d => setQrDataUrl(d))
      .catch(() => setQrError(true))
  }, [url])

  async function handleCopy() {
    const ok = await copyToClipboard(url)
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000) }
  }

  function handleDownload() {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.download = 'booking-qr.png'
    a.href = qrDataUrl
    a.click()
  }

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      <button
        onClick={onBack}
        className="self-start flex items-center gap-1.5 text-white/50 hover:text-white text-sm transition-colors"
        aria-label="Back to share options"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
        </svg>
        Back
      </button>

      <p className="text-white/40 text-xs uppercase tracking-widest">QR Code — Scan to Book</p>

      <div className="bg-white p-4 rounded-2xl">
        {qrDataUrl ? (
          <img src={qrDataUrl} alt="Booking page QR code" width={256} height={256} className="block" />
        ) : qrError ? (
          <div className="w-64 h-64 flex items-center justify-center text-center">
            <div>
              <p className="text-gray-500 text-sm mb-2">QR generation failed</p>
              <p className="text-gray-700 text-xs break-all">{url}</p>
            </div>
          </div>
        ) : (
          <div className="w-64 h-64 flex items-center justify-center">
            <svg className="animate-spin w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          </div>
        )}
      </div>

      <p className="text-white/40 text-xs text-center break-all max-w-xs">{url}</p>

      <div className="flex gap-3 w-full">
        <button
          onClick={handleDownload}
          disabled={!qrDataUrl}
          aria-label="Download QR code as PNG"
          className="flex-1 flex items-center justify-center gap-2 bg-[#FF6600] hover:bg-[#E55A00] disabled:opacity-40 text-white font-condensed font-bold text-sm rounded-xl py-3 transition-colors"
        >
          <IconDownload />
          Download PNG
        </button>
        <button
          onClick={handleCopy}
          aria-label="Copy booking URL"
          className="flex-1 flex items-center justify-center gap-2 border border-[#2969B0] text-white hover:bg-[#2969B0]/20 font-condensed font-bold text-sm rounded-xl py-3 transition-colors"
        >
          {copied ? '✓ Copied' : 'Copy URL'}
        </button>
      </div>
    </div>
  )
}

// ─── Actions View ─────────────────────────────────────────────────────────────

function ActionsView({
  url,
  templates,
  vars,
  onShowQR,
}: {
  url:       string
  templates: ShareTemplates
  vars:      Record<string, string>
  onShowQR:  () => void
}) {
  const [copied,      setCopied]      = useState(false)
  const [copyFailed,  setCopyFailed]  = useState(false)

  async function handleCopy() {
    const ok = await copyToClipboard(url)
    if (ok) {
      setCopied(true)
      setCopyFailed(false)
      setTimeout(() => setCopied(false), 2500)
    } else {
      setCopyFailed(true)
    }
  }

  function handleSMS() {
    const body = applyVars(templates.share_sms_template || DEFAULT_SMS, vars)
    window.location.href = getSmsUrl(body)
  }

  function handleEmail() {
    const subject = applyVars(templates.share_email_subject || DEFAULT_EMAIL_SUBJECT, vars)
    const body    = applyVars(templates.share_email_body    || DEFAULT_EMAIL_BODY,    vars)
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  return (
    <div className="space-y-3">
      {/* Copy failed fallback */}
      {copyFailed && (
        <div className="bg-dark-input border border-dark-border rounded-xl p-3">
          <p className="text-white/40 text-xs mb-1.5">Copy this link manually:</p>
          <input
            readOnly
            value={url}
            className="w-full bg-transparent text-white text-sm outline-none select-all"
            onFocus={e => e.target.select()}
          />
        </div>
      )}

      {/* Copied toast */}
      {copied && (
        <div className="bg-success/10 border border-success/30 text-success rounded-xl px-4 py-2.5 text-sm flex items-center gap-2" role="status" aria-live="polite">
          <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
          </svg>
          Link copied to clipboard
        </div>
      )}

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-3">
        {/* Copy Link */}
        <button
          onClick={handleCopy}
          aria-label="Copy booking link to clipboard"
          className="flex flex-col items-center justify-center gap-2 border border-[#2969B0] hover:bg-[#2969B0]/15 text-white rounded-2xl py-5 px-3 transition-colors min-h-[96px]"
        >
          <IconClipboard />
          <span className="font-condensed font-bold text-sm tracking-wide">Copy Link</span>
        </button>

        {/* Text to Customer */}
        <button
          onClick={handleSMS}
          aria-label="Send booking link via SMS"
          className="flex flex-col items-center justify-center gap-2 bg-[#FF6600] hover:bg-[#E55A00] text-white rounded-2xl py-5 px-3 transition-colors min-h-[96px]"
        >
          <IconMessage />
          <span className="font-condensed font-bold text-sm tracking-wide">Text Customer</span>
        </button>

        {/* Email to Customer */}
        <button
          onClick={handleEmail}
          aria-label="Send booking link via email"
          className="flex flex-col items-center justify-center gap-2 border border-[#2969B0] hover:bg-[#2969B0]/15 text-white rounded-2xl py-5 px-3 transition-colors min-h-[96px]"
        >
          <IconEnvelope />
          <span className="font-condensed font-bold text-sm tracking-wide">Email Customer</span>
        </button>

        {/* Show QR Code */}
        <button
          onClick={onShowQR}
          aria-label="Show QR code for booking page"
          className="flex flex-col items-center justify-center gap-2 border border-[#2969B0] hover:bg-[#2969B0]/15 text-white rounded-2xl py-5 px-3 transition-colors min-h-[96px]"
        >
          <IconQR />
          <span className="font-condensed font-bold text-sm tracking-wide">Show QR Code</span>
        </button>
      </div>
    </div>
  )
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export default function ShareBookingModal({
  slug,
  businessName,
  techName,
  open,
  onClose,
}: {
  slug:         string | null
  businessName: string
  techName:     string
  open:         boolean
  onClose:      () => void
}) {
  const [view,      setView]      = useState<'actions' | 'qr'>('actions')
  const [templates, setTemplates] = useState<ShareTemplates>({
    share_sms_template:  DEFAULT_SMS,
    share_email_subject: DEFAULT_EMAIL_SUBJECT,
    share_email_body:    DEFAULT_EMAIL_BODY,
  })
  const panelRef = useRef<HTMLDivElement>(null)

  const bookingUrl = slug ? `${BOOKING_BASE}/${slug}` : ''
  const vars = { booking_url: bookingUrl, business_name: businessName, tech_name: techName, first_name: '' }

  // Load templates
  useEffect(() => {
    if (!open) return
    fetch('/api/user/share-templates')
      .then(r => r.json())
      .then(d => {
        if (d.templates) {
          setTemplates({
            share_sms_template:  d.templates.share_sms_template  || DEFAULT_SMS,
            share_email_subject: d.templates.share_email_subject || DEFAULT_EMAIL_SUBJECT,
            share_email_body:    d.templates.share_email_body    || DEFAULT_EMAIL_BODY,
          })
        }
      })
      .catch(() => {})
  }, [open])

  // Reset view when modal closes
  useEffect(() => {
    if (!open) setView('actions')
  }, [open])

  // Focus first focusable element on open; restore focus on close
  const triggerRef = useRef<Element | null>(null)
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement
      setTimeout(() => panelRef.current?.focus(), 50)
    } else {
      (triggerRef.current as HTMLElement | null)?.focus?.()
    }
  }, [open])

  // Escape key + focus trap
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key !== 'Tab' || !panelRef.current) return
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    const first = focusable[0]
    const last  = focusable[focusable.length - 1]
    if (!e.shiftKey && document.activeElement === last)  { e.preventDefault(); first?.focus() }
    if (e.shiftKey  && document.activeElement === first) { e.preventDefault(); last?.focus()  }
  }, [onClose])

  useEffect(() => {
    if (open) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, handleKeyDown])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      aria-hidden="false"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
        tabIndex={-1}
        className="w-full md:max-w-md bg-[#1a1a1a] rounded-t-2xl md:rounded-2xl border border-[#333] max-h-[92vh] overflow-y-auto outline-none"
        style={{ boxShadow: '0 -8px 40px rgba(0,0,0,0.6)' }}
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 id="share-modal-title" className="font-condensed font-bold text-xl text-white tracking-wide">
              Share Your Booking Link
            </h2>
            <button
              onClick={onClose}
              aria-label="Close share modal"
              className="flex-shrink-0 text-white/40 hover:text-white transition-colors p-1 -mr-1 -mt-1"
            >
              <IconClose />
            </button>
          </div>

          {slug ? (
            <>
              <p className="text-white/40 text-xs mb-5 break-all">
                Your booking page:{' '}
                <span className="text-white/60">{bookingUrl}</span>
              </p>

              {view === 'qr' ? (
                <QRView url={bookingUrl} onBack={() => setView('actions')} />
              ) : (
                <ActionsView
                  url={bookingUrl}
                  templates={templates}
                  vars={vars}
                  onShowQR={() => setView('qr')}
                />
              )}
            </>
          ) : (
            <div className="py-6 text-center">
              <p className="text-white/50 text-sm mb-3">
                You need a booking slug before sharing.
              </p>
              <a href="/onboarding" className="text-[#FF6600] hover:text-[#FF8533] text-sm underline">
                Set your booking URL in Settings →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
