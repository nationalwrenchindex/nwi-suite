// ─── Drive time, mileage, shop supplies and the service call fee, on an HD work order ─
//
// Pure: no React, no database. PUT /api/hd/work-orders/[id]/extras prices with it and
// scripts/verify-hd-extras.ts runs it against real work orders, so what the script
// proves is what the route writes.
//
// ONE SET PER WORK ORDER, not per job: one trip, one drive time, one mileage, one
// service call. A job's subtotal stays its own labor and parts.
//
// WHAT IS PRICED AT WHAT
//
//   A rate the work order RECORDED wins - money is frozen. An extra it never recorded
//   is priced at the shop's HD setting now, and that rate is recorded with it, so a
//   later change to Settings never re-prices this work order.
//
//   SHOP SUPPLIES is a percentage of the PARTS lines only, never labor, drive time,
//   mileage or a fee. The tech never types it. ONLY AS RECORDED: a new work order
//   records the shop's percentage when it is created, and one approved from a quote
//   carries the quote's. A work order that recorded none is never given one here -
//   that would add a charge to terms the customer already approved. The converter
//   refigures the recorded percentage on the parts actually billed
//   (src/lib/hd/wo-to-invoice.ts).
//
//   THE SERVICE CALL FEE is what the tech enters, its tax treatment the one the work
//   order recorded, else the shop's setting.
//
// TAX. A work order with no tax recorded (most of them) stores none here either: the
// converter taxes everything at billing time. A work order carrying its quote's tax
// has that tax moved by exactly the tax on what changed (src/lib/hd/carried-tax.ts),
// and its quoted total by what changed plus that tax. A discount record is shifted by
// the same tax, since the extras are never discounted.

import {
  computeExtras, extrasColumns, extrasFromDocument, round2,
  type ExtrasResult, type ExtrasSettings,
} from '@/lib/billable-extras'
import { documentExtras } from '@/lib/document-money'
import { parseBreakdown, type TaxSettings } from '@/lib/tax'
import { parseDiscount } from '@/lib/document-discount'
import { invoiceLinesFromWorkOrder, sumInvoiceLines, type WorkOrderLineRow } from '@/lib/hd/wo-to-invoice'
import {
  hdFeesTotal, hdTaxableFees, isServiceCallTax, serviceCallColumns, serviceCallFee,
  type HdServiceCallSettings, type ServiceCallTax,
} from '@/lib/hd/hd-extras'
import { recordedTaxSettings, shiftCarriedTax } from '@/lib/hd/carried-tax'

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export interface WorkOrderExtrasInput {
  travelHours: number
  mileageMiles: number
  /** NULL or 0 = no service call fee. */
  serviceCallFee: number | null
}

export interface ShopExtras {
  extras: ExtrasSettings
  serviceCall: HdServiceCallSettings
  laborRate: number | null
  taxSettings: TaxSettings
}

/**
 * The settings a work order prices its extras under. Drive time and mileage: what it
 * recorded, else the shop's rate now (hours and miles are facts the tech enters).
 * Shop supplies: only what it recorded.
 */
export function workOrderExtrasSettings(wo: Record<string, unknown>, shop: ExtrasSettings): ExtrasSettings {
  const rec = documentExtras(wo).settings
  const pct = num(wo.shop_supplies_percent_applied)
  return {
    billTravel:          rec.billTravel || shop.billTravel,
    travelRatePerHour:   rec.billTravel ? rec.travelRatePerHour : shop.travelRatePerHour,
    billMileage:         rec.billMileage || shop.billMileage,
    mileageRatePerMile:  rec.billMileage ? rec.mileageRatePerMile : shop.mileageRatePerMile,
    billShopSupplies:    pct != null,
    shopSuppliesPercent: pct,
    shopSuppliesCap:     pct != null ? num(wo.shop_supplies_cap_applied) : null,
  }
}

/** The service call tax treatment: the work order's record, else the shop's setting. */
export function workOrderServiceCallTax(wo: Record<string, unknown>, shop: HdServiceCallSettings): ServiceCallTax {
  return isServiceCallTax(wo.service_call_tax) ? wo.service_call_tax : shop.tax
}

export interface WorkOrderExtrasPrice {
  laborSubtotal: number
  partsSubtotal: number
  extras: ExtrasResult
  serviceCallFee: number
  serviceCallTax: ServiceCallTax
}

/** Price the four extras on the work order's current lines. */
export function priceWorkOrderExtras(
  wo: Record<string, unknown>,
  lineRows: WorkOrderLineRow[],
  input: WorkOrderExtrasInput,
  shop: ShopExtras,
): WorkOrderExtrasPrice {
  const laborRate = num(wo.labor_rate) ?? shop.laborRate
  const totals = sumInvoiceLines(invoiceLinesFromWorkOrder(lineRows, laborRate))
  const rec = documentExtras(wo).input
  const extras = computeExtras(
    totals.subtotal_parts,
    {
      travelHours: input.travelHours, mileageMiles: input.mileageMiles,
      travelRateOverride: rec.travelRateOverride, mileageRateOverride: rec.mileageRateOverride,
      shopSuppliesPercentOverride: rec.shopSuppliesPercentOverride, shopSuppliesCapOverride: rec.shopSuppliesCapOverride,
    },
    workOrderExtrasSettings(wo, shop.extras),
    laborRate ?? 0,
  )
  const fee = num(input.serviceCallFee)
  return {
    laborSubtotal: totals.subtotal_labor,
    partsSubtotal: totals.subtotal_parts,
    extras,
    serviceCallFee: fee != null && fee > 0 ? round2(fee) : 0,
    serviceCallTax: workOrderServiceCallTax(wo, shop.serviceCall),
  }
}

/**
 * The hd_work_orders update for an extras save, or an error. Writes only the extras
 * columns, the service call pair, and - when the work order carries a tax figure - the
 * tax, its split, the quoted total and the discount record that the change moves.
 */
export function workOrderExtrasUpdate(
  wo: Record<string, unknown>,
  lineRows: WorkOrderLineRow[],
  input: WorkOrderExtrasInput,
  shop: ShopExtras,
  /** False before migration 178: a service call fee cannot be stored. */
  serviceCallAvailable = true,
): { update: Record<string, unknown>; price: WorkOrderExtrasPrice } | { error: string } {
  if (!(input.travelHours >= 0) || !(input.mileageMiles >= 0)) return { error: 'Drive time and mileage cannot be negative.' }
  const sc = num(input.serviceCallFee)
  if (sc != null && sc < 0) return { error: 'The service call fee cannot be negative.' }
  if (!serviceCallAvailable && sc != null && sc > 0) {
    return { error: 'A service call fee needs migration 178. Nothing was saved.' }
  }

  const price = priceWorkOrderExtras(wo, lineRows, input, shop)
  const update: Record<string, unknown> = {
    ...extrasColumns(price.extras),
    ...(serviceCallAvailable ? serviceCallColumns(price.serviceCallFee, price.serviceCallTax) : {}),
  }

  const carried = num(wo.tax_amount)
  if (carried != null) {
    const after = { ...wo, ...update }
    const stored = extrasFromDocument(wo)
    const settings = recordedTaxSettings(wo.tax_breakdown, shop.taxSettings)
    const before = { parts: stored.shopSupplies.amount, labor: round2(stored.travel.amount + hdTaxableFees(wo)) }
    const now    = { parts: price.extras.shopSupplies.amount, labor: round2(price.extras.travel.amount + hdTaxableFees(after)) }
    const tax = shiftCarriedTax({ taxAmount: carried, breakdown: parseBreakdown(wo.tax_breakdown) }, before, now, settings)
    const taxDelta = round2(tax.taxAmount - carried)
    const subtotalDelta = round2(
      (price.extras.total + hdFeesTotal(after)) - (stored.total + hdFeesTotal(wo)),
    )
    update.tax_amount = tax.taxAmount
    update.tax_breakdown = tax.breakdown
    if (num(wo.total_amount) != null) update.total_amount = round2((num(wo.total_amount) ?? 0) + subtotalDelta + taxDelta)
    const d = parseDiscount(wo.discount)
    if (d) {
      const pre = shiftCarriedTax({ taxAmount: d.tax_before, breakdown: d.pre_tax_breakdown }, before, now, settings)
      update.discount = { ...d, tax_before: pre.taxAmount, pre_tax_breakdown: pre.breakdown, subtotal_before: round2(d.subtotal_before + subtotalDelta) }
    }
  }
  return { update, price }
}

/** What the work order stores now, for the panel's starting values. */
export function workOrderExtrasState(wo: Record<string, unknown>): WorkOrderExtrasInput {
  const e = extrasFromDocument(wo)
  const fee = serviceCallFee(wo)
  return { travelHours: e.travel.input, mileageMiles: e.mileage.input, serviceCallFee: fee > 0 ? fee : null }
}

/**
 * What a NEW work order records from the shop's HD settings when it is created: the
 * drive time and mileage rates, the shop supplies percentage and cap, and the service
 * call fee - each only when the shop bills it. Recorded so the work order keeps them
 * when Settings change later. Hours and miles start at zero; the tech enters them.
 */
export function workOrderDefaultColumns(shop: ShopExtras, serviceCallAvailable: boolean): Record<string, unknown> {
  const e = shop.extras
  const pct = e.billShopSupplies && e.shopSuppliesPercent != null && e.shopSuppliesPercent > 0 ? e.shopSuppliesPercent : null
  const sc = shop.serviceCall
  return {
    travel_rate: e.billTravel ? (e.travelRatePerHour ?? shop.laborRate ?? null) : null,
    mileage_rate: e.billMileage ? (e.mileageRatePerMile ?? 0) : null,
    shop_supplies_percent_applied: pct,
    shop_supplies_cap_applied: pct != null ? e.shopSuppliesCap : null,
    ...(serviceCallAvailable && sc.bill ? serviceCallColumns(sc.fee, sc.tax) : {}),
  }
}
