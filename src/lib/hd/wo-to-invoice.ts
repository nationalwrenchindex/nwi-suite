// HD work order -> invoice. The mapping, as pure functions.
//
// ===========================================================================
// WHAT WAS BROKEN
// ===========================================================================
//
// There was no converter. The "Create Invoice" button on an HD work order built a
// QUERY STRING carrying only labor_hours and labor_rate, and the invoice form
// synthesized ONE labor line from it:
//
//     /hd/invoices/new?work_order_id=...&labor_hours=2&labor_rate=135
//
// hd_work_order_line_items was never read by that path - its only consumer was the
// editing widget. So every PART line a technician entered on a work order was visible
// on the work order and never reached the bill. The code said why, in a comment that
// had been true before migration 120 created the table:
//
//     "Work orders carry no line items of their own"
//
// They do. Fifteen rows of them.
//
// ===========================================================================
// THE TWO LINE SHAPES, WHICH ARE GENUINELY DIFFERENT
// ===========================================================================
//
// hd_work_order_line_items (relational, migration 120):
//     type 'labor' | 'part'   <- SINGULAR
//     description, part_number, quantity, unit_cost, unit_price,
//     markup_percent, total, sort_order
//
// hd_invoices.line_items (JSONB), read from four live invoices rather than guessed:
//     labor: { id, type:'labor', amount, quantity:0, unit_cost:0, description,
//              part_number:'', mobile_hours }
//     part:  { id, type:'parts', amount, quantity, unit_cost, description,
//              part_number, mobile_hours:0, markup_percent, unit_cost_base }
//                   ^ PLURAL
//
// Three traps in that mapping, all of which would produce a wrong bill:
//
//   1. 'part' becomes 'parts'. The invoice renderers and the stock ledger both key off
//      this. A line typed 'part' on an invoice renders as neither.
//
//   2. The invoice's unit_cost is the MARKED-UP price the customer pays, and
//      unit_cost_base is what the shop paid. On the work order those are unit_price and
//      unit_cost respectively. Copying unit_cost straight across would bill the
//      customer the shop's cost and lose the margin entirely.
//
//   3. LABOR hours live in `quantity` on the work order (it has no hours column) and in
//      `mobile_hours` on the invoice, with quantity pinned to 0. Copying quantity
//      across would put hours in a quantity field that the invoice multiplies by
//      unit_cost, which is 0 - so the labor would bill as nothing.

/** A row out of hd_work_order_line_items. */
export interface WorkOrderLineRow {
  id?: string
  type?: string | null
  description?: string | null
  part_number?: string | null
  quantity?: number | string | null
  unit_cost?: number | string | null
  unit_price?: number | string | null
  markup_percent?: number | string | null
  total?: number | string | null
  sort_order?: number | null
}

/** A line as hd_invoices.line_items stores it. */
export interface InvoiceLine {
  id: string
  type: 'labor' | 'parts'
  description: string
  part_number: string
  quantity: number
  unit_cost: number
  unit_cost_base?: number | null
  markup_percent?: number | null
  mobile_hours: number
  amount: number
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const r2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Turn work-order lines into invoice lines.
 *
 * Money is COPIED, not recomputed, wherever the work order already has it. `total` on a
 * work-order line is the figure the technician and often the customer have already
 * seen; re-deriving it from quantity x price can land a cent away through rounding, and
 * a bill that disagrees with the work order by a cent is a phone call.
 *
 * It is recomputed ONLY when the work order has no total, which is the one case where
 * there is nothing to copy.
 */
export function invoiceLinesFromWorkOrder(
  rows: WorkOrderLineRow[],
  workOrderLaborRate: number | null,
): InvoiceLine[] {
  const sorted = [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  const out: InvoiceLine[] = []

  for (const r of sorted) {
    const kind = String(r.type ?? '').toLowerCase()
    const isLabor = kind === 'labor' || kind === 'labour'
    const description = (r.description ?? '').toString().trim()
    const partNumber = (r.part_number ?? '').toString().trim()

    // A line with neither is a row the tech cannot act on and the customer cannot
    // read. Dropping it silently is how a billable line disappears, so it is dropped
    // only when BOTH are empty.
    if (!description && !partNumber) continue

    const id = r.id ?? crypto.randomUUID()

    if (isLabor) {
      // Hours out of quantity, into mobile_hours. quantity and unit_cost pinned to 0 to
      // match what the invoice form writes - see the live-data sample above.
      const hoursValue = num(r.quantity) ?? 0
      const rate = num(r.unit_price) ?? workOrderLaborRate ?? 0
      const total = num(r.total)
      out.push({
        id,
        type: 'labor',
        description: description || 'Labor',
        part_number: '',
        quantity: 0,
        unit_cost: 0,
        mobile_hours: hoursValue,
        amount: total ?? r2(hoursValue * rate),
      })
      continue
    }

    const quantity = num(r.quantity) ?? 1
    const cost = num(r.unit_cost)            // what the shop paid
    const price = num(r.unit_price)           // what the customer pays, per unit
    const markup = num(r.markup_percent)
    const total = num(r.total)

    // unit_cost on an INVOICE line is the customer-facing unit price. Falling back to
    // the shop's cost when no price was recorded is deliberate and visible: it bills at
    // cost rather than inventing a margin the tech never set.
    const unitForCustomer = price ?? cost ?? 0

    out.push({
      id,
      type: 'parts',
      description: description || partNumber,
      part_number: partNumber,
      quantity,
      unit_cost: unitForCustomer,
      unit_cost_base: cost,
      markup_percent: markup,
      mobile_hours: 0,
      amount: total ?? r2(quantity * unitForCustomer),
    })
  }

  return out
}

export interface InvoiceTotals {
  subtotal_labor: number
  subtotal_parts: number
  parts_cost: number
  parts_sell: number
}

/**
 * Sum the lines. Labor and parts separately, because the invoice stores them that way
 * and because tax is applied per bucket elsewhere in this codebase.
 *
 * parts_cost is the shop's own cost total - margin reporting, never shown to a
 * customer - and it sums unit_cost_base, not unit_cost. Summing the wrong one would
 * report every job as zero margin.
 */
export function sumInvoiceLines(lines: InvoiceLine[]): InvoiceTotals {
  let labor = 0, parts = 0, cost = 0
  for (const l of lines) {
    if (l.type === 'labor') { labor += l.amount; continue }
    parts += l.amount
    if (l.unit_cost_base != null) cost += l.unit_cost_base * l.quantity
  }
  return {
    subtotal_labor: r2(labor),
    subtotal_parts: r2(parts),
    parts_cost:     r2(cost),
    parts_sell:     r2(parts),
  }
}

/**
 * Every figure the invoice inherits from the WORK ORDER, in one place.
 *
 * "A document's recorded terms beat current settings." These are read off the work
 * order row - which, since migration 153, itself inherited them from the approved
 * quote. So a quote approved at tonight's rate produces a work order at tonight's rate
 * and an invoice at tonight's rate, three documents later, with no settings lookup
 * anywhere in the chain.
 *
 * NOTE THE TAX NAME CHANGE AGAIN: hd_work_orders.tax_percent (added in 153) carries the
 * same value hd_invoices calls tax_rate. Third name for one number across the chain -
 * hd_quotes.tax_rate -> hd_work_orders.tax_percent -> hd_invoices.tax_rate - which is
 * exactly why every hop writes the mapping down instead of spreading an object.
 */
export function invoiceTermsFromWorkOrder(wo: Record<string, unknown>): Record<string, unknown> {
  return {
    labor_rate:                    wo.labor_rate ?? null,
    labor_hours:                   wo.labor_hours ?? null,
    parts_markup_percent:          wo.parts_markup_percent ?? null,

    tax_rate:                      wo.tax_percent ?? null,
    tax_amount:                    wo.tax_amount ?? null,
    tax_breakdown:                 wo.tax_breakdown ?? null,

    travel_hours:                  wo.travel_hours ?? null,
    travel_rate:                   wo.travel_rate ?? null,
    travel_amount:                 wo.travel_amount ?? null,

    mileage_miles:                 wo.mileage_miles ?? null,
    mileage_rate:                  wo.mileage_rate ?? null,
    mileage_amount:                wo.mileage_amount ?? null,

    shop_supplies_percent_applied: wo.shop_supplies_percent_applied ?? null,
    shop_supplies_cap_applied:     wo.shop_supplies_cap_applied ?? null,
    shop_supplies_fee:             wo.shop_supplies_fee ?? null,
  }
}

/** Identity and the authorization record, carried so nothing is retyped. */
export function invoiceIdentityFromWorkOrder(wo: Record<string, unknown>): Record<string, unknown> {
  return {
    work_order_id:     wo.id ?? null,
    work_order_number: wo.work_order_number ?? null,
    customer_id:       wo.customer_id ?? null,
    customer_name:     wo.customer_name ?? null,
    customer_phone:    wo.customer_phone ?? null,
    unit_id:           wo.unit_id ?? null,
    fleet_account_id:  wo.fleet_account_id ?? null,
    unit_manufacturer: wo.unit_manufacturer ?? null,
    unit_model:        wo.unit_model ?? null,
    unit_serial:       wo.unit_serial ?? null,
    unit_number:       wo.unit_number ?? null,
    address_line1:     wo.address_line1 ?? null,
    address_line2:     wo.address_line2 ?? null,
    city:              wo.city ?? null,
    state:             wo.state ?? null,
    zip:               wo.zip ?? null,
    // The work order's service request is what the customer reported; comments are what
    // the tech found. Same split the quote-to-work-order hop uses.
    complaint:         wo.service_requests ?? null,
    diagnosis:         wo.comments ?? null,
    internal_notes:    wo.internal_notes ?? null,
    // The customer's PO, which since migration 153 came off the approved quote. It must
    // reach the invoice or the fleet cannot reconcile what they authorized.
    po_number:         wo.customer_po_number ?? null,
  }
}

/**
 * The whole invoice payload for a work order.
 *
 * Returned to the client, which POSTs it to the EXISTING /api/hd/invoices route rather
 * than this module inserting it. One insert path, deliberately: that route already
 * carries the migration 119/140/142 column-tolerance retries, already deducts stock
 * through the shared ledger, and already flips the work order to 'invoiced'.
 * Re-implementing the insert here would mean two places to keep in step and two places
 * for the stock deduction to be forgotten.
 */
export function buildInvoicePayload(
  wo: Record<string, unknown>,
  lineRows: WorkOrderLineRow[],
): Record<string, unknown> {
  const laborRate = num(wo.labor_rate)
  const lines = invoiceLinesFromWorkOrder(lineRows, laborRate)
  const totals = sumInvoiceLines(lines)
  const terms = invoiceTermsFromWorkOrder(wo)

  const extras =
    (num(terms.travel_amount) ?? 0) +
    (num(terms.mileage_amount) ?? 0) +
    (num(terms.shop_supplies_fee) ?? 0)

  // The total is the sum of what is on the invoice. tax_amount is CARRIED from the work
  // order rather than recomputed - it is the figure the customer approved on the quote,
  // and re-deriving it from a combined base is the rounding mistake that cost a week.
  const taxAmount = num(terms.tax_amount) ?? 0
  const total = r2(totals.subtotal_labor + totals.subtotal_parts + extras + taxAmount)

  return {
    ...invoiceIdentityFromWorkOrder(wo),
    ...terms,
    line_items:     lines,
    subtotal_labor: totals.subtotal_labor,
    subtotal_parts: totals.subtotal_parts,
    parts_cost:     totals.parts_cost,
    parts_sell:     totals.parts_sell,
    total,
    status:         'unpaid',
  }
}
