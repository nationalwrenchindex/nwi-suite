// Public customer-facing quote page. No auth required.
// Fetches quote server-side via service client; interactive parts handled by client component.

import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import QuoteApprovalClient from './QuoteApprovalClient'
import type { Metadata } from 'next'

const QUOTE_SELECT = `
  id, quote_number, status, public_token,
  job_category, job_subtype, notes,
  line_items, labor_hours, labor_rate,
  parts_subtotal, parts_markup_percent, labor_subtotal,
  tax_percent, tax_amount, grand_total,
  view_count, viewed_at, times_sent,
  sent_at, approved_at, declined_at, quote_expires_at,
  customer_response_note,
  customer:customers(id, first_name, last_name, phone),
  vehicle:vehicles(id, year, make, model, vin),
  user_id
`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuote = Record<string, any>

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const { token } = await params
  const sc = createServiceClient()
  const { data } = await sc.from('quotes').select('quote_number').eq('public_token', token).single()
  const num = data?.quote_number ?? 'Quote'
  return { title: `${num} — National Wrench Index` }
}

export default async function PublicQuotePage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const sc = createServiceClient()

  const { data: quote, error } = await sc
    .from('quotes')
    .select(QUOTE_SELECT)
    .eq('public_token', token)
    .single()

  if (error || !quote) notFound()

  const { data: profile } = await sc
    .from('profiles')
    .select('full_name, business_name, phone, email')
    .eq('id', quote.user_id)
    .single()

  const p = profile as { full_name?: string; business_name?: string; phone?: string; email?: string } | null
  const bizName  = p?.business_name ?? 'Your Technician'
  const techName = p?.full_name     ?? 'Your Technician'
  const techPhone = p?.phone        ?? null

  const q = quote as AnyQuote

  const customerName = q.customer
    ? `${q.customer.first_name ?? ''} ${q.customer.last_name ?? ''}`.trim()
    : 'Valued Customer'

  const vehicleLabel = q.vehicle
    ? [q.vehicle.year, q.vehicle.make, q.vehicle.model].filter(Boolean).join(' ')
    : null

  const fmt = (n: number | null | undefined) =>
    n == null ? '$0.00' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

  const lineItems: Array<{ description: string; quantity: number; unit_price: number; total: number }> =
    Array.isArray(q.line_items) ? q.line_items : []

  const partsItems  = lineItems.filter(li => !/^labor/i.test(li.description?.trim() ?? ''))
  const laborItems  = lineItems.filter(li => /^labor/i.test(li.description?.trim() ?? ''))

  const isExpired   = q.status === 'expired' || (
    q.status === 'sent' && q.quote_expires_at && new Date(q.quote_expires_at) < new Date()
  )

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white">

      {/* Header */}
      <div className="bg-[#1a1a1a] border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-[#FF6600] flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
              </svg>
            </div>
            <span className="font-bold text-sm text-white/80 tracking-wide">National Wrench Index</span>
          </div>
          <div className="h-4 w-px bg-white/15" />
          <p className="text-white/50 text-sm">Quote from {bizName}</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* Quote number + greeting */}
        <div className="space-y-1">
          <p className="text-[#FF6600] font-mono text-sm font-semibold">{q.quote_number}</p>
          <h1 className="font-bold text-2xl text-white tracking-tight">Hello, {customerName}</h1>
          <p className="text-white/50 text-sm">{bizName} has sent you a service quote.</p>
        </div>

        {/* Vehicle */}
        {vehicleLabel && (
          <div className="bg-white/5 rounded-xl px-4 py-3 space-y-0.5">
            <p className="text-white/40 text-xs uppercase tracking-widest">Vehicle</p>
            <p className="text-white font-medium">{vehicleLabel}</p>
            {q.vehicle?.vin && (
              <p className="text-white/30 text-xs font-mono">VIN: {q.vehicle.vin}</p>
            )}
          </div>
        )}

        {/* Job */}
        {(q.job_category || q.job_subtype) && (
          <div className="bg-white/5 rounded-xl px-4 py-3 space-y-0.5">
            <p className="text-white/40 text-xs uppercase tracking-widest">Service</p>
            <p className="text-white font-medium">
              {[q.job_category, q.job_subtype].filter(Boolean).join(' — ')}
            </p>
          </div>
        )}

        {/* Line items */}
        {lineItems.length > 0 && (
          <div className="bg-white/5 rounded-xl overflow-hidden">
            <p className="text-white/40 text-xs uppercase tracking-widest px-4 pt-4 pb-2">
              What&apos;s Included
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-4 py-2 text-white/40 font-medium">Description</th>
                  <th className="text-right px-4 py-2 text-white/40 font-medium">Qty</th>
                  <th className="text-right px-4 py-2 text-white/40 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {partsItems.map((li, i) => (
                  <tr key={i} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2.5 text-white/80">{li.description}</td>
                    <td className="px-4 py-2.5 text-white/50 text-right">{li.quantity}</td>
                    <td className="px-4 py-2.5 text-white text-right font-medium">{fmt(li.total)}</td>
                  </tr>
                ))}
                {laborItems.map((li, i) => (
                  <tr key={`labor-${i}`} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2.5 text-white/80">{li.description}</td>
                    <td className="px-4 py-2.5 text-white/50 text-right">{li.quantity}h</td>
                    <td className="px-4 py-2.5 text-white text-right font-medium">{fmt(li.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pricing summary */}
        <div className="bg-white/5 rounded-xl p-4 space-y-2">
          {q.parts_subtotal != null && q.parts_subtotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/60">Parts</span>
              <span className="text-white">
                {fmt(q.parts_subtotal * (1 + (q.parts_markup_percent ?? 0) / 100))}
              </span>
            </div>
          )}
          {q.labor_subtotal != null && q.labor_subtotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-white/60">
                Labor{q.labor_hours && q.labor_rate
                  ? ` (${q.labor_hours}h)`
                  : ''}
              </span>
              <span className="text-white">{fmt(q.labor_subtotal)}</span>
            </div>
          )}
          {q.tax_amount != null && q.tax_amount > 0 && (
            <div className="flex justify-between text-sm border-t border-white/10 pt-2">
              <span className="text-white/50">
                Tax{q.tax_percent ? ` (${q.tax_percent}%)` : ''}
              </span>
              <span className="text-white/70">{fmt(q.tax_amount)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline border-t border-white/15 pt-3 mt-1">
            <span className="text-white font-bold text-base uppercase tracking-wide">Grand Total</span>
            <span className="text-[#FF6600] font-bold text-3xl">{fmt(q.grand_total)}</span>
          </div>
        </div>

        {/* Tech notes */}
        {q.notes && (
          <div className="bg-white/5 rounded-xl px-4 py-3 space-y-1">
            <p className="text-white/40 text-xs uppercase tracking-widest">Notes from {techName}</p>
            <p className="text-white/70 text-sm whitespace-pre-wrap">{q.notes}</p>
          </div>
        )}

        {/* Interactive section: approve/decline or status banners */}
        <QuoteApprovalClient
          token={token}
          initialStatus={q.status}
          grandTotal={q.grand_total}
          quoteNumber={q.quote_number}
          bizName={bizName}
          isExpired={isExpired}
        />

        {/* Contact footer */}
        {techPhone && (
          <p className="text-center text-white/30 text-xs pt-2">
            Questions? Contact {bizName} at{' '}
            <a href={`tel:${techPhone}`} className="text-white/50 hover:text-white underline">
              {techPhone}
            </a>
          </p>
        )}

        <p className="text-center text-white/15 text-xs pb-4">
          Powered by National Wrench Index
        </p>

      </div>
    </div>
  )
}
