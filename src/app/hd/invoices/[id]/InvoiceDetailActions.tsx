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
  sent?:  boolean
  error?: string
  url?:   string
  to?:    string
}

export default function InvoiceDetailActions({
  invoiceId,
  invoiceNumber,
  currentStatus,
  customerPhone,
  pmChecklistId = null,
  dotInspectionId = null,
  aerialInspectionId = null,
}: {
  invoiceId: string
  invoiceNumber: string
  currentStatus: string
  customerPhone: string | null
  pmChecklistId?: string | null
  dotInspectionId?: string | null
  aerialInspectionId?: string | null
}) {
  const router = useRouter()
  const [busy, setBusy]   = useState(false)
  const [toast, setToast] = useState('')

  // SMS panel state. `phone` is seeded from the invoice but stays editable — the
  // number on file is often the shop's main line, not the person waiting on the
  // truck, and the tech knows which one to text.
  const [smsOpen, setSmsOpen]   = useState(false)
  const [phone, setPhone]       = useState(customerPhone ?? '')
  const [sendState, setSend]    = useState<SendState>('idle')
  const [sendError, setError]   = useState('')
  const [payUrl, setPayUrl]     = useState('')
  const [copied, setCopied]     = useState(false)

  const hasReports = Boolean(pmChecklistId || dotInspectionId || aerialInspectionId)

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

  async function sendSMS() {
    if (!phone.trim()) { setSend('failed'); setError('Enter a phone number to text.'); return }
    setSend('sending')
    setError('')
    setCopied(false)
    try {
      const res  = await fetch(`/api/hd/invoices/${invoiceId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'sms', phone: phone.trim() }),
      })
      const data = await res.json() as SendResponse
      // The route answers 200 on a delivery failure so the link survives; keep
      // whatever URL came back either way so the tech always has a fallback.
      if (data.url) setPayUrl(data.url)
      if (data.sent) {
        setSend('sent')
        router.refresh()   // status may have moved unpaid -> sent
      } else {
        setSend('failed')
        setError(data.error ?? 'The text could not be delivered.')
      }
    } catch (err) {
      setSend('failed')
      setError(err instanceof Error ? err.message : 'Network error — the text was not sent.')
    }
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
          onClick={() => setSmsOpen(o => !o)}
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
          {sendState === 'sent' ? 'Sent' : 'Text Invoice'}
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

      {smsOpen && (
        <div
          className="p-4 rounded-xl w-full sm:w-[380px] text-left"
          style={{ background: '#FFFFFF', border: `1px solid ${BORDER}` }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#9CA3AF' }}>
            Text invoice to customer
          </p>

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
            onClick={sendSMS}
            disabled={sending}
            className="mt-3 w-full px-4 py-2 rounded-lg font-semibold text-sm text-white disabled:opacity-60"
            style={{ background: ORANGE, minHeight: 44 }}
          >
            {sending ? 'Sending…' : sendState === 'sent' ? 'Send again' : 'Send text'}
          </button>

          {sendState === 'sent' && (
            <p className="mt-3 text-sm font-semibold" style={{ color: '#16a34a' }}>
              Sent to {phone}. The customer can view and pay from the link.
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
        </div>
      )}
    </div>
  )
}
