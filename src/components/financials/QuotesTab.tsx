'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Quote, QuoteStatus, LineItem } from '@/types/financials'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined) =>
  n == null
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const fmtDate = (s: string | null | undefined) => {
  if (!s) return '—'
  return new Date(s + (s.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('en-US', {
    month: '2-digit', day: '2-digit', year: 'numeric',
  })
}

const fmtDateTime = (s: string | null | undefined) => {
  if (!s) return null
  return new Date(s).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function isLaborItem(li: LineItem): boolean {
  return /^labor/i.test((li.description ?? '').trim())
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface EditItem {
  _id:         string
  description: string
  quantity:    number
  unit_price:  number   // BASE price (pre-markup), what the tech paid/sourced
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_META: Record<QuoteStatus, { label: string; bg: string; text: string }> = {
  draft:     { label: 'Draft',     bg: '#6b7280', text: '#ffffff' },
  sent:      { label: 'Sent',      bg: '#2969B0', text: '#ffffff' },
  approved:  { label: 'Approved',  bg: '#10b981', text: '#ffffff' },
  declined:  { label: 'Declined',  bg: '#ef4444', text: '#ffffff' },
  converted: { label: 'Converted', bg: '#8b5cf6', text: '#ffffff' },
  expired:   { label: 'Expired',   bg: '#FF6600', text: '#ffffff' },
}

function StatusBadge({ status }: { status: QuoteStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft
  return (
    <span
      className="px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"
      style={{ backgroundColor: meta.bg, color: meta.text }}
    >
      {meta.label}
    </span>
  )
}

// ─── Filter options ───────────────────────────────────────────────────────────

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '',          label: 'All Statuses' },
  { value: 'draft',     label: 'Draft' },
  { value: 'sent',      label: 'Sent' },
  { value: 'approved',  label: 'Approved' },
  { value: 'declined',  label: 'Declined' },
  { value: 'converted', label: 'Converted' },
  { value: 'expired',   label: 'Expired' },
]

const DATE_RANGE_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '7d',  label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
]

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ msg, type }: { msg: string; type: 'success' | 'error' | 'warn' }) {
  const bg =
    type === 'success' ? 'border-success/40 bg-success/10 text-success' :
    type === 'warn'    ? 'border-orange/40 bg-orange/10 text-orange' :
                         'border-danger/40 bg-danger/10 text-danger'
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl border shadow-2xl text-sm font-semibold whitespace-nowrap ${bg}`}>
      {msg}
    </div>
  )
}

// ─── Vehicle Change Modal ─────────────────────────────────────────────────────

function VehicleChangeModal({
  customerId,
  currentVehicleId,
  onSelect,
  onClose,
}: {
  customerId:       string | null
  currentVehicleId: string | null
  onSelect:         (v: { id: string; year: number | null; make: string; model: string; vin: string | null }) => void
  onClose:          () => void
}) {
  const [vehicles, setVehicles] = useState<{ id: string; year: number | null; make: string; model: string; vin: string | null }[]>([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!customerId) { setLoading(false); return }
    fetch(`/api/vehicles?customer_id=${customerId}&limit=20`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.vehicles) setVehicles(d.vehicles) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [customerId])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-white font-semibold">Change Vehicle</p>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors p-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {loading ? (
          <p className="text-white/30 text-sm text-center py-4">Loading vehicles…</p>
        ) : !customerId ? (
          <p className="text-white/40 text-sm text-center py-4">No customer linked to this quote.</p>
        ) : vehicles.length === 0 ? (
          <p className="text-white/40 text-sm text-center py-4">No vehicles on file for this customer.</p>
        ) : (
          <div className="space-y-2">
            {vehicles.map(v => (
              <button
                key={v.id}
                onClick={() => { onSelect(v); onClose() }}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                  v.id === currentVehicleId
                    ? 'border-orange/50 bg-orange/10'
                    : 'border-white/10 hover:border-white/25 hover:bg-white/5'
                }`}
              >
                <p className="text-white text-sm font-medium">
                  {[v.year, v.make, v.model].filter(Boolean).join(' ')}
                </p>
                {v.vin && <p className="text-white/30 text-[10px] font-mono mt-0.5">{v.vin}</p>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Send Quote Modal ─────────────────────────────────────────────────────────

function SendQuoteModal({
  quote,
  isResend,
  onClose,
  onSent,
}: {
  quote:    Quote
  isResend: boolean
  onClose:  () => void
  onSent:   (updatedQuote: Quote) => void
}) {
  const [method,       setMethod]       = useState<'sms' | 'email' | 'link'>('sms')
  const [phone,        setPhone]        = useState(quote.sent_to_phone ?? quote.customer?.phone ?? '')
  const [email,        setEmail]        = useState(quote.sent_to_email ?? quote.customer?.email ?? '')
  const [sending,      setSending]      = useState(false)
  const [quoteUrl,     setQuoteUrl]     = useState<string | null>(
    quote.public_token ? `${window.location.origin}/quote/${quote.public_token}` : null
  )
  const [copied,       setCopied]       = useState(false)
  const [qrDataUrl,    setQrDataUrl]    = useState<string | null>(null)
  const [generatingQr, setGeneratingQr] = useState(false)
  const [smsWarn,      setSmsWarn]      = useState(false)

  // Pre-load quote URL when switching to link tab if token not yet known
  useEffect(() => {
    if (method === 'link' && !quoteUrl) {
      callSend('link')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method])

  async function callSend(sendMethod: 'sms' | 'email' | 'link') {
    setSending(true)
    try {
      const res  = await fetch(`/api/quotes/${quote.id}/send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ method: sendMethod, phone, email }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Send failed')

      if (json.quote_url) setQuoteUrl(json.quote_url)

      if (sendMethod === 'sms' && !json.sms_sent) setSmsWarn(true)

      onSent(json.quote)
      return json
    } finally {
      setSending(false)
    }
  }

  async function handleSendSms() {
    if (!phone.trim()) return
    setSmsWarn(false)
    const json = await callSend('sms').catch(() => null)
    if (json) onClose()
  }

  async function handleSendEmail() {
    if (!email.trim()) return
    await callSend('email').catch(() => null)
    onClose()
  }

  async function handleCopyLink() {
    let url = quoteUrl
    if (!url) {
      const json = await callSend('link').catch(() => null)
      url = json?.quote_url ?? null
    } else {
      // Still need to mark as sent if this is a first send via link
      await fetch(`/api/quotes/${quote.id}/send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ method: 'link', phone, email }),
      }).then(r => r.json()).then(j => { if (j.quote) onSent(j.quote) }).catch(() => {})
    }
    if (url) {
      navigator.clipboard.writeText(url).catch(() => {})
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }

  async function handleGenerateQr() {
    let url = quoteUrl
    if (!url) {
      const json = await callSend('link').catch(() => null)
      url = json?.quote_url ?? null
    }
    if (!url) return
    setGeneratingQr(true)
    try {
      const QRCode  = await import('qrcode')
      const dataUrl = await QRCode.toDataURL(url, { width: 280, margin: 2, color: { dark: '#ffffff', light: '#1a1a1a' } })
      setQrDataUrl(dataUrl)
    } catch (e) {
      console.error('QR generation failed:', e)
    } finally {
      setGeneratingQr(false)
    }
  }

  const customerName = quote.customer
    ? `${quote.customer.first_name} ${quote.customer.last_name}`.trim()
    : '{Customer}'

  const grandTotal = fmt(quote.grand_total)

  const smsPreviw =
    `Hi ${customerName}, your quote is ready. Total: ${grandTotal}. ` +
    `Review and approve: ${quoteUrl ?? '[link will be generated]'} Reply STOP to opt out.`

  const emailPreview =
    `Subject: Your quote from [Your Business]\n\n` +
    `Hi ${customerName},\n\nYour quote for service on ${
      quote.vehicle ? [quote.vehicle.year, quote.vehicle.make, quote.vehicle.model].filter(Boolean).join(' ') : 'your vehicle'
    } is ready.\n\nTotal: ${grandTotal}\n\nReview and approve: ${quoteUrl ?? '[link will be generated]'}`

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-lg bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <p className="text-white font-semibold">{isResend ? 'Resend Quote' : 'Send Quote'}</p>
            <p className="text-white/40 text-xs mt-0.5">{quote.quote_number} · {grandTotal}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-white/40 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Method tabs */}
        <div className="flex border-b border-white/10">
          {(['sms', 'email', 'link'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                method === m
                  ? 'text-white border-b-2 border-orange -mb-px'
                  : 'text-white/40 hover:text-white/70'
              }`}
            >
              {m === 'sms' ? 'SMS' : m === 'email' ? 'Email' : 'Copy Link'}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">

          {/* ── SMS tab ── */}
          {method === 'sms' && (
            <>
              <div>
                <label className="nwi-label">Customer Phone</label>
                <input
                  type="tel"
                  className="nwi-input"
                  placeholder="+1 (555) 000-0000"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                />
              </div>
              <div className="bg-white/5 rounded-xl p-3 space-y-1">
                <p className="text-white/30 text-[10px] uppercase tracking-widest">SMS Preview</p>
                <p className="text-white/60 text-xs leading-relaxed">{smsPreviw}</p>
              </div>
              {smsWarn && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-orange/30 bg-orange/10 text-orange text-xs">
                  <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  Quote marked as sent. SMS delivery pending A2P approval — please contact the customer directly for now.
                </div>
              )}
              <button
                onClick={handleSendSms}
                disabled={sending || !phone.trim()}
                className="w-full py-3 bg-[#FF6600] hover:bg-orange-600 disabled:opacity-40 text-white font-semibold rounded-xl transition-colors"
              >
                {sending ? 'Sending…' : 'Send SMS'}
              </button>
            </>
          )}

          {/* ── Email tab ── */}
          {method === 'email' && (
            <>
              <div>
                <label className="nwi-label">Customer Email</label>
                <input
                  type="email"
                  className="nwi-input"
                  placeholder="customer@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
              <div className="bg-white/5 rounded-xl p-3 space-y-1">
                <p className="text-white/30 text-[10px] uppercase tracking-widest">Email Preview</p>
                <p className="text-white/60 text-xs leading-relaxed whitespace-pre-line">{emailPreview}</p>
              </div>
              <button
                onClick={handleSendEmail}
                disabled={sending || !email.trim()}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold rounded-xl transition-colors"
              >
                {sending ? 'Sending…' : 'Send Email'}
              </button>
            </>
          )}

          {/* ── Copy Link tab ── */}
          {method === 'link' && (
            <>
              <div className="space-y-1">
                <p className="text-white/30 text-[10px] uppercase tracking-widest">Quote URL</p>
                {quoteUrl ? (
                  <div className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2.5 border border-white/10">
                    <p className="text-white/70 text-xs font-mono break-all flex-1">{quoteUrl}</p>
                  </div>
                ) : sending ? (
                  <div className="bg-white/5 rounded-xl px-3 py-3 text-white/30 text-xs">
                    Generating link…
                  </div>
                ) : null}
              </div>

              {quoteUrl && (
                <div className="flex gap-3">
                  <button
                    onClick={handleCopyLink}
                    disabled={sending}
                    className="flex-1 py-2.5 border border-white/20 hover:border-white/40 text-white/70 hover:text-white text-sm font-medium rounded-xl transition-colors"
                  >
                    {copied ? '✓ Copied!' : 'Copy to Clipboard'}
                  </button>
                  <button
                    onClick={handleGenerateQr}
                    disabled={generatingQr}
                    className="flex-1 py-2.5 border border-white/20 hover:border-white/40 text-white/70 hover:text-white text-sm font-medium rounded-xl transition-colors"
                  >
                    {generatingQr ? 'Generating…' : 'Generate QR Code'}
                  </button>
                </div>
              )}

              {qrDataUrl && (
                <div className="flex flex-col items-center gap-2 p-4 bg-white/5 rounded-xl border border-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt="Quote QR Code" className="w-48 h-48 rounded-lg" />
                  <p className="text-white/40 text-xs">Show this to the customer to scan</p>
                </div>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  )
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

function QuoteDetailModal({
  quote:      initialQuote,
  isDetailer = false,
  onClose,
  onUpdated,
  onDeleted,
}: {
  quote:       Quote
  isDetailer?: boolean
  onClose:     () => void
  onUpdated:   (q: Quote) => void
  onDeleted:   (id: string) => void
}) {
  const isDraft  = initialQuote.status === 'draft'
  const isSent   = initialQuote.status === 'sent'
  const isLocked = !isDraft

  // ── Derive base prices from stored post-markup unit prices ──────────────────
  const initMarkupPct = initialQuote.parts_markup_percent ?? 0
  const [initialItems] = useState<EditItem[]>(() =>
    (initialQuote.line_items ?? [])
      .filter(li => !isLaborItem(li))
      .map((li, i) => ({
        _id:         `li-${i}`,
        description: li.description,
        quantity:    li.quantity,
        unit_price:  initMarkupPct > 0
          ? round2(li.unit_price / (1 + initMarkupPct / 100))
          : li.unit_price,
      }))
  )
  const [initLaborHours] = useState(initialQuote.labor_hours ?? 0)
  const [initLaborRate]  = useState(initialQuote.labor_rate  ?? 125)
  const [initMarkup]     = useState(initialQuote.parts_markup_percent ?? 20)
  const [initTaxPct]     = useState(initialQuote.tax_percent ?? 8.5)
  const [initNotes]      = useState(initialQuote.notes ?? '')
  const [initCustName]   = useState(
    initialQuote.customer
      ? `${initialQuote.customer.first_name} ${initialQuote.customer.last_name}`.trim()
      : ''
  )
  const [initCustPhone]  = useState(initialQuote.customer?.phone ?? '')

  // ── Edit state ─────────────────────────────────────────────────────────────
  const [items,       setItems]       = useState<EditItem[]>(initialItems)
  const [laborHours,  setLaborHours]  = useState(initLaborHours)
  const [laborRate,   setLaborRate]   = useState(initLaborRate)
  const [markupPct,   setMarkupPct]   = useState(initMarkup)
  const [taxPct,      setTaxPct]      = useState(initTaxPct)
  const [notes,       setNotes]       = useState(initNotes)
  const [custName,    setCustName]    = useState(initCustName)
  const [custPhone,   setCustPhone]   = useState(initCustPhone)
  const [vehicleId,   setVehicleId]   = useState<string | null>(initialQuote.vehicle_id)
  const [vehicle,     setVehicle]     = useState(initialQuote.vehicle)

  // ── Inline line-item editing ───────────────────────────────────────────────
  const [editingId,     setEditingId]     = useState<string | null>(null)
  const [editingVals,   setEditingVals]   = useState({ description: '', quantity: 1, unit_price: 0 })
  const [addingNew,     setAddingNew]     = useState(false)
  const [newItemVals,   setNewItemVals]   = useState({ description: '', quantity: 1, unit_price: 0 })

  // ── Vehicle change modal ───────────────────────────────────────────────────
  const [showVehicleModal, setShowVehicleModal] = useState(false)

  // ── Phase 2: send / mark modals ────────────────────────────────────────────
  const [showSendModal,   setShowSendModal]   = useState(false)
  const [showMarkModal,   setShowMarkModal]   = useState<'approved' | 'declined' | null>(null)
  const [markNote,        setMarkNote]        = useState('')
  const [marking,         setMarking]         = useState(false)

  // ── Phase 3: Push to Invoice ────────────────────────────────────────────────
  const [showConvertModal,      setShowConvertModal]      = useState(false)
  const [converting,            setConverting]            = useState(false)
  const [convertedInvoiceNum,   setConvertedInvoiceNum]   = useState<string | null>(null)

  // Fetch the invoice number for converted quotes (for the banner display)
  useEffect(() => {
    if (initialQuote.status === 'converted' && initialQuote.converted_invoice_id && !convertedInvoiceNum) {
      fetch(`/api/invoices/${initialQuote.converted_invoice_id}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.invoice?.invoice_number) setConvertedInvoiceNum(d.invoice.invoice_number) })
        .catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuote.status, initialQuote.converted_invoice_id])

  // ── UI state ───────────────────────────────────────────────────────────────
  const [saving,            setSaving]            = useState(false)
  const [cloning,           setCloning]           = useState(false)
  const [deleting,          setDeleting]           = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [toast,             setToast]             = useState<{ msg: string; type: 'success' | 'error' | 'warn' } | null>(null)
  const [validationErr,     setValidationErr]     = useState<string | null>(null)
  // Replaces window.confirm for unsaved-changes guard — works on mobile Safari/WebViews.
  const [pendingDiscard,    setPendingDiscard]    = useState<{ action: () => void; msg: string } | null>(null)

  // ── Dirty detection ────────────────────────────────────────────────────────
  function makeHash(
    its: EditItem[], lh: number, lr: number, mp: number, tp: number,
    n: string, cn: string, cp: string, vid: string | null,
  ) {
    return JSON.stringify({ its: its.map(x => ({ d: x.description, q: x.quantity, p: x.unit_price })), lh, lr, mp, tp, n, cn, cp, vid })
  }
  const [savedHash, setSavedHash] = useState(() =>
    makeHash(initialItems, initLaborHours, initLaborRate, initMarkup, initTaxPct, initNotes, initCustName, initCustPhone, initialQuote.vehicle_id)
  )
  const currentHash = makeHash(items, laborHours, laborRate, markupPct, taxPct, notes, custName, custPhone, vehicleId)
  const isDirty = isDraft && currentHash !== savedHash

  // ── Live calculations ──────────────────────────────────────────────────────
  const partsBase     = items.reduce((s, li) => s + li.quantity * li.unit_price, 0)
  const markupAmt     = isDetailer ? 0 : partsBase * (markupPct / 100)
  const partsTotal    = partsBase + markupAmt
  // Detailers: service is a flat rate (laborRate), hours are irrelevant
  const laborSubtotal = isDetailer ? (laborRate || 0) : (laborHours || 0) * (laborRate || 0)
  const subtotal      = partsTotal + laborSubtotal
  const taxAmount     = subtotal * ((taxPct || 0) / 100)
  const grandTotal    = subtotal + taxAmount

  // ── Prevent accidental navigation when dirty ───────────────────────────────
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // ── Toast helper ───────────────────────────────────────────────────────────
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function showToast(msg: string, type: 'success' | 'error' | 'warn' = 'success') {
    if (toastRef.current) clearTimeout(toastRef.current)
    setToast({ msg, type })
    toastRef.current = setTimeout(() => setToast(null), 4000)
  }

  // ── Item editing helpers ───────────────────────────────────────────────────
  function startEditItem(item: EditItem) {
    setEditingId(item._id)
    setEditingVals({ description: item.description, quantity: item.quantity, unit_price: item.unit_price })
  }

  function commitEditItem() {
    if (!editingVals.description.trim()) return
    setItems(prev => prev.map(li =>
      li._id === editingId
        ? { ...li, description: editingVals.description.trim(), quantity: editingVals.quantity, unit_price: editingVals.unit_price }
        : li
    ))
    setEditingId(null)
  }

  function removeItem(id: string) {
    setItems(prev => prev.filter(li => li._id !== id))
    if (editingId === id) setEditingId(null)
  }

  function commitNewItem() {
    if (!newItemVals.description.trim()) return
    setItems(prev => [...prev, {
      _id:         `new-${Date.now()}`,
      description: newItemVals.description.trim(),
      quantity:    newItemVals.quantity,
      unit_price:  newItemVals.unit_price,
    }])
    setNewItemVals({ description: '', quantity: 1, unit_price: 0 })
    setAddingNew(false)
  }

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate(): string | null {
    if (grandTotal < 0)
      return 'Grand total cannot be negative.'
    if (items.some(li => li.quantity < 0 || li.unit_price < 0))
      return 'Line items cannot have negative quantity or price.'
    if (laborRate < 0 || (!isDetailer && laborHours < 0))
      return 'Rate cannot be negative.'
    if (isDetailer) {
      if (items.length === 0 && laborRate <= 0)
        return 'Add at least one add-on or a service fee.'
    } else {
      if (items.length === 0 && (laborHours || 0) <= 0)
        return 'At least one line item or labor time is required.'
    }
    return null
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    const err = validate()
    if (err) { setValidationErr(err); return }
    setValidationErr(null)
    setSaving(true)

    const markup = isDetailer ? 0 : markupPct / 100
    const savedLaborHours = isDetailer ? (laborRate > 0 ? 1 : 0) : laborHours
    const savedLineItems = [
      ...items.map(li => ({
        description: li.description,
        quantity:    li.quantity,
        unit_price:  round2(li.unit_price * (1 + markup)),
        total:       round2(li.quantity * li.unit_price * (1 + markup)),
      })),
      ...(isDetailer
        ? (laborRate > 0 ? [{
            description: 'Service',
            quantity:    1,
            unit_price:  laborRate,
            total:       laborRate,
          }] : [])
        : (laborHours > 0 ? [{
            description: 'Labor',
            quantity:    laborHours,
            unit_price:  laborRate,
            total:       round2(laborHours * laborRate),
          }] : [])
      ),
    ]

    try {
      const res  = await fetch(`/api/quotes/${initialQuote.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          line_items:           savedLineItems,
          labor_hours:          savedLaborHours,
          labor_rate:           laborRate,
          parts_subtotal:       round2(partsBase),
          parts_markup_percent: isDetailer ? 0 : markupPct,
          labor_subtotal:       round2(laborSubtotal),
          tax_percent:          taxPct,
          tax_amount:           round2(taxAmount),
          grand_total:          round2(grandTotal),
          notes,
          customer_name:        custName,
          customer_phone:       custPhone,
          vehicle_id:           vehicleId,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setSavedHash(currentHash)
      showToast(`Quote updated — ${json.quote.quote_number}`)
      onUpdated(json.quote)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Cancel ─────────────────────────────────────────────────────────────────
  function doCancel() {
    setItems(initialItems)
    setLaborHours(initLaborHours)
    setLaborRate(initLaborRate)
    setMarkupPct(initMarkup)
    setTaxPct(initTaxPct)
    setNotes(initNotes)
    setCustName(initCustName)
    setCustPhone(initCustPhone)
    setVehicleId(initialQuote.vehicle_id)
    setVehicle(initialQuote.vehicle)
    setEditingId(null)
    setAddingNew(false)
    setValidationErr(null)
  }
  function handleCancel() {
    if (isDirty) {
      setPendingDiscard({ action: doCancel, msg: 'Discard unsaved changes?' })
      return
    }
    doCancel()
  }

  // ── Clone to new version ───────────────────────────────────────────────────
  async function handleClone() {
    setCloning(true)
    try {
      const res  = await fetch(`/api/quotes/${initialQuote.id}/clone`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Clone failed')
      showToast(`New version created — ${json.quote.quote_number}`)
      onUpdated(json.quote)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to create new version', 'error')
    } finally {
      setCloning(false)
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────
  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/quotes/${initialQuote.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Delete failed')
      }
      onDeleted(initialQuote.id)
      onClose()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to delete', 'error')
      setShowDeleteConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  // ── Reopen in QuickWrench ──────────────────────────────────────────────────
  function handleReopenInQW() {
    if (isDirty) {
      setPendingDiscard({
        action: () => { window.location.href = `/quickwrench?loadQuoteId=${initialQuote.id}` },
        msg:    'Discard unsaved changes and open in QuickWrench?',
      })
      return
    }
    window.location.href = `/quickwrench?loadQuoteId=${initialQuote.id}`
  }

  // ── Mark Approved / Declined (manual, tech-side) ───────────────────────────
  async function handleMark(action: 'approved' | 'declined') {
    setMarking(true)
    try {
      const res  = await fetch(`/api/quotes/${initialQuote.id}/respond`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: action === 'approved' ? 'approve' : 'decline', note: markNote || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to update status')
      setShowMarkModal(null)
      setMarkNote('')
      showToast(`Quote marked as ${action}`)
      onUpdated(json.quote)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed', 'error')
    } finally {
      setMarking(false)
    }
  }

  // ── Close guard ────────────────────────────────────────────────────────────
  function handleClose() {
    if (isDirty) {
      setPendingDiscard({ action: onClose, msg: 'Discard unsaved changes and close?' })
      return
    }
    onClose()
  }

  // ── Push to Invoice (Phase 3) ───────────────────────────────────────────────
  async function handlePushToInvoice() {
    setConverting(true)
    setShowConvertModal(false)
    try {
      const res  = await fetch(`/api/quotes/${initialQuote.id}/convert`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        // If already converted (409), navigate to existing invoice
        if (res.status === 409 && json.invoice_id) {
          window.location.href = `/financials/invoices/${json.invoice_id}`
          return
        }
        throw new Error(json.error ?? 'Conversion failed')
      }
      const inv = json.invoice
      showToast(`Invoice ${inv.invoice_number} created. Opening now…`)
      onUpdated({ ...initialQuote, status: 'converted', converted_invoice_id: inv.id, converted_at: new Date().toISOString() })
      setTimeout(() => { window.location.href = `/financials/invoices/${inv.id}` }, 1200)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Conversion failed', 'error')
    } finally {
      setConverting(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  const vehicleLabel = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
    : '—'

  const jobDesc = Array.isArray(initialQuote.jobs) && initialQuote.jobs.length > 1
    ? `${initialQuote.jobs.length} Services`
    : [initialQuote.job_category, initialQuote.job_subtype].filter(Boolean).join(' / ') || '—'

  const timeline: { label: string; ts: string | null; detail?: string }[] = [
    { label: 'Created',   ts: initialQuote.created_at },
    { label: 'Sent',      ts: initialQuote.sent_at,
      detail: initialQuote.times_sent && initialQuote.times_sent > 1
        ? `(sent ${initialQuote.times_sent}x)` : undefined },
    { label: 'Viewed',    ts: initialQuote.viewed_at,
      detail: initialQuote.view_count > 0
        ? `(${initialQuote.view_count} view${initialQuote.view_count !== 1 ? 's' : ''})` : undefined },
    { label: 'Approved',  ts: initialQuote.approved_at },
    { label: 'Declined',  ts: initialQuote.declined_at },
    { label: 'Converted', ts: initialQuote.converted_at },
  ].filter(e => e.ts)

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
        onClick={e => { if (e.target === e.currentTarget) handleClose() }}
      >
        <div className="relative w-full max-w-2xl bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl my-8">

          {/* ── Header ── */}
          <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-white/10">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-condensed font-bold text-2xl text-white tracking-wide">
                  {initialQuote.quote_number}
                </span>
                <StatusBadge status={initialQuote.status as QuoteStatus} />
                {isDirty && (
                  <span className="flex items-center gap-1 text-xs text-orange/80 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange animate-pulse" />
                    Editing
                  </span>
                )}
              </div>
              <p className="text-white/40 text-sm mt-1">{fmtDate(initialQuote.created_at)}</p>
            </div>
            <button
              onClick={handleClose}
              className="flex-shrink-0 p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors min-h-[48px] min-w-[48px] flex items-center justify-center"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* ── Parent version banner ── */}
          {initialQuote.parent_quote_id && (
            <div className="mx-6 mt-4 flex items-center gap-2 px-4 py-2.5 rounded-lg border border-orange/20 bg-orange/5">
              <svg className="w-3.5 h-3.5 text-orange/60 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <polyline points="15 10 20 15 15 20" />
                <path d="M4 4v7a4 4 0 0 0 4 4h12" />
              </svg>
              <p className="text-orange/70 text-xs">New version — edited from a previous quote</p>
            </div>
          )}

          {/* ── Locked-quote banner (non-converted) ── */}
          {isLocked && initialQuote.status !== 'converted' && (
            <div className="mx-6 mt-4 flex items-center gap-2 px-4 py-2.5 rounded-lg border border-white/10 bg-white/5">
              <svg className="w-3.5 h-3.5 text-white/40 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <p className="text-white/40 text-xs">This quote is locked. Use &ldquo;Edit as New Version&rdquo; to make changes.</p>
            </div>
          )}

          {/* ── Converted-quote banner ── */}
          {initialQuote.status === 'converted' && (
            <div className="mx-6 mt-4 flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-purple-500/25 bg-purple-500/8">
              <div className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                <p className="text-purple-300 text-xs">
                  Converted to Invoice{' '}
                  <span className="font-mono font-semibold">
                    {convertedInvoiceNum ?? '…'}
                  </span>
                  {initialQuote.converted_at && (
                    <span className="text-purple-400/70"> on {fmtDate(initialQuote.converted_at)}</span>
                  )}
                </p>
              </div>
              {initialQuote.converted_invoice_id && (
                <button
                  onClick={() => { window.location.href = `/financials/invoices/${initialQuote.converted_invoice_id}` }}
                  className="flex-shrink-0 text-xs px-3 py-1.5 border border-purple-500/30 text-purple-300 hover:bg-purple-500/20 rounded-lg transition-colors"
                >
                  View Invoice →
                </button>
              )}
            </div>
          )}

          <div className="px-6 py-5 space-y-6">

            {/* ── Customer ── */}
            <div className="space-y-2">
              <p className="text-white/30 text-xs uppercase tracking-widest">Customer</p>
              {isDraft ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="nwi-label">Name <span className="normal-case text-white/20">(optional)</span></label>
                    <input
                      className="nwi-input"
                      placeholder="John Smith"
                      value={custName}
                      onChange={e => setCustName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="nwi-label">Phone <span className="normal-case text-white/20">(optional)</span></label>
                    <input
                      className="nwi-input"
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      value={custPhone}
                      onChange={e => setCustPhone(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-white font-medium">
                    {initialQuote.customer
                      ? `${initialQuote.customer.first_name} ${initialQuote.customer.last_name}`
                      : '—'}
                  </p>
                  {initialQuote.customer?.phone && (
                    <p className="text-white/50 text-sm">{initialQuote.customer.phone}</p>
                  )}
                  {initialQuote.customer?.email && (
                    <p className="text-white/50 text-sm">{initialQuote.customer.email}</p>
                  )}
                </div>
              )}
            </div>

            {/* ── Vehicle ── */}
            <div className="space-y-2">
              <p className="text-white/30 text-xs uppercase tracking-widest">Vehicle</p>
              {isDraft ? (
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium">{vehicleLabel}</p>
                    {vehicle?.vin && (
                      <p className="text-white/30 text-xs font-mono mt-0.5">{vehicle.vin}</p>
                    )}
                  </div>
                  {initialQuote.customer_id && (
                    <button
                      onClick={() => setShowVehicleModal(true)}
                      className="flex-shrink-0 px-3 py-1.5 text-xs border border-white/20 hover:border-orange/40 hover:text-orange text-white/60 rounded-lg transition-colors"
                    >
                      Change Vehicle
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-white font-medium">{vehicleLabel}</p>
                  {initialQuote.vehicle?.vin && (
                    <p className="text-white/40 text-xs font-mono">{initialQuote.vehicle.vin}</p>
                  )}
                </div>
              )}
            </div>

            {/* ── Job ── */}
            {Array.isArray(initialQuote.jobs) && initialQuote.jobs.length > 1 ? (
              <div className="space-y-2">
                <p className="text-white/30 text-xs uppercase tracking-widest">Services ({initialQuote.jobs.length})</p>
                <div className="space-y-1.5">
                  {initialQuote.jobs.map((j, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded-full bg-orange/15 border border-orange/30 flex items-center justify-center text-orange text-[9px] font-bold flex-shrink-0">
                        {i + 1}
                      </span>
                      <p className="text-white/80 text-sm">{j.subtype}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-white/30 text-xs uppercase tracking-widest">Job Description</p>
                <p className="text-white">{jobDesc}</p>
              </div>
            )}

            {/* ── Line Items ── */}
            <div className="space-y-3">
              <p className="text-white/30 text-xs uppercase tracking-widest">
                {isDetailer ? 'Add-ons / Products' : 'Line Items'}
              </p>

              {isDraft ? (
                <div className="rounded-xl border border-white/10 overflow-hidden">
                  {/* Header row */}
                  <div className="grid grid-cols-[1fr_56px_80px_80px_52px] gap-1 px-3 py-2 border-b border-white/10 bg-white/5">
                    <span className="text-white/30 text-[10px] uppercase tracking-wider">
                      {isDetailer ? 'Add-on / Description' : 'Part / Description'}
                    </span>
                    <span className="text-white/30 text-[10px] uppercase tracking-wider text-right">Qty</span>
                    <span className="text-white/30 text-[10px] uppercase tracking-wider text-right">Base Price</span>
                    <span className="text-white/30 text-[10px] uppercase tracking-wider text-right">Total</span>
                    <span />
                  </div>

                  {items.length === 0 && !addingNew && (
                    <div className="px-4 py-4 text-white/25 text-sm text-center">
                      {isDetailer
                        ? 'No add-ons — add one below, or leave empty for service-only.'
                        : 'No parts — add one below or skip if labor-only.'}
                    </div>
                  )}

                  {items.map(li => (
                    <div key={li._id} className="border-b border-white/5 last:border-0">
                      {editingId === li._id ? (
                        <div className="p-3 space-y-2 bg-orange/5">
                          <input
                            autoFocus
                            className="nwi-input text-sm w-full"
                            placeholder={isDetailer ? 'Add-on name' : 'Part name'}
                            value={editingVals.description}
                            onChange={e => setEditingVals(v => ({ ...v, description: e.target.value }))}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="nwi-label text-[10px]">Qty</label>
                              <input
                                type="number" min={0} step={1}
                                className="nwi-input text-sm"
                                value={editingVals.quantity}
                                onChange={e => setEditingVals(v => ({ ...v, quantity: Number(e.target.value) || 0 }))}
                              />
                            </div>
                            <div>
                              <label className="nwi-label text-[10px]">Base Price ($)</label>
                              <input
                                type="number" min={0} step={0.01}
                                className="nwi-input text-sm"
                                value={editingVals.unit_price}
                                onChange={e => setEditingVals(v => ({ ...v, unit_price: Number(e.target.value) || 0 }))}
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={commitEditItem}
                              className="px-3 py-1.5 bg-orange hover:bg-orange-hover text-white text-xs font-semibold rounded-lg transition-colors"
                            >
                              Apply
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="px-3 py-1.5 border border-white/15 text-white/50 hover:text-white text-xs rounded-lg transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-[1fr_56px_80px_80px_52px] gap-1 items-center px-3 py-2.5 hover:bg-white/[0.03]">
                          <span className="text-white/80 text-sm truncate">{li.description}</span>
                          <span className="text-white/50 text-sm text-right">{li.quantity}</span>
                          <span className="text-white/50 text-sm text-right">{fmt(li.unit_price)}</span>
                          <span className="text-white text-sm font-medium text-right">
                            {fmt(li.quantity * li.unit_price)}
                          </span>
                          <div className="flex items-center justify-end gap-0.5">
                            <button
                              onClick={() => startEditItem(li)}
                              className="p-1.5 text-white/25 hover:text-orange transition-colors rounded"
                              title="Edit item"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                              </svg>
                            </button>
                            <button
                              onClick={() => removeItem(li._id)}
                              className="p-1.5 text-white/25 hover:text-danger transition-colors rounded"
                              title="Remove item"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                <path d="M10 11v6M14 11v6"/>
                                <path d="M9 6V4h6v2"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {addingNew ? (
                    <div className="p-3 space-y-2 bg-white/5 border-t border-white/10">
                      <input
                        autoFocus
                        className="nwi-input text-sm w-full"
                        placeholder={isDetailer ? 'Add-on name or description' : 'Part name or description'}
                        value={newItemVals.description}
                        onChange={e => setNewItemVals(v => ({ ...v, description: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') commitNewItem() }}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="nwi-label text-[10px]">Qty</label>
                          <input
                            type="number" min={0} step={1}
                            className="nwi-input text-sm"
                            value={newItemVals.quantity}
                            onChange={e => setNewItemVals(v => ({ ...v, quantity: Number(e.target.value) || 0 }))}
                          />
                        </div>
                        <div>
                          <label className="nwi-label text-[10px]">Base Price ($)</label>
                          <input
                            type="number" min={0} step={0.01}
                            className="nwi-input text-sm"
                            value={newItemVals.unit_price}
                            onChange={e => setNewItemVals(v => ({ ...v, unit_price: Number(e.target.value) || 0 }))}
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={commitNewItem}
                          className="px-3 py-1.5 bg-orange hover:bg-orange-hover text-white text-xs font-semibold rounded-lg transition-colors"
                        >
                          Add Item
                        </button>
                        <button
                          onClick={() => { setAddingNew(false); setNewItemVals({ description: '', quantity: 1, unit_price: 0 }) }}
                          className="px-3 py-1.5 border border-white/15 text-white/50 hover:text-white text-xs rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAddingNew(true); setEditingId(null) }}
                      className="w-full flex items-center gap-2 px-4 py-3 text-white/40 hover:text-orange hover:bg-white/5 text-xs transition-colors border-t border-white/5"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      Add Line Item
                    </button>
                  )}
                </div>
              ) : (
                Array.isArray(initialQuote.line_items) && initialQuote.line_items.length > 0 && (
                  <div className="bg-white/5 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left px-4 py-2.5 text-white/40 font-medium">Description</th>
                          <th className="text-right px-4 py-2.5 text-white/40 font-medium">Qty</th>
                          <th className="text-right px-4 py-2.5 text-white/40 font-medium">Unit</th>
                          <th className="text-right px-4 py-2.5 text-white/40 font-medium">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {initialQuote.line_items.map((li, i) => (
                          <tr key={i} className="border-b border-white/5 last:border-0">
                            <td className="px-4 py-2.5 text-white/80">{li.description}</td>
                            <td className="px-4 py-2.5 text-white/60 text-right">{li.quantity}</td>
                            <td className="px-4 py-2.5 text-white/60 text-right">{fmt(li.unit_price)}</td>
                            <td className="px-4 py-2.5 text-white font-medium text-right">{fmt(li.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </div>

            {/* ── Labor / Service Fee ── */}
            {isDraft ? (
              <div className="space-y-2">
                <p className="text-white/30 text-xs uppercase tracking-widest">
                  {isDetailer ? 'Service Fee' : 'Labor'}
                </p>
                {isDetailer ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="nwi-label">Service Fee ($)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">$</span>
                        <input
                          type="number" min={0} step={5}
                          className="nwi-input pl-7"
                          placeholder="0.00"
                          value={laborRate}
                          onChange={e => setLaborRate(Number(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="nwi-label">Total</label>
                      <div className="nwi-input bg-white/5 text-white/60 pointer-events-none">
                        {fmt(laborSubtotal)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="nwi-label">Hours</label>
                      <input
                        type="number" min={0} step={0.25}
                        className="nwi-input"
                        value={laborHours}
                        onChange={e => setLaborHours(Number(e.target.value) || 0)}
                      />
                    </div>
                    <div>
                      <label className="nwi-label">Rate $/hr</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">$</span>
                        <input
                          type="number" min={0} step={5}
                          className="nwi-input pl-7"
                          value={laborRate}
                          onChange={e => setLaborRate(Number(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="nwi-label">Subtotal</label>
                      <div className="nwi-input bg-white/5 text-white/60 pointer-events-none">
                        {fmt(laborSubtotal)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              initialQuote.labor_subtotal != null && (
                <div className="space-y-1">
                  <p className="text-white/30 text-xs uppercase tracking-widest">
                    {isDetailer ? 'Service Fee' : 'Labor'}
                  </p>
                  <p className="text-white/70 text-sm">
                    {!isDetailer && initialQuote.labor_hours != null && initialQuote.labor_rate != null
                      ? `${initialQuote.labor_hours}h × ${fmt(initialQuote.labor_rate)}/hr = `
                      : ''}
                    <span className="text-white font-medium">{fmt(initialQuote.labor_subtotal)}</span>
                  </p>
                </div>
              )
            )}

            {/* ── Pricing settings (draft only) ── */}
            {isDraft && (
              <div className="space-y-2">
                <p className="text-white/30 text-xs uppercase tracking-widest">Pricing Settings</p>
                <div className={`grid gap-3 ${isDetailer ? 'grid-cols-1 max-w-[50%]' : 'grid-cols-2'}`}>
                  {!isDetailer && (
                    <div>
                      <label className="nwi-label">Parts Markup %</label>
                      <div className="relative">
                        <input
                          type="number" min={0} step={1}
                          className="nwi-input pr-7"
                          value={markupPct}
                          onChange={e => setMarkupPct(Number(e.target.value) || 0)}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">%</span>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="nwi-label">Tax Rate %</label>
                    <div className="relative">
                      <input
                        type="number" min={0} step={0.25}
                        className="nwi-input pr-7"
                        value={taxPct}
                        onChange={e => setTaxPct(Number(e.target.value) || 0)}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">%</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Notes ── */}
            {isDraft ? (
              <div className="space-y-2">
                <p className="text-white/30 text-xs uppercase tracking-widest">Notes</p>
                <textarea
                  rows={3}
                  className="nwi-input resize-y text-sm w-full"
                  placeholder="Add notes for this quote…"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />
              </div>
            ) : (
              initialQuote.notes && (
                <div className="space-y-1">
                  <p className="text-white/30 text-xs uppercase tracking-widest">Notes</p>
                  <p className="text-white/70 text-sm whitespace-pre-wrap">{initialQuote.notes}</p>
                </div>
              )
            )}

            {/* ── Financial breakdown ── */}
            <div className="bg-white/5 rounded-xl p-4 space-y-2.5">
              <p className="text-white/30 text-xs uppercase tracking-widest mb-3">Financial Breakdown</p>

              {isDraft ? (
                <>
                  {partsBase > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-white/60">{isDetailer ? 'Add-ons' : 'Parts Base'}</span>
                      <span className="text-white">{fmt(partsBase)}</span>
                    </div>
                  )}
                  {!isDetailer && markupPct > 0 && partsBase > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-white/40">Parts Markup ({markupPct}%)</span>
                      <span className="text-white/60">+{fmt(markupAmt)}</span>
                    </div>
                  )}
                  {laborSubtotal > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-white/60">
                        {isDetailer ? 'Service Fee' : `Labor (${laborHours}h × ${fmt(laborRate)}/hr)`}
                      </span>
                      <span className="text-white">{fmt(laborSubtotal)}</span>
                    </div>
                  )}
                  {taxPct > 0 && (
                    <div className="flex justify-between text-sm border-t border-white/10 pt-2.5">
                      <span className="text-white/40">Tax ({taxPct}%)</span>
                      <span className="text-white/60">{fmt(taxAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-baseline border-t border-white/10 pt-3">
                    <span className="font-condensed font-bold text-white text-lg tracking-wide">GRAND TOTAL</span>
                    <span className={`font-condensed font-bold text-3xl ${grandTotal < 0 ? 'text-danger' : 'text-orange'}`}>
                      {fmt(grandTotal)}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  {initialQuote.parts_subtotal != null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-white/60">{isDetailer ? 'Add-ons Subtotal' : 'Parts Subtotal'}</span>
                      <span className="text-white">{fmt(initialQuote.parts_subtotal)}</span>
                    </div>
                  )}
                  {!isDetailer && initialQuote.parts_markup_percent != null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-white/40">Parts Markup ({initialQuote.parts_markup_percent}%)</span>
                      <span className="text-white/60">
                        {initialQuote.parts_subtotal != null
                          ? fmt(initialQuote.parts_subtotal * (initialQuote.parts_markup_percent / 100))
                          : '—'}
                      </span>
                    </div>
                  )}
                  {initialQuote.labor_subtotal != null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-white/60">
                        {isDetailer
                          ? 'Service Fee'
                          : `Labor${initialQuote.labor_hours != null && initialQuote.labor_rate != null
                              ? ` (${initialQuote.labor_hours}h × ${fmt(initialQuote.labor_rate)}/hr)`
                              : ''}`}
                      </span>
                      <span className="text-white">{fmt(initialQuote.labor_subtotal)}</span>
                    </div>
                  )}
                  {initialQuote.tax_amount != null && (
                    <div className="flex justify-between text-sm border-t border-white/10 pt-2.5">
                      <span className="text-white/40">
                        Tax{initialQuote.tax_percent != null ? ` (${initialQuote.tax_percent}%)` : ''}
                      </span>
                      <span className="text-white/60">{fmt(initialQuote.tax_amount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-baseline border-t border-white/10 pt-3">
                    <span className="font-condensed font-bold text-white text-lg tracking-wide">GRAND TOTAL</span>
                    <span className="font-condensed font-bold text-orange text-3xl">{fmt(initialQuote.grand_total)}</span>
                  </div>
                </>
              )}
            </div>

            {/* ── Validation error ── */}
            {validationErr && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-danger/30 bg-danger/10 text-danger text-sm">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {validationErr}
              </div>
            )}

            {/* ── Timeline (locked) ── */}
            {isLocked && timeline.length > 0 && (
              <div className="space-y-2">
                <p className="text-white/30 text-xs uppercase tracking-widest">Timeline</p>
                <div className="space-y-1.5">
                  {timeline.map(({ label, ts, detail }) => (
                    <div key={label} className="flex items-center justify-between text-sm gap-2">
                      <span className="text-white/50">
                        {label}
                        {detail && <span className="text-white/30 text-xs ml-1.5">{detail}</span>}
                      </span>
                      <span className="text-white/70 text-right">{fmtDateTime(ts)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Customer decline note ── */}
            {initialQuote.status === 'declined' && initialQuote.customer_response_note && (
              <div className="space-y-1">
                <p className="text-white/30 text-xs uppercase tracking-widest">Customer Note</p>
                <p className="text-white/60 text-sm italic">&ldquo;{initialQuote.customer_response_note}&rdquo;</p>
              </div>
            )}

            {/* ── Sent-to info ── */}
            {(initialQuote.sent_to_phone || initialQuote.sent_to_email) && (
              <div className="space-y-1">
                <p className="text-white/30 text-xs uppercase tracking-widest">Sent To</p>
                {initialQuote.sent_to_phone && (
                  <p className="text-white/50 text-sm">{initialQuote.sent_to_phone} (SMS)</p>
                )}
                {initialQuote.sent_to_email && (
                  <p className="text-white/50 text-sm">{initialQuote.sent_to_email} (Email)</p>
                )}
              </div>
            )}

            {/* ── Action buttons ── */}
            <div className="flex flex-wrap gap-3 pt-2 border-t border-white/10">
              {isDraft ? (
                <>
                  {/* Send Quote (primary for draft) */}
                  <button
                    onClick={() => setShowSendModal(true)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-[#FF6600] hover:bg-orange-600 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors shadow-md shadow-orange/20"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                    Send Quote
                  </button>

                  {/* Save Changes */}
                  <button
                    onClick={handleSave}
                    disabled={saving || grandTotal < 0}
                    className={`flex items-center gap-2 px-5 py-2.5 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-all ${
                      isDirty
                        ? 'bg-white/15 hover:bg-white/20 border border-white/20'
                        : 'bg-white/10 hover:bg-white/15 border border-white/10'
                    } disabled:opacity-40`}
                  >
                    {saving ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        Saving…
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                          <polyline points="17 21 17 13 7 13 7 21"/>
                          <polyline points="7 3 7 8 15 8"/>
                        </svg>
                        Save Changes
                      </>
                    )}
                  </button>

                  {isDirty && (
                    <button
                      onClick={handleCancel}
                      className="px-4 py-2.5 border border-white/15 text-white/60 hover:text-white hover:border-white/30 text-sm font-medium rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  )}

                  <button
                    onClick={handleReopenInQW}
                    className="flex items-center gap-2 px-4 py-2.5 border border-blue/30 bg-blue/10 hover:bg-blue/20 text-blue-light text-sm font-medium rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                    </svg>
                    Reopen in QuickWrench
                  </button>

                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="ml-auto flex items-center gap-1.5 px-3 py-2.5 text-danger/60 hover:text-danger text-sm rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    </svg>
                    Delete
                  </button>
                </>
              ) : isSent ? (
                <>
                  {/* Mark Approved */}
                  <button
                    onClick={() => setShowMarkModal('approved')}
                    className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Mark Approved
                  </button>

                  {/* Mark Declined */}
                  <button
                    onClick={() => setShowMarkModal('declined')}
                    className="flex items-center gap-2 px-4 py-2.5 border border-danger/40 bg-danger/10 hover:bg-danger/20 text-danger text-sm font-semibold rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                    Mark Declined
                  </button>

                  {/* Resend Quote */}
                  <button
                    onClick={() => setShowSendModal(true)}
                    className="flex items-center gap-2 px-4 py-2.5 border border-white/20 hover:border-orange/40 text-white/60 hover:text-orange text-sm font-medium rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                    </svg>
                    Resend Quote
                  </button>

                  {/* Edit as New Version */}
                  <button
                    onClick={handleClone}
                    disabled={cloning}
                    className="flex items-center gap-2 px-4 py-2.5 border border-white/15 text-white/50 hover:text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40"
                  >
                    {cloning ? 'Creating…' : 'Edit as New Version'}
                  </button>

                  <button
                    onClick={handleReopenInQW}
                    className="flex items-center gap-2 px-4 py-2.5 border border-blue/30 bg-blue/10 hover:bg-blue/20 text-blue-light text-sm font-medium rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                    </svg>
                    Reopen in QuickWrench
                  </button>
                </>
              ) : initialQuote.status === 'approved' ? (
                <>
                  {/* Push to Invoice (primary) or View Invoice if already converted */}
                  {initialQuote.converted_invoice_id ? (
                    <button
                      onClick={() => { window.location.href = `/financials/invoices/${initialQuote.converted_invoice_id}` }}
                      className="flex items-center gap-2 px-5 py-2.5 bg-[#2969B0] hover:bg-blue-700 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                      View Invoice
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowConvertModal(true)}
                      disabled={converting}
                      className="flex items-center gap-2 px-5 py-2.5 bg-[#FF6600] hover:bg-orange-600 disabled:opacity-50 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors shadow-md shadow-orange/20"
                    >
                      {converting ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                          </svg>
                          Converting…
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="12" y1="18" x2="12" y2="12"/>
                            <line x1="9" y1="15" x2="12" y2="12"/>
                            <line x1="15" y1="15" x2="12" y2="12"/>
                          </svg>
                          Push to Invoice
                        </>
                      )}
                    </button>
                  )}

                  <button
                    onClick={handleReopenInQW}
                    className="flex items-center gap-2 px-4 py-2.5 border border-blue/30 bg-blue/10 hover:bg-blue/20 text-blue-light text-sm font-medium rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                    </svg>
                    Reopen in QuickWrench
                  </button>
                </>
              ) : initialQuote.status === 'converted' ? (
                <>
                  {/* View Invoice (converted quotes are fully locked) */}
                  {initialQuote.converted_invoice_id && (
                    <button
                      onClick={() => { window.location.href = `/financials/invoices/${initialQuote.converted_invoice_id}` }}
                      className="flex items-center gap-2 px-5 py-2.5 bg-[#2969B0] hover:bg-blue-700 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                      View Invoice →
                    </button>
                  )}
                  <button
                    onClick={handleReopenInQW}
                    className="flex items-center gap-2 px-4 py-2.5 border border-blue/30 bg-blue/10 hover:bg-blue/20 text-blue-light text-sm font-medium rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                    </svg>
                    Reopen in QuickWrench
                  </button>
                </>
              ) : (
                <>
                  {/* Edit as New Version (declined / expired) */}
                  <button
                    onClick={handleClone}
                    disabled={cloning}
                    className="flex items-center gap-2 px-5 py-2.5 bg-orange hover:bg-orange-hover disabled:opacity-50 text-white font-condensed font-bold text-sm tracking-wide rounded-lg transition-colors"
                  >
                    {cloning ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        Creating…
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        Edit as New Version
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleReopenInQW}
                    className="flex items-center gap-2 px-4 py-2.5 border border-blue/30 bg-blue/10 hover:bg-blue/20 text-blue-light text-sm font-medium rounded-lg transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                    </svg>
                    Reopen in QuickWrench
                  </button>
                </>
              )}
            </div>

          </div>{/* end scrollable content */}
        </div>{/* end modal card */}
      </div>{/* end overlay */}

      {/* ── Delete confirmation ── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm bg-[#1a1a1a] border border-danger/30 rounded-2xl p-6 space-y-4">
            <p className="text-white font-semibold">Delete this quote?</p>
            <p className="text-white/50 text-sm">
              <span className="font-mono text-orange">{initialQuote.quote_number}</span> will be permanently removed. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 bg-danger hover:bg-danger/80 disabled:opacity-50 text-white font-semibold text-sm rounded-lg transition-colors"
              >
                {deleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 px-4 py-2.5 border border-white/15 text-white/60 hover:text-white text-sm rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Manual mark modal (approve / decline) ── */}
      {showMarkModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 space-y-4">
            <p className="text-white font-semibold">
              Mark as {showMarkModal === 'approved' ? 'Approved' : 'Declined'}?
            </p>
            <p className="text-white/50 text-sm">
              {showMarkModal === 'approved'
                ? 'Record that the customer verbally approved this quote.'
                : 'Record that the customer verbally declined this quote.'}
            </p>
            {showMarkModal === 'declined' && (
              <div className="space-y-1">
                <label className="nwi-label">Reason / note (optional)</label>
                <textarea
                  rows={3}
                  value={markNote}
                  onChange={e => setMarkNote(e.target.value)}
                  placeholder="e.g. Customer said too expensive"
                  className="nwi-input resize-none text-sm w-full"
                />
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => handleMark(showMarkModal)}
                disabled={marking}
                className={`flex-1 px-4 py-2.5 disabled:opacity-50 text-white font-semibold text-sm rounded-lg transition-colors ${
                  showMarkModal === 'approved'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-danger hover:bg-danger/80'
                }`}
              >
                {marking ? 'Saving…' : `Yes, Mark ${showMarkModal === 'approved' ? 'Approved' : 'Declined'}`}
              </button>
              <button
                onClick={() => { setShowMarkModal(null); setMarkNote('') }}
                disabled={marking}
                className="flex-1 px-4 py-2.5 border border-white/15 text-white/60 hover:text-white text-sm rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Push to Invoice confirmation modal (Phase 3) ── */}
      {showConvertModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-sm bg-[#1a1a1a] border border-orange/30 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange/15 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-orange" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <p className="text-white font-semibold">Convert to Invoice in Progress?</p>
            </div>
            <p className="text-white/50 text-sm leading-relaxed">
              This will create a new Invoice in Progress from{' '}
              <span className="font-mono text-orange">{initialQuote.quote_number}</span>.
              The quote will be locked from further edits.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handlePushToInvoice}
                disabled={converting}
                className="flex-1 px-4 py-2.5 bg-[#FF6600] hover:bg-orange-600 disabled:opacity-50 text-white font-semibold text-sm rounded-lg transition-colors"
              >
                {converting ? 'Converting…' : 'Yes, Convert'}
              </button>
              <button
                onClick={() => setShowConvertModal(false)}
                disabled={converting}
                className="flex-1 px-4 py-2.5 border border-white/15 text-white/60 hover:text-white text-sm rounded-lg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Vehicle change modal ── */}
      {showVehicleModal && (
        <VehicleChangeModal
          customerId={initialQuote.customer_id}
          currentVehicleId={vehicleId}
          onSelect={v => {
            setVehicleId(v.id)
            setVehicle({ id: v.id, year: v.year, make: v.make, model: v.model, vin: v.vin })
          }}
          onClose={() => setShowVehicleModal(false)}
        />
      )}

      {/* ── Send / Resend Quote modal ── */}
      {showSendModal && (
        <SendQuoteModal
          quote={initialQuote}
          isResend={isSent}
          onClose={() => setShowSendModal(false)}
          onSent={updatedQuote => {
            setShowSendModal(false)
            showToast(
              isSent
                ? 'Quote resent successfully'
                : `Quote sent — ${updatedQuote.quote_number}`,
              'success'
            )
            onUpdated(updatedQuote)
          }}
        />
      )}

      {/* ── Discard-changes confirmation (replaces window.confirm for mobile compat) ── */}
      {pendingDiscard && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-xs bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl p-6 space-y-4">
            <p className="text-white font-semibold text-base">Unsaved changes</p>
            <p className="text-white/50 text-sm">{pendingDiscard.msg}</p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { pendingDiscard.action(); setPendingDiscard(null) }}
                className="flex-1 py-2.5 rounded-xl bg-danger/20 border border-danger/30 text-danger text-sm font-semibold hover:bg-danger/30 transition-colors"
              >
                Discard
              </button>
              <button
                onClick={() => setPendingDiscard(null)}
                className="flex-1 py-2.5 rounded-xl border border-white/15 text-white/70 text-sm font-semibold hover:bg-white/5 transition-colors"
              >
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function QuotesTab({ initialQuoteId, isDetailer = false }: { initialQuoteId?: string; isDetailer?: boolean }) {
  const [quotes,       setQuotes]       = useState<Quote[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [dateRange,    setDateRange]    = useState('all')
  const [search,       setSearch]       = useState('')
  const [selected,     setSelected]     = useState<Quote | null>(null)
  const [modalKey,     setModalKey]     = useState(0)

  const loadQuotes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (dateRange && dateRange !== 'all') params.set('date_range', dateRange)

      const res  = await fetch(`/api/quotes?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load quotes')
      setQuotes(json.quotes ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, dateRange])

  useEffect(() => { loadQuotes() }, [loadQuotes])

  useEffect(() => {
    if (initialQuoteId && quotes.length > 0 && !selected) {
      const match = quotes.find(q => q.id === initialQuoteId)
      if (match) setSelected(match)
    }
  }, [initialQuoteId, quotes, selected])

  function handleQuoteUpdated(updatedQuote: Quote) {
    setQuotes(qs => qs.map(q => q.id === updatedQuote.id ? updatedQuote : q))
    setSelected(updatedQuote)
    setModalKey(k => k + 1)
  }

  function handleQuoteDeleted(deletedId: string) {
    setQuotes(qs => qs.filter(q => q.id !== deletedId))
    setSelected(null)
  }

  const visible = quotes.filter(q => {
    if (!search.trim()) return true
    const s = search.toLowerCase()
    const customerName = q.customer
      ? `${q.customer.first_name} ${q.customer.last_name}`.toLowerCase()
      : ''
    const vin = q.vehicle?.vin?.toLowerCase() ?? ''
    return (
      q.quote_number.toLowerCase().includes(s) ||
      customerName.includes(s) ||
      vin.includes(s)
    )
  })

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="nwi-input text-sm py-2 min-w-[140px]"
        >
          {STATUS_FILTERS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        <select
          value={dateRange}
          onChange={e => setDateRange(e.target.value)}
          className="nwi-input text-sm py-2 min-w-[140px]"
        >
          {DATE_RANGE_FILTERS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[200px]">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30"
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            placeholder="Search by customer, quote #, or VIN…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="nwi-input pl-9 text-sm py-2 w-full"
          />
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-white/30 text-sm">
          Loading quotes…
        </div>
      ) : error ? (
        <div className="px-4 py-3 rounded-lg border border-danger/30 bg-danger/10 text-danger text-sm">
          {error}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <svg className="w-10 h-10 text-white/20" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
          </svg>
          <p className="text-white/40 text-sm">
            {quotes.length === 0
              ? 'No quotes yet. Build one in QuickWrench and save as a quote.'
              : 'No quotes match your current filters.'}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/5 border-b border-white/10">
                  <th className="text-left px-4 py-3 text-white/40 font-medium whitespace-nowrap">Quote #</th>
                  <th className="text-left px-4 py-3 text-white/40 font-medium whitespace-nowrap">Date</th>
                  <th className="text-left px-4 py-3 text-white/40 font-medium">Customer</th>
                  <th className="text-left px-4 py-3 text-white/40 font-medium">Vehicle</th>
                  <th className="text-left px-4 py-3 text-white/40 font-medium">Job</th>
                  <th className="text-right px-4 py-3 text-white/40 font-medium whitespace-nowrap">Total</th>
                  <th className="text-left px-4 py-3 text-white/40 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((q, i) => {
                  const customerName = q.customer
                    ? `${q.customer.first_name} ${q.customer.last_name}`
                    : '—'
                  const vehicleLabel = q.vehicle
                    ? [q.vehicle.year, q.vehicle.make, q.vehicle.model].filter(Boolean).join(' ')
                    : '—'
                  const jobDesc = Array.isArray(q.jobs) && q.jobs.length > 1
                    ? `${q.jobs.length} Services`
                    : [q.job_category, q.job_subtype].filter(Boolean).join(' / ') || '—'

                  return (
                    <tr
                      key={q.id}
                      onClick={() => { setSelected(q); setModalKey(0) }}
                      className={`
                        border-b border-white/5 last:border-0 cursor-pointer transition-colors
                        hover:bg-white/5
                        ${i % 2 === 0 ? '' : 'bg-white/[0.02]'}
                      `}
                    >
                      <td className="px-4 py-3 font-mono text-orange text-xs font-medium">{q.quote_number}</td>
                      <td className="px-4 py-3 text-white/60 whitespace-nowrap">{fmtDate(q.created_at)}</td>
                      <td className="px-4 py-3 text-white">{customerName}</td>
                      <td className="px-4 py-3 text-white/70 whitespace-nowrap">{vehicleLabel}</td>
                      <td className="px-4 py-3 text-white/60 max-w-[200px] truncate">{jobDesc}</td>
                      <td className="px-4 py-3 text-white font-medium text-right whitespace-nowrap">
                        {fmt(q.grand_total)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={q.status as QuoteStatus} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {visible.map(q => {
              const customerName = q.customer
                ? `${q.customer.first_name} ${q.customer.last_name}`
                : '—'
              const vehicleLabel = q.vehicle
                ? [q.vehicle.year, q.vehicle.make, q.vehicle.model].filter(Boolean).join(' ')
                : '—'
              const jobDesc = Array.isArray(q.jobs) && q.jobs.length > 1
                ? `${q.jobs.length} Services`
                : [q.job_category, q.job_subtype].filter(Boolean).join(' / ') || '—'

              return (
                <button
                  key={q.id}
                  onClick={() => { setSelected(q); setModalKey(0) }}
                  className="w-full text-left nwi-card hover:border-white/20 transition-colors min-h-[48px]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-mono text-orange text-xs font-medium">{q.quote_number}</span>
                        <StatusBadge status={q.status as QuoteStatus} />
                      </div>
                      <p className="text-white font-medium text-sm truncate">{customerName}</p>
                      <p className="text-white/50 text-xs">{vehicleLabel}</p>
                      <p className="text-white/40 text-xs truncate">{jobDesc}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-condensed font-bold text-orange text-lg">{fmt(q.grand_total)}</p>
                      <p className="text-white/30 text-xs">{fmtDate(q.created_at)}</p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          <p className="text-white/20 text-xs text-right">
            {visible.length} quote{visible.length !== 1 ? 's' : ''}
            {visible.length !== quotes.length ? ` (${quotes.length} total)` : ''}
          </p>
        </>
      )}

      {selected && (
        <QuoteDetailModal
          key={`${selected.id}-${modalKey}`}
          quote={selected}
          isDetailer={isDetailer}
          onClose={() => setSelected(null)}
          onUpdated={handleQuoteUpdated}
          onDeleted={handleQuoteDeleted}
        />
      )}
    </div>
  )
}
