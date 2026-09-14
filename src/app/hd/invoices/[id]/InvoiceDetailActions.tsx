'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const ORANGE = '#FF6600'
const BLUE   = '#2969B0'
const BORDER = '#E5E7EB'
const MUTED  = '#6B7280'
const TEXT   = '#1A1A1A'

type SendState = 'idle' | 'sending' | 'sent' | 'failed'

interface SendResponse {
  sent?:         boolean
  error?:        string
  url?:          string
  to?:           string
  sent_count?:   number
  last_sent_at?: string | null
  /** True once the route has charged the fee; false if it charged and then rolled back. */
  late_fee_applied?:  boolean
  late_fee_amount?:   number
  /** false means the rollback after a failed send did NOT work — the fee is still on the row. */
  late_fee_reverted?: boolean
  warning?:           string
}

/** Which of the two resend choices the tech picked. */
type SendMode = 'original' | 'late_fee'

function money(n: number) {
  return `$${n.toFixed(2)}`
}

/**
 * "12 Sep, 2:14 PM" — day and time, because the question a tech is asking is
 * "was this chased recently?", which a bare date cannot answer. The year is
 * added only when the send was not this year, so the common case stays short.
 *
 * Rendered with suppressHydrationWarning wherever it is used: the server
 * formats in UTC and the browser in the tech's own zone, and the browser's
 * answer is the correct one.
 */
function formatSentAt(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString('en-US', {
    month:  'short',
    day:    'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour:   'numeric',
    minute: '2-digit',
  })
}

export default function InvoiceDetailActions({
  invoiceId,
  invoiceNumber,
  currentStatus,
  customerPhone,
  customerEmail = null,
  sentCount = 0,
  lastSentAt = null,
  pmChecklistId = null,
  dotInspectionId = null,
  aerialInspectionId = null,
  lateFeeChargeable = false,
  lateFeeAmount = 0,
  lateFeeDaysOverdue = 0,
  lateFeePercentage = null,
  lateFeeBlockedReason = null,
  lateFeeAlreadyApplied = false,
}: {
  invoiceId: string
  invoiceNumber: string
  currentStatus: string
  customerPhone: string | null
  /** Email is the only channel that can carry the PM report attachment. */
  customerEmail?: string | null
  sentCount?: number
  lastSentAt?: string | null
  pmChecklistId?: string | null
  dotInspectionId?: string | null
  aerialInspectionId?: string | null
  /* ── Late fee ──────────────────────────────────────────────────────────────
     All six come from src/lib/hd/late-fee.ts, evaluated on the server in
     page.tsx. Nothing here recomputes a fee: the amount shown on the button is
     the amount the send route writes, because both read the same assessment. */
  lateFeeChargeable?: boolean
  lateFeeAmount?: number
  lateFeeDaysOverdue?: number
  /** Monthly rate, or null for a flat fee. */
  lateFeePercentage?: number | null
  /** One sentence saying why a fee cannot be charged. Null when it can. */
  lateFeeBlockedReason?: string | null
  lateFeeAlreadyApplied?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy]   = useState(false)
  const [toast, setToast] = useState('')

  // Seeded from the server row, then advanced from the send response rather than
  // re-read. router.refresh() is still called for the status change, but it is a
  // round trip the tech should not have to wait on to see that their resend
  // landed — the count and timestamp are already in the reply.
  const [count, setCount]   = useState(sentCount)
  const [lastAt, setLastAt] = useState<string | null>(lastSentAt)

  // Send modal state. `phone` is seeded from the invoice but stays editable — the
  // number on file is often the shop's main line, not the person waiting on the
  // truck, and the tech knows which one to text.
  const [sendOpen, setSendOpen] = useState(false)
  // null = the two-choice screen. Picking a choice reveals the channel picker, so
  // the "with or without a fee" decision is made once, before any recipient is
  // typed, and cannot be ambiguous at the moment a send button is pressed.
  const [mode, setMode]         = useState<SendMode | null>(null)
  // Flipped locally the instant a fee-bearing send succeeds, so the late-fee
  // choice closes off immediately instead of waiting on router.refresh().
  const [feeJustApplied, setFeeJustApplied] = useState(false)
  const [phone, setPhone]       = useState(customerPhone ?? '')
  const [email, setEmail]       = useState(customerEmail ?? '')
  // Which channel the last attempt used, so the success and failure copy names the
  // right one rather than always saying "text".
  const [lastChannel, setLastChannel] = useState<'sms' | 'email'>('sms')
  const [sendState, setSend]    = useState<SendState>('idle')
  const [sendError, setError]   = useState('')
  const [payUrl, setPayUrl]     = useState('')
  const [copied, setCopied]     = useState(false)

  const hasReports = Boolean(pmChecklistId || dotInspectionId || aerialInspectionId)

  // Option B is genuinely unavailable, not a disabled button that shrugs: either a
  // fee can be charged right now or the modal prints the sentence explaining why not.
  const feeApplied     = lateFeeAlreadyApplied || feeJustApplied
  const canChargeFee   = lateFeeChargeable && !feeApplied
  const feeBlockedWhy  = feeApplied
    ? 'A late fee has already been applied to this invoice.'
    : (lateFeeBlockedReason ?? 'A late fee cannot be applied to this invoice.')

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  async function markPaid() {
    setBusy(true)
    try {
      const res  = await fetch(`/api/hd/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid' }),
      })
      const data = await res.json()
      if (data.invoice) { showToast('Invoice marked as paid.'); router.refresh() }
      else showToast(data.error ?? 'Failed to update')
    } finally {
      setBusy(false)
    }
  }

  async function deleteInvoice() {
    if (!confirm(`Delete invoice ${invoiceNumber}? This cannot be undone.`)) return
    setBusy(true)
    try {
      await fetch(`/api/hd/invoices/${invoiceId}`, { method: 'DELETE' })
      router.push('/hd/invoices')
    } finally {
      setBusy(false)
    }
  }

  /**
   * One sender for both channels AND both modes. SMS carries a link; email carries
   * the same link plus the PM report as an attachment, which is the only route by
   * which that report reaches a customer — a text cannot carry a file.
   *
   * `applyLateFee` rides along on the same request rather than being a separate
   * "add fee" call the tech makes first. That is deliberate: the route charges the
   * fee and sends inside one handler, and rolls the charge back if the delivery
   * fails, so there is no state where the invoice carries a fee the customer was
   * never told about.
   */
  async function send(channel: 'sms' | 'email') {
    const target = channel === 'sms' ? phone.trim() : email.trim()
    if (!target) {
      setSend('failed')
      setError(channel === 'sms' ? 'Enter a phone number to text.' : 'Enter an email address to send to.')
      return
    }
    const applyLateFee = mode === 'late_fee'
    setLastChannel(channel)
    setSend('sending')
    setError('')
    setCopied(false)
    try {
      const res  = await fetch(`/api/hd/invoices/${invoiceId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(channel === 'sms' ? { method: 'sms', phone: target } : { method: 'email', email: target }),
          ...(applyLateFee ? { applyLateFee: true } : {}),
        }),
      })
      const data = await res.json() as SendResponse
      // The route answers 200 on a delivery failure so the link survives; keep
      // whatever URL came back either way so the tech always has a fallback.
      if (data.url) setPayUrl(data.url)
      if (data.sent) {
        setSend('sent')
        if (data.late_fee_applied) setFeeJustApplied(true)
        // Advance the send record from the response so the label flips to
        // "Resend Invoice" and the timestamp moves without a reload.
        if (typeof data.sent_count === 'number') setCount(data.sent_count)
        else setCount(c => c + 1)
        setLastAt(data.last_sent_at ?? new Date().toISOString())
        router.refresh()   // status, total and the late-fee badges may all have moved
      } else {
        setSend('failed')
        // A failed fee-bearing send normally rolls the charge back. When the
        // rollback itself failed the route says so, and that has to reach the tech
        // verbatim — the invoice is now carrying a fee the customer never received.
        const stuck = data.late_fee_applied === true && data.late_fee_reverted === false
        setError([
          data.error ?? `The ${channel === 'sms' ? 'text' : 'email'} could not be delivered.`,
          stuck ? (data.warning ?? 'The late fee could not be removed and is still on this invoice.') : '',
        ].filter(Boolean).join(' '))
        if (stuck) { setFeeJustApplied(true); router.refresh() }
      }
    } catch (err) {
      setSend('failed')
      setError(err instanceof Error ? err.message
        : `Network error — the ${channel === 'sms' ? 'text' : 'email'} was not sent.`)
      // A network error means we never saw the reply. The server may have charged
      // and rolled back, or charged and not — reload so the page shows the truth.
      if (applyLateFee) router.refresh()
    }
  }

  /** Opens the modal on the two-choice screen, clearing any previous attempt. */
  function openSendModal() {
    setSendOpen(true)
    setMode(null)
    setSend('idle')
    setError('')
  }

  async function copyLink() {
    if (!payUrl) return
    try {
      await navigator.clipboard.writeText(payUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard blocked (insecure context / permissions). The link is already
      // on screen and selectable, so say that instead of failing silently.
      showToast('Copy blocked — select the link above and copy it manually.')
    }
  }

  const sending = sendState === 'sending'

  return (
    <div className="flex flex-col gap-2 items-stretch sm:items-end">
      <div className="flex items-center gap-2 flex-wrap">
        {toast && (
          <span className="text-xs px-3 py-1.5 rounded-lg" style={{ background: TEXT, color: '#fff' }}>
            {toast}
          </span>
        )}

        <Link
          href={`/hd/invoices/${invoiceId}/edit`}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-semibold text-sm"
          style={{ background: '#FFF7ED', color: ORANGE, border: `1px solid ${ORANGE}40`, minHeight: 44 }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Edit
        </Link>

        {currentStatus !== 'paid' && currentStatus !== 'void' && (
          <button
            onClick={markPaid}
            disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-50"
            style={{ background: '#DCFCE7', color: '#16a34a', minHeight: 44 }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Mark Paid
          </button>
        )}

        <Link
          href={`/api/hd/invoices/${invoiceId}/pdf`}
          target="_blank"
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-semibold text-sm text-white"
          style={{ background: BLUE, minHeight: 44 }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download PDF
        </Link>

        <button
          onClick={() => (sendOpen ? setSendOpen(false) : openSendModal())}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-semibold text-sm"
          style={
            sendState === 'sent'
              ? { background: '#DCFCE7', color: '#16a34a', border: '1px solid #BBF7D0', minHeight: 44 }
              : { background: '#F3F4F6', color: '#374151', border: `1px solid ${BORDER}`, minHeight: 44 }
          }
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.69 12 19.79 19.79 0 011.61 3.44 2 2 0 013.6 1.27h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.91 8.91a16 16 0 006 6l.92-.92a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
          </svg>
          {count > 0 ? 'Resend Invoice' : 'Send Invoice'}
        </button>

        <button
          onClick={deleteInvoice}
          disabled={busy}
          className="px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-50"
          style={{ background: '#FEE2E2', color: '#dc2626', minHeight: 44 }}
        >
          Delete
        </button>
      </div>

      {/* Sits directly under the send button, because it is the fact that
          decides whether to press it. Absent entirely when the invoice has
          never gone out — "Send Invoice" with no timestamp already says that,
          and a "Never sent" line would just be noise on a fresh invoice. */}
      {count > 0 && lastAt && (
        <p className="text-xs" style={{ color: MUTED }} suppressHydrationWarning>
          {count > 1
            ? `Sent ${count} times · last ${formatSentAt(lastAt)}`
            : `Sent ${formatSentAt(lastAt)}`}
        </p>
      )}

      {/* ── SEND MODAL ────────────────────────────────────────────────────────
          Two screens. The first asks the only question that changes what the
          customer is charged — original, or with the late fee — and the second
          asks how to deliver it. Splitting them keeps the money decision from
          being something you might click past on the way to a phone number.

          Both channels survive the split: the second screen is the panel that was
          here before, text and email intact, and whichever choice was made on the
          first screen rides along on the request. */}
      {sendOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(17,24,39,0.5)' }}
          onClick={() => { if (!sending) setSendOpen(false) }}
          role="presentation"
        >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Send invoice ${invoiceNumber}`}
          onClick={e => e.stopPropagation()}
          className="p-4 rounded-xl w-full sm:w-[420px] text-left overflow-y-auto"
          style={{ background: '#FFFFFF', border: `1px solid ${BORDER}`, maxHeight: '88vh' }}
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>
              {mode === null ? `Send ${invoiceNumber}` : mode === 'late_fee' ? 'Resend with late fee' : 'Resend original invoice'}
            </p>
            <button
              onClick={() => setSendOpen(false)}
              disabled={sending}
              aria-label="Close"
              className="text-sm leading-none px-2 py-1 rounded disabled:opacity-40"
              style={{ color: MUTED }}
            >
              ✕
            </button>
          </div>

          {/* ── Screen 1: which resend? ─────────────────────────────────────── */}
          {mode === null && (
            <div className="flex flex-col gap-3">
              {/* Option A — always available. */}
              <button
                onClick={() => { setMode('original'); setSend('idle'); setError('') }}
                className="w-full text-left p-3 rounded-lg"
                style={{ background: '#F9FAFB', border: `1px solid ${BORDER}` }}
              >
                <span className="block text-sm font-semibold" style={{ color: TEXT }}>
                  {count > 0 ? 'Resend Original Invoice' : 'Send Invoice'}
                </span>
                <span className="block text-xs mt-1" style={{ color: MUTED }}>
                  Sends the invoice exactly as it stands. Nothing on it changes.
                </span>
              </button>

              {/* Option B — offered only when a fee can actually be charged. When it
                  cannot, the choice is absent and its place is taken by the reason,
                  rather than a dead button the tech clicks at and gets nothing from. */}
              {canChargeFee ? (
                <button
                  onClick={() => { setMode('late_fee'); setSend('idle'); setError('') }}
                  className="w-full text-left p-3 rounded-lg"
                  style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold" style={{ color: '#92400e' }}>Resend with Late Fee</span>
                    <span className="text-sm font-bold" style={{ color: '#92400e' }}>+{money(lateFeeAmount)}</span>
                  </span>
                  <span className="block text-xs mt-1" style={{ color: '#a16207' }}>
                    {lateFeeDaysOverdue} day{lateFeeDaysOverdue === 1 ? '' : 's'} past due
                    {lateFeePercentage != null ? ` · ${lateFeePercentage}% per month` : ' · flat fee'}.
                    Adds the fee as a line item and sends the customer the new total.
                  </span>
                </button>
              ) : (
                <div className="w-full p-3 rounded-lg" style={{ background: '#F9FAFB', border: `1px dashed ${BORDER}` }}>
                  <span className="block text-sm font-semibold" style={{ color: '#9CA3AF' }}>
                    Resend with Late Fee — unavailable
                  </span>
                  <span className="block text-xs mt-1" style={{ color: MUTED }}>{feeBlockedWhy}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Screen 2: how to deliver it? ────────────────────────────────── */}
          {mode !== null && (
          <>
          <button
            onClick={() => { setMode(null); setSend('idle'); setError('') }}
            disabled={sending}
            className="text-xs mb-3 disabled:opacity-40"
            style={{ color: BLUE }}
          >
            ← Back
          </button>

          {/* The chosen mode restated on the delivery screen, because this is the
              last point before the customer is charged. */}
          <div className="p-3 rounded-lg mb-3" style={mode === 'late_fee'
            ? { background: '#FFFBEB', border: '1px solid #FDE68A' }
            : { background: '#F9FAFB', border: `1px solid ${BORDER}` }}>
            <p className="text-xs" style={{ color: mode === 'late_fee' ? '#a16207' : MUTED }}>
              {mode === 'late_fee'
                ? `A late fee of ${money(lateFeeAmount)} will be added to this invoice, then the new total is sent. If the send fails the fee is removed again.`
                : 'The invoice is sent as-is. No late fee is added.'}
            </p>
          </div>

          <label className="block text-xs mb-1" style={{ color: MUTED }}>Mobile number</label>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={e => { setPhone(e.target.value); if (sendState !== 'idle') setSend('idle') }}
            placeholder="(555) 555-5555"
            disabled={sending}
            className="w-full px-3 py-2 rounded-lg text-sm"
            style={{ border: `1px solid ${BORDER}`, color: TEXT, background: '#FFFFFF', minHeight: 44 }}
          />

          {hasReports && (
            <p className="text-xs mt-2" style={{ color: MUTED }}>
              The attached inspection report is included on the page the customer opens.
            </p>
          )}

          <button
            onClick={() => send('sms')}
            disabled={sending}
            className="mt-3 w-full px-4 py-2 rounded-lg font-semibold text-sm text-white disabled:opacity-60"
            style={{ background: ORANGE, minHeight: 44 }}
          >
            {sending && lastChannel === 'sms' ? 'Sending…' : count > 0 ? 'Send text again' : 'Send text'}
          </button>

          {/* Email. Separate from the text option because it is not a cosmetic
              alternative: a text carries only a link, while the email carries the PM
              inspection report as an attachment. For a customer who wants the paperwork
              rather than just a way to pay, this is the channel that delivers it. */}
          <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${BORDER}` }}>
            <label className="block text-xs mb-1" style={{ color: MUTED }}>Email address</label>
            <input
              type="email"
              inputMode="email"
              value={email}
              onChange={e => { setEmail(e.target.value); if (sendState !== 'idle') setSend('idle') }}
              placeholder="customer@example.com"
              disabled={sending}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{ border: `1px solid ${BORDER}`, color: TEXT, background: '#FFFFFF', minHeight: 44 }}
            />
            {hasReports && (
              <p className="text-xs mt-2" style={{ color: MUTED }}>
                The full inspection report is attached to the email.
              </p>
            )}
            <button
              onClick={() => send('email')}
              disabled={sending}
              className="mt-3 w-full px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-60"
              style={{ background: '#FFFFFF', color: TEXT, border: `1px solid ${BORDER}`, minHeight: 44 }}
            >
              {sending && lastChannel === 'email' ? 'Sending…' : count > 0 ? 'Send email again' : 'Send email'}
            </button>
          </div>

          {sendState === 'sent' && (
            <p className="mt-3 text-sm font-semibold" style={{ color: '#16a34a' }}>
              Sent to {lastChannel === 'sms' ? phone : email}.{' '}
              {feeJustApplied
                ? `The ${money(lateFeeAmount)} late fee is on the invoice and the customer has the new total.`
                : 'The customer can view and pay from the link.'}
            </p>
          )}

          {sendState === 'failed' && (
            <div className="mt-3 p-3 rounded-lg" style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
              <p className="text-sm font-semibold" style={{ color: '#b91c1c' }}>Not delivered</p>
              <p className="text-xs mt-1 break-words" style={{ color: '#991b1b' }}>{sendError}</p>
            </div>
          )}

          {/* The link is shown for every outcome once minted: on a failure it is
              the tech's manual fallback, on success it is what to re-send. */}
          {payUrl && (
            <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
              <p className="text-xs mb-1" style={{ color: MUTED }}>Payment link</p>
              <p className="text-xs font-mono break-all mb-2" style={{ color: TEXT }}>{payUrl}</p>
              <button
                onClick={copyLink}
                className="px-3 py-1.5 rounded-lg font-semibold text-xs"
                style={{ background: '#F3F4F6', color: '#374151', border: `1px solid ${BORDER}` }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          )}
          </>
          )}
        </div>
        </div>
      )}
    </div>
  )
}
