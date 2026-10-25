'use client'

// The customer's side of an HD quote. No login.
//
// Mirrors LD's QuoteApprovalClient in behaviour and vocabulary - approve, decline, a
// note, and here also a PO number, because an HD customer is usually a fleet and the
// PO is how they will reconcile the invoice later.
//
// WHAT IT SHOWS BEFORE THE CUSTOMER COMMITS: every line, the hours and rate behind the
// labor, the extras itemized, the tax, and the total. A customer approving a number
// they cannot see the inside of is how a dispute starts.

import { useState } from 'react'
import { discountPrintLabel, parseDiscount } from '@/lib/document-discount'
import { documentPaymentTerms, hdTermsBlockRows, parseTermsSnapshot } from '@/lib/document-terms'
import { parseBreakdown, taxDisplayRows } from '@/lib/tax'
import DocumentTermsBlock from '@/components/hd/DocumentTermsBlock'

// The brand fills, unchanged, with DARK text: #1A1A1A is 4.99:1 on #E85D24 and 4.62:1
// on #EF4444, where white was 3.49:1 and 3.76:1. Inline, so no theme remap touches it.
const APPROVE_BG = '#E85D24'
const DECLINE_BG = '#EF4444'
const ON_FILL    = '#1A1A1A'

interface QuoteLine {
  type?: string
  description?: string
  part_number?: string
  quantity?: number
  unit_cost?: number
  unit_price?: number
  amount?: number
  mobile_hours?: number
  book_hours?: number
}

export interface PublicHDQuote {
  id: string
  quote_number: string
  status: string
  customer_name: string | null
  unit_manufacturer: string | null
  unit_model: string | null
  unit_serial: string | null
  unit_number: string | null
  truck_make: string | null
  truck_model: string | null
  vin: string | null
  complaint: string | null
  diagnosis: string | null
  notes: string | null
  line_items: QuoteLine[] | null
  labor_rate: number | null
  subtotal_labor: number | null
  subtotal_parts: number | null
  diagnostic_fee: number | null
  road_call_fee: number | null
  travel_hours: number | null
  travel_rate: number | null
  travel_amount: number | null
  mileage_miles: number | null
  mileage_rate: number | null
  mileage_amount: number | null
  shop_supplies_percent_applied: number | null
  shop_supplies_fee: number | null
  tax_rate: number | null
  tax_amount: number | null
  /** Migration 140: the tax per bucket, each at the rate it was charged. */
  tax_breakdown?: unknown
  total: number | null
  payment_terms: string | null
  /** Migration 168: the discount and the terms this quote recorded. */
  discount?: unknown
  terms_snapshot?: unknown
  valid_until: string | null
  approved_at: string | null
  declined_at: string | null
  customer_po_number: string | null
}

const money = (n: number | null | undefined): string =>
  n == null ? '--' : `$${Number(n).toFixed(2)}`

const hours = (n: number | null | undefined): string =>
  n == null ? '' : `${Number(n)} hr${Number(n) === 1 ? '' : 's'}`

export default function HDQuoteApprovalClient({
  quote,
  businessName,
}: {
  quote: PublicHDQuote
  businessName: string
}) {
  const discount = parseDiscount(quote.discount)
  const taxRows = taxDisplayRows(parseBreakdown(quote.tax_breakdown))
  const snap = parseTermsSnapshot(quote.terms_snapshot)
  const paymentTerms = documentPaymentTerms(quote.payment_terms, snap)
  const termsRows = hdTermsBlockRows(snap)
  const [po, setPo] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ status: string; workOrder?: string | null; message?: string } | null>(
    quote.approved_at ? { status: 'approved' }
      : quote.declined_at ? { status: 'declined' }
      : null,
  )
  const [confirming, setConfirming] = useState<'decline' | null>(null)

  const lines = Array.isArray(quote.line_items) ? quote.line_items : []
  const token = typeof window !== 'undefined' ? window.location.pathname.split('/').pop() : ''

  async function respond(decision: 'approve' | 'decline') {
    setBusy(decision)
    setError(null)
    try {
      const res = await fetch(`/api/hd/quotes/public/${token}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: note || null, po_number: po || null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not record your response.')
      setDone({
        status: json.status ?? decision,
        workOrder: json.work_order?.number ?? json.work_order_number ?? null,
        message: json.message ?? json.warning ?? undefined,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record your response.')
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  // ── already answered, or just answered ───────────────────────────────────
  if (done) {
    const approved = done.status === 'approved'
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <div
          className="w-14 h-14 rounded-full mx-auto mb-5 flex items-center justify-center text-2xl"
          style={{ background: approved ? '#22C55E22' : 'rgba(var(--hd-ink-rgb), 0.08)' }}
        >
          {approved ? '✓' : '—'}
        </div>
        <h1 className="font-condensed font-bold text-2xl mb-2" style={{ color: 'var(--hd-text)' }}>
          {approved ? 'Approved. Thank you.' : 'Quote declined'}
        </h1>
        <p className="text-sm mb-1" style={{ color: 'var(--hd-text-muted)' }}>
          {quote.quote_number} &middot; {businessName}
        </p>
        {approved && done.workOrder && (
          <p className="text-sm mt-4" style={{ color: 'rgba(var(--hd-ink-rgb), 0.75)' }}>
            Your job is scheduled as <span className="font-semibold">{done.workOrder}</span>.
          </p>
        )}
        {done.message && (
          <p className="text-xs mt-3" style={{ color: 'var(--hd-text-muted)' }}>{done.message}</p>
        )}
        {!approved && (
          <p className="text-sm mt-4" style={{ color: 'var(--hd-text-muted)' }}>
            Nothing has been scheduled. {businessName} will follow up if you would like to
            revisit any of it.
          </p>
        )}
      </div>
    )
  }

  const unit = [quote.unit_manufacturer, quote.unit_model].filter(Boolean).join(' ')
  const truck = [quote.truck_make, quote.truck_model].filter(Boolean).join(' ')

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--hd-text-faint)' }}>
          Quote for approval
        </p>
        <h1 className="font-condensed font-bold text-3xl tracking-wide" style={{ color: 'var(--hd-text)' }}>
          {quote.quote_number}
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--hd-text-muted)' }}>
          From {businessName}
          {quote.customer_name ? ` for ${quote.customer_name}` : ''}
        </p>
        {quote.valid_until && (
          <p className="text-xs mt-1" style={{ color: 'var(--hd-text-muted)' }}>
            Valid until {new Date(quote.valid_until).toLocaleDateString()}
          </p>
        )}
      </div>

      {(unit || truck || quote.unit_serial || quote.vin) && (
        <div className="rounded-xl p-4 mb-4" style={{ background: 'rgba(var(--hd-ink-rgb), 0.04)' }}>
          {unit && <p className="text-sm" style={{ color: 'var(--hd-text)' }}>{unit}</p>}
          {truck && <p className="text-sm" style={{ color: 'var(--hd-text)' }}>{truck}</p>}
          <p className="text-xs mt-1" style={{ color: 'var(--hd-text-muted)' }}>
            {[
              quote.unit_number && `Unit ${quote.unit_number}`,
              quote.unit_serial && `Serial ${quote.unit_serial}`,
              quote.vin && `VIN ${quote.vin}`,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
      )}

      {quote.complaint && (
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--hd-text-faint)' }}>
            Reported problem
          </p>
          <p className="text-sm" style={{ color: 'var(--hd-text)' }}>{quote.complaint}</p>
        </div>
      )}
      {quote.diagnosis && (
        <div className="mb-4">
          <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--hd-text-faint)' }}>
            What we found
          </p>
          <p className="text-sm" style={{ color: 'var(--hd-text)' }}>{quote.diagnosis}</p>
        </div>
      )}

      {/* THE LINES. Shown with the hours and rate behind the labor, because a customer
          approving a figure they cannot see inside of is how a dispute starts. */}
      <div className="rounded-xl border mb-4" style={{ borderColor: 'rgba(var(--hd-ink-rgb), 0.12)' }}>
        <div className="px-4 py-2 text-xs uppercase tracking-wider"
          style={{ background: 'rgba(var(--hd-ink-rgb), 0.04)', color: 'var(--hd-text-muted)' }}>
          What this covers
        </div>
        {lines.length === 0 ? (
          <p className="px-4 py-4 text-sm" style={{ color: 'var(--hd-text-muted)' }}>
            No line items on this quote.
          </p>
        ) : (
          <ul>
            {lines.map((l, i) => {
              const isLabor = String(l.type ?? '').toLowerCase().startsWith('lab')
              const h = l.mobile_hours ?? l.book_hours ?? null
              return (
                <li key={i} className="px-4 py-3 border-t flex items-start justify-between gap-3"
                  style={{ borderColor: 'rgba(var(--hd-ink-rgb), 0.08)' }}>
                  <div className="min-w-0">
                    <p className="text-sm" style={{ color: 'var(--hd-text)' }}>
                      {l.description || l.part_number || (isLabor ? 'Labor' : 'Part')}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--hd-text-muted)' }}>
                      {isLabor
                        ? [h != null && hours(h), quote.labor_rate != null && `at ${money(quote.labor_rate)}/hr`]
                            .filter(Boolean).join(' ')
                        : [l.part_number, l.quantity != null && `qty ${l.quantity}`]
                            .filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <p className="text-sm font-medium shrink-0" style={{ color: 'var(--hd-text)' }}>
                    {money(l.amount)}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* The money, itemized. Every extra named rather than folded into a subtotal. */}
      <div className="rounded-xl p-4 mb-6" style={{ background: 'rgba(var(--hd-ink-rgb), 0.04)' }}>
        {([
          ['Labor', quote.subtotal_labor],
          ['Parts', quote.subtotal_parts],
          ['Diagnostic', quote.diagnostic_fee],
          ['Road call', quote.road_call_fee],
          [quote.travel_hours ? `Travel (${hours(quote.travel_hours)})` : 'Travel', quote.travel_amount],
          [quote.mileage_miles ? `Mileage (${quote.mileage_miles} mi)` : 'Mileage', quote.mileage_amount],
          [quote.shop_supplies_percent_applied != null
            ? `Shop supplies (${quote.shop_supplies_percent_applied}%)` : 'Shop supplies',
            quote.shop_supplies_fee],
        ] as Array<[string, number | null]>)
          .filter(([, v]) => v != null && Number(v) !== 0)
          .map(([label, v]) => (
            <div key={label} className="flex justify-between text-sm py-0.5">
              <span style={{ color: 'var(--hd-text-muted)' }}>{label}</span>
              <span style={{ color: 'var(--hd-text)' }}>{money(v)}</span>
            </div>
          ))}
        {/* The discount: between the subtotal and the tax, only when there is one. The
            amount is ONE text node - '-' and the figure in a single string. */}
        {discount && (
          <>
            <div className="flex justify-between text-sm py-0.5 mt-1 pt-1 border-t" style={{ borderColor: 'rgba(var(--hd-ink-rgb), 0.12)' }}>
              <span style={{ color: 'var(--hd-text-muted)' }}>Subtotal</span>
              <span style={{ color: 'var(--hd-text)' }}>{money(discount.subtotal_before)}</span>
            </div>
            <div className="flex justify-between text-sm py-0.5" data-testid="discount-row">
              <span style={{ color: 'var(--hd-text-muted)' }}>{discountPrintLabel(discount)}</span>
              <span style={{ color: 'var(--hd-positive)' }}>{'-' + money(discount.amount)}</span>
            </div>
          </>
        )}
        {/* The tax as recorded: per bucket with each bucket's own rate, or the single
            line a quote saved before migration 140 carries. */}
        {(taxRows.length > 0
          ? taxRows.filter(r => r.taxed && r.amount > 0).map(r => [r.text, r.amount] as [string, number])
          : Number(quote.tax_amount) > 0 ? [[quote.tax_rate ? `Tax (${quote.tax_rate}%)` : 'Tax', Number(quote.tax_amount)] as [string, number]] : []
        ).map(([label, v]) => (
          <div key={label} className="flex justify-between text-sm py-0.5" data-testid="tax-row">
            <span style={{ color: 'var(--hd-text-muted)' }}>{label}</span>
            <span style={{ color: 'var(--hd-text)' }}>{money(v)}</span>
          </div>
        ))}
        <div className="flex justify-between items-baseline mt-3 pt-3 border-t"
          style={{ borderColor: 'rgba(var(--hd-ink-rgb), 0.12)' }}>
          <span className="font-condensed font-bold uppercase tracking-wide" style={{ color: 'var(--hd-text)' }}>
            Total
          </span>
          <span className="font-bold text-xl" style={{ color: 'var(--hd-text)' }}>{money(quote.total)}</span>
        </div>
        {/* The quote's own terms, else the ones it recorded, else nothing. Printed as
            "Net 30", never the stored code ("net30"). */}
        {paymentTerms && (
          <p className="text-xs mt-2" style={{ color: 'var(--hd-text-muted)' }} data-testid="payment-terms">
            Payment terms: {paymentTerms}
          </p>
        )}
      </div>

      {/* The customer's own fields. PO first - for a fleet it is the thing they need to
          put on before anything is authorized. */}
      <label className="block mb-3">
        <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--hd-text-muted)' }}>
          Your PO number <span style={{ opacity: 0.6 }}>(optional)</span>
        </span>
        <input
          value={po}
          onChange={e => setPo(e.target.value)}
          placeholder="PO-12345"
          className="w-full mt-1 rounded-lg px-3 py-2 text-sm border"
          style={{ borderColor: 'rgba(var(--hd-ink-rgb), 0.18)', background: 'transparent', color: 'var(--hd-text)' }}
        />
      </label>

      <label className="block mb-5">
        <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--hd-text-muted)' }}>
          Anything we should know <span style={{ opacity: 0.6 }}>(optional)</span>
        </span>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={3}
          placeholder="Access hours, gate code, who to call on arrival..."
          className="w-full mt-1 rounded-lg px-3 py-2 text-sm border"
          style={{ borderColor: 'rgba(var(--hd-ink-rgb), 0.18)', background: 'transparent', color: 'var(--hd-text)' }}
        />
      </label>

      {/* The terms the customer is agreeing to, recorded when the quote was sent. */}
      <div className="mb-6">
        <DocumentTermsBlock rows={termsRows} text="var(--hd-text)" muted="var(--hd-text-muted)" border="rgba(var(--hd-ink-rgb), 0.12)" />
      </div>

      {error && <p className="text-sm mb-3" style={{ color: 'var(--hd-negative)' }}>{error}</p>}

      {confirming === 'decline' ? (
        <div className="rounded-xl p-4 mb-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <p className="text-sm mb-3" style={{ color: 'var(--hd-text)' }}>
            Decline this quote? Nothing will be scheduled. {businessName} will see your
            note and can follow up.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => void respond('decline')}
              disabled={busy !== null}
              className="px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
              style={{ background: DECLINE_BG, color: ON_FILL }}
            >
              {busy === 'decline' ? 'Recording...' : 'Yes, decline'}
            </button>
            <button
              onClick={() => setConfirming(null)}
              disabled={busy !== null}
              className="px-4 py-2 rounded-lg text-sm"
              style={{ color: 'var(--hd-text-muted)' }}
            >
              Go back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => void respond('approve')}
            disabled={busy !== null}
            className="flex-1 py-3 rounded-xl font-condensed font-bold tracking-wide disabled:opacity-50"
            style={{ background: APPROVE_BG, color: ON_FILL }}
          >
            {busy === 'approve' ? 'Approving...' : `APPROVE ${money(quote.total)}`}
          </button>
          <button
            onClick={() => setConfirming('decline')}
            disabled={busy !== null}
            className="px-6 py-3 rounded-xl text-sm border"
            style={{ borderColor: 'rgba(var(--hd-ink-rgb), 0.18)', color: 'rgba(var(--hd-ink-rgb), 0.7)' }}
          >
            Decline
          </button>
        </div>
      )}

      <p className="text-xs text-center mt-4" style={{ color: 'var(--hd-text-faint)' }}>
        Approving authorizes {businessName} to carry out the work above at this price.
      </p>
    </div>
  )
}
