'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { invoiceBodyFromQuote } from '@/lib/hd/quote-to-invoice'

const ORANGE = '#FF6600'
const BLUE   = '#2969B0'

export default function QuoteListActions({
  quoteId,
  quoteNumber,
}: {
  quoteId: string
  quoteNumber: string
}) {
  const router  = useRouter()
  const [busy, setBusy] = useState(false)

  async function convertToInvoice() {
    setBusy(true)
    try {
      const qRes  = await fetch(`/api/hd/quotes/${quoteId}`)
      const { quote } = await qRes.json()
      if (!quote) return

      // The same body the quote detail screen sends - see invoiceBodyFromQuote.
      const body = invoiceBodyFromQuote(quote)

      const iRes   = await fetch('/api/hd/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const { invoice } = await iRes.json()
      if (invoice?.id) router.push(`/hd/invoices/${invoice.id}`)
    } finally {
      setBusy(false)
    }
  }

  async function deleteQuote() {
    if (!confirm(`Delete quote ${quoteNumber}? This cannot be undone.`)) return
    setBusy(true)
    try {
      await fetch(`/api/hd/quotes/${quoteId}`, { method: 'DELETE' })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/hd/quotes/${quoteId}`}
        className="text-xs font-medium px-2.5 py-1.5 rounded-lg"
        style={{ background: '#F3F4F6', color: '#374151', minHeight: 32 }}
      >
        View
      </Link>
      <button
        onClick={convertToInvoice}
        disabled={busy}
        className="text-xs font-medium px-2.5 py-1.5 rounded-lg text-white disabled:opacity-50"
        style={{ background: BLUE, minHeight: 32 }}
      >
        Invoice
      </button>
      <button
        onClick={deleteQuote}
        disabled={busy}
        className="text-xs font-medium px-2.5 py-1.5 rounded-lg disabled:opacity-50"
        style={{ background: '#FEE2E2', color: '#dc2626', minHeight: 32 }}
      >
        Delete
      </button>
    </div>
  )
}
