// Which HD quotes can be edited, and which fields an edit may write.
//
// DRAFT and SENT are fully editable: customer, unit, line items, rates, fees, terms,
// notes. APPROVED stays LOCKED - the customer agreed to those numbers, and a work order
// may already be running on them. A DECLINED quote is locked too: it is a record of
// what the customer turned down. "Edit as New Version" (a fresh draft cloned from a
// locked quote) is banked as a separate feature; it needs hd_quotes.parent_quote_id.

export const EDITABLE_QUOTE_STATUSES = ['draft', 'sent'] as const

export function isQuoteEditable(status: unknown): boolean {
  return (EDITABLE_QUOTE_STATUSES as readonly string[]).includes(String(status ?? ''))
}

/** Why a quote cannot be edited, in the words the tech reads. */
export function quoteLockReason(status: unknown): string {
  switch (String(status ?? '')) {
    case 'approved':
      return 'This quote was approved by the customer, so it is locked: they agreed to these numbers. Any change belongs on the work order.'
    case 'declined':
      return 'This quote was declined by the customer, so it is locked as a record of what they turned down.'
    default:
      return 'This quote cannot be edited in its current state.'
  }
}

/**
 * Every column an edit may write: what the quote form sends, and nothing else.
 *
 * An allow-list rather than the raw body. The route used to spread whatever arrived
 * into the update, so a PUT could set user_id, quote_number, approved_at, an approval
 * method or a public token. Status is handled separately by the route.
 */
export const QUOTE_EDIT_FIELDS = [
  'customer_name', 'customer_phone', 'customer_email', 'customer_id',
  'fleet_account_id', 'unit_id',
  'address_line1', 'address_line2', 'city', 'state', 'zip',
  'has_corp_address', 'corp_address_line1', 'corp_address_line2', 'corp_city', 'corp_state', 'corp_zip',
  'payment_terms',
  'unit_number', 'unit_manufacturer', 'unit_model', 'unit_serial', 'unit_year',
  'truck_make', 'truck_model', 'truck_year', 'vin',
  'complaint', 'diagnosis',
  'line_items', 'labor_rate', 'subtotal_labor', 'subtotal_parts',
  'diagnostic_fee', 'road_call_fee',
  'tax_rate', 'tax_breakdown', 'tax_amount', 'total',
  'travel_hours', 'travel_rate', 'travel_amount',
  'mileage_miles', 'mileage_rate', 'mileage_amount',
  'shop_supplies_percent_applied', 'shop_supplies_cap_applied', 'shop_supplies_fee',
  'notes', 'valid_until', 'customer_po_number', 'tech_name',
] as const

export function quoteEditUpdate(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of QUOTE_EDIT_FIELDS) if (k in body) out[k] = body[k]
  return out
}
