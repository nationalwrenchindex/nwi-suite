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
  SHOP_ADDRESS_SELECT_143,
  shopBlockFrom,
  customerBlockFrom,
  ldInvoiceDates,
  formatDocDate,
  isLaborLine,
  segmentedLine,
  groupBySegment,
  segmentHeading,
  enrichLaborDescription,
  quantityText,
  lineMeta,
} from '@/lib/invoice-document'
import { extrasDisplayRows, extrasFromDocument } from '@/lib/billable-extras'
import { missingMigration142Column } from '@/lib/migration-142'
import { termsWithDueDate } from '@/lib/hd/payment-terms'
import InvoiceViewClient from './InvoiceViewClient'
import InvoiceApprovalClient from './InvoiceApprovalClient'
import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import type { MultiJobEntry } from '@/types/financials'
import { money } from '@/lib/format'

// internal_notes is DELIBERATELY ABSENT and must stay absent. It is the shop-only
// field added by migration 142 precisely so a tech's notes have somewhere to go that
// a customer never sees. Selecting it here, even without rendering it, puts it one
// typo away from a public page.
const INVOICE_SELECT_BASE = `
  id, invoice_number, po_number, invoice_status, public_token,
  invoice_date, due_date, terms, total, subtotal, tax_rate, tax_amount, tax_breakdown,
  job_category, job_subtype, job_notes, jobs,
  line_items, shop_supplies, additional_parts, additional_labor,
  payment_instructions, finalized_at, created_at,
  customer_view_count, customer_viewed_at, times_sent,
  sent_to_customer_at, paid_at,
  service_lines, adjustments, tip_amount_cents,
  customer:customers(id, first_name, last_name, phone, email, address_line1, address_line2, city, state, zip),
  source_quote:quotes!invoices_source_quote_id_fkey(id, quote_number, parts_subtotal, parts_markup_percent, labor_subtotal, labor_hours, labor_rate),
  user_id
`

// Everything migrations 142 and 143 add that this page renders. Split out because
// selecting a column that does not exist is a 400, and a 400 here lands as
// notFound() — every customer invoice link in production would read "not available"
// until the SQL was run by hand. A customer-facing outage is not an acceptable cost
// for a travel line or a terms label.
const INVOICE_SELECT_143 = 'payment_terms'

const INVOICE_SELECT_142 = `
  unit_number,
  travel_hours, travel_rate, travel_amount,
  mileage_miles, mileage_rate, mileage_amount,
  shop_supplies_percent_applied, shop_supplies_cap_applied, shop_supplies_fee
`

const VEHICLE_142    = 'vehicle:vehicles(id, year, make, model, vin, unit_number)'
const VEHICLE_LEGACY = 'vehicle:vehicles(id, year, make, model, vin)'

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
interface DocLine {
  key: string
  description: string
  meta: string | null
  amount: number
  note?: string | null
}

function LineRows({
  label,
  rows,
}: {
  label: string
  rows: DocLine[]
}) {
  if (rows.length === 0) return null
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden', background: CARD }}>
        {rows.map((r, i) => (
          <LineRow key={r.key} row={r} last={i === rows.length - 1} />
        ))}
      </div>
    </div>
  )
}

function LineRow({ row: r, last }: { row: DocLine; last: boolean }) {
  return (
    <div
      className="flex items-start justify-between gap-3 px-4 py-3"
      style={{ borderBottom: last ? 'none' : `1px solid ${RULE}` }}
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
  )
}

/**
 * Parts and labour, grouped by the segment each line belonged to.
 *
 * A segment heading carries no money of its own. The segment's total is the sum of
 * the lines printed under it, which the customer can add up themselves - a heading
 * row showing a total would be a second figure to reconcile, and a zero-value row
 * on a customer's copy is exactly what we agreed not to print.
 *
 * Falls back to the flat list when nothing is segmented, so a parent-priced invoice
 * is byte-for-byte what it was.
 */
function SegmentedLineRows({
  label,
  groups,
}: {
  label: string
  groups: Array<{ sequence: number | null; label: string | null; rows: DocLine[] }>
}) {
  const total = groups.reduce((n, g) => n + g.rows.length, 0)
  if (total === 0) return null

  const segmented = groups.some(g => g.sequence !== null)
  if (!segmented) return <LineRows label={label} rows={groups.flatMap(g => g.rows)} />

  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, overflow: 'hidden', background: CARD }}>
        {groups.map((g, gi) => {
          const heading = segmentHeading(g)
          return (
            <div key={`grp-${g.sequence ?? 'none'}-${gi}`}>
              {heading && (
                <p
                  className="text-xs font-semibold px-4 pt-3 pb-1"
                  style={{
                    color: MUTED,
                    borderTop: gi === 0 ? 'none' : `1px solid ${RULE}`,
                  }}
                >
                  {heading}
                </p>
              )}
              {g.rows.map((r, i) => (
                <LineRow
                  key={r.key}
                  row={r}
                  last={gi === groups.length - 1 && i === g.rows.length - 1}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default async function PublicInvoicePage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const sc = createServiceClient()

  // Cast at the boundary: a select built from a runtime string collapses the row
  // type to ParserError / GenericStringError, which is the same Supabase behaviour
  // that forced literal selects elsewhere in this codebase. The shape is asserted
  // once here rather than at twenty property accesses.
  const readInvoice = async (cols: string): Promise<{ data: AnyInvoice | null; error: unknown }> => {
    const r = await sc.from('invoices').select(cols).eq('public_token', token).single()
    return { data: (r.data as AnyInvoice | null) ?? null, error: r.error }
  }

  let { data: invoice, error } = await readInvoice(
    `${INVOICE_SELECT_BASE}, ${INVOICE_SELECT_142}, ${INVOICE_SELECT_143}, ${VEHICLE_142}`,
  )
  // Migration 142/143 not applied yet: step down, then down again. The travel,
  // mileage, shop-supplies and terms lines simply do not render, which is correct —
  // no existing invoice has any of them.
  if (error) {
    ({ data: invoice, error } = await readInvoice(
      `${INVOICE_SELECT_BASE}, ${INVOICE_SELECT_142}, ${VEHICLE_142}`,
    ))
  }
  if (error && missingMigration142Column(error)) {
    ({ data: invoice, error } = await readInvoice(`${INVOICE_SELECT_BASE}, ${VEHICLE_LEGACY}`))
  }

  if (error || !invoice) notFound()

  // The 143 street columns are tried first and dropped if the migration has not
  // been applied — the shop block then prints city and state as it does today,
  // rather than the whole page failing.
  // Cast for the same reason as the invoice read above: a runtime-built select
  // collapses the row type.
  const readProfile = async (cols: string): Promise<Record<string, unknown> | null> => {
    const r = await sc.from('profiles').select(cols).eq('id', invoice.user_id).single()
    return r.error ? null : (r.data as unknown as Record<string, unknown>)
  }
  const profile =
    await readProfile(`business_type, bill_consumables_separately, default_payment_instructions, ${SHOP_BLOCK_SELECT}, ${SHOP_ADDRESS_SELECT_143}`)
    ?? await readProfile(`business_type, bill_consumables_separately, default_payment_instructions, ${SHOP_BLOCK_SELECT}`)

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
  // "Net 7 — due 10/10/2026", or just the terms when no due date is stored.
  const termsLine = inv.payment_terms || dates.due
    ? termsWithDueDate(inv.payment_terms as string | null, dates.due)
    : null

  const vehicleLabel = inv.vehicle
    ? [inv.vehicle.year, inv.vehicle.make, inv.vehicle.model].filter(Boolean).join(' ')
    : null

  // The invoice's own snapshot wins over the live vehicle record: this is billed
  // history, and it must still read correctly after the unit is renumbered.
  const unitNumber: string | null =
    (typeof inv.unit_number === 'string' && inv.unit_number.trim() ? inv.unit_number.trim() : null) ??
    (typeof inv.vehicle?.unit_number === 'string' && inv.vehicle.unit_number.trim()
      ? inv.vehicle.unit_number.trim() : null)

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

  // Travel, mileage and shop supplies as stored on this invoice. extrasFromDocument
  // reads, it does not recompute — an invoice already sent must keep the figures the
  // customer was given, whatever Settings says today.
  const extraRows = extrasDisplayRows(extrasFromDocument(inv))

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
    const seg = segmentedLine(li as unknown as Record<string, unknown>)
    return {
      key: `li-${i}`,
      // segmentedLine strips a legacy "Segment 1 - " prefix, so a line converted
      // before the segment travelled separately still reads as its own part.
      description: (labor ? description : seg.description) || description || 'Service',
      // The part number is what lets a customer order the same part again, or
      // check it against a warranty claim. Nothing captured it until now.
      note: (li as { part_number?: string | null }).part_number || null,
      meta: lineMeta(qty, unit, labor),
      amount: Number(li.total ?? 0),
      sequence: seg.sequence,
      label: seg.label,
    }
  })

  // Grouped so each part and each labour entry prints under the complaint it was
  // for. A non-segmented invoice yields one group with sequence null, which renders
  // exactly as it always has: one "Parts & Labor" block, no heading.
  const lineGroups = groupBySegment(describedLines, r => ({ sequence: r.sequence, label: r.label }))

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
              {/* TERMS AND DUE DATE IN PLAIN WORDS: "Net 7 — due 10/10/2026".
                  A due date is printed only when one is STORED. Nothing here
                  derives "issued + 30 days" — see ldInvoiceDates. An invoice sent
                  without a due date keeps reading exactly as the customer got it. */}
              {termsLine && (
                <p className="font-semibold" style={{ color: TEXT }}>
                  <span className="font-normal" style={{ color: FAINT }}>Terms:</span> {termsLine}
                </p>
              )}
              {/* The shop's own free-text sentence, where it wrote one. Kept
                  alongside the structured terms rather than replaced by them. */}
              {dates.termsText && dates.termsText !== termsLine && (
                <p className="text-xs" style={{ color: MUTED }}>{dates.termsText}</p>
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

            {/* Vehicle. The unit number leads, because that is what a fleet
                customer matches this invoice against in their own records — the
                VIN is for a title or a warranty claim. Taken from the invoice's
                own snapshot first, then the vehicle record. */}
            {(unitNumber || vehicleLabel) && (
              <div>
                <SectionLabel>{unitNumber ? 'Unit' : 'Vehicle'}</SectionLabel>
                {unitNumber && (
                  <p className="font-bold text-base" style={{ color: TEXT }}>{unitNumber}</p>
                )}
                {vehicleLabel && (
                  <p className="font-medium text-sm" style={{ color: TEXT }}>{vehicleLabel}</p>
                )}
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
              <SegmentedLineRows label={'Parts & Labor'} groups={lineGroups} />
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
                {/* Travel, mileage and shop supplies — each its own labelled line,
                    never folded into labor or parts. A zero prints nothing at all:
                    extrasDisplayRows returns no row for it. Read from the stored
                    columns, never recomputed, so a sent invoice cannot change. */}
                {extraRows.map(r => (
                  <div
                    key={r.key}
                    className="flex justify-between py-2 text-sm"
                    style={{ color: MUTED, borderBottom: `1px solid ${RULE}` }}
                  >
                    <span>
                      {r.label}
                      {r.detail && <span className="block text-xs" style={{ color: FAINT }}>{r.detail}</span>}
                    </span>
                    <span style={{ color: TEXT }}>{fmt(r.amount)}</span>
                  </div>
                ))}
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
