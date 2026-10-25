// Customer-facing HD invoice document. Rendered with NO session — the visitor is
// the truck owner who got a text, not a subscriber.
//
// Not a client component on purpose: everything here is static, and this page is
// opened on a phone over cell data from an SMS. Shipping zero JS for it is the
// whole point.
//
// WHITE LABEL: every mark on this page belongs to the subscriber. NWI branding
// must never appear here — the customer's relationship is with the shop, and the
// shop is paying for the invoice to look like theirs.

import type { PublicInvoiceBranding } from '@/lib/hd/invoice-token'
import { parseBreakdown, taxDisplayRows } from '@/lib/tax'
import { termsDisplay, termsWithDueDate } from '@/lib/hd/payment-terms'
import {
  addressLines,
  serviceUnitLines,
  documentDisclaimers,
  epa608Line,
  feeRows,
} from '@/lib/invoice-document'
import { addressFrom } from '@/lib/address'
import { extrasDisplayRows, extrasFromDocument } from '@/lib/billable-extras'
import { money } from '@/lib/format'
import { discountPrintLabel, parseDiscount } from '@/lib/document-discount'
import { hdTermsBlockRows, parseTermsSnapshot } from '@/lib/document-terms'
import DocumentTermsBlock from '@/components/hd/DocumentTermsBlock'
import { shopTimeZone, fmtShopDate } from '@/lib/shop-time'

// The light "document" palette HD invoices use, not the dark HD suite chrome.
const BG     = '#F4F5F7'
const CARD   = '#FFFFFF'
const BORDER = '#E5E7EB'
const TEXT   = '#1A1A1A'
// Paper tokens (globals.css): this page is white in both themes, and its text must
// pass WCAG AA on it. #6B7280 measured 4.43:1 on BG and #9CA3AF 2.54:1 on white.
const MUTED  = 'var(--paper-muted)'
const FAINT  = 'var(--paper-muted)'
// Orange stays the brand for rules and the logo tile. As TEXT it is the darker paper
// accent - #FF6600 is 2.94:1 on white, below AA even for the large invoice number.
const ORANGE = '#FF6600'
const ACCENT = 'var(--paper-accent)'
// The brand orange as a button fill, with DARK text: #1A1A1A is 5.93:1 on #FF6600
// (white was 2.94:1). Brand standards lock #FF6600; the text is what changes.
const ON_ACCENT = '#1A1A1A'
const BLUE   = '#2969B0'

interface LineItem {
  id?:            string
  type:           'labor' | 'parts'
  description:    string
  book_hours?:    number
  mobile_hours?:  number
  part_number?:   string
  quantity?:      number
  unit_cost?:     number
  amount:         number
}

interface Props {
  // Loose record for the same reason as the helper: hd_invoices grows every few
  // migrations and this is a read-only view over it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoice:  Record<string, any>
  branding: PublicInvoiceBranding
}

function fmt(n: number | string | null | undefined) {
  return `${money(Number(n ?? 0))}`
}


// tel: hrefs choke on formatting characters; digits (and a leading +) are all a
// dialer wants. The visible label keeps whatever the subscriber typed.
function telHref(phone: string) {
  const digits = phone.replace(/[^\d+]/g, '')
  return `tel:${digits}`
}

export default function PublicInvoicePay({ invoice: inv, branding }: Props) {
  // The SHOP's calendar date. Rendered on a UTC server, an invoice made at 11 pm
  // Eastern printed the next day; branding.state picks the shop's zone, and an explicit
  // zone also keeps the server and browser renders identical. See shop-time.ts.
  const shopTz = shopTimeZone(branding.state)
  const fmtDate = (s: string | null | undefined) => fmtShopDate(s, shopTz)

  const items: LineItem[] = Array.isArray(inv.line_items) ? inv.line_items : []
  const labor = items.filter(i => i.type === 'labor')
  const parts = items.filter(i => i.type === 'parts')

  const isPaid = inv.status === 'paid'
  const isVoid = inv.status === 'void'
  const canPay = !isPaid && !isVoid

  // hd_company_logo_url first: an HD subscriber who set an HD-specific mark meant
  // it to be the one their truck customers see.
  const logoUrl  = branding.hd_company_logo_url ?? branding.business_logo_url ?? null
  const bizName  = branding.business_name ?? 'Heavy Duty Service'
  const bizPhone = branding.phone ?? null
  const bizPlace = [branding.city, branding.state].filter(Boolean).join(', ')

  // Two envelope lines rather than one run-together comma string, so a long
   // street and a city/state/zip do not wrap mid-address on a phone.
  const billToLines = addressLines(addressFrom(inv))

  // The unit the work was done on. Empty array means the invoice knows nothing
  // about it, and the block is hidden rather than printing a bare heading.
  const unitLines = serviceUnitLines(inv)

  // Manufacturer and certification claims, conditional on what this invoice is
  // actually for. See documentDisclaimers.
  const disclaimers = documentDisclaimers(inv)

  // Empty on a pre-140 invoice, which then keeps the single Tax line it was sent with.
  const payTaxRows = taxDisplayRows(parseBreakdown((inv as { tax_breakdown?: unknown }).tax_breakdown))

  // Migration 168. The discount, and the terms this invoice recorded (at send, or
  // carried from its quote). Neither exists on an older invoice, which prints as before.
  const discount = parseDiscount(inv.discount)
  const snap = parseTermsSnapshot(inv.terms_snapshot)
  // A paid or voided invoice does not ask for money: no How to pay on it.
  const termsRows = hdTermsBlockRows(snap).filter(r => r.key !== 'how_to_pay' || canPay)
  // The invoice's own terms, else the ones it recorded, else none - never a default.
  const termsCode: string | null =
    (typeof inv.payment_terms === 'string' && inv.payment_terms.trim()) || snap?.payment_terms || null

  const summaryRows = [
    ...(Number(inv.subtotal_labor)  > 0 ? [{ label: 'Labor Subtotal',  val: inv.subtotal_labor  }] : []),
    ...(Number(inv.subtotal_parts)  > 0 ? [{ label: 'Parts Subtotal',  val: inv.subtotal_parts  }] : []),
    // feeRows is the shared rule: a zero fee prints no line at all. See the
    // migration 057 DEFAULT 125.00 note on it.
    ...feeRows(inv).map(r => ({ label: r.label, val: r.amount })),
    // Travel, mileage and shop supplies, each as its own labelled line and never
    // folded into labor or parts. Read from the stored columns, never recomputed.
    // A zero prints nothing — extrasDisplayRows returns no row for it.
    ...extrasDisplayRows(extrasFromDocument(inv)).map(r => ({
      label: r.detail ? `${r.label} (${r.detail})` : r.label,
      val:   r.amount,
    })),
    // The discount sits between the subtotal and the tax, and only when there is one.
    ...(discount ? [
      { label: 'Subtotal', val: discount.subtotal_before },
      { label: discountPrintLabel(discount), val: -discount.amount, testid: 'discount-row' },
    ] : []),
    // tax_rate is stored as a percent (7.5 means 7.5%), not a fraction.
    //
    // When the invoice carries a breakdown, each category becomes its own row --
    // including an untaxed one, which is how the customer can see that labor was not
    // taxed rather than having to work it out from a total. Pre-140 invoices have no
    // breakdown and keep the single Tax line they were sent with.
    ...(payTaxRows.length > 0
      ? payTaxRows.map(r => ({ label: r.text, val: r.taxed ? r.amount : 0, testid: 'tax-row' }))
      : Number(inv.tax_amount) > 0 ? [{ label: `Tax (${inv.tax_rate}%)`, val: inv.tax_amount, testid: 'tax-row' }] : []),
  ] as Array<{ label: string; val: number; testid?: string }>

  return (
    <div style={{ background: BG, color: TEXT, minHeight: '100dvh', padding: '16px 12px 40px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* ── Subscriber branding. The shop's mark leads the document. ───────── */}
        <div className="flex items-center gap-3 px-1 pb-4">
          {logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={logoUrl}
              alt={bizName}
              style={{ height: 52, maxWidth: 180, objectFit: 'contain' }}
            />
          ) : (
            <div className="w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: ORANGE }}>
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <rect x="1" y="3" width="15" height="13" rx="2" />
                <path d="M16 8h4l3 5v3h-7V8z" />
                <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
            </div>
          )}
          <div className="min-w-0">
            <p className="font-condensed font-bold text-lg tracking-wide truncate" style={{ color: TEXT }}>{bizName}</p>
            {bizPlace && <p className="text-xs" style={{ color: MUTED }}>{bizPlace}</p>}
            <p className="text-xs" style={{ color: MUTED }}>
              {[bizPhone, branding.email].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>

        {/* ── Status banners ────────────────────────────────────────────────── */}
        {isPaid && (
          <div className="mb-4 px-4 py-3 rounded-xl" style={{ background: '#DCFCE7', border: '1px solid #86EFAC' }}>
            <p className="font-bold text-sm" style={{ color: '#15803d' }}>Paid in Full</p>
            <p className="text-xs mt-0.5" style={{ color: '#15803d' }}>
              {inv.paid_at ? `Received ${fmtDate(inv.paid_at)}. Thank you!` : 'Thank you!'}
            </p>
          </div>
        )}
        {isVoid && (
          <div className="mb-4 px-4 py-3 rounded-xl" style={{ background: '#F3F4F6', border: `1px solid ${BORDER}` }}>
            <p className="font-bold text-sm" style={{ color: MUTED }}>This invoice has been voided</p>
            <p className="text-xs mt-0.5" style={{ color: FAINT }}>
              No payment is due. Contact {bizName} with any questions.
            </p>
          </div>
        )}

        {/* ── Invoice document ──────────────────────────────────────────────── */}
        <div style={{ background: CARD, borderRadius: 12, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>

          <div
            className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 px-5 sm:px-7 py-5"
            style={{ borderBottom: `3px solid ${ORANGE}` }}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: FAINT }}>Invoice</p>
              <p className="font-bold text-2xl" style={{ color: ACCENT }}>{inv.invoice_number}</p>
            </div>
            <div className="sm:text-right text-sm" style={{ color: MUTED }}>
              <p>Date: {fmtDate(inv.created_at)}</p>
              {inv.work_order_number && <p>Work Order: {inv.work_order_number}</p>}
              {/* The customer's own PO (migration 157). This is the page their accounts
                  payable actually opens, and a PO invoice with no PO on it is the one
                  that gets set aside. */}
              {inv.customer_po_number && (
                <p className="font-semibold" style={{ color: '#374151' }}>PO #: {inv.customer_po_number}</p>
              )}
              {/* "Net 30 — due 10/14/2026", one phrasing on every surface. No terms
                  recorded anywhere prints no line - it used to print "Due on receipt". */}
              {termsCode && (
                <p className={inv.due_date && !isPaid && !isVoid ? 'font-semibold' : undefined} data-testid="payment-terms"
                   style={{ color: inv.due_date && !isPaid && !isVoid && inv.status === 'overdue' ? '#b91c1c' : MUTED }}>
                  Terms: {isPaid || isVoid
                    ? termsDisplay(termsCode)
                    : termsWithDueDate(termsCode, inv.due_date)}
                </p>
              )}
            </div>
          </div>

          <div className="px-5 sm:px-7 py-5">

            {/* Bill To + Service Unit. Stacked on a phone, side by side above it. */}
            <div className="mb-6 pb-6 grid grid-cols-1 sm:grid-cols-2 gap-5" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: FAINT }}>Bill To</h3>
                <p className="font-semibold text-base" style={{ color: TEXT }}>{inv.customer_name}</p>
                {billToLines.map((l, i) => (
                  <p key={i} className="text-sm mt-0.5" style={{ color: MUTED }}>{l}</p>
                ))}
                {inv.customer_phone && <p className="text-sm mt-1" style={{ color: MUTED }}>{inv.customer_phone}</p>}
                {inv.customer_email && <p className="text-sm" style={{ color: MUTED }}>{inv.customer_email}</p>}
              </div>
              {unitLines.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: FAINT }}>Service Unit</h3>
                  {unitLines.map((l, i) => (
                    l.label
                      ? <p key={i} className="text-sm mt-0.5" style={{ color: MUTED }}>{l.label}: {l.value}</p>
                      : <p key={i} className="font-semibold text-base" style={{ color: TEXT }}>{l.value}</p>
                  ))}
                </div>
              )}
            </div>

            {/* Labor */}
            {labor.length > 0 && (
              <div className="mb-5">
                <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: FAINT }}>Labor</h3>
                <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
                  {labor.map((item, i) => (
                    <div
                      key={item.id ?? `labor-${i}`}
                      className="flex items-start justify-between gap-3 px-4 py-3"
                      style={{ borderBottom: i === labor.length - 1 ? 'none' : `1px solid #F3F4F6` }}
                    >
                      <div className="min-w-0">
                        <p className="text-sm" style={{ color: TEXT }}>{item.description}</p>
                        <p className="text-xs mt-0.5" style={{ color: FAINT }}>
                          {Number(item.mobile_hours ?? 0)}h × {fmt(inv.labor_rate)}/hr
                        </p>
                      </div>
                      <span className="text-sm font-semibold flex-shrink-0" style={{ color: TEXT }}>{fmt(item.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Parts */}
            {parts.length > 0 && (
              <div className="mb-5">
                <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: FAINT }}>Parts</h3>
                <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
                  {parts.map((item, i) => (
                    <div
                      key={item.id ?? `parts-${i}`}
                      className="flex items-start justify-between gap-3 px-4 py-3"
                      style={{ borderBottom: i === parts.length - 1 ? 'none' : `1px solid #F3F4F6` }}
                    >
                      <div className="min-w-0">
                        <p className="text-sm" style={{ color: TEXT }}>{item.description}</p>
                        {item.part_number && (
                          <p className="text-xs font-mono mt-0.5" style={{ color: BLUE }}>{item.part_number}</p>
                        )}
                        <p className="text-xs mt-0.5" style={{ color: FAINT }}>
                          {Number(item.quantity ?? 0)} × {fmt(item.unit_cost)}
                        </p>
                      </div>
                      <span className="text-sm font-semibold flex-shrink-0" style={{ color: TEXT }}>{fmt(item.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {items.length === 0 && (
              <p className="text-sm mb-5" style={{ color: FAINT }}>No line items on this invoice.</p>
            )}

            {/* Totals */}
            <div className="flex justify-end mb-6">
              <div className="w-full sm:w-80">
                {summaryRows.map(r => (
                  <div
                    key={r.label}
                    className="flex justify-between py-2 text-sm"
                    data-testid={r.testid}
                    style={{ color: MUTED, borderBottom: '1px solid #F3F4F6' }}
                  >
                    {/* fmt(-25) is ONE text node: "-$25.00". */}
                    <span>{r.label}</span><span>{fmt(r.val)}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center py-3" style={{ borderTop: `2px solid ${ORANGE}`, marginTop: 4 }}>
                  <span className="font-bold text-base" style={{ color: TEXT }}>
                    {isPaid ? 'TOTAL PAID' : isVoid ? 'TOTAL' : 'AMOUNT DUE'}
                  </span>
                  <span className="font-bold text-3xl" style={{ color: isVoid ? MUTED : ACCENT }}>{fmt(inv.total)}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {inv.notes && (
              <div className="p-4 rounded-lg" style={{ background: '#F9FAFB', border: `1px solid ${BORDER}` }}>
                <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: FAINT }}>Notes</h3>
                <p className="text-sm leading-relaxed" style={{ color: '#374151' }}>{inv.notes}</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Payment ───────────────────────────────────────────────────────────
            There is no Stripe payment-intent flow for HD invoices in this codebase,
            so this button CANNOT take a card and is rendered disabled. A live-looking
            button that silently does nothing costs the shop the payment and the
            customer's trust; an honest "call to pay" gets the invoice settled today.
            When a payment intent exists, enable the button here. */}
        {canPay && (
          <div
            className="mt-5 px-5 py-5 rounded-xl text-center"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <button
              type="button"
              disabled
              className="w-full font-bold text-base rounded-lg py-3.5 cursor-not-allowed"
              style={{ background: '#F3F4F6', color: FAINT, border: `1px solid ${BORDER}` }}
            >
              Pay {fmt(inv.total)} Online
            </button>
            <p className="text-xs mt-2" style={{ color: FAINT }}>Online payment coming soon</p>

            {bizPhone ? (
              <>
                <div className="my-4" style={{ borderTop: `1px solid ${BORDER}` }} />
                <p className="text-sm mb-2" style={{ color: MUTED }}>To pay this invoice now, call {bizName}:</p>
                <a
                  href={telHref(bizPhone)}
                  className="inline-block w-full font-bold text-base rounded-lg py-3.5"
                  style={{ background: ORANGE, color: ON_ACCENT }}
                >
                  Call {bizPhone}
                </a>
              </>
            ) : (
              <p className="text-sm mt-3" style={{ color: MUTED }}>
                Contact {bizName} to arrange payment.
              </p>
            )}
          </div>
        )}

        {/* ── HOW TO PAY. The shop's default instructions, in their own bordered
            block. Without it the customer has an amount and no way to settle it. */}
        {/* Older invoices (no recorded terms) keep the block they always printed. One
            with recorded terms prints its How to pay in the terms block below. */}
        {canPay && !snap && branding.default_payment_instructions?.trim() && (
          <div
            className="mt-5 px-5 py-4 rounded-xl"
            style={{ background: CARD, border: `2px solid ${ORANGE}` }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: FAINT }}>How to Pay</h3>
            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#374151' }}>
              {branding.default_payment_instructions.trim()}
            </p>
          </div>
        )}

        {/* ── The terms block: warranty, customer-supplied parts, how to pay - what
            this invoice recorded. Nothing recorded, no block. */}
        {termsRows.length > 0 && (
          <div className="mt-5 px-5 py-4 rounded-xl" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
            <DocumentTermsBlock rows={termsRows} text={TEXT} muted={MUTED} border="transparent" />
          </div>
        )}

        {/* ── Certification and manufacturer notices, only where they apply.
            A refrigeration certification must not appear on an aerial lift
            inspection, and Thermo King must not be named on a Carrier job. */}
        {(disclaimers.epa608 || disclaimers.manufacturers.length > 0) && (
          <div className="mt-5 px-4 text-center space-y-1">
            {disclaimers.epa608 && (
              <p className="text-xs leading-relaxed" style={{ color: MUTED }}>
                {epa608Line(branding.hd_epa_cert_number)}
              </p>
            )}
            {disclaimers.manufacturers.map((l, i) => (
              <p key={i} className="text-xs leading-relaxed" style={{ color: FAINT }}>{l}</p>
            ))}
          </div>
        )}

        {/* Contact footer. No NWI attribution — this document is the shop's. */}
        <p className="text-center text-xs mt-6 px-4 leading-relaxed" style={{ color: FAINT }}>
          Questions about this invoice? Contact {bizName}
          {bizPhone && (
            <> at <a href={telHref(bizPhone)} style={{ color: MUTED, textDecoration: 'underline' }}>{bizPhone}</a></>
          )}
          {branding.email && <> or <a href={`mailto:${branding.email}`} style={{ color: MUTED, textDecoration: 'underline' }}>{branding.email}</a></>}
          .
        </p>

      </div>
    </div>
  )
}
