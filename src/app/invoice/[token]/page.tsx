// Public customer-facing invoice page. No auth required.
// Fetches invoice server-side via service client; view tracking via client component.

import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import InvoiceViewClient from './InvoiceViewClient'
import type { Metadata } from 'next'

const INVOICE_SELECT = `
  id, invoice_number, invoice_status, public_token,
  invoice_date, total, subtotal, tax_rate, tax_amount,
  job_category, job_subtype, job_notes,
  line_items, shop_supplies, additional_parts, additional_labor,
  payment_instructions, finalized_at,
  customer_view_count, customer_viewed_at, times_sent,
  sent_to_customer_at, paid_at,
  customer:customers(id, first_name, last_name, phone),
  vehicle:vehicles(id, year, make, model, vin),
  source_quote:quotes!invoices_source_quote_id_fkey(id, quote_number, parts_subtotal, parts_markup_percent, labor_subtotal, labor_hours, labor_rate),
  user_id
`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInvoice = Record<string, any>

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const { token } = await params
  const sc = createServiceClient()
  const { data } = await sc.from('invoices').select('invoice_number').eq('public_token', token).single()
  const num = data?.invoice_number ?? 'Invoice'
  return { title: `${num} — National Wrench Index` }
}

const fmt = (n: number | null | undefined) =>
  n == null ? '$0.00' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

export default async function PublicInvoicePage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const sc = createServiceClient()

  const { data: invoice, error } = await sc
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('public_token', token)
    .single()

  if (error || !invoice) notFound()

  const { data: profile } = await sc
    .from('profiles')
    .select('full_name, business_name, phone, email')
    .eq('id', invoice.user_id)
    .single()

  const p = profile as { full_name?: string; business_name?: string; phone?: string } | null
  const bizName   = p?.business_name ?? 'Your Technician'
  const techPhone = p?.phone         ?? null

  const inv = invoice as AnyInvoice

  const customerName = inv.customer
    ? `${inv.customer.first_name ?? ''} ${inv.customer.last_name ?? ''}`.trim()
    : 'Valued Customer'

  const vehicleLabel = inv.vehicle
    ? [inv.vehicle.year, inv.vehicle.make, inv.vehicle.model].filter(Boolean).join(' ')
    : null

  const isPaid = inv.invoice_status === 'paid'

  // Line items from original quote
  const lineItems: Array<{ description: string; quantity: number; unit_price: number; total: number }> =
    Array.isArray(inv.line_items) ? inv.line_items : []

  // Additional items
  const shopSupplies:    Array<{ id: string; name: string; qty: number; unit_cost: number; total: number }> =
    Array.isArray(inv.shop_supplies)    ? inv.shop_supplies    : []
  const additionalParts: Array<{ id: string; description: string; qty: number; unit_cost: number; total: number }> =
    Array.isArray(inv.additional_parts) ? inv.additional_parts : []
  const additionalLabor: Array<{ id: string; description: string; hours: number; rate: number; subtotal: number }> =
    Array.isArray(inv.additional_labor) ? inv.additional_labor : []

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
          <p className="text-white/50 text-sm">Invoice from {bizName}</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

        {/* Paid banner */}
        {isPaid && inv.paid_at && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
              </svg>
            </div>
            <div>
              <p className="text-emerald-400 font-bold text-base">Paid in Full</p>
              <p className="text-emerald-400/60 text-xs">
                {new Date(inv.paid_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                . Thank you!
              </p>
            </div>
          </div>
        )}

        {/* Invoice number + status + greeting */}
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-[#FF6600] font-mono text-base font-semibold">{inv.invoice_number}</p>
            <span
              className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
              style={isPaid
                ? { backgroundColor: '#10b981', color: '#fff' }
                : { backgroundColor: '#8b5cf6', color: '#fff' }
              }
            >
              {isPaid ? 'Paid' : 'Awaiting Payment'}
            </span>
          </div>
          <h1 className="font-bold text-2xl text-white tracking-tight">Hello, {customerName}</h1>
          <p className="text-white/50 text-sm">{bizName} has sent you an invoice for completed service.</p>
        </div>

        {/* Vehicle */}
        {vehicleLabel && (
          <div className="bg-white/5 rounded-xl px-4 py-3 space-y-0.5">
            <p className="text-white/40 text-xs uppercase tracking-widest">Vehicle</p>
            <p className="text-white font-medium">{vehicleLabel}</p>
            {inv.vehicle?.vin && (
              <p className="text-white/30 text-xs font-mono">VIN: {inv.vehicle.vin}</p>
            )}
          </div>
        )}

        {/* Service */}
        {(inv.job_category || inv.job_subtype) && (
          <div className="bg-white/5 rounded-xl px-4 py-3 space-y-0.5">
            <p className="text-white/40 text-xs uppercase tracking-widest">Service</p>
            <p className="text-white font-medium">
              {[inv.job_category, inv.job_subtype].filter(Boolean).join(' — ')}
            </p>
          </div>
        )}

        {/* Line items */}
        {lineItems.length > 0 && (
          <div className="bg-white/5 rounded-xl overflow-hidden">
            <p className="text-white/40 text-xs uppercase tracking-widest px-4 pt-4 pb-2">Parts &amp; Labor</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-4 py-2 text-white/40 font-medium">Description</th>
                  <th className="text-right px-4 py-2 text-white/40 font-medium">Qty</th>
                  <th className="text-right px-4 py-2 text-white/40 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li, i) => (
                  <tr key={i} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2.5 text-white/80">{li.description}</td>
                    <td className="px-4 py-2.5 text-white/50 text-right">{li.quantity}</td>
                    <td className="px-4 py-2.5 text-white text-right font-medium">{fmt(li.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Additional parts */}
        {additionalParts.length > 0 && (
          <div className="bg-white/5 rounded-xl overflow-hidden">
            <p className="text-white/40 text-xs uppercase tracking-widest px-4 pt-4 pb-2">Additional Parts</p>
            <table className="w-full text-sm">
              <tbody>
                {additionalParts.map((part) => (
                  <tr key={part.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2.5 text-white/80">{part.description}</td>
                    <td className="px-4 py-2.5 text-white/50 text-right">×{part.qty}</td>
                    <td className="px-4 py-2.5 text-white text-right font-medium">{fmt(part.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Shop supplies */}
        {shopSupplies.length > 0 && (
          <div className="bg-white/5 rounded-xl overflow-hidden">
            <p className="text-white/40 text-xs uppercase tracking-widest px-4 pt-4 pb-2">Shop Supplies</p>
            <table className="w-full text-sm">
              <tbody>
                {shopSupplies.map((sup) => (
                  <tr key={sup.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2.5 text-white/80">{sup.name}</td>
                    <td className="px-4 py-2.5 text-white/50 text-right">×{sup.qty}</td>
                    <td className="px-4 py-2.5 text-white text-right font-medium">{fmt(sup.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Additional labor */}
        {additionalLabor.length > 0 && (
          <div className="bg-white/5 rounded-xl overflow-hidden">
            <p className="text-white/40 text-xs uppercase tracking-widest px-4 pt-4 pb-2">Additional Labor</p>
            <table className="w-full text-sm">
              <tbody>
                {additionalLabor.map((lab) => (
                  <tr key={lab.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2.5 text-white/80">{lab.description}</td>
                    <td className="px-4 py-2.5 text-white/50 text-right">{lab.hours}h</td>
                    <td className="px-4 py-2.5 text-white text-right font-medium">{fmt(lab.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pricing summary */}
        <div className="bg-white/5 rounded-xl p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-white/60">Subtotal</span>
            <span className="text-white">{fmt(inv.subtotal)}</span>
          </div>
          {inv.tax_amount > 0 && (
            <div className="flex justify-between text-sm border-t border-white/10 pt-2">
              <span className="text-white/50">
                Tax{inv.tax_rate ? ` (${Math.round(inv.tax_rate * 10000) / 100}%)` : ''}
              </span>
              <span className="text-white/70">{fmt(inv.tax_amount)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline border-t border-white/15 pt-3 mt-1">
            <span className="text-white font-bold text-base uppercase tracking-wide">Total Due</span>
            <span className="text-[#FF6600] font-bold text-3xl">{fmt(inv.total)}</span>
          </div>
        </div>

        {/* Payment instructions — hidden once paid */}
        {inv.payment_instructions && !isPaid && (
          <div className="bg-white/5 rounded-xl px-4 py-4 space-y-2">
            <p className="text-white/40 text-xs uppercase tracking-widest">Payment Instructions</p>
            <p className="text-white/80 text-sm whitespace-pre-wrap leading-relaxed">{inv.payment_instructions}</p>
          </div>
        )}

        {/* Job notes (work performed) */}
        {inv.job_notes && (
          <div className="bg-white/5 rounded-xl px-4 py-3 space-y-1">
            <p className="text-white/40 text-xs uppercase tracking-widest">Work Performed</p>
            <p className="text-white/70 text-sm whitespace-pre-wrap">{inv.job_notes}</p>
          </div>
        )}

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

      {/* Track view on mount */}
      <InvoiceViewClient token={token} />
    </div>
  )
}
