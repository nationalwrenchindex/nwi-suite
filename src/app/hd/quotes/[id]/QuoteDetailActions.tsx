'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { invoiceBodyFromQuote } from '@/lib/hd/quote-to-invoice'

const ORANGE = '#FF6600'
const BLUE   = '#2969B0'

interface QuoteData {
  id: string
  status: string
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  has_corp_address: boolean | null
  corp_address_line1: string | null
  corp_address_line2: string | null
  corp_city: string | null
  corp_state: string | null
  corp_zip: string | null
  payment_terms: string | null
  // Optional: absent on a quote saved before migration 158.
  fleet_account_id?: string | null
  unit_id?: string | null
  unit_number?: string | null
  unit_manufacturer: string | null
  unit_model: string | null
  unit_serial: string | null
  unit_year: string | null
  truck_make: string | null
  truck_model: string | null
  truck_year: string | null
  vin: string | null
  complaint: string | null
  diagnosis: string | null
  line_items: unknown[]
  labor_rate: number
  subtotal_labor: number
  subtotal_parts: number
  diagnostic_fee: number
  road_call_fee: number
  tax_rate: number
  tax_amount: number
  customer_po_number: string | null
  total: number
  notes: string | null
}

// =============================================================================
// SEND QUOTE
// =============================================================================
//
// Migration 153 built the customer approval page at /hd/quote/[token] and the endpoint
// that records the approval and turns the quote into a work order. Nothing in the
// product could reach any of it: this screen had Convert to Invoice and Delete, so the
// only route to a quote's approval page was to already know a 32-character token.
//
// This is the door. Text it, email it, or copy the link - and each one either delivers
// or says why, because the route records "sent" only after a channel confirms.

type SendTab = 'sms' | 'email' | 'link'

function SendQuoteModal({
  quoteId,
  quote,
  onClose,
  onSent,
}: {
  quoteId: string
  quote: QuoteData
  onClose: () => void
  onSent: () => void
}) {
  const [tab,     setTab]     = useState<SendTab>(quote.customer_phone ? 'sms' : 'email')
  const [phone,   setPhone]   = useState(quote.customer_phone ?? '')
  const [email,   setEmail]   = useState(quote.customer_email ?? '')
  const [url,     setUrl]     = useState('')
  const [busy,    setBusy]    = useState(false)
  const [copied,  setCopied]  = useState(false)
  const [message, setMessage] = useState('')
  const [failed,  setFailed]  = useState(false)

  // Mint the link on open so the Copy Link tab has something to show and the tech can
  // always fall back to it. preview: true writes the token and claims nothing - looking
  // at a link is not sending it.
  useEffect(() => {
    let live = true
    fetch(`/api/hd/quotes/${quoteId}/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ method: 'link', preview: true }),
    })
      .then(r => r.json())
      .then(j => {
        if (!live) return
        if (j?.url) setUrl(j.url as string)
        else if (j?.error) { setMessage(j.error as string); setFailed(true) }
      })
      .catch(() => {})
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function send(method: SendTab) {
    setBusy(true)
    setMessage('')
    setFailed(false)
    try {
      const res = await fetch(`/api/hd/quotes/${quoteId}/send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ method, phone, email }),
      })
      const json = await res.json()
      if (json?.url) setUrl(json.url as string)

      if (!res.ok || !json?.sent) {
        // The quote is intact and its link works. Say what failed and leave the tech
        // on this screen with the link rather than closing on a silent failure.
        setMessage(json?.error ?? 'The quote could not be sent.')
        setFailed(true)
        return
      }

      onSent()
      if (json.warning) {
        setMessage(json.warning as string)
        setFailed(false)
        return
      }
      onClose()
    } catch {
      setMessage('The quote could not be sent. Check the connection and try again.')
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    if (!url) return
    navigator.clipboard.writeText(url).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
    // Copying the link IS the delivery - the tech is about to paste it to the customer
    // - so it records as one. The preview on open did not.
    await send('link')
  }

  const tabStyle = (t: SendTab): React.CSSProperties => ({
    flex: 1,
    padding: '10px 0',
    fontSize: 13,
    fontWeight: 600,
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    background: tab === t ? ORANGE : '#F3F4F6',
    color:      tab === t ? '#FFFFFF' : '#6B7280',
  })

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#FFFFFF', borderRadius: 14, width: '100%', maxWidth: 460, padding: 24 }}
      >
        <div className="flex items-start justify-between mb-1">
          <h2 className="font-condensed font-bold text-xl" style={{ color: '#1A1A1A' }}>
            Send {quote.customer_name ? `to ${quote.customer_name}` : 'Quote'}
          </h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 22, lineHeight: 1, color: '#9CA3AF', cursor: 'pointer' }}>
            &times;
          </button>
        </div>
        <p className="text-sm mb-4" style={{ color: '#6B7280' }}>
          They can approve it with one tap, which creates the work order.
        </p>

        <div className="flex gap-2 mb-4">
          <button onClick={() => setTab('sms')}   style={tabStyle('sms')}>Text</button>
          <button onClick={() => setTab('email')} style={tabStyle('email')}>Email</button>
          <button onClick={() => setTab('link')}  style={tabStyle('link')}>Copy Link</button>
        </div>

        {tab === 'sms' && (
          <div>
            <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>Mobile Number</label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="(555) 555-5555"
              style={{ width: '100%', marginTop: 6, marginBottom: 14, padding: '12px 14px', fontSize: 16, borderRadius: 10, border: '1px solid #E5E7EB' }}
            />
            <button
              onClick={() => send('sms')}
              disabled={busy || !phone.trim()}
              style={{ width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: ORANGE, color: '#FFFFFF', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: busy || !phone.trim() ? 0.5 : 1, minHeight: 44 }}
            >
              {busy ? 'Sending...' : 'Text the Quote'}
            </button>
          </div>
        )}

        {tab === 'email' && (
          <div>
            <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>Email Address</label>
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              inputMode="email"
              placeholder="name@company.com"
              style={{ width: '100%', marginTop: 6, marginBottom: 14, padding: '12px 14px', fontSize: 16, borderRadius: 10, border: '1px solid #E5E7EB' }}
            />
            <button
              onClick={() => send('email')}
              disabled={busy || !email.trim()}
              style={{ width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: ORANGE, color: '#FFFFFF', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: busy || !email.trim() ? 0.5 : 1, minHeight: 44 }}
            >
              {busy ? 'Sending...' : 'Email the Quote'}
            </button>
          </div>
        )}

        {tab === 'link' && (
          <div>
            <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>Customer Approval Link</label>
            <p style={{ marginTop: 6, marginBottom: 14, padding: '12px 14px', borderRadius: 10, border: '1px solid #E5E7EB', background: '#F9FAFB', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all', color: '#374151' }}>
              {url || 'Creating the link...'}
            </p>
            <button
              onClick={copyLink}
              disabled={busy || !url}
              style={{ width: '100%', padding: '13px 0', borderRadius: 10, border: 'none', background: copied ? '#16A34A' : '#1A1A1A', color: '#FFFFFF', fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: busy || !url ? 0.5 : 1, minHeight: 44 }}
            >
              {copied ? 'Copied' : 'Copy to Clipboard'}
            </button>
          </div>
        )}

        {message && (
          <p
            className="text-sm mt-4"
            style={{
              padding: '10px 12px', borderRadius: 8,
              background: failed ? '#FEE2E2' : '#FEF3C7',
              color:      failed ? '#B91C1C' : '#92400E',
            }}
          >
            {message}
            {failed && url ? ' Copy Link still works - send it by hand.' : ''}
          </p>
        )}
      </div>
    </div>
  )
}

export default function QuoteDetailActions({
  quoteId,
  quoteNumber,
  quoteData,
}: {
  quoteId: string
  quoteNumber: string
  quoteData: QuoteData
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [sendOpen, setSendOpen] = useState(false)

  // ===========================================================================
  // CONVERT TO WORK ORDER
  // ===========================================================================
  //
  // This screen could only bill a quote, which bills a job before anyone has done it:
  // no parts pulled, no hours recorded, no chance to add the bolt that sheared. The
  // work order is where the job happens, and last pass's converter turns it into the
  // invoice afterwards.
  //
  // An unapproved quote is NOT converted silently. The route refuses with
  // 'not_approved' and the tech is asked whether the customer approved it verbally -
  // which is recorded as 'verbal', with the PO they gave, so an invoice dispute can
  // tell a tap on a link from a phone call.
  async function convertToWorkOrder(recordVerbal = false, po?: string, note?: string) {
    setBusy(true)
    setToast('')
    try {
      const res = await fetch(`/api/hd/quotes/${quoteId}/work-order`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ...(recordVerbal ? { record_verbal_approval: true } : {}),
          ...(po   ? { po_number: po } : {}),
          ...(note ? { note }          : {}),
        }),
      })
      const data = await res.json()

      if (res.status === 422 && data.reason === 'not_approved') {
        // Asked once, plainly, with what the answer commits them to. The dialog is the
        // authorization record's only safeguard here - there is no customer tap to
        // point at - so it names what is being asserted rather than saying "continue?".
        const who = prompt(
          `${data.error}\n\n`
          + 'If the customer approved it verbally, enter their PO number or the name of the person who authorized it. '
          + 'This is recorded as a verbal approval on the work order.\n\n'
          + 'Leave blank and press OK to record the verbal approval with no reference, or Cancel to stop.',
        )
        if (who === null) return
        const ref = who.trim()
        await convertToWorkOrder(true, ref || undefined, ref ? `Verbal approval: ${ref}` : undefined)
        return
      }

      if (!res.ok || !data.work_order?.id) {
        setToast(data.error ?? 'Could not create the work order')
        return
      }

      // already_existed is not an error. The quote had a work order - the customer
      // approved it at the link, or someone clicked twice - so go to the one that
      // exists rather than reporting a failure for a job that is open.
      router.push(`/hd/work-orders/${data.work_order.id}`)
    } catch {
      setToast('Could not create the work order. Check the connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function convertToInvoice() {
    // Converting is meant for an APPROVED quote. Anything else is still an estimate the
    // customer has not agreed to, so billing it is a deliberate choice.
    //
    // THIS DIALOG USED TO FIRE EVERY TIME. Before migration 153 nothing in the codebase
    // could write 'approved' to hd_quotes - the CHECK allowed it, no code path produced
    // it - so `status !== 'approved'` was always true and the warning appeared on every
    // single conversion. A warning that always fires is a warning nobody reads, and it
    // trained the user to click through the one dialog that was supposed to stop them.
    //
    // Now that the customer approval page can actually set it, this fires only when the
    // quote genuinely has not been approved, and it says which state it IS in and what
    // to do instead, rather than just naming a status.
    if (quoteData.status !== 'approved') {
      const state = {
        draft:    'still a draft and has not been sent to the customer',
        sent:     'been sent, but the customer has not approved it yet',
        declined: 'been DECLINED by the customer',
      }[quoteData.status as string] ?? `in an unexpected state (${quoteData.status})`

      const advice = quoteData.status === 'draft'
        ? 'Send it first, and the customer can approve it with one tap.'
        : quoteData.status === 'sent'
        ? 'You can wait for them to approve it, or record a verbal approval.'
        : quoteData.status === 'declined'
        ? 'Billing a declined quote is almost certainly a mistake.'
        : 'Check the quote before billing it.'

      if (!confirm(
        `This quote has ${state}.\n\n${advice}\n\nBill it anyway?`
      )) return
    }

    setBusy(true)
    try {
      // One body, shared with the quote list's button, so the two cannot drift again.
      // It carries the extras and the tax breakdown the old hand-built body dropped.
      const body = invoiceBodyFromQuote(quoteData as unknown as Record<string, unknown>)
      const res  = await fetch('/api/hd/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (data.invoice?.id) router.push(`/hd/invoices/${data.invoice.id}`)
      else setToast(data.error ?? 'Failed to create invoice')
    } finally {
      setBusy(false)
    }
  }

  async function deleteQuote() {
    if (!confirm(`Delete quote ${quoteNumber}? This cannot be undone.`)) return
    setBusy(true)
    try {
      await fetch(`/api/hd/quotes/${quoteId}`, { method: 'DELETE' })
      router.push('/hd/quotes')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {toast && (
        <span className="text-xs px-3 py-1 rounded-lg" style={{ background: '#FEE2E2', color: '#dc2626' }}>{toast}</span>
      )}
      {sendOpen && (
        <SendQuoteModal
          quoteId={quoteId}
          quote={quoteData}
          onClose={() => setSendOpen(false)}
          // The send changes status draft -> sent, which this screen renders. Refresh
          // rather than patch local state: the server component is the source of truth
          // for the badge and for whether Convert to Invoice warns.
          onSent={() => router.refresh()}
        />
      )}
      <button
        onClick={() => setSendOpen(true)}
        disabled={busy}
        className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm text-white disabled:opacity-50"
        style={{ background: ORANGE, minHeight: 44 }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
        {quoteData.status === 'draft' ? 'Send Quote' : 'Send Again'}
      </button>
      <button
        onClick={() => convertToWorkOrder()}
        disabled={busy}
        className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm text-white disabled:opacity-50"
        style={{ background: BLUE, minHeight: 44 }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
        Convert to Work Order
      </button>
      {/* Secondary on purpose. Billing straight off the quote suits a one-line road
          call, but for anything with parts the work order is where the job gets
          recorded - and it is the converter's input. */}
      <button
        onClick={convertToInvoice}
        disabled={busy}
        className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-50"
        style={{ background: '#FFFFFF', color: BLUE, border: `1px solid ${BLUE}`, minHeight: 44 }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        Bill Directly
      </button>
      <button
        onClick={deleteQuote}
        disabled={busy}
        className="px-4 py-2 rounded-lg font-semibold text-sm disabled:opacity-50"
        style={{ background: '#FEE2E2', color: '#dc2626', minHeight: 44 }}
      >
        Delete
      </button>
    </div>
  )
}
