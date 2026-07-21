'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const ORANGE = '#16a34a'
const BLUE   = '#15803d'

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

      const body = {
        quote_id:          quote.id,
        customer_name:     quote.customer_name,
        customer_phone:    quote.customer_phone,
        customer_email:    quote.customer_email,
        unit_manufacturer: quote.unit_manufacturer,
        unit_model:        quote.unit_model,
        unit_serial:       quote.unit_serial,
        unit_year:         quote.unit_year,
        truck_make:        quote.truck_make,
        truck_model:       quote.truck_model,
        truck_year:        quote.truck_year,
        vin:               quote.vin,
        complaint:         quote.complaint,
        diagnosis:         quote.diagnosis,
        line_items:        quote.line_items,
        labor_rate:        quote.labor_rate,
        subtotal_labor:    quote.subtotal_labor,
        subtotal_parts:    quote.subtotal_parts,
        diagnostic_fee:    quote.diagnostic_fee,
        road_call_fee:     quote.road_call_fee,
        tax_rate:          quote.tax_rate,
        tax_amount:        quote.tax_amount,
        total:             quote.total,
        notes:             quote.notes,
        status:            'unpaid',
      }

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
