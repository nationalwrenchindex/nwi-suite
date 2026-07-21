'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const ORANGE = '#16a34a'
const BLUE   = '#15803d'

interface QuoteData {
  id: string
  customer_name: string
  customer_phone: string | null
  customer_email: string | null
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
  total: number
  notes: string | null
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

  async function convertToInvoice() {
    setBusy(true)
    try {
      const body = {
        quote_id:          quoteData.id,
        customer_name:     quoteData.customer_name,
        customer_phone:    quoteData.customer_phone,
        customer_email:    quoteData.customer_email,
        unit_manufacturer: quoteData.unit_manufacturer,
        unit_model:        quoteData.unit_model,
        unit_serial:       quoteData.unit_serial,
        unit_year:         quoteData.unit_year,
        truck_make:        quoteData.truck_make,
        truck_model:       quoteData.truck_model,
        truck_year:        quoteData.truck_year,
        vin:               quoteData.vin,
        complaint:         quoteData.complaint,
        diagnosis:         quoteData.diagnosis,
        line_items:        quoteData.line_items,
        labor_rate:        quoteData.labor_rate,
        subtotal_labor:    quoteData.subtotal_labor,
        subtotal_parts:    quoteData.subtotal_parts,
        diagnostic_fee:    quoteData.diagnostic_fee,
        road_call_fee:     quoteData.road_call_fee,
        tax_rate:          quoteData.tax_rate,
        tax_amount:        quoteData.tax_amount,
        total:             quoteData.total,
        notes:             quoteData.notes,
        status:            'unpaid',
      }
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
      <button
        onClick={convertToInvoice}
        disabled={busy}
        className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm text-white disabled:opacity-50"
        style={{ background: BLUE, minHeight: 44 }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        Convert to Invoice
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
