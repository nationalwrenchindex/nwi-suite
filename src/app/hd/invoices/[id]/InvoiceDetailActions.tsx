'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const ORANGE = '#FF6600'
const BLUE   = '#2969B0'

export default function InvoiceDetailActions({
  invoiceId,
  invoiceNumber,
  currentStatus,
  customerPhone,
  pmChecklistId = null,
  dotInspectionId = null,
}: {
  invoiceId: string
  invoiceNumber: string
  currentStatus: string
  customerPhone: string | null
  pmChecklistId?: string | null
  dotInspectionId?: string | null
}) {
  const router = useRouter()
  const [busy, setBusy]   = useState(false)
  const [toast, setToast] = useState('')

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

  function sendSMS() {
    if (!customerPhone) {
      showToast('No customer phone number on this invoice.')
      return
    }
    // Build the message: invoice link + any attached report links, for manual SMS.
    const origin = window.location.origin
    const lines = [`Invoice ${invoiceNumber}: ${origin}/hd/invoices/${invoiceId}`]
    if (pmChecklistId) {
      lines.push(`Your invoice includes a PM checklist report. View it here: ${origin}/hd/pm-checklist/${pmChecklistId}`)
    }
    if (dotInspectionId) {
      lines.push(`Your invoice includes a DOT inspection report. View it here: ${origin}/hd/dot-inspections/${dotInspectionId}`)
    }
    const message = lines.join('\n\n')
    navigator.clipboard.writeText(message).then(() => {
      showToast(`Message${lines.length > 1 ? ' (with report links)' : ''} copied. Text to: ${customerPhone}`)
    }).catch(() => {
      showToast(message)
    })
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {toast && (
        <span className="text-xs px-3 py-1.5 rounded-lg" style={{ background: '#1A1A1A', color: '#fff' }}>
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
        onClick={sendSMS}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg font-semibold text-sm"
        style={{ background: '#F3F4F6', color: '#374151', border: '1px solid #E5E7EB', minHeight: 44 }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.69 12 19.79 19.79 0 011.61 3.44 2 2 0 013.6 1.27h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.91 8.91a16 16 0 006 6l.92-.92a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
        </svg>
        Send SMS
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
  )
}
