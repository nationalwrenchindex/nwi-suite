// HD quote -> invoice, directly ("Bill Directly"), skipping the work order.
//
// ONE BODY FOR BOTH BUTTONS. The quote detail screen and the quote list each built
// their own POST body by hand, and the two had drifted: the list dropped the address,
// the terms, the fleet links and the PO, and BOTH dropped tax_breakdown and all nine
// travel / mileage / shop supplies columns - while still sending the quote's full
// total. So an invoice could carry a total containing charges it did not display, the
// same money bug as the dropped road call fee, by another road.
//
// Everything is COPIED off the quote row, never recomputed. The quote is what the
// customer saw; the bill must say the same thing to the cent.

export function invoiceBodyFromQuote(q: Record<string, unknown>): Record<string, unknown> {
  const corp = !!q.has_corp_address
  return {
    quote_id:           q.id,
    customer_id:        q.customer_id ?? null,
    customer_name:      q.customer_name,
    customer_phone:     q.customer_phone,
    customer_email:     q.customer_email,
    address_line1:      q.address_line1,
    address_line2:      q.address_line2,
    city:               q.city,
    state:              q.state,
    zip:                q.zip,
    has_corp_address:   corp,
    corp_address_line1: corp ? q.corp_address_line1 : null,
    corp_address_line2: corp ? q.corp_address_line2 : null,
    corp_city:          corp ? q.corp_city  : null,
    corp_state:         corp ? q.corp_state : null,
    corp_zip:           corp ? q.corp_zip   : null,
    // The quote's own terms, or none - never a guessed Net 30 (Brock, Oct 25).
    payment_terms:      q.payment_terms ?? null,
    fleet_account_id:   q.fleet_account_id ?? null,
    unit_id:            q.unit_id ?? null,
    unit_number:        q.unit_number ?? null,
    unit_manufacturer:  q.unit_manufacturer,
    unit_model:         q.unit_model,
    unit_serial:        q.unit_serial,
    unit_year:          q.unit_year,
    truck_make:         q.truck_make,
    truck_model:        q.truck_model,
    truck_year:         q.truck_year,
    vin:                q.vin,
    complaint:          q.complaint,
    diagnosis:          q.diagnosis,
    line_items:         q.line_items,
    labor_rate:         q.labor_rate,
    parts_markup_percent: q.parts_markup_percent ?? null,
    subtotal_labor:     q.subtotal_labor,
    subtotal_parts:     q.subtotal_parts,
    diagnostic_fee:     q.diagnostic_fee,
    road_call_fee:      q.road_call_fee,

    // The billable extras, as the quote recorded them. These are inside q.total, so
    // leaving them off is an invoice whose lines do not add up to its own total.
    travel_hours:                  q.travel_hours ?? null,
    travel_rate:                   q.travel_rate ?? null,
    travel_amount:                 q.travel_amount ?? null,
    mileage_miles:                 q.mileage_miles ?? null,
    mileage_rate:                  q.mileage_rate ?? null,
    mileage_amount:                q.mileage_amount ?? null,
    shop_supplies_percent_applied: q.shop_supplies_percent_applied ?? null,
    shop_supplies_cap_applied:     q.shop_supplies_cap_applied ?? null,
    shop_supplies_fee:             q.shop_supplies_fee ?? null,

    // The tax as agreed, per bucket. tax_breakdown is what the invoice prints its tax
    // rows from; without it the customer copy cannot say what was taxed.
    tax_rate:           q.tax_rate,
    tax_amount:         q.tax_amount,
    tax_breakdown:      q.tax_breakdown ?? null,
    total:              q.total,
    // Migration 168. q.total and the tax above are already after this discount; the
    // record says what came off and what the tax was before it.
    discount:           q.discount ?? null,
    // The terms the quote recorded when it was sent. The invoice keeps them.
    terms_snapshot:     q.terms_snapshot ?? null,
    notes:              q.notes,
    tech_name:          q.tech_name ?? null,
    // The insert route strips this if migration 157 has not been applied.
    customer_po_number: q.customer_po_number ?? null,
    status:             'unpaid',
  }
}
