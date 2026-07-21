'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const ORANGE = '#16a34a'

export default function InvoiceListActions({
  invoiceId,
  invoiceNumber,
  currentStatus,
}: {
  invoiceId: string
  invoiceNumber: string
  currentStatus: string
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
    if (!confirm(`Delete invoice ${invoiceNumber}? This cannot be undone.`)) return
    setBusy(true)
    try {
      await fetch(`/api/hd/invoices/${invoiceId}`, { method: 'DELETE' })
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
          style={{ background: '#DCFCE7', color: '#16a34a', minHeight: 32 }}
        >
          Mark Paid
        </button>
      )}
      <Link
        href={`/api/hd/invoices/${invoiceId}/pdf`}
        target="_blank"
        className="text-xs font-medium px-2.5 py-1.5 rounded-lg"
        style={{ background: '#EBF5FF', color: '#15803d', minHeight: 32, lineHeight: '1.8' }}
      >
        PDF
      </Link>
      <button
        onClick={deleteInvoice}
        disabled={busy}
        className="text-xs font-medium px-2.5 py-1.5 rounded-lg disabled:opacity-50"
        style={{ background: '#FEE2E2', color: '#dc2626', minHeight: 32 }}
      >
        Delete
      </button>
    </div>
  )
}
