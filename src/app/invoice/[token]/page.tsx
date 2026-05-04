// Public customer-facing invoice page. No auth required.
// Fetches invoice server-side via service client; view tracking via client component.

import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import InvoiceViewClient from './InvoiceViewClient'
import InvoiceApprovalClient from './InvoiceApprovalClient'
import type { Metadata } from 'next'
import type { MultiJobEntry } from '@/types/financials'

const INVOICE_SELECT = `
  id, invoice_number, invoice_status, public_token,
  invoice_date, total, subtotal, tax_rate, tax_amount,
  job_category, job_subtype, job_notes, jobs,
  line_items, shop_supplies, additional_parts, additional_labor,
  payment_instructions, finalized_at,
  customer_view_count, customer_viewed_at, times_sent,
  sent_to_customer_at, paid_at,
  service_lines, adjustments, tip_amount_cents,
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

function round2(n: number) {
  return Math.round(n * 100) / 100
}

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
    .select('full_name, business_name, phone, email, business_type, bill_consumables_separately, default_payment_instructions')
    .eq('id', invoice.user_id)
    .single()

  const p = profile as { full_name?: string; business_name?: string; phone?: string; business_type?: string; bill_consumables_separately?: boolean; default_payment_instructions?: string | null } | null
  const bizName             = p?.business_name             ?? 'Your Technician'
  const techPhone           = p?.phone                     ?? null
  const billConsumables     = p?.bill_consumables_separately ?? false

  // Detect detailer: primary signal is profile.business_type; fallback is invoice having
  // service_lines or adjustments data (mechanics never get those columns populated).
  const isDetailerByProfile = p?.business_type === 'detailer'
  const hasDetailerData     = (Array.isArray(invoice.service_lines) && (invoice.service_lines as unknown[]).length > 0)
                           || (Array.isArray(invoice.adjustments)   && (invoice.adjustments   as unknown[]).length > 0)
  const isDetailer          = isDetailerByProfile || hasDetailerData

  console.log('[PublicInvoicePage]', {
    invoiceNumber: invoice.invoice_number,
    userId:            invoice.user_id,
    bizName,
    profileBizType:    p?.business_type,
    isDetailerByProfile,
    hasDetailerData,
    isDetailer,
    serviceLineCount:  Array.isArray(invoice.service_lines) ? (invoice.service_lines as unknown[]).length : 'not-array',
    adjustmentCount:   Array.isArray(invoice.adjustments)   ? (invoice.adjustments   as unknown[]).length : 'not-array',
  })

  const inv = invoice as AnyInvoice

  const customerName = inv.customer
    ? `${inv.customer.first_name ?? ''} ${inv.customer.last_name ?? ''}`.trim()
    : 'Valued Customer'

  const vehicleLabel = inv.vehicle
    ? [inv.vehicle.year, inv.vehicle.make, inv.vehicle.model].filter(Boolean).join(' ')
    : null

  const isPaid = inv.invoice_status === 'paid'

  // Phase 8: multi-job support
  const jobs: MultiJobEntry[] = Array.isArray(inv.jobs) && inv.jobs.length > 0 ? inv.jobs : []
  const isMultiJob = jobs.length > 0

  // Detailer model
  const serviceLines: Array<{ service_name: string; vehicle_category: string | null; price_cents: number }> =
    Array.isArray(inv.service_lines) ? inv.service_lines : []
  const adjustments: Array<{ name: string; price_cents: number }> =
    Array.isArray(inv.adjustments) ? inv.adjustments : []
  // Legacy line items
  const lineItems: Array<{ description: string; quantity: number; unit_price: number; total: number }> =
    Array.isArray(inv.line_items) ? inv.line_items : []

  // Additional items (mechanic/in-progress only)
  const shopSupplies:    Array<{ id: string; name: string; qty: number; unit_cost: number; total: number }> =
    Array.isArray(inv.shop_supplies)    ? inv.shop_supplies    : []
  const additionalParts: Array<{ id: string; description: string; qty: number; unit_cost: number; total: number }> =
    Array.isArray(inv.additional_parts) ? inv.additional_parts : []
  const additionalLabor: Array<{ id: string; description: string; hours: number; rate: number; subtotal: number }> =
    Array.isArray(inv.additional_labor) ? inv.additional_labor : []

  // Detailer: compute subtotal/tax/total from JSON rather than relying on stored total (may be 0 for older rows)
  const showDetailerSupplies = isDetailer && billConsumables && shopSupplies.length > 0
  const detailerSubtotal = isDetailer
    ? round2(
        serviceLines.reduce((s, sl) => s + sl.price_cents, 0) / 100 +
        adjustments.reduce((s, a) => s + a.price_cents, 0) / 100 +
        (showDetailerSupplies ? shopSupplies.reduce((s, ss) => s + ss.total, 0) : 0)
      )
    : null
  const detailerTaxRate = Number(inv.tax_rate ?? 0)
  const detailerTax     = detailerSubtotal != null ? round2(detailerSubtotal * detailerTaxRate) : null
  const detailerTotal   = detailerSubtotal != null && detailerTax != null
    ? round2(detailerSubtotal + detailerTax)
    : null

  // Payment instructions: invoice-level setting takes priority, fall back to profile default
  const paymentInstructions = inv.payment_instructions || p?.default_payment_instructions || null

  // Use computed values for display (fall back to stored values for non-detailer)
  const displaySubtotal = detailerSubtotal ?? inv.subtotal
  const displayTaxAmt   = detailerTax      ?? inv.tax_amount
  const displayTotal    = detailerTotal    ?? inv.total

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

        {/* Service label */}
        {isMultiJob ? (
          <div className="bg-white/5 rounded-xl px-4 py-3 space-y-0.5">
            <p className="text-white/40 text-xs uppercase tracking-widest">Services Performed ({jobs.length})</p>
            <ul className="space-y-0.5">
              {jobs.map((j, i) => (
                <li key={i} className="text-white font-medium text-sm">{j.subtype}</li>
              ))}
            </ul>
          </div>
        ) : (inv.job_category || inv.job_subtype) ? (
          <div className="bg-white/5 rounded-xl px-4 py-3 space-y-0.5">
            <p className="text-white/40 text-xs uppercase tracking-widest">Service</p>
            <p className="text-white font-medium">
              {[inv.job_category, inv.job_subtype].filter(Boolean).join(' — ')}
            </p>
          </div>
        ) : null}

        {/* Detailer: services + adjustments */}
        {isDetailer ? (
          <>
            {serviceLines.length > 0 && (
              <div className="bg-white/5 rounded-xl overflow-hidden">
                <p className="text-white/40 text-xs uppercase tracking-widest px-4 pt-4 pb-2">Services</p>
                <div>
                  {serviceLines.map((sl, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 last:border-0">
                      <span className="text-white/80 text-sm">{sl.service_name}</span>
                      {sl.price_cents === 0
                        ? <span className="text-emerald-400/80 text-sm font-medium">Complimentary</span>
                        : <span className="text-white text-sm font-medium">{fmt(sl.price_cents / 100)}</span>
                      }
                    </div>
                  ))}
                </div>
              </div>
            )}
            {adjustments.length > 0 && (
              <div className="bg-white/5 rounded-xl overflow-hidden">
                <p className="text-white/40 text-xs uppercase tracking-widest px-4 pt-4 pb-2">Adjustments</p>
                <div>
                  {adjustments.map((a, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 last:border-0">
                      <span className="text-white/80 text-sm">{a.name}</span>
                      {a.price_cents === 0
                        ? <span className="text-emerald-400/80 text-sm font-medium">Complimentary</span>
                        : <span className={`text-sm font-medium ${a.price_cents < 0 ? 'text-emerald-400' : 'text-white'}`}>
                            {a.price_cents < 0 ? '-' : '+'}{fmt(Math.abs(a.price_cents) / 100)}
                          </span>
                      }
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : isMultiJob ? (
          /* Multi-job grouped breakdown */
          <div className="space-y-4">
            {jobs.map((j, ji) => {
              const jobPartsRevenue = j.parts.reduce((s, p) => s + p.unit_price * p.qty, 0)
              const jobLaborTotal   = j.labor_hours * j.labor_rate
              const jobSubtotal     = jobPartsRevenue + jobLaborTotal
              return (
                <div key={ji} className="bg-white/5 rounded-xl overflow-hidden border border-white/8">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/8 bg-white/[0.02]">
                    <p className="text-white font-semibold text-sm">{j.subtype}</p>
                    <span className="text-[#FF6600] font-bold text-sm">{fmt(jobSubtotal)}</span>
                  </div>
                  {j.parts.length > 0 && (
                    <table className="w-full text-sm">
                      <tbody>
                        {j.parts.map((part, pi) => (
                          <tr key={pi} className="border-b border-white/5">
                            <td className="px-4 py-2 text-white/70">{part.name}</td>
                            <td className="px-4 py-2 text-white/40 text-right">×{part.qty}</td>
                            <td className="px-4 py-2 text-white/80 text-right font-medium">{fmt(part.unit_price * part.qty)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td className="px-4 py-2 text-white/50" colSpan={2}>
                            Labor ({j.labor_hours}h)
                          </td>
                          <td className="px-4 py-2 text-white/80 text-right font-medium">{fmt(jobLaborTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>
        ) : lineItems.length > 0 ? (
          /* Legacy single-job line items */
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
        ) : null}

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

        {/* Shop supplies — detailers only show if bill_consumables_separately is on */}
        {shopSupplies.length > 0 && (!isDetailer || showDetailerSupplies) && (
          <div className="bg-white/5 rounded-xl overflow-hidden">
            <p className="text-white/40 text-xs uppercase tracking-widest px-4 pt-4 pb-2">
              {isDetailer ? 'Detailing Supplies' : 'Shop Supplies'}
            </p>
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

        {/* Additional labor — hidden for detailers (they use service_lines instead) */}
        {!isDetailer && additionalLabor.length > 0 && (
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
            <span className="text-white">{fmt(displaySubtotal)}</span>
          </div>
          {displayTaxAmt > 0 && (
            <div className="flex justify-between text-sm border-t border-white/10 pt-2">
              <span className="text-white/50">
                Tax{detailerTaxRate > 0
                  ? ` (${Math.round(detailerTaxRate * 10000) / 100}%)`
                  : inv.tax_rate ? ` (${Math.round(inv.tax_rate * 10000) / 100}%)` : ''}
              </span>
              <span className="text-white/70">{fmt(displayTaxAmt)}</span>
            </div>
          )}
          <div className="flex justify-between items-baseline border-t border-white/15 pt-3 mt-1">
            <span className="text-white font-bold text-base uppercase tracking-wide">Total Due</span>
            <span className="text-[#FF6600] font-bold text-3xl">{fmt(displayTotal)}</span>
          </div>
        </div>

        {/* Payment instructions — invoice-level setting or fallback to profile default */}
        {paymentInstructions && !isPaid && (
          <div className="bg-white/5 rounded-xl px-4 py-4 space-y-2">
            <p className="text-white/40 text-xs uppercase tracking-widest">Payment Instructions</p>
            <p className="text-white/80 text-sm whitespace-pre-wrap leading-relaxed">{paymentInstructions}</p>
          </div>
        )}

        {/* Detailer: tip + approve (unpaid only) */}
        {isDetailer && !isPaid && (
          <InvoiceApprovalClient token={token} invoiceTotal={detailerTotal ?? Number(inv.total) ?? 0} />
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
