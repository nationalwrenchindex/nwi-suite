// ─── Travel, mileage and shop supplies ────────────────────────────────────────
//
// ONE CALCULATOR, LD AND HD, work order / quote / invoice. The tax split
// (src/lib/tax.ts) is not touched — this decides the AMOUNTS and which bucket
// each one belongs to, then hands those buckets to computeTax exactly as parts
// and labour already are.
//
// ── WHAT THE AUDIT FOUND BEFORE ANY OF THIS WAS BUILT ───────────────────────
//
// HD road_call_fee (migration 057) is a flat dollar figure typed per document.
// It is a call-out charge, NOT travel time: no hours, no rate, no miles. It
// stays exactly as it is. Travel time is hours x rate and is a different line.
//
// Fuel cost already exists but only on the LD side and only at payment time:
// PATCH /api/invoices/[id] takes miles_driven from the request when the invoice
// is marked paid, multiplies by profiles.average_mpg and a fuel price, and
// stores invoices.fuel_cost. That is the COST side. This module is the REVENUE
// side, and the two together are what finally give profit after travel.
//
// There was no billable mileage field anywhere.
//
// ── SHOP SUPPLIES: WHAT ALREADY EXISTED ─────────────────────────────────────
//
// invoices.shop_supplies (migration 012) is a hand-itemised JSONB list of
// consumables — {id, name, qty, unit_cost, total}. It is NOT merely COGS
// tracking, which is what I told you during the tax work; I was wrong. It is
// both:
//
//   * it IS billed — InvoiceInProgressClient adds shopSuppliesTotal into the
//     subtotal and it is already taxed in the PARTS bucket, and
//   * it IS booked as cost — PATCH /api/invoices/[id] writes an `expenses` row
//     with category 'shop_supplies' when the invoice is paid, and the
//     financials overview counts that category as COGS.
//
// So it is an at-cost pass-through: zero margin by design. Per INVOICE, not per
// job. Quotes and work orders have no such column.
//
// THIS MODULE DOES NOT REPLACE IT. A percentage-of-parts fee is a different
// mechanism with no cost basis, so it is a separate figure
// (shop_supplies_fee) in a separate, clearly-labelled line. A shop that
// itemises keeps itemising; a shop that charges a percentage sets a percentage.
// Both can be on one document and neither double-counts the other, because
// neither is derived from the other. The fee is NOT written to `expenses`,
// because a percentage has no cost to book — it is margin.

import type { TaxBreakdown, TaxSettings } from '@/lib/tax'
import { computeTax } from '@/lib/tax'

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** What the shop charges for extras, from profiles. */
export interface ExtrasSettings {
  billTravel:        boolean
  /** NULL means "bill travel at the labour rate". 0 means travel is free. */
  travelRatePerHour: number | null
  billMileage:       boolean
  mileageRatePerMile: number | null
  billShopSupplies:  boolean
  shopSuppliesPercent: number | null
  /** NULL means uncapped. */
  shopSuppliesCap:   number | null
}

export const EXTRAS_OFF: ExtrasSettings = {
  billTravel: false, travelRatePerHour: null,
  billMileage: false, mileageRatePerMile: null,
  billShopSupplies: false, shopSuppliesPercent: null, shopSuppliesCap: null,
}

/** Columns a caller must select for extrasSettingsFrom to work. */
export const EXTRAS_SETTINGS_SELECT =
  'bill_travel, travel_rate_per_hour, bill_mileage, mileage_rate_per_mile, ' +
  'bill_shop_supplies, shop_supplies_percent, shop_supplies_cap, default_labor_rate'

export function extrasSettingsFrom(profile: Record<string, unknown> | null | undefined): ExtrasSettings {
  const p = profile ?? {}
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    billTravel:          p.bill_travel === true,
    travelRatePerHour:   num(p.travel_rate_per_hour),
    billMileage:         p.bill_mileage === true,
    mileageRatePerMile:  num(p.mileage_rate_per_mile),
    billShopSupplies:    p.bill_shop_supplies === true,
    shopSuppliesPercent: num(p.shop_supplies_percent),
    shopSuppliesCap:     num(p.shop_supplies_cap),
  }
}

/** What the tech typed on this document. */
export interface ExtrasInput {
  travelHours:  number
  mileageMiles: number
  /** Per-document override of the shop's percentage. NULL uses the shop default. */
  shopSuppliesPercentOverride?: number | null
  shopSuppliesCapOverride?:     number | null
}

export interface ExtrasLine {
  /** The figure the tech entered — hours, miles, or the percent applied. */
  input:  number
  /** The rate in force. Stored on the document so a reopen cannot re-price it. */
  rate:   number | null
  amount: number
  /** True when a cap reduced the amount. Shown to the tech, never to the customer. */
  capped?: boolean
}

export interface ExtrasResult {
  travel:       ExtrasLine
  mileage:      ExtrasLine
  shopSupplies: ExtrasLine
  /** travel + mileage + shop supplies. */
  total:        number
}

/**
 * Compute the three extras.
 *
 * SHOP SUPPLIES IS A PERCENTAGE OF THE PARTS SUBTOTAL ONLY. Never labour, never
 * travel, never mileage. A labour-only job has a parts subtotal of zero, so its
 * shop supplies are zero and no line prints. That is the trade's rule and it is
 * enforced here rather than at each call site.
 *
 * THE BASE IS THE PARTS SUBTOTAL AS IT APPEARS ON THE DOCUMENT — the marked-up
 * sell price the customer reads, not the shop's raw cost. Stated plainly because
 * it is a decision: charging 8% of the sell price yields more than 8% of cost,
 * and that is what a shop quoting "8% shop supplies" off an invoice means.
 */
export function computeExtras(
  partsSubtotalOnDocument: number,
  input: ExtrasInput,
  settings: ExtrasSettings,
  laborRate: number,
): ExtrasResult {
  // ── Travel: hours x rate. NULL rate falls back to the labour rate. ──
  const travelHours = Math.max(0, Number(input.travelHours) || 0)
  const travelRate  = settings.billTravel
    ? (settings.travelRatePerHour ?? laborRate ?? 0)
    : null
  const travelAmount = settings.billTravel && travelHours > 0
    ? round2(travelHours * (travelRate ?? 0))
    : 0

  // ── Mileage: miles x rate. ──
  const miles       = Math.max(0, Number(input.mileageMiles) || 0)
  const mileageRate = settings.billMileage ? (settings.mileageRatePerMile ?? 0) : null
  const mileageAmount = settings.billMileage && miles > 0
    ? round2(miles * (mileageRate ?? 0))
    : 0

  // ── Shop supplies: a percentage of the parts subtotal, optionally capped. ──
  const pct = input.shopSuppliesPercentOverride ?? settings.shopSuppliesPercent ?? null
  const cap = input.shopSuppliesCapOverride     ?? settings.shopSuppliesCap     ?? null
  const partsBase = Math.max(0, Number(partsSubtotalOnDocument) || 0)

  let suppliesAmount = 0
  let capped = false
  if (settings.billShopSupplies && pct != null && pct > 0 && partsBase > 0) {
    suppliesAmount = round2(partsBase * (pct / 100))
    if (cap != null && cap >= 0 && suppliesAmount > cap) {
      suppliesAmount = round2(cap)
      capped = true
    }
  }

  return {
    travel:       { input: travelHours, rate: travelRate,  amount: travelAmount },
    mileage:      { input: miles,       rate: mileageRate, amount: mileageAmount },
    shopSupplies: { input: pct ?? 0,    rate: cap,         amount: suppliesAmount, capped },
    total:        round2(travelAmount + mileageAmount + suppliesAmount),
  }
}

/**
 * The columns a document stores, so reopening it cannot re-price anything.
 *
 * Every extra keeps THREE values: what the tech entered, the rate in force at
 * that moment, and the resulting amount. That is the whole reason the markup bug
 * exists for parts — the document never recorded the terms it was priced under.
 */
export function extrasColumns(e: ExtrasResult): Record<string, number | null> {
  return {
    travel_hours:                  e.travel.input,
    travel_rate:                   e.travel.rate,
    travel_amount:                 e.travel.amount,
    mileage_miles:                 e.mileage.input,
    mileage_rate:                  e.mileage.rate,
    mileage_amount:                e.mileage.amount,
    shop_supplies_percent_applied: e.shopSupplies.input > 0 ? e.shopSupplies.input : null,
    shop_supplies_cap_applied:     e.shopSupplies.rate,
    shop_supplies_fee:             e.shopSupplies.amount,
  }
}

/** Read the stored extras back off a document, WITHOUT recomputing anything. */
export function extrasFromDocument(doc: Record<string, unknown> | null | undefined): ExtrasResult {
  const d = doc ?? {}
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
  const nn = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    const x = Number(v); return Number.isFinite(x) ? x : null
  }
  const travel   = n(d.travel_amount)
  const mileage  = n(d.mileage_amount)
  const supplies = n(d.shop_supplies_fee)
  return {
    travel:       { input: n(d.travel_hours),  rate: nn(d.travel_rate),  amount: travel },
    mileage:      { input: n(d.mileage_miles), rate: nn(d.mileage_rate), amount: mileage },
    shopSupplies: {
      input:  n(d.shop_supplies_percent_applied),
      rate:   nn(d.shop_supplies_cap_applied),
      amount: supplies,
    },
    total: round2(travel + mileage + supplies),
  }
}

// ─── Tax ──────────────────────────────────────────────────────────────────────

/**
 * Which tax bucket each extra lands in.
 *
 * TRAVEL TIME IS LABOUR. It is time billed at an hourly rate and follows
 * tax_labor. Uncontroversial.
 *
 * SHOP SUPPLIES ARE PARTS. They are tangible goods and follow tax_parts, which
 * is already how the existing itemised list is taxed — see the parts bucket in
 * InvoiceInProgressClient. Not changed, just made explicit.
 *
 * MILEAGE IS BEHIND tax_labor, AND THAT IS A DECISION YOU OWE ME AN ANSWER ON.
 * Mileage is closer to a reimbursement than to either goods or services, and in
 * several states a separately-stated mileage charge on a repair order is not
 * taxable at all. A third bucket was explicitly ruled out, so it sits with
 * labour — which means a shop that does not tax labour does not tax mileage,
 * and a shop that does, does. That is the conservative pairing: it never
 * under-collects relative to the labour rule the shop already set.
 *
 * To move it, change ONLY this function. Nothing else needs to know.
 */
export interface ExtrasTaxBuckets { parts: number; labor: number }

export function extrasTaxBuckets(e: ExtrasResult): ExtrasTaxBuckets {
  return {
    parts: e.shopSupplies.amount,
    labor: e.travel.amount + e.mileage.amount,
  }
}

/**
 * Totals for a document, extras included and taxed in the right buckets.
 *
 * Deliberately thin: it adds the extras into the bases and calls the one tax
 * calculator. No tax maths happens here.
 */
export function totalsWithExtras(
  base: { parts: number; labor: number },
  extras: ExtrasResult,
  settings: TaxSettings | null,
  fallbackTaxPercent = 0,
): { subtotal: number; taxAmount: number; grandTotal: number; taxBreakdown: TaxBreakdown | null } {
  const b = extrasTaxBuckets(extras)
  const parts = round2(base.parts + b.parts)
  const labor = round2(base.labor + b.labor)
  const subtotal = round2(parts + labor)

  if (!settings) {
    const taxAmount = round2(subtotal * (fallbackTaxPercent / 100))
    return { subtotal, taxAmount, grandTotal: round2(subtotal + taxAmount), taxBreakdown: null }
  }

  const tax = computeTax({ parts, labor }, settings)
  return {
    subtotal,
    taxAmount:    tax.taxAmount,
    grandTotal:   round2(subtotal + tax.taxAmount),
    taxBreakdown: tax.breakdown,
  }
}

// ─── Display ──────────────────────────────────────────────────────────────────

export interface ExtrasDisplayRow {
  key:    'travel' | 'mileage' | 'shop_supplies'
  label:  string
  /** "2.5 hours × $95.00/hr", "48 miles × $0.6500/mi", "8% of parts" */
  detail: string | null
  amount: number
}

/**
 * The rows a document prints. A ZERO AMOUNT PRINTS NOTHING — not a $0.00 line,
 * not a dash. That is item 2d's rule and it applies to these the moment they
 * exist, rather than being retrofitted later.
 */
export function extrasDisplayRows(e: ExtrasResult): ExtrasDisplayRow[] {
  const rows: ExtrasDisplayRow[] = []
  const usd = (n: number) => `$${n.toFixed(2)}`

  if (e.travel.amount > 0) {
    rows.push({
      key: 'travel',
      label: 'Travel Time',
      detail: `${trim(e.travel.input)} ${e.travel.input === 1 ? 'hour' : 'hours'}`
        + (e.travel.rate != null ? ` × ${usd(e.travel.rate)}/hr` : ''),
      amount: e.travel.amount,
    })
  }
  if (e.mileage.amount > 0) {
    rows.push({
      key: 'mileage',
      label: 'Mileage',
      detail: `${trim(e.mileage.input)} ${e.mileage.input === 1 ? 'mile' : 'miles'}`
        + (e.mileage.rate != null ? ` × $${e.mileage.rate.toFixed(4)}/mi` : ''),
      amount: e.mileage.amount,
    })
  }
  if (e.shopSupplies.amount > 0) {
    // The customer is told what it is and what it is a percentage OF. A shop
    // supplies line with no basis stated is the one customers argue about.
    rows.push({
      key: 'shop_supplies',
      label: 'Shop Supplies',
      detail: e.shopSupplies.input > 0 ? `${trim(e.shopSupplies.input)}% of parts` : null,
      amount: e.shopSupplies.amount,
    })
  }
  return rows
}

function trim(n: number): string {
  return String(Math.round(n * 10000) / 10000)
}
