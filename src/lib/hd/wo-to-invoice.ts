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

// computeTax is the SAME function LD uses, so parts and labor are taxed at their own
// rates with each bucket rounded independently. See the per-bucket rounding note in
// src/lib/tax.ts - this file must not grow its own tax arithmetic.
import { computeTax, effectiveRatePercent, parseBreakdown, type TaxSettings } from '@/lib/tax'
import { parseDiscount, type DiscountInput, type DocumentDiscount } from '@/lib/document-discount'
import { hdApplyDiscount, recordedRate } from '@/lib/hd/hd-discount'

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
 * The shop's current settings, used ONLY where the work order records nothing.
 *
 * See termsWithFallback for why this exists and what it is allowed to touch.
 */
export interface ShopFallback {
  laborRate: number | null
  taxSettings: TaxSettings
}

/** Where each figure on the invoice came from. Returned so the tech can be told. */
export interface TermsSource {
  /** true when the work order had its own labor rate. */
  laborRateFromDocument: boolean
  /** true when the work order had its own tax figure. */
  taxFromDocument: boolean
  /** Settings values that had to stand in. Empty when the document had everything. */
  usedFallbackFor: string[]
}

/**
 * Every figure the invoice inherits from the WORK ORDER - and the fallback that stops
 * a missing one from silently becoming zero.
 *
 * ===========================================================================
 * WHY THERE IS A FALLBACK AT ALL, GIVEN THE RULE
 * ===========================================================================
 *
 * The rule is "a document's recorded terms beat current settings", and it still holds:
 * whenever the work order HAS a figure, that figure wins, full stop. Nothing here can
 * override a recorded term.
 *
 * But the first version of this function read terms only off the work order, and the
 * measurement was brutal:
 *
 *   ALL 1,562 live hd_work_orders have labor_rate NULL.    100%.
 *   ALL 1,562 have tax_percent and tax_amount NULL.         100%.
 *   1,555 of 1,562 (99.6%) have no line items at all.
 *
 * So "recorded terms beat settings" degenerated into "no terms, therefore zero". For
 * the 4 work orders actually convertible today, the subtotals came out right - because
 * each LINE stores its own total - and the tax came out as exactly $0.00. The invoices
 * those same shops already send carry 7%, 7.25% and 7.75%. That is not conservatism,
 * it is a silent under-bill and a regression against what the product bills today.
 *
 * A term that was never recorded is not a term the customer agreed to a different
 * value for. It is an absence, and the shop's own current setting is the only honest
 * thing to put in an absence - as long as the invoice RECORDS that it did so, which is
 * what TermsSource is for.
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

    // THE FEES. Missing from this list, INV-2026-0020 came out $35.00 under its quote:
    // the road call fee was dropped while the quote's tax - which had taxed it in the
    // labor bucket - was copied, so the bill taxed a fee it did not charge. The convert
    // route fills these from the quote when the work order predates migration 159.
    diagnostic_fee:                wo.diagnostic_fee ?? null,
    road_call_fee:                 wo.road_call_fee ?? null,
  }
}

/** The two flat fees on a document, summed. Both are taxed as labor. */
export function feesTotal(doc: Record<string, unknown>): number {
  return (num(doc.diagnostic_fee) ?? 0) + (num(doc.road_call_fee) ?? 0)
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
    // Migration 159. The convert route fills these from the quote for a work order
    // made before it, so the invoice states the machine the customer was quoted for.
    unit_year:         wo.unit_year ?? null,
    truck_make:        wo.truck_make ?? null,
    truck_model:       wo.truck_model ?? null,
    truck_year:        wo.truck_year ?? null,
    vin:               wo.vin ?? null,
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
    // Who did the work, so billed labor has a name on it (hd_invoices.tech_name,
    // migration 160 - the insert route strips it until then).
    tech_name:         wo.tech_name ?? null,
    // The customer's PO, which since migration 153 came off the approved quote. It must
    // reach the invoice or the fleet cannot reconcile what they authorized.
    //
    // customer_po_number, NOT po_number. hd_invoices has NEITHER column until migration
    // 157 - verified against the live database with scripts/probe-hd-invoice-po.ts -
    // and the previous pass wrote po_number here, which is LD's name on LD's table. The
    // key is present on every payload whether there is a PO or not, so that one wrong
    // name failed the insert for EVERY conversion, not only the ones with a PO. The
    // name now matches hd_quotes and hd_work_orders, which is the chain it travels, and
    // the insert route strips it when 157 has not been applied.
    customer_po_number: wo.customer_po_number ?? null,
    // THE TERMS THE CUSTOMER AGREED TO, from the quote by way of the work order. This
    // key was absent, so every converted invoice took hd_invoices' column DEFAULT,
    // 'Due on receipt' (migration 057) - a Net 30 quote became a due-now invoice.
    // Omitted rather than nulled when there is nothing recorded, so an old work order
    // converts exactly as it did before.
    ...(wo.payment_terms ? { payment_terms: wo.payment_terms } : {}),
  }
}

/**
 * Apply the shop's settings to whatever the work order did not record.
 *
 * A recorded figure is NEVER touched. This only fills absences, and it reports every
 * absence it filled so the invoice can say where its numbers came from.
 *
 * TAX IS COMPUTED PER BUCKET through computeTax from src/lib/tax.ts - the same function
 * LD uses - so parts and labor are taxed at their own rates, each rounded to the cent
 * independently and then summed. Re-deriving one blended figure from a combined base is
 * the rounding mistake that cost a week on billable extras.
 */
export function termsWithFallback(
  wo: Record<string, unknown>,
  totals: InvoiceTotals,
  /** The taxable extras and fees, by the bucket each is taxed in. */
  extras: { labor: number; parts: number },
  fallback: ShopFallback,
): { terms: Record<string, unknown>; source: TermsSource } {
  const terms = invoiceTermsFromWorkOrder(wo)
  const source: TermsSource = {
    laborRateFromDocument: terms.labor_rate != null,
    taxFromDocument:       terms.tax_amount != null,
    usedFallbackFor:       [],
  }

  if (terms.labor_rate == null && fallback.laborRate != null) {
    terms.labor_rate = fallback.laborRate
    source.usedFallbackFor.push('labor rate')
  }

  // Tax. The work order's own tax_amount wins when it has one. Otherwise compute it
  // from the shop's current per-bucket settings rather than leaving the 0 that the
  // first version of this shipped.
  if (terms.tax_amount == null) {
    const result = computeTax(
      {
        // The settled rule: shop supplies is taxed as PARTS, travel and the fees as
        // labor, mileage not at all (the caller leaves it out). Supplies used to ride
        // in the labor bucket here, which mis-taxed it whenever the two rates differ.
        // Forward only: this prices a NEW invoice; no stored split is rewritten.
        parts: totals.subtotal_parts + extras.parts,
        labor: totals.subtotal_labor + extras.labor,
      },
      fallback.taxSettings,
    )
    terms.tax_amount = result.taxAmount
    terms.tax_breakdown = result.breakdown
    // The single legacy column gets the effective blended rate, because hd_invoices has
    // one tax_rate column and the real split lives in tax_breakdown.
    terms.tax_rate = effectiveRatePercent(result)
    source.usedFallbackFor.push('tax rate')
  }

  return { terms, source }
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
  fallback: ShopFallback,
): { payload: Record<string, unknown>; source: TermsSource; discountError: string | null } {
  // The work order's own rate if it has one, the shop's current setting if not. Passed
  // into the line builder so a labor line with no unit_price of its own prices at a
  // real rate instead of at 0.
  const laborRate = num(wo.labor_rate) ?? fallback.laborRate
  const lines = invoiceLinesFromWorkOrder(lineRows, laborRate)
  const totals = sumInvoiceLines(lines)

  const baseTerms = invoiceTermsFromWorkOrder(wo)

  // MILEAGE IS EXCLUDED from the taxable extras. It is reimbursement of a cost, not a
  // sale - the settled rule. Travel is taxed as labor, shop supplies as parts.
  //
  // The diagnostic and road call fees are taxed as labor too (src/lib/tax.ts), which is
  // how the quote computed the tax this normally copies.
  const taxableExtras = {
    labor: (num(baseTerms.travel_amount) ?? 0) + feesTotal(baseTerms),
    parts: num(baseTerms.shop_supplies_fee) ?? 0,
  }

  const { terms, source } = termsWithFallback(wo, totals, taxableExtras, fallback)

  // Every extra, including the untaxed mileage, counts toward the total.
  const allExtras =
    (num(terms.travel_amount) ?? 0) +
    (num(terms.mileage_amount) ?? 0) +
    (num(terms.shop_supplies_fee) ?? 0)

  const subtotal = r2(totals.subtotal_labor + totals.subtotal_parts + feesTotal(terms) + allExtras)

  // ===========================================================================
  // THE DISCOUNT (migration 168), from the approved quote or set on the work order.
  // ===========================================================================
  //
  // Re-applied to the invoice's own lines through the shared engine. The tax it comes
  // off is the tax BEFORE the discount: when the work order carries its quote's tax,
  // that tax is already discounted, so the record's tax_before / pre_tax_breakdown is
  // the starting point - never the carried figure, which would discount twice. When
  // the tax was just computed from settings (above) it is pre-discount already.
  //
  // Lines unchanged since the quote give exactly the quote's figures, to the cent.
  let taxAmount = num(terms.tax_amount) ?? 0
  let discount: DocumentDiscount | null = null
  let discountError: string | null = null
  const recorded = parseDiscount(wo.discount)
  if (recorded) {
    const before = source.taxFromDocument
      ? { taxAmount: recorded.tax_before, breakdown: recorded.pre_tax_breakdown }
      : { taxAmount, breakdown: parseBreakdown(terms.tax_breakdown) }
    const applied = hdApplyDiscount({
      discount:   { type: recorded.type, value: recorded.value, scope: recorded.scope, reason: recorded.reason },
      laborLines: totals.subtotal_labor,
      partsLines: totals.subtotal_parts,
      subtotal,
      breakdown:  before.breakdown,
      taxAmount:  before.taxAmount,
      taxRatePct: recordedRate(terms.tax_rate),
    })
    if (!applied.ok) {
      discountError = `The work order's discount cannot be applied to this invoice: ${applied.error}`
    } else {
      discount = applied.discount
      taxAmount = applied.taxAmount
      terms.tax_amount = applied.taxAmount
      terms.tax_breakdown = applied.breakdown
    }
  }

  const total = r2(subtotal - (discount?.amount ?? 0) + taxAmount)

  return {
    payload: {
      ...invoiceIdentityFromWorkOrder(wo),
      ...terms,
      line_items:     lines,
      subtotal_labor: totals.subtotal_labor,
      subtotal_parts: totals.subtotal_parts,
      parts_cost:     totals.parts_cost,
      parts_sell:     totals.parts_sell,
      total,
      discount,
      // The terms the quote recorded when it was sent, carried by the work order.
      terms_snapshot: wo.terms_snapshot ?? null,
      status:         'unpaid',
      // Recorded on the invoice itself so a figure that came from Settings rather than
      // from the job is visible later, when someone asks why the tax is what it is.
      internal_notes: source.usedFallbackFor.length
        ? [
            baseTerms.internal_notes ?? wo.internal_notes ?? '',
            `[${new Date().toISOString().slice(0, 10)}] ${source.usedFallbackFor.join(' and ')} taken from shop settings - the work order had none recorded.`,
          ].filter(Boolean).join(' ').trim()
        : (wo.internal_notes ?? null),
    },
    source,
    discountError,
  }
}

/**
 * Set, change or remove the discount on a work order (migration 168).
 *
 * The work order keeps the same invariant as the quote and the invoice: its tax and
 * total columns are AFTER the discount, and the record holds the tax as it stood
 * before it. So a work order carrying its quote's tax has that tax re-figured here,
 * from the pre-discount figures, never from the already-discounted ones; and removing
 * the discount restores them. A work order with no tax recorded stores the discount
 * only - the invoice prices its tax at convert, and applies the discount there.
 *
 * Priced against the lines exactly as the converter will bill them, so what the tech
 * sees here is what the invoice gets while the lines stay as they are. The converter
 * re-applies it to whatever the lines are at billing time.
 */
export function workOrderDiscountUpdate(
  wo: Record<string, unknown>,
  lineRows: WorkOrderLineRow[],
  input: DiscountInput | null,
  fallbackLaborRate: number | null,
): { update: Record<string, unknown>; discount: DocumentDiscount | null; notice: string | null } | { error: string } {
  const prior = parseDiscount(wo.discount)
  const carried = num(wo.tax_amount) != null
  const before = prior
    ? { taxAmount: prior.tax_before, breakdown: prior.pre_tax_breakdown }
    : { taxAmount: num(wo.tax_amount) ?? 0, breakdown: parseBreakdown(wo.tax_breakdown) }

  const totals = sumInvoiceLines(invoiceLinesFromWorkOrder(lineRows, num(wo.labor_rate) ?? fallbackLaborRate))
  const terms = invoiceTermsFromWorkOrder(wo)
  const subtotal = r2(
    totals.subtotal_labor + totals.subtotal_parts + feesTotal(terms) +
    (num(terms.travel_amount) ?? 0) + (num(terms.mileage_amount) ?? 0) + (num(terms.shop_supplies_fee) ?? 0),
  )

  let discount: DocumentDiscount | null = null
  let notice: string | null = null
  let tax = before.taxAmount
  let breakdown = before.breakdown
  if (input) {
    const r = hdApplyDiscount({
      discount:   input,
      laborLines: totals.subtotal_labor,
      partsLines: totals.subtotal_parts,
      subtotal,
      // No tax recorded yet: nothing to take tax off here. The invoice will.
      breakdown:  carried ? before.breakdown : { version: 1 },
      taxAmount:  carried ? before.taxAmount : 0,
      taxRatePct: recordedRate(wo.tax_percent),
    })
    if (!r.ok) return { error: r.error }
    discount = r.discount
    notice = r.notice ?? null
    tax = r.taxAmount
    breakdown = r.breakdown
  }

  const update: Record<string, unknown> = { discount }
  if (carried) {
    const oldTax = num(wo.tax_amount) ?? 0
    update.tax_amount = tax
    update.tax_breakdown = breakdown
    // The quoted total moves by exactly what the discount and its tax moved.
    if (num(wo.total_amount) != null) {
      update.total_amount = r2((num(wo.total_amount) ?? 0) + (prior?.amount ?? 0) - (discount?.amount ?? 0) + (tax - oldTax))
    }
  }
  return { update, discount, notice }
}
