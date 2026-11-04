// What travels between HD documents that the money converters do not carry.
//
// None of this is money. quote-approval.ts and wo-to-invoice.ts carry every price, rate,
// tax and fee, and are not touched by this file. These are the fields that fell through
// the gap because hd_work_orders has no column for them, so a job that went quote ->
// work order -> invoice lost them in the middle:
//
//   - the quote's internal notes, and the customer's note when they approved;
//   - the customer-facing notes printed on the quote (they reached the work order as
//     internal notes and never reached the invoice);
//   - the customer's email (the invoice has nowhere to send without retyping it);
//   - the service address, when the quote had one apart from the billing address.
//
// THE WORK ORDER IS STILL THE SOURCE where it has the field. These only fill what the
// invoice payload would otherwise leave empty, and read the quote the work order was
// approved from - its recorded values, never a recomputation.

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * The service location a work order is opened with from its quote: the service address
 * when the quote has one apart from the billing address, else the billing address. One
 * line, as hd_work_orders.location stores it.
 */
export function serviceLocationFromQuote(quote: Record<string, unknown>): string {
  const useCorp = Boolean(quote.has_corp_address)
  const line1 = useCorp ? quote.corp_address_line1 : quote.address_line1
  const line2 = useCorp ? quote.corp_address_line2 : quote.address_line2
  const city  = useCorp ? quote.corp_city  : quote.city
  const state = useCorp ? quote.corp_state : quote.state
  const zip   = useCorp ? quote.corp_zip   : quote.zip
  return [
    line1, line2,
    [city, state].filter(v => String(v ?? '').trim() !== '').join(', '),
    zip,
  ]
    .map(v => String(v ?? '').trim())
    .filter(v => v !== '')
    .join(', ')
}

/**
 * The work order's internal notes, from its quote. The quote's printed notes come first,
 * exactly as before (a quote with nothing else gives the same text it always did); then
 * the quote's own internal notes and the customer's note when they approved, which used
 * to be dropped.
 */
export function workOrderNotesFromQuote(quote: Record<string, unknown>): string | null {
  const parts = [
    text(quote.notes),
    text(quote.internal_notes),
    text(quote.customer_response_note) ? `Customer's note on approval: ${text(quote.customer_response_note)}` : '',
  ].filter(Boolean)
  return parts.length ? [...new Set(parts)].join('\n\n') : null
}

/**
 * What the invoice payload gains from the quote the work order came from, and the fleet
 * account it is billed to. Only keys the payload leaves empty; never a money key.
 *
 *   customer_email   the fleet account's contact email (contact info is read live), else
 *                    the email the quote recorded.
 *   notes            the quote's customer-facing notes, printed on the invoice as they
 *                    were printed on the quote.
 *   service address  the quote's service address, ONLY while the work order's location
 *                    is still the one opened from the quote. A job the tech moved to
 *                    another site is not billed at the quote's address.
 */
export function invoiceCarryFromQuote(
  payload: Record<string, unknown>,
  wo: Record<string, unknown>,
  quote: Record<string, unknown> | null,
  fleet: { contact_email?: unknown } | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const q = quote ?? {}

  if (!text(payload.customer_email)) {
    const email = text(fleet?.contact_email) || text(q.customer_email)
    if (email) out.customer_email = email
  }

  if (!quote) return out

  if (!text(payload.notes) && text(q.notes)) out.notes = text(q.notes)

  const moved = text(wo.location) !== '' && text(wo.location) !== serviceLocationFromQuote(q)
  if (!payload.has_corp_address && q.has_corp_address && text(q.corp_address_line1) && !moved) {
    out.has_corp_address   = true
    out.corp_address_line1 = q.corp_address_line1 ?? null
    out.corp_address_line2 = q.corp_address_line2 ?? null
    out.corp_city          = q.corp_city  ?? null
    out.corp_state         = q.corp_state ?? null
    out.corp_zip           = q.corp_zip   ?? null
  }
  return out
}
