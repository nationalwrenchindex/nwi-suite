'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Invoice, MultiJobEntry } from '@/types/financials'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tools.nationalwrenchindex.com'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

function fmtDate(s: string | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', opts ?? { month: 'short', day: 'numeric', year: 'numeric' })
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

// ─── Per-job P&L drill-down row ───────────────────────────────────────────────

function JobBreakdownRow({ j, idx }: { j: MultiJobEntry; idx: number }) {
  const [open, setOpen] = useState(false)
  const partsRev  = j.parts.reduce((s, p) => s + p.unit_price * p.qty, 0)
  const partsCost = j.parts.reduce((s, p) => s + p.unit_cost  * p.qty, 0)
  const laborInc  = j.labor_hours * j.labor_rate
  const jobProfit = round2(partsRev + laborInc - partsCost)
  const profitColor = jobProfit >= 0 ? '#10b981' : '#ef4444'

  return (
    <div className="border border-white/8 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/3 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-success/15 border border-success/25 flex items-center justify-center text-success text-[9px] font-bold flex-shrink-0">
            {idx + 1}
          </span>
          <span className="text-white font-medium text-sm">{j.subtype}</span>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ color: profitColor }} className="font-semibold text-sm">{fmt(jobProfit)}</span>
          <svg
            className={`w-4 h-4 text-white/30 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1.5 border-t border-white/5 pt-3">
          {partsRev > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-white/40">Parts Revenue</span>
              <span className="text-white/60">{fmt(partsRev)}</span>
            </div>
          )}
          {partsCost > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-white/40">Parts Cost</span>
              <span className="text-danger/70">−{fmt(partsCost)}</span>
            </div>
          )}
          {laborInc > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-white/40">Labor ({j.labor_hours}h @ {fmt(j.labor_rate)}/hr)</span>
              <span className="text-white/60">{fmt(laborInc)}</span>
            </div>
          )}
          <div className="flex justify-between text-xs pt-1 border-t border-white/5 font-medium">
            <span className="text-white/50">Job Profit</span>
            <span style={{ color: profitColor }}>{fmt(jobProfit)}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Per-job P&L calculation (mirrors API calcBreakdown) ─────────────────────

function calcJobPnL(invoice: import('@/types/financials').Invoice) {
  const sq        = invoice.source_quote
  const markupPct = Number(sq?.parts_markup_percent ?? 0)

  const quotedPartsCost        = Number(sq?.parts_subtotal ?? 0)
  const additionalParts        = Array.isArray(invoice.additional_parts) ? invoice.additional_parts : []
  const additionalPartsCost    = additionalParts.reduce((s, p) => s + p.unit_cost * p.qty, 0)
  const totalPartsCost         = round2(quotedPartsCost + additionalPartsCost)
  const quotedPartsRevenue     = round2(quotedPartsCost * (1 + markupPct / 100))
  const additionalPartsRevenue = additionalParts.reduce((s, p) => s + p.total, 0)
  const partsRevenue           = round2(quotedPartsRevenue + additionalPartsRevenue)
  const partsGrossProfit       = round2(partsRevenue - totalPartsCost)

  const additionalLabor     = Array.isArray(invoice.additional_labor) ? invoice.additional_labor : []
  const quotedLaborSubtotal = Number(sq?.labor_subtotal ?? 0)
  const laborIncome         = round2(quotedLaborSubtotal + additionalLabor.reduce((s, l) => s + l.subtotal, 0))

  const shopSupplies      = Array.isArray(invoice.shop_supplies) ? invoice.shop_supplies : []
  const shopSuppliesTotal = round2(shopSupplies.reduce((s, ss) => s + ss.total, 0))

  const cogsTotal  = round2(totalPartsCost + shopSuppliesTotal)
  const taxAmount  = Number(invoice.tax_amount ?? 0)
  const grandTotal = Number(invoice.total ?? 0)
  const netProfit  = round2(grandTotal - cogsTotal - taxAmount)
  const netMargin  = grandTotal > 0 ? Math.round((netProfit / grandTotal) * 100) : 0

  return {
    grandTotal,
    partsRevenue,
    laborIncome,
    shopSuppliesTotal,
    taxAmount,
    totalPartsCost,
    shopSuppliesCost: shopSuppliesTotal,
    cogsTotal,
    netProfit,
    netMargin,
    partsGrossProfit,
  }
}

// ─── Payment method constants ──────────────────────────────────────────────────

const PAYMENT_METHODS_FOR_MODAL = [
  { value: 'cash',    label: 'Cash' },
  { value: 'card',    label: 'Card' },
  { value: 'check',   label: 'Check' },
  { value: 'venmo',   label: 'Venmo' },
  { value: 'zelle',   label: 'Zelle' },
  { value: 'cashapp', label: 'Cash App' },
  { value: 'paypal',  label: 'PayPal' },
  { value: 'other',   label: 'Other' },
] as const

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash:    'Cash',
  card:    'Card',
  check:   'Check',
  venmo:   'Venmo',
  zelle:   'Zelle',
  cashapp: 'Cash App',
  paypal:  'PayPal',
  other:   'Other',
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ msg, type }: { msg: string; type: 'success' | 'error' | 'warning' }) {
  const color = type === 'success' ? 'border-success/40 bg-success/10 text-success'
    : type === 'error' ? 'border-danger/40 bg-danger/10 text-danger'
    : 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400'
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl border shadow-2xl text-sm font-semibold whitespace-nowrap ${color}`}>
      {msg}
    </div>
  )
}

// ─── Section card ─────────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#222222] border border-white/8 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-white/8 bg-white/[0.02]">
        <p className="text-white/50 text-xs font-semibold uppercase tracking-widest">{label}</p>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ─── ReadOnlyTable ────────────────────────────────────────────────────────────

function ReadOnlyTable({ rows }: {
  rows: Array<{ label: string; qty?: string; amount: number }>
}) {
  if (rows.length === 0) return null
  return (
    <div className="rounded-xl border border-white/8 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/8 bg-white/[0.02]">
            <th className="text-left px-4 py-2 text-white/40 font-medium">Description</th>
            {rows.some(r => r.qty) && <th className="text-right px-4 py-2 text-white/40 font-medium">Qty</th>}
            <th className="text-right px-4 py-2 text-white/40 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-white/5 last:border-0">
              <td className="px-4 py-2.5 text-white/70">{r.label}</td>
              {rows.some(x => x.qty) && <td className="px-4 py-2.5 text-white/50 text-right">{r.qty ?? ''}</td>}
              <td className="px-4 py-2.5 text-white font-medium text-right">{fmt(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

interface TimelineEvent {
  label: string
  date: string | null
  icon: string
  highlight?: boolean
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  const visible = events.filter(e => e.date)
  if (visible.length === 0) return null

  return (
    <Section label="Activity Timeline">
      <div className="space-y-3">
        {visible.map((e, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm ${
              e.highlight ? 'bg-success/20 text-success' : 'bg-white/8 text-white/40'
            }`}>
              {e.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm ${e.highlight ? 'text-white' : 'text-white/60'}`}>{e.label}</p>
              <p className="text-white/30 text-xs">{fmtDate(e.date, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ─── Confirmation Modal ───────────────────────────────────────────────────────

function FinalizeConfirmModal({
  grandTotal,
  onConfirm,
  onCancel,
  loading,
}: {
  grandTotal: number
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-orange/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-orange" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            </svg>
          </div>
          <div>
            <h2 className="text-white font-bold text-lg">Finalize this invoice?</h2>
            <p className="text-white/60 text-sm mt-1">
              Once finalized, the invoice is locked from further edits. The grand total will be{' '}
              <span className="text-orange font-semibold">{fmt(grandTotal)}</span>.
              Only finalize when the job is complete.
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-3 bg-[#FF6600] hover:bg-orange-600 disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-xl transition-colors"
          >
            {loading ? 'Finalizing…' : 'Yes, Finalize'}
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-3 border border-white/15 text-white/60 hover:text-white rounded-xl transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Mark as Paid Modal ───────────────────────────────────────────────────────

function MarkAsPaidModal({
  grandTotal,
  onConfirm,
  onCancel,
  loading,
}: {
  grandTotal: number
  onConfirm: (method: string, reference: string, notes: string) => void
  onCancel: () => void
  loading: boolean
}) {
  const [method,    setMethod]    = useState('cash')
  const [reference, setReference] = useState('')
  const [notes,     setNotes]     = useState('')

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-success/15 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-success" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <div>
            <h2 className="text-white font-bold text-lg">Mark as Paid</h2>
            <p className="text-white/60 text-sm mt-1">
              Total collected:{' '}
              <span className="text-success font-semibold">{fmt(grandTotal)}</span>
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-white/40 text-xs uppercase tracking-widest block mb-1.5">Payment Method</label>
            <select
              value={method}
              onChange={e => setMethod(e.target.value)}
              className="nwi-input text-sm w-full"
            >
              {PAYMENT_METHODS_FOR_MODAL.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-white/40 text-xs uppercase tracking-widest block mb-1.5">
              Reference <span className="normal-case text-white/20">(optional — check #, transaction ID, etc.)</span>
            </label>
            <input
              type="text"
              className="nwi-input text-sm w-full"
              placeholder="e.g. Check #1042"
              value={reference}
              onChange={e => setReference(e.target.value)}
            />
          </div>

          <div>
            <label className="text-white/40 text-xs uppercase tracking-widest block mb-1.5">
              Notes <span className="normal-case text-white/20">(optional)</span>
            </label>
            <textarea
              rows={3}
              className="nwi-input resize-none text-sm w-full"
              placeholder="Any notes about this payment…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => onConfirm(method, reference, notes)}
            disabled={loading}
            className="flex-1 py-3 bg-success hover:bg-green-600 disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-xl transition-colors"
          >
            {loading ? 'Saving…' : 'Confirm Payment'}
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-3 border border-white/15 text-white/60 hover:text-white rounded-xl transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Send Invoice Modal ───────────────────────────────────────────────────────

type SendTab = 'sms' | 'email' | 'link'

function SendInvoiceModal({
  invoice,
  invoiceUrl,
  bizName,
  techName,
  onSent,
  onClose,
}: {
  invoice: Invoice
  invoiceUrl: string
  bizName: string
  techName: string
  onSent: (updated: Invoice) => void
  onClose: () => void
}) {
  const [tab,         setTab]         = useState<SendTab>('sms')
  const [phone,       setPhone]       = useState(invoice.customer?.phone ?? invoice.sent_to_phone ?? '')
  const [email,       setEmail]       = useState(invoice.customer?.email ?? invoice.sent_to_email ?? '')
  const [loading,     setLoading]     = useState(false)
  const [copied,      setCopied]      = useState(false)
  const [result,      setResult]      = useState<string | null>(null)
  const [resultType,  setResultType]  = useState<'success' | 'warning'>('success')

  const customerName = invoice.customer
    ? `${invoice.customer.first_name} ${invoice.customer.last_name}`.trim()
    : 'Customer'

  const grandTotal = fmt(invoice.total)

  const smsPreview =
    `Hi ${customerName}, your invoice from ${bizName} is ready. ` +
    `Total due: ${grandTotal}. View and download here: ${invoiceUrl}. Reply STOP to opt out.`

  const emailSubject = `Invoice from ${bizName} — Total Due: ${grandTotal}`
  const emailBodyPreview = `Hi ${customerName},\n\nYour invoice for service is ready.\n\nTotal Due: ${grandTotal}\n\nView and download your invoice: ${invoiceUrl}\n\n${invoice.payment_instructions ? `Payment Instructions:\n${invoice.payment_instructions}\n\n` : ''}Please contact ${bizName} directly with any questions.\n\nThanks,\n${techName}\n${bizName}`

  async function handleSend(method: SendTab) {
    setLoading(true)
    setResult(null)
    try {
      const body: Record<string, unknown> = { method }
      if (method === 'sms')   body.phone = phone
      if (method === 'email') body.email = email

      const res  = await fetch(`/api/invoices/${invoice.id}/send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Send failed')

      onSent(json.invoice)

      if (method === 'sms') {
        if (json.sms_sent) {
          setResult('SMS sent successfully.')
          setResultType('success')
        } else {
          setResult(`Invoice link saved. SMS delivery failed: ${json.sms_error ?? 'Twilio not configured'}. Share the link manually.`)
          setResultType('warning')
        }
      } else if (method === 'email') {
        if (json.email_sent) {
          setResult('Email sent successfully.')
          setResultType('success')
        } else {
          setResult(`Invoice link saved. Email delivery failed: ${json.email_error ?? 'SMTP not configured'}. Share the link manually.`)
          setResultType('warning')
        }
      }
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Failed to send')
      setResultType('warning')
    } finally {
      setLoading(false)
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(invoiceUrl).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const tabCls = (t: SendTab) =>
    `flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
      tab === t ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
    }`

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md bg-[#1a1a1a] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <p className="text-white font-semibold">
              {invoice.times_sent > 0 ? 'Resend Invoice' : 'Send Invoice'}
            </p>
            <p className="text-white/40 text-xs mt-0.5">{invoice.invoice_number} · {grandTotal}</p>
          </div>
          <button onClick={onClose} className="p-2 text-white/40 hover:text-white rounded-lg hover:bg-white/10 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-3 border-b border-white/8 bg-white/[0.02]">
          <button className={tabCls('sms')}   onClick={() => setTab('sms')}>SMS</button>
          <button className={tabCls('email')} onClick={() => setTab('email')}>Email</button>
          <button className={tabCls('link')}  onClick={() => setTab('link')}>Copy Link</button>
        </div>

        <div className="p-5 space-y-4">

          {/* Result banner */}
          {result && (
            <div className={`text-sm px-4 py-3 rounded-xl border ${
              resultType === 'success'
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
            }`}>
              {result}
            </div>
          )}

          {/* SMS tab */}
          {tab === 'sms' && (
            <div className="space-y-4">
              <div>
                <label className="text-white/40 text-xs uppercase tracking-widest block mb-1.5">Customer Phone</label>
                <input
                  className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-white/30"
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="(555) 555-5555"
                />
              </div>
              <div className="bg-white/[0.03] border border-white/8 rounded-xl p-4">
                <p className="text-white/30 text-[10px] uppercase tracking-widest mb-2">Message Preview</p>
                <p className="text-white/60 text-xs leading-relaxed">{smsPreview}</p>
              </div>
              <button
                onClick={() => handleSend('sms')}
                disabled={loading || !phone.trim()}
                className="w-full py-3 bg-[#FF6600] hover:bg-orange-600 disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-xl transition-colors"
              >
                {loading ? 'Sending…' : 'Send SMS'}
              </button>
            </div>
          )}

          {/* Email tab */}
          {tab === 'email' && (
            <div className="space-y-4">
              <div>
                <label className="text-white/40 text-xs uppercase tracking-widest block mb-1.5">Customer Email</label>
                <input
                  className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-white/30"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="customer@email.com"
                />
              </div>
              <div className="bg-white/[0.03] border border-white/8 rounded-xl p-4 space-y-2">
                <p className="text-white/30 text-[10px] uppercase tracking-widest">Subject</p>
                <p className="text-white/70 text-xs">{emailSubject}</p>
                <p className="text-white/30 text-[10px] uppercase tracking-widest mt-3">Body Preview</p>
                <p className="text-white/60 text-xs leading-relaxed whitespace-pre-wrap">{emailBodyPreview}</p>
              </div>
              <button
                onClick={() => handleSend('email')}
                disabled={loading || !email.trim()}
                className="w-full py-3 bg-[#2969B0] hover:bg-blue-700 disabled:opacity-50 text-white font-condensed font-bold text-sm rounded-xl transition-colors"
              >
                {loading ? 'Sending…' : 'Send Email'}
              </button>
            </div>
          )}

          {/* Copy Link tab */}
          {tab === 'link' && (
            <div className="space-y-4">
              <div>
                <p className="text-white/40 text-xs uppercase tracking-widest mb-2">Public Invoice URL</p>
                <div className="flex items-center gap-2 bg-white/[0.03] border border-white/8 rounded-xl px-4 py-3">
                  <p className="flex-1 text-white/60 text-xs font-mono break-all">{invoiceUrl}</p>
                </div>
              </div>
              <button
                onClick={copyLink}
                className={`w-full py-3 font-condensed font-bold text-sm rounded-xl transition-colors ${
                  copied
                    ? 'bg-success/20 border border-success/30 text-success'
                    : 'bg-white/10 hover:bg-white/15 text-white'
                }`}
              >
                {copied ? '✓ Copied!' : 'Copy to Clipboard'}
              </button>
              <p className="text-white/30 text-xs text-center">
                Share this link directly with your customer via any channel.
                The link stays consistent even after resending.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function FinalizedInvoiceClient({
  invoice: initialInvoice,
  bizName,
  techName,
}: {
  invoice: Invoice
  bizName: string
  techName: string
}) {
  const router = useRouter()
  const [invoice,           setInvoice]          = useState(initialInvoice)
  const [paymentInstr,      setPaymentInstr]      = useState(initialInvoice.payment_instructions ?? '')
  const [savingInstr,       setSavingInstr]       = useState(false)
  const [showFinalizeModal, setShowFinalizeModal] = useState(false)
  const [finalizing,        setFinalizing]        = useState(false)
  const [showSendModal,     setShowSendModal]      = useState(false)
  const [showPaidModal,     setShowPaidModal]      = useState(false)
  const [markingPaid,       setMarkingPaid]        = useState(false)
  const [toast,             setToast]             = useState<{ msg: string; type: 'success' | 'error' | 'warning' } | null>(null)
  const [estimateOpen,      setEstimateOpen]      = useState(false)

  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string, type: 'success' | 'error' | 'warning' = 'success') {
    if (toastRef.current) clearTimeout(toastRef.current)
    setToast({ msg, type })
    toastRef.current = setTimeout(() => setToast(null), 4000)
  }

  const sq        = invoice.source_quote
  const vehicle   = invoice.vehicle
  const customer  = invoice.customer
  const markupPct = sq?.parts_markup_percent ?? 0
  const taxRate   = invoice.tax_rate

  const invoiceUrl = invoice.public_token
    ? `${APP_URL}/invoice/${invoice.public_token}`
    : ''

  // Totals (read-only, from saved values)
  const shopSuppliesTotal    = (Array.isArray(invoice.shop_supplies)    ? invoice.shop_supplies    : []).reduce((s: number, i: { total: number }) => s + i.total, 0)
  const additionalPartsTotal = (Array.isArray(invoice.additional_parts) ? invoice.additional_parts : []).reduce((s: number, i: { total: number }) => s + i.total, 0)
  const additionalLaborTotal = (Array.isArray(invoice.additional_labor) ? invoice.additional_labor : []).reduce((s: number, i: { subtotal: number }) => s + i.subtotal, 0)

  const quotedPartsSubtotal = sq
    ? round2(Number(sq.parts_subtotal ?? 0) * (1 + markupPct / 100))
    : 0
  const quotedLaborSubtotal = Number(sq?.labor_subtotal ?? 0)
  const grandTotal          = invoice.total

  const vehicleLabel = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
    : '—'

  const isInProgress      = invoice.invoice_status === 'in_progress'
  const isAwaitingPayment = invoice.invoice_status === 'awaiting_payment'
  const isPaid            = invoice.invoice_status === 'paid'
  const isFinalized       = isAwaitingPayment || isPaid

  // ── Timeline ──────────────────────────────────────────────────────────────

  const timelineEvents: TimelineEvent[] = [
    {
      label: sq ? `Source quote ${sq.quote_number} approved` : 'Invoice created',
      date:  invoice.started_at ?? invoice.invoice_date,
      icon:  sq ? '📄' : '🧾',
    },
    ...(Array.isArray(invoice.shop_supplies) && invoice.shop_supplies.length > 0
      ? [{ label: 'Shop supplies added', date: invoice.started_at ?? invoice.invoice_date, icon: '🔧' }]
      : []),
    ...(Array.isArray(invoice.additional_parts) && invoice.additional_parts.length > 0
      ? [{ label: 'Additional parts added', date: invoice.started_at ?? invoice.invoice_date, icon: '⚙️' }]
      : []),
    ...(Array.isArray(invoice.additional_labor) && invoice.additional_labor.length > 0
      ? [{ label: 'Additional labor added', date: invoice.started_at ?? invoice.invoice_date, icon: '⏱️' }]
      : []),
    ...(invoice.job_notes
      ? [{ label: 'Job notes recorded', date: invoice.started_at ?? invoice.invoice_date, icon: '📝' }]
      : []),
    {
      label:     'Invoice finalized',
      date:      invoice.finalized_at ?? null,
      icon:      '✅',
      highlight: true,
    },
    {
      label: 'Sent to customer',
      date:  invoice.sent_to_customer_at ?? null,
      icon:  '📤',
    },
    {
      label:     'Viewed by customer',
      date:      invoice.customer_viewed_at ?? null,
      icon:      '👀',
      highlight: !!invoice.customer_viewed_at,
    },
    {
      label:     invoice.payment_method
        ? `Payment received via ${PAYMENT_METHOD_LABELS[invoice.payment_method] ?? invoice.payment_method}`
        : 'Payment received',
      date:      invoice.paid_at ?? null,
      icon:      '💰',
      highlight: !!invoice.paid_at,
    },
  ]

  // ── Finalize ──────────────────────────────────────────────────────────────

  async function handleFinalize() {
    setFinalizing(true)
    try {
      const res  = await fetch(`/api/invoices/${invoice.id}/finalize`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Finalize failed')
      setInvoice(json.invoice)
      setPaymentInstr(json.invoice.payment_instructions ?? '')
      setShowFinalizeModal(false)
      showToast('Invoice finalized. Ready to send to customer.')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Finalize failed', 'error')
      setShowFinalizeModal(false)
    } finally {
      setFinalizing(false)
    }
  }

  // ── Mark as Paid ──────────────────────────────────────────────────────────

  async function handleMarkAsPaid(method: string, reference: string, notes: string) {
    setMarkingPaid(true)
    try {
      const res  = await fetch(`/api/invoices/${invoice.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          status:            'paid',
          payment_method:    method,
          payment_reference: reference || null,
          payment_notes:     notes     || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to mark as paid')
      setInvoice(json.invoice)
      setShowPaidModal(false)
      showToast('Invoice marked as paid.')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to mark as paid', 'error')
      setShowPaidModal(false)
    } finally {
      setMarkingPaid(false)
    }
  }

  // ── Save payment instructions ─────────────────────────────────────────────

  const handleSaveInstructions = useCallback(async () => {
    setSavingInstr(true)
    try {
      const res  = await fetch(`/api/invoices/${invoice.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ payment_instructions: paymentInstr || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setInvoice(json.invoice)
      showToast('Payment instructions saved.')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed', 'error')
    } finally {
      setSavingInstr(false)
    }
  }, [invoice.id, paymentInstr])

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 pb-8">

      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
              {invoice.invoice_number}
            </h1>
            {isPaid && (
              <span
                className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                style={{ backgroundColor: '#16a34a', color: '#fff' }}
              >
                Paid
              </span>
            )}
            {isAwaitingPayment && (
              <span
                className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                style={{ backgroundColor: '#8b5cf6', color: '#fff' }}
              >
                Awaiting Payment
              </span>
            )}
            {isInProgress && (
              <span
                className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                style={{ backgroundColor: '#f59e0b', color: '#fff' }}
              >
                In Progress
              </span>
            )}
          </div>
          {isFinalized && invoice.finalized_at && (
            <p className="text-success text-sm mt-1 flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              Invoice Finalized on {fmtDate(invoice.finalized_at)}
            </p>
          )}
        </div>
        <button
          onClick={() => router.push('/financials?tab=invoices')}
          className="flex items-center gap-2 px-4 py-2 border border-white/15 hover:border-white/30 text-white/50 hover:text-white text-sm rounded-lg transition-colors"
        >
          ← Back to Invoices
        </button>
      </div>

      {/* Paid banner */}
      {isPaid && (
        <div className="flex items-start gap-3 px-4 py-4 rounded-xl border border-success/25 bg-success/8">
          <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-success" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-success font-semibold text-sm">Payment Received</p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
              {invoice.paid_at && (
                <span className="text-success/70 text-xs">
                  {fmtDate(invoice.paid_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
              {invoice.payment_method && (
                <span className="text-success/70 text-xs">
                  via {PAYMENT_METHOD_LABELS[invoice.payment_method] ?? invoice.payment_method}
                </span>
              )}
              {invoice.payment_reference && (
                <span className="text-success/50 text-xs font-mono">{invoice.payment_reference}</span>
              )}
            </div>
            {invoice.payment_notes && (
              <p className="text-success/50 text-xs mt-1">{invoice.payment_notes}</p>
            )}
          </div>
        </div>
      )}

      {/* Posted to Financials banner */}
      {isPaid && invoice.financials_posted && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/10 bg-white/[0.03]">
          <svg className="w-4 h-4 text-success/60 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z"/>
          </svg>
          <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
            <span className="text-success/70 text-sm font-medium">Posted to Financials</span>
            {invoice.financials_posted_at && (
              <span className="text-white/30 text-xs">
                {fmtDate(invoice.financials_posted_at, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Source quote banner */}
      {sq && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-orange/25 bg-orange/8">
          <svg className="w-4 h-4 text-orange/70 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
          </svg>
          <span className="text-orange/80 text-sm">
            Based on approved quote{' '}
            <button
              onClick={() => router.push(`/financials?tab=quotes&quote=${sq.id}`)}
              className="font-mono font-semibold text-orange hover:underline"
            >
              {sq.quote_number}
            </button>
          </span>
        </div>
      )}

      {/* Send/view status banner (when sent) */}
      {invoice.sent_to_customer_at && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-purple-500/25 bg-purple-500/8">
          <svg className="w-4 h-4 text-purple-400/70 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
          </svg>
          <div className="text-sm">
            <span className="text-purple-300">
              Sent to customer {invoice.times_sent > 1 ? `${invoice.times_sent}×` : ''} on {fmtDate(invoice.sent_to_customer_at)}
            </span>
            {invoice.customer_viewed_at ? (
              <span className="text-white/40 ml-2">· Viewed {fmtDate(invoice.customer_viewed_at)}</span>
            ) : (
              <span className="text-white/30 ml-2">· Not yet viewed</span>
            )}
          </div>
        </div>
      )}

      {/* Vehicle & Customer */}
      <Section label="Vehicle & Customer">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1">
            <p className="text-white/30 text-xs uppercase tracking-widest">Vehicle</p>
            <p className="text-white font-medium">{vehicleLabel}</p>
            {vehicle?.vin && <p className="text-white/40 text-xs font-mono">{vehicle.vin}</p>}
          </div>
          <div className="space-y-1">
            <p className="text-white/30 text-xs uppercase tracking-widest">Customer</p>
            {customer ? (
              <>
                <p className="text-white font-medium">{customer.first_name} {customer.last_name}</p>
                {customer.phone && <p className="text-white/50 text-sm">{customer.phone}</p>}
                {customer.email && <p className="text-white/50 text-sm">{customer.email}</p>}
              </>
            ) : (
              <p className="text-white/40">—</p>
            )}
          </div>
        </div>
        {invoice.job_category && (
          <div className="mt-4 pt-4 border-t border-white/8 space-y-1">
            <p className="text-white/30 text-xs uppercase tracking-widest">Job</p>
            <p className="text-white/70 text-sm">
              {[invoice.job_category, invoice.job_subtype].filter(Boolean).join(' / ')}
            </p>
          </div>
        )}
      </Section>

      {/* Original estimate (accordion) */}
      <div className="bg-[#222222] border border-white/8 rounded-2xl overflow-hidden">
        <button
          onClick={() => setEstimateOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3 border-b border-white/8 bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
        >
          <p className="text-white/50 text-xs font-semibold uppercase tracking-widest">Original Estimate</p>
          <div className="flex items-center gap-2">
            {sq?.grand_total != null && (
              <span className="text-white/60 text-sm font-mono">{fmt(Number(sq.grand_total))}</span>
            )}
            <svg className={`w-4 h-4 text-white/30 transition-transform ${estimateOpen ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </button>
        {estimateOpen && sq && (
          <div className="p-5 space-y-3">
            {Array.isArray(sq.jobs) && sq.jobs.length > 1 ? (
              <div className="space-y-2">
                {(sq.jobs as MultiJobEntry[]).map((j, ji) => {
                  const jobPartsRev = j.parts.reduce((s, p) => s + p.unit_price * p.qty, 0)
                  const jobLabor    = j.labor_hours * j.labor_rate
                  return (
                    <div key={ji} className="rounded-xl border border-white/8 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.02] border-b border-white/8">
                        <p className="text-white font-semibold text-sm">{j.subtype}</p>
                        <span className="text-orange font-bold text-sm">{fmt(jobPartsRev + jobLabor)}</span>
                      </div>
                      {j.parts.length > 0 && (
                        <table className="w-full text-sm">
                          <tbody>
                            {j.parts.map((p, pi) => (
                              <tr key={pi} className="border-b border-white/5">
                                <td className="px-4 py-2 text-white/70">{p.name}</td>
                                <td className="px-4 py-2 text-white/50 text-right">×{p.qty}</td>
                                <td className="px-4 py-2 text-white font-medium text-right">{fmt(p.unit_price * p.qty)}</td>
                              </tr>
                            ))}
                            <tr>
                              <td className="px-4 py-2 text-white/50" colSpan={2}>Labor ({j.labor_hours}h)</td>
                              <td className="px-4 py-2 text-white font-medium text-right">{fmt(jobLabor)}</td>
                            </tr>
                          </tbody>
                        </table>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : Array.isArray(sq.line_items) && sq.line_items.length > 0 && (
              <ReadOnlyTable
                rows={sq.line_items.map(li => ({
                  label:  li.description,
                  qty:    String(li.quantity),
                  amount: li.total,
                }))}
              />
            )}
            <div className="space-y-1.5 border-t border-white/8 pt-3">
              {quotedPartsSubtotal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Parts{markupPct > 0 ? ` (incl. ${markupPct}% markup)` : ''}</span>
                  <span className="text-white">{fmt(quotedPartsSubtotal)}</span>
                </div>
              )}
              {quotedLaborSubtotal > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-white/50">Labor</span>
                  <span className="text-white">{fmt(quotedLaborSubtotal)}</span>
                </div>
              )}
              <div className="flex justify-between items-baseline border-t border-white/8 pt-2 mt-1">
                <span className="text-white font-medium">Estimate Total</span>
                <span className="font-condensed font-bold text-orange text-xl">{fmt(Number(sq.grand_total ?? 0))}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Job notes (read-only) */}
      {invoice.job_notes && (
        <Section label="Job Notes">
          <p className="text-white/70 text-sm whitespace-pre-wrap font-mono leading-relaxed">
            {invoice.job_notes}
          </p>
        </Section>
      )}

      {/* Shop supplies (read-only) */}
      {Array.isArray(invoice.shop_supplies) && invoice.shop_supplies.length > 0 && (
        <Section label="Shop Supplies">
          <ReadOnlyTable
            rows={(invoice.shop_supplies as Array<{ id: string; name: string; qty: number; unit_cost: number; total: number }>).map(s => ({
              label:  s.name,
              qty:    `${s.qty}×`,
              amount: s.total,
            }))}
          />
          <div className="flex justify-end pt-3 border-t border-white/8 mt-3">
            <div className="flex gap-6 text-sm">
              <span className="text-white/40">Subtotal</span>
              <span className="text-white w-20 text-right">{fmt(shopSuppliesTotal)}</span>
            </div>
          </div>
        </Section>
      )}

      {/* Additional parts (read-only) */}
      {Array.isArray(invoice.additional_parts) && invoice.additional_parts.length > 0 && (
        <Section label={`Additional Parts${markupPct > 0 ? ` (${markupPct}% markup applied)` : ''}`}>
          <ReadOnlyTable
            rows={(invoice.additional_parts as Array<{ id: string; description: string; qty: number; unit_cost: number; total: number }>).map(p => ({
              label:  p.description,
              qty:    `${p.qty}×`,
              amount: p.total,
            }))}
          />
          <div className="flex justify-end pt-3 border-t border-white/8 mt-3">
            <div className="flex gap-6 text-sm">
              <span className="text-white/40">Subtotal</span>
              <span className="text-white w-20 text-right">{fmt(additionalPartsTotal)}</span>
            </div>
          </div>
        </Section>
      )}

      {/* Additional labor (read-only) */}
      {Array.isArray(invoice.additional_labor) && invoice.additional_labor.length > 0 && (
        <Section label="Additional Labor">
          <ReadOnlyTable
            rows={(invoice.additional_labor as Array<{ id: string; description: string; hours: number; rate: number; subtotal: number }>).map(l => ({
              label:  l.description,
              qty:    `${l.hours}h`,
              amount: l.subtotal,
            }))}
          />
          <div className="flex justify-end pt-3 border-t border-white/8 mt-3">
            <div className="flex gap-6 text-sm">
              <span className="text-white/40">Subtotal</span>
              <span className="text-white w-20 text-right">{fmt(additionalLaborTotal)}</span>
            </div>
          </div>
        </Section>
      )}

      {/* Grand total summary */}
      <div className="bg-[#222222] border border-white/8 rounded-2xl p-5">
        <p className="text-white/50 text-xs font-semibold uppercase tracking-widest mb-4">Invoice Total</p>
        <div className="space-y-2">
          {quotedPartsSubtotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Quoted Parts</span>
              <span className="text-white">{fmt(quotedPartsSubtotal)}</span>
            </div>
          )}
          {additionalPartsTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Additional Parts</span>
              <span className="text-white">{fmt(additionalPartsTotal)}</span>
            </div>
          )}
          {shopSuppliesTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Shop Supplies</span>
              <span className="text-white">{fmt(shopSuppliesTotal)}</span>
            </div>
          )}
          {quotedLaborSubtotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Quoted Labor</span>
              <span className="text-white">{fmt(quotedLaborSubtotal)}</span>
            </div>
          )}
          {additionalLaborTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Additional Labor</span>
              <span className="text-white">{fmt(additionalLaborTotal)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm border-t border-white/8 pt-2">
            <span className="text-white/50">Subtotal</span>
            <span className="text-white">{fmt(invoice.subtotal)}</span>
          </div>
          {invoice.tax_amount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/40">Tax ({Math.round(taxRate * 10000) / 100}%)</span>
              <span className="text-white/60">{fmt(invoice.tax_amount)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline border-t border-white/8 pt-3 mt-1">
            <span className="font-condensed font-bold text-white text-lg tracking-wide">GRAND TOTAL</span>
            <span className="font-condensed font-bold text-orange text-4xl">{fmt(grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* Per-Job P&L — shown only after financials are posted */}
      {isPaid && invoice.financials_posted && (() => {
        const pnl = calcJobPnL(invoice)
        return (
          <div className="bg-[#1a1f1a] border border-success/20 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-success/15 bg-success/[0.04]">
              <p className="text-success/70 text-xs font-semibold uppercase tracking-widest">Per-Job P&L</p>
            </div>
            <div className="p-5 space-y-3">

              {/* Revenue breakdown */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-baseline text-sm">
                  <span className="text-white/70 font-medium">Revenue Collected</span>
                  <span className="text-white font-semibold">{fmt(pnl.grandTotal)}</span>
                </div>
                {pnl.partsRevenue > 0 && (
                  <div className="flex justify-between text-xs pl-4">
                    <span className="text-white/40">Parts Revenue</span>
                    <span className="text-white/60">{fmt(pnl.partsRevenue)}</span>
                  </div>
                )}
                {pnl.laborIncome > 0 && (
                  <div className="flex justify-between text-xs pl-4">
                    <span className="text-white/40">Labor Income</span>
                    <span className="text-white/60">{fmt(pnl.laborIncome)}</span>
                  </div>
                )}
                {pnl.shopSuppliesTotal > 0 && (
                  <div className="flex justify-between text-xs pl-4">
                    <span className="text-white/40">Shop Supplies Charged</span>
                    <span className="text-white/60">{fmt(pnl.shopSuppliesTotal)}</span>
                  </div>
                )}
                {pnl.taxAmount > 0 && (
                  <div className="flex justify-between text-xs pl-4">
                    <span className="text-white/40">Tax Collected</span>
                    <span className="text-white/60">{fmt(pnl.taxAmount)}</span>
                  </div>
                )}
              </div>

              {/* COGS */}
              {pnl.cogsTotal > 0 && (
                <div className="space-y-1.5 border-t border-white/8 pt-3">
                  <div className="flex justify-between items-baseline text-sm">
                    <span className="text-white/70 font-medium">Cost of Goods Sold</span>
                    <span className="text-danger">−{fmt(pnl.cogsTotal)}</span>
                  </div>
                  {pnl.totalPartsCost > 0 && (
                    <div className="flex justify-between text-xs pl-4">
                      <span className="text-white/40">Parts Cost</span>
                      <span className="text-danger/70">−{fmt(pnl.totalPartsCost)}</span>
                    </div>
                  )}
                  {pnl.shopSuppliesCost > 0 && (
                    <div className="flex justify-between text-xs pl-4">
                      <span className="text-white/40">Shop Supplies Cost</span>
                      <span className="text-danger/70">−{fmt(pnl.shopSuppliesCost)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Tax remitted */}
              {pnl.taxAmount > 0 && (
                <div className="flex justify-between text-sm border-t border-white/8 pt-3">
                  <span className="text-white/50">Tax Remitted</span>
                  <span className="text-white/40">−{fmt(pnl.taxAmount)}</span>
                </div>
              )}

              {/* Per-job breakdown (multi-job only) */}
              {Array.isArray(invoice.jobs) && invoice.jobs.length > 1 && (
                <div className="space-y-2 border-t border-white/8 pt-3">
                  <p className="text-white/30 text-[10px] uppercase tracking-widest">By Service</p>
                  {(invoice.jobs as MultiJobEntry[]).map((j, i) => (
                    <JobBreakdownRow key={j.id ?? i} j={j} idx={i} />
                  ))}
                </div>
              )}

              {/* Net Profit */}
              <div className="flex justify-between items-baseline border-t border-success/20 pt-3 mt-1">
                <div>
                  <span className="font-condensed font-bold text-white text-lg tracking-wide">NET PROFIT</span>
                  <span className="text-white/30 text-xs ml-2">{pnl.netMargin}% margin</span>
                </div>
                <span
                  className="font-condensed font-bold text-4xl"
                  style={{ color: pnl.netProfit >= 0 ? '#10b981' : '#ef4444' }}
                >
                  {fmt(pnl.netProfit)}
                </span>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Payment Instructions */}
      <div className="bg-[#222222] border border-white/8 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/8 bg-white/[0.02]">
          <p className="text-white/50 text-xs font-semibold uppercase tracking-widest">Payment Instructions</p>
          <span className="text-white/25 text-xs">Shown to customer</span>
        </div>
        <div className="p-5 space-y-3">
          {isPaid ? (
            <p className="text-white/60 text-sm whitespace-pre-wrap leading-relaxed">
              {invoice.payment_instructions || <span className="text-white/25 italic">No payment instructions provided.</span>}
            </p>
          ) : (
            <>
              <textarea
                rows={5}
                className="nwi-input resize-y text-sm w-full"
                placeholder="Enter payment methods and instructions for your customer. Example: 'Payment accepted via Venmo (@username), Zelle (phone), Cash App ($cashtag), or cash on delivery. Please pay within 7 days of receiving this invoice.'"
                value={paymentInstr}
                onChange={e => setPaymentInstr(e.target.value)}
              />
              <button
                onClick={handleSaveInstructions}
                disabled={savingInstr || paymentInstr === (invoice.payment_instructions ?? '')}
                className="px-4 py-2 bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {savingInstr ? 'Saving…' : 'Save Instructions'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Action buttons */}
      {isInProgress && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowFinalizeModal(true)}
            className="flex items-center gap-2 px-6 py-3 bg-[#FF6600] hover:bg-orange-600 text-white font-condensed font-bold text-sm tracking-wide rounded-xl transition-colors shadow-md shadow-orange/20"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            Finalize Invoice
          </button>
          <button
            onClick={() => router.push('/financials?tab=invoices')}
            className="px-5 py-3 border border-white/15 hover:border-white/30 text-white/50 hover:text-white text-sm font-medium rounded-xl transition-colors"
          >
            Back to Invoices
          </button>
        </div>
      )}

      {isAwaitingPayment && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowPaidModal(true)}
            className="flex items-center gap-2 px-6 py-3 bg-success hover:bg-green-600 text-white font-condensed font-bold text-sm tracking-wide rounded-xl transition-colors shadow-md shadow-success/20"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            Mark as Paid
          </button>
          <button
            onClick={() => setShowSendModal(true)}
            className="flex items-center gap-2 px-6 py-3 border border-white/20 hover:border-white/35 text-white/70 hover:text-white font-condensed font-bold text-sm tracking-wide rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
            </svg>
            {invoice.times_sent > 0 ? 'Resend Invoice' : 'Send Invoice'}
          </button>
          <button
            onClick={() => router.push('/financials?tab=invoices')}
            className="px-5 py-3 border border-white/15 hover:border-white/30 text-white/50 hover:text-white text-sm font-medium rounded-xl transition-colors"
          >
            Back to Invoices
          </button>
        </div>
      )}

      {isPaid && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowSendModal(true)}
            className="flex items-center gap-2 px-6 py-3 border border-white/20 hover:border-white/35 text-white/70 hover:text-white font-condensed font-bold text-sm tracking-wide rounded-xl transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
            </svg>
            Resend as Receipt
          </button>
          <button
            onClick={() => router.push('/financials?tab=invoices')}
            className="px-5 py-3 border border-white/15 hover:border-white/30 text-white/50 hover:text-white text-sm font-medium rounded-xl transition-colors"
          >
            Back to Invoices
          </button>
        </div>
      )}

      {/* Timeline */}
      <Timeline events={timelineEvents} />

      {/* Modals */}
      {showFinalizeModal && (
        <FinalizeConfirmModal
          grandTotal={grandTotal}
          onConfirm={handleFinalize}
          onCancel={() => setShowFinalizeModal(false)}
          loading={finalizing}
        />
      )}

      {showPaidModal && (
        <MarkAsPaidModal
          grandTotal={grandTotal}
          onConfirm={handleMarkAsPaid}
          onCancel={() => setShowPaidModal(false)}
          loading={markingPaid}
        />
      )}

      {showSendModal && (
        <SendInvoiceModal
          invoice={invoice}
          invoiceUrl={invoiceUrl}
          bizName={bizName}
          techName={techName}
          onSent={updated => { setInvoice(updated); showToast('Invoice sent!') }}
          onClose={() => setShowSendModal(false)}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}
