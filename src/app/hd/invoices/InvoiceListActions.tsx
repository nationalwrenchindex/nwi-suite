'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const ORANGE = '#FF6600'

export default function InvoiceListActions({
  invoiceId,
  invoiceNumber,
  currentStatus,
  deletable = false,
}: {
  invoiceId: string
  invoiceNumber: string
  currentStatus: string
  /** A never-sent draft (isDeletableDraft). The route refuses any other. */
  deletable?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function markPaid() {
    setBusy(true)
    try {
      await fetch(`/api/hd/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid' }),
      })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function deleteInvoice() {
    if (!confirm(`Delete draft ${invoiceNumber}? It has never been sent. Any parts it took go back on the shelf. This cannot be undone.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/hd/invoices/${invoiceId}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        alert(j.error ?? 'The invoice was not deleted.')
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/hd/invoices/${invoiceId}`}
        className="text-xs font-medium px-2.5 py-1.5 rounded-lg"
        style={{ background: '#F3F4F6', color: '#374151', minHeight: 32, lineHeight: '1.8' }}
      >
        View
      </Link>
      {currentStatus === 'unpaid' && (
        <button
          onClick={markPaid}
          disabled={busy}
          className="text-xs font-medium px-2.5 py-1.5 rounded-lg disabled:opacity-50"
          style={{ background: '#DCFCE7', color: '#15803d', minHeight: 32 }}
        >
          Mark Paid
        </button>
      )}
      <Link
        href={`/api/hd/invoices/${invoiceId}/pdf`}
        target="_blank"
        className="text-xs font-medium px-2.5 py-1.5 rounded-lg"
        style={{ background: '#EBF5FF', color: '#2969B0', minHeight: 32, lineHeight: '1.8' }}
      >
        PDF
      </Link>
      {deletable && <button
        onClick={deleteInvoice}
        disabled={busy}
        data-delete-invoice="true"
        className="text-xs font-medium px-2.5 py-1.5 rounded-lg disabled:opacity-50"
        style={{ background: '#FEE2E2', color: '#b91c1c', minHeight: 32 }}
      >
        Delete
      </button>}
    </div>
  )
}
