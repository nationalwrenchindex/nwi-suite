// Public customer-facing LD invoice. No auth required — the visitor got a text or
// an email and has no account.
//
// THIS IS THE LD INVOICE. There is no LD PDF route; the customer prints this page.
// So it is laid out as a document, not as app chrome:
//
//   - LIGHT BACKGROUND, DARK TEXT, NO FILLED PANELS. It was white-on-#0f0f0f,
//     which a customer printing a copy pays for in toner and which many printers
//     render as a black page. Fills are now hairline borders.
//   - SINGLE COLUMN at phone width. Every row that was a flex pair wraps.
//   - TOTAL DUE is the largest thing on the page.
//
// Shared document rules (shop block, dates, labour labelling, addresses) live in
// src/lib/invoice-document.ts so the HD surfaces cannot drift from this one again.

import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { BrandFooter } from '@/components/BrandHeader'
import { parseBreakdown, taxDisplayRows } from '@/lib/tax'
import { publicDocumentMetadata } from '@/lib/public-metadata'
import {
  SHOP_BLOCK_SELECT,
  shopBlockFrom,
  customerBlockFrom,
  ldInvoiceDates,
  formatDocDate,
  isLaborLine,
  enrichLaborDescription,
  quantityText,
  lineMeta,
} from '@/lib/invoice-document'
import InvoiceViewClient from './InvoiceViewClient'
import InvoiceApprovalClient from './InvoiceApprovalClient'
import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import type { MultiJobEntry } from '@/types/financials'
import { money } from '@/lib/format'

const INVOICE_SELECT = `
  id, invoice_number, po_number, invoice_status, public_token,
  invoice_date, due_date, terms, total, subtotal, tax_rate, tax_amount, tax_breakdown,
  job_category, job_subtype, job_notes, jobs,
  line_items, shop_supplies, additional_parts, additional_labor,
  payment_instructions, finalized_at, created_at,
  customer_view_count, customer_viewed_at, times_sent,
  sent_to_customer_at, paid_at,
  service_lines, adjustments, tip_amount_cents,
  customer:customers(id, first_name, last_name, phone, email, address_line1, address_line2, city, state, zip),
  vehicle:vehicles(id, year, make, model, vin),
  source_quote:quotes!invoices_source_quote_id_fkey(id, quote_number, parts_subtotal, parts_markup_percent, labor_subtotal, labor_hours, labor_rate),
  user_id
`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyInvoice = Record<string, any>

// ─── The document palette. Light, and the same one HD's invoice uses. ──────────
const BG     = '#F4F5F7'
const CARD   = '#FFFFFF'
const BORDER = '#E5E7EB'
const RULE   = '#F3F4F6'
const TEXT   = '#1A1A1A'
const BODY   = '#374151'
const MUTED  = '#6B7280'
const FAINT  = '#9CA3AF'
const ORANGE = '#FF6600'

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
): Promise<Metadata> {
  const { token } = await params
  const sc = createServiceClient()
  const { data } = await sc.from('invoices').select('invoice_number, user_id').eq('public_token', token).single()
  const num = data?.invoice_number ?? 'Invoice'

  // The subscriber's business on the tab. Was hard-coded to NWI's name.
  let businessName: string | null = null
  if (data?.user_id) {
    const { data: p } = await sc
      .from('profiles')
      .select('business_name, full_name')
      .eq('id', data.user_id as string)
      .single()
    businessName = (p?.business_name as string | null) || (p?.full_name as string | null) || null
  }

  return publicDocumentMetadata(num, businessName)
}

const fmt = (n: number | null | undefined) =>
  n == null ? '$0.00' : money(n)

function round2(n: number) {
  return Math.round(n * 100) / 100
}

// ─── Small presentational primitives, so every block looks the same ───────────

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: FAINT }}>
      {children}
    </p>
  )
}

/** A bordered white panel. Replaces the old translucent-white-on-black fills. */
function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`px-4 py-4 ${className}`}
      style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10 }}
    >
      {children}
    </div>
  )
}

/**
 * A line-item table that becomes a stack on a phone.
 *
 * A real <table> at 360px either scrolls sideways or crushes the description to
 * two characters per line. Each row is its own flex block instead, so the
 * description gets the full width and the money stays right-aligned beside it.
 */
function LineRows({
  label,
  rows,
}: {
  label: string
  rows: Array<{ key: string; description: string; meta: string | null; amount: number; note?: string | null }>
}) {
  if (rows.length === 0) return null
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden', background: CARD }}>
        {rows.map((r, i) => (
          <div
            key={r.key}
            className="flex items-start justify-between gap-3 px-4 py-3"
            style={{ borderBottom: i === rows.length - 1 ? 'none' : `1px solid ${RULE}` }}
          >
            <div className="min-w-0">
              <p className="text-sm" style={{ color: TEXT }}>{r.description}</p>
              {r.note && <p className="text-xs font-mono mt-0.5" style={{ color: MUTED }}>{r.note}</p>}
              {r.meta && <p className="text-xs mt-0.5" style={{ color: FAINT }}>{r.meta}</p>}
            </div>
            <span className="text-sm font-semibold flex-shrink-0" style={{ color: TEXT }}>
              {fmt(r.amount)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
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
    .select(`business_type, bill_consumables_separately, default_payment_instructions, ${SHOP_BLOCK_SELECT}`)
    .eq('id', invoice.user_id)
    .single()

  const p = profile as {
    business_type?: string
    bill_consumables_separately?: boolean
    default_payment_instructions?: string | null
  } | null

  // Shop identity, address, phone and email in one place. The logo resolves
  // through resolveBranding so an HD subscriber who only ever set
  // hd_company_logo_url still gets their mark on an LD invoice.
  const shop        = shopBlockFrom(profile)
  const bizName     = shop.name
  const billConsumables = p?.bill_consumables_separately ?? false

  // Detect detailer: primary signal is profile.business_type; fallback is invoice having
  // service_lines or adjustments data (mechanics never get those columns populated).
  const isDetailerByProfile = p?.business_type === 'detailer'
  const hasDetailerData     = (Array.isArray(invoice.service_lines) && (invoice.service_lines as unknown[]).length > 0)
                           || (Array.isArray(invoice.adjustments)   && (invoice.adjustments   as unknown[]).length > 0)
  const isDetailer          = isDetailerByProfile || hasDetailerData

  const inv = invoice as AnyInvoice
  // NULL for anything written before migration 140 -- those keep the single Tax line
  // they were sent with, because an invoice the customer already received must not
  // start describing itself differently.
  const taxBreakdown = parseBreakdown(inv.tax_breakdown)
  const taxRows      = taxDisplayRows(taxBreakdown)

  const customer = customerBlockFrom(inv.customer)
  const dates    = ldInvoiceDates(inv)
  const issuedOn = formatDocDate(dates.issued)
  const dueOn    = formatDocDate(dates.due)

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

  // ── Parts & labour, described properly ──────────────────────────────────────
  // "Labor, Qty 2" told the customer nothing. A labour line now says how many
  // HOURS and at what rate, and a bare "Labor" borrows the job it belonged to.
  // See isLaborLine for why this is not inferred from price alone.
  // PostgREST returns an object for a to-one embed and an array when it cannot
  // prove the cardinality. Read through both, or the labour proof silently
  // becomes undefined and every line falls back to "Qty".
  const srcQuote = Array.isArray(inv.source_quote) ? inv.source_quote[0] : inv.source_quote
  const quoteCtx = {
    laborHours: srcQuote?.labor_hours ?? null,
    laborRate:  srcQuote?.labor_rate  ?? null,
  }
  const describedLines = lineItems.map((li, i) => {
    const labor = isLaborLine(li as unknown as Record<string, unknown>, quoteCtx)
    const qty   = Number(li.quantity ?? 0)
    const unit  = Number(li.unit_price ?? 0)
    const description = labor
      ? enrichLaborDescription(li.description, {
          jobSubtype:  inv.job_subtype,
          jobCategory: inv.job_category,
          jobNotes:    inv.job_notes,
        })
      : (li.description ?? '').trim()
    return {
      key: `li-${i}`,
      description: description || 'Service',
      meta: lineMeta(qty, unit, labor),
      amount: Number(li.total ?? 0),
    }
  })

  return (
    <div style={{ background: BG, minHeight: '100dvh', padding: '16px 12px 40px', color: TEXT }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* ── SHOP BLOCK. Logo, name, address, phone, email. ─────────────────── */}
        <div className="flex items-start gap-3 px-1 pb-4">
          {shop.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={shop.logoUrl}
              alt={bizName}
              style={{ height: 56, maxWidth: 200, objectFit: 'contain' }}
            />
          ) : (
            <div
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: 44, height: 44, borderRadius: 8, border: `1px solid ${BORDER}`, background: CARD }}
            >
              <svg width="24" height="24" fill="none" stroke={ORANGE} strokeWidth={2.2} viewBox="0 0 24 24">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
              </svg>
            </div>
          )}
          <div className="min-w-0">
            <p className="font-bold text-lg leading-tight" style={{ color: TEXT }}>{bizName}</p>
            {shop.addressLines.map((l, i) => (
              <p key={i} className="text-xs leading-snug" style={{ color: MUTED }}>{l}</p>
            ))}
            <p className="text-xs leading-snug" style={{ color: MUTED }}>
              {[shop.phone, shop.email].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        {/* ── Paid banner ────────────────────────────────────────────────────── */}
        {isPaid && inv.paid_at && (
          <div
            className="mb-4 px-4 py-3"
            style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 10 }}
          >
            <p className="font-bold text-sm" style={{ color: '#15803D' }}>Paid in Full</p>
            <p className="text-xs mt-0.5" style={{ color: '#16A34A' }}>
              {formatDocDate(inv.paid_at)}. Thank you!
            </p>
          </div>
        )}

        {/* ── The invoice document ───────────────────────────────────────────── */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>

          {/* Invoice number, date, due date, PO — one labelled group */}
          <div
            className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 px-5 py-5"
            style={{ borderBottom: `3px solid ${ORANGE}` }}
          >
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: FAINT }}>Invoice</p>
              <p className="font-bold text-2xl leading-tight" style={{ color: ORANGE }}>{inv.invoice_number}</p>
              {!isPaid && (
                <p className="text-xs mt-1" style={{ color: MUTED }}>Awaiting payment</p>
              )}
            </div>
            <div className="text-sm sm:text-right" style={{ color: MUTED }}>
              {issuedOn && (
                <p><span style={{ color: FAINT }}>Invoice Date:</span> {issuedOn}</p>
              )}
              {/* A due date is printed only when one is stored. Nothing here
                  derives "issued + 30 days" — see ldInvoiceDates. */}
              {dueOn && (
                <p className="font-semibold" style={{ color: TEXT }}>
                  <span className="font-normal" style={{ color: FAINT }}>Payment Due:</span> {dueOn}
                </p>
              )}
              {dates.termsText && (
                <p><span style={{ color: FAINT }}>Terms:</span> {dates.termsText}</p>
              )}
              {inv.po_number && (
                <p className="font-mono text-xs mt-0.5">
                  <span className="font-sans" style={{ color: FAINT }}>PO #:</span> {inv.po_number}
                </p>
              )}
            </div>
          </div>

          <div className="px-5 py-5 space-y-5">

            {/* ── Bill To. The customer's own address, which never printed. ──── */}
            <div className="pb-5" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <SectionLabel>Bill To</SectionLabel>
              <p className="font-semibold text-base" style={{ color: TEXT }}>{customer.name}</p>
              {customer.addressLines.map((l, i) => (
                <p key={i} className="text-sm" style={{ color: MUTED }}>{l}</p>
              ))}
              {customer.phone && <p className="text-sm" style={{ color: MUTED }}>{customer.phone}</p>}
              {customer.email && <p className="text-sm" style={{ color: MUTED }}>{customer.email}</p>}
            </div>

            {/* Vehicle */}
            {vehicleLabel && (
              <div>
                <SectionLabel>Vehicle</SectionLabel>
                <p className="font-medium text-sm" style={{ color: TEXT }}>{vehicleLabel}</p>
                {inv.vehicle?.vin && (
                  <p className="text-xs font-mono mt-0.5" style={{ color: MUTED }}>VIN: {inv.vehicle.vin}</p>
                )}
              </div>
            )}

            {/* Service label */}
            {isMultiJob ? (
              <div>
                <SectionLabel>Services Performed ({jobs.length})</SectionLabel>
                <ul className="space-y-0.5">
                  {jobs.map((j, i) => (
                    <li key={i} className="text-sm font-medium" style={{ color: TEXT }}>{j.subtype}</li>
                  ))}
                </ul>
              </div>
            ) : (inv.job_category || inv.job_subtype) ? (
              <div>
                <SectionLabel>Service</SectionLabel>
                <p className="font-medium text-sm" style={{ color: TEXT }}>
                  {[inv.job_category, inv.job_subtype].filter(Boolean).join(' — ')}
                </p>
              </div>
            ) : null}

            {/* ── Detailer: services + adjustments ──────────────────────────── */}
            {isDetailer ? (
              <>
                <LineRows
                  label="Services"
                  rows={serviceLines.map((sl, i) => ({
                    key: `sl-${i}`,
                    description: sl.service_name,
                    meta: sl.price_cents === 0 ? 'Complimentary' : null,
                    amount: sl.price_cents / 100,
                  }))}
                />
                <LineRows
                  label="Adjustments"
                  rows={adjustments.map((a, i) => ({
                    key: `adj-${i}`,
                    description: a.name,
                    meta: a.price_cents === 0 ? 'Complimentary' : a.price_cents < 0 ? 'Credit' : null,
                    amount: a.price_cents / 100,
                  }))}
                />
              </>
            ) : isMultiJob ? (
              /* Multi-job grouped breakdown */
              <div className="space-y-4">
                {jobs.map((j, ji) => {
                  const jobPartsRevenue = j.parts.reduce((s, part) => s + part.unit_price * part.qty, 0)
                  const jobLaborTotal   = j.labor_hours * j.labor_rate
                  const jobSubtotal     = jobPartsRevenue + jobLaborTotal
                  return (
                    <div key={ji} style={{ border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden' }}>
                      <div
                        className="flex items-center justify-between gap-2 px-4 py-3"
                        style={{ borderBottom: `1px solid ${BORDER}` }}
                      >
                        <p className="font-semibold text-sm" style={{ color: TEXT }}>{j.subtype}</p>
                        <span className="font-bold text-sm" style={{ color: TEXT }}>{fmt(jobSubtotal)}</span>
                      </div>
                      {j.parts.map((part, pi) => (
                        <div
                          key={pi}
                          className="flex items-start justify-between gap-3 px-4 py-2.5"
                          style={{ borderBottom: `1px solid ${RULE}` }}
                        >
                          <div className="min-w-0">
                            <p className="text-sm" style={{ color: TEXT }}>{part.name}</p>
                            <p className="text-xs mt-0.5" style={{ color: FAINT }}>
                              ×{part.qty} × {fmt(part.unit_price)} ea
                            </p>
                          </div>
                          <span className="text-sm font-semibold flex-shrink-0" style={{ color: TEXT }}>
                            {fmt(part.unit_price * part.qty)}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-start justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm" style={{ color: TEXT }}>Labor — {j.subtype}</p>
                          <p className="text-xs mt-0.5" style={{ color: FAINT }}>
                            {quantityText(j.labor_hours, true)} × {fmt(j.labor_rate)}/hr
                          </p>
                        </div>
                        <span className="text-sm font-semibold flex-shrink-0" style={{ color: TEXT }}>
                          {fmt(jobLaborTotal)}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <LineRows label={'Parts & Labor'} rows={describedLines} />
            )}

            {/* Additional parts */}
            <LineRows
              label="Additional Parts"
              rows={additionalParts.map(part => ({
                key: part.id,
                description: part.description,
                meta: [quantityText(Number(part.qty), false), part.unit_cost > 0 ? `${fmt(part.unit_cost)} ea` : null]
                  .filter(Boolean).join(' × ') || null,
                amount: part.total,
              }))}
            />

            {/* Shop supplies — detailers only show if bill_consumables_separately is on */}
            {(!isDetailer || showDetailerSupplies) && (
              <LineRows
                label={isDetailer ? 'Detailing Supplies' : 'Shop Supplies'}
                rows={shopSupplies.map(sup => ({
                  key: sup.id,
                  description: sup.name,
                  meta: quantityText(Number(sup.qty), false),
                  amount: sup.total,
                }))}
              />
            )}

            {/* Additional labor — hidden for detailers (they use service_lines instead) */}
            {!isDetailer && (
              <LineRows
                label="Additional Labor"
                rows={additionalLabor.map(lab => ({
                  key: lab.id,
                  description: lab.description,
                  meta: [quantityText(Number(lab.hours), true), lab.rate > 0 ? `${fmt(lab.rate)}/hr` : null]
                    .filter(Boolean).join(' × ') || null,
                  amount: lab.subtotal,
                }))}
              />
            )}

            {/* ── Totals. TOTAL DUE is the largest thing on the page. ───────── */}
            <div className="flex justify-end">
              <div className="w-full sm:w-80">
                <div className="flex justify-between py-2 text-sm" style={{ color: MUTED, borderBottom: `1px solid ${RULE}` }}>
                  <span>Subtotal</span>
                  <span style={{ color: TEXT }}>{fmt(displaySubtotal)}</span>
                </div>
                {/* WHAT WAS TAXED, including what was not.
                    A customer who is not charged tax on labor should be able to see
                    that stated, rather than being left to work out why the tax looks
                    low -- and a separately-stated exemption is the thing that makes
                    it an exemption.

                    taxBreakdown is NULL on any invoice written before migration 140.
                    Those fall through to the single Tax line they were sent with: an
                    invoice the customer has already received must not start
                    describing itself differently. */}
                {taxBreakdown ? (
                  taxRows.map(r => (
                    <div
                      key={r.category}
                      className="flex justify-between py-2 text-sm"
                      style={{ color: MUTED, borderBottom: `1px solid ${RULE}` }}
                    >
                      <span>{r.text}</span>
                      <span style={{ color: r.taxed ? TEXT : FAINT }}>{r.taxed ? fmt(r.amount) : '—'}</span>
                    </div>
                  ))
                ) : displayTaxAmt > 0 ? (
                  <div className="flex justify-between py-2 text-sm" style={{ color: MUTED, borderBottom: `1px solid ${RULE}` }}>
                    <span>
                      Tax{detailerTaxRate > 0
                        ? ` (${Math.round(detailerTaxRate * 10000) / 100}%)`
                        : inv.tax_rate ? ` (${Math.round(inv.tax_rate * 10000) / 100}%)` : ''}
                    </span>
                    <span style={{ color: TEXT }}>{fmt(displayTaxAmt)}</span>
                  </div>
                ) : null}
                <div
                  className="flex justify-between items-center gap-3 py-3"
                  style={{ borderTop: `2px solid ${ORANGE}`, marginTop: 4 }}
                >
                  <span className="font-bold text-base uppercase tracking-wide" style={{ color: TEXT }}>
                    {isPaid ? 'Total Paid' : 'Total Due'}
                  </span>
                  <span className="font-bold text-3xl" style={{ color: ORANGE }}>{fmt(displayTotal)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── PAYMENT INSTRUCTIONS, in their own bordered block. ──────────────
            Without this the customer has the amount and no way to pay it. The
            invoice's own value wins over the shop default, so a one-off "pay the
            driver by card" overrides "mail a check". */}
        {paymentInstructions && !isPaid && (
          <div
            className="mt-5 px-5 py-4"
            style={{ background: CARD, border: `2px solid ${ORANGE}`, borderRadius: 12 }}
          >
            <SectionLabel>How to Pay</SectionLabel>
            <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: BODY }}>
              {paymentInstructions}
            </p>
          </div>
        )}

        {/* Detailer: tip + approve (unpaid only) */}
        {isDetailer && !isPaid && (
          <div className="mt-5">
            <InvoiceApprovalClient token={token} invoiceTotal={detailerTotal ?? Number(inv.total) ?? 0} />
          </div>
        )}

        {/* Work performed */}
        {inv.job_notes && (
          <div className="mt-5">
            <Panel>
              <SectionLabel>Work Performed</SectionLabel>
              <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: BODY }}>{inv.job_notes}</p>
            </Panel>
          </div>
        )}

        {/* Contact footer */}
        {(shop.phone || shop.email) && (
          <p className="text-center text-xs mt-6 px-4 leading-relaxed" style={{ color: MUTED }}>
            Questions about this invoice? Contact {bizName}
            {shop.phone && (
              <> at <a href={`tel:${shop.phone.replace(/[^\d+]/g, '')}`} style={{ color: TEXT, textDecoration: 'underline' }}>{shop.phone}</a></>
            )}
            {shop.email && (
              <> or <a href={`mailto:${shop.email}`} style={{ color: TEXT, textDecoration: 'underline' }}>{shop.email}</a></>
            )}
            .
          </p>
        )}

        {/* Trademark attribution — stays even when the header is fully
            white-labelled. The subscriber's brand leads the document; the
            platform credit remains at the foot of it. Untouched by this phase. */}
        <BrandFooter className="text-center pt-1" />

      </div>

      {/* Track view on mount */}
      <InvoiceViewClient token={token} />
    </div>
  )
}
