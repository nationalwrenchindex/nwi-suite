// What an HD invoice PRINTS for its customer, in one place.
//
// The customer copy (components/hd/PublicInvoicePay - the page the customer gets by
// text or email) and the fleet manager's records (lib/fleet-view/unit-history) both
// build their money rows from here, so the fleet view can never show a figure that was
// not on the customer's paper, or miss one that was.
//
// Pure. Reads only the stored columns, never recomputes (CLAUDE.md money rules: a
// document's recorded figures beat anything derived).
//
// ON "COST": on an hd_invoices line, `unit_cost` is the MARKED-UP unit price the
// customer was charged and `unit_cost_base` is what the shop paid its supplier
// (lib/hd/wo-to-invoice explains why). Only the former is printed, and only the
// former ever leaves this file - renamed `unit_price` so no reader mistakes it.

import { feeRows } from '@/lib/invoice-document'
import { extrasDisplayRows, extrasFromDocument } from '@/lib/billable-extras'
import { discountPrintLabel, parseDiscount } from '@/lib/document-discount'
import { parseBreakdown, taxDisplayRows } from '@/lib/tax'

type Row = Record<string, unknown>

export interface PrintedSummaryRow {
  label: string
  amount: number
  /** The customer copy's existing test ids, kept on the same rows. */
  testid?: 'discount-row' | 'tax-row'
}

/**
 * The rows between the line items and the total, in print order: labor and parts
 * subtotals, each fee, travel / mileage / shop supplies, the discount (with the
 * subtotal it came off), and tax (per category when the invoice recorded a breakdown,
 * else its single Tax line). A zero prints nothing, exactly as on the customer copy.
 */
export function hdInvoiceSummaryRows(inv: Row): PrintedSummaryRow[] {
  const discount = parseDiscount(inv.discount)
  const taxRows = taxDisplayRows(parseBreakdown(inv.tax_breakdown))
  return [
    ...(Number(inv.subtotal_labor) > 0 ? [{ label: 'Labor Subtotal', amount: Number(inv.subtotal_labor) }] : []),
    ...(Number(inv.subtotal_parts) > 0 ? [{ label: 'Parts Subtotal', amount: Number(inv.subtotal_parts) }] : []),
    ...feeRows(inv).map(r => ({ label: r.label, amount: r.amount })),
    ...extrasDisplayRows(extrasFromDocument(inv)).map(r => ({ label: r.detail ? `${r.label} (${r.detail})` : r.label, amount: r.amount })),
    ...(discount ? [
      { label: 'Subtotal', amount: discount.subtotal_before },
      { label: discountPrintLabel(discount), amount: -discount.amount, testid: 'discount-row' as const },
    ] : []),
    // tax_rate is stored as a percent (7.5 means 7.5%).
    ...(taxRows.length > 0
      ? taxRows.map(r => ({ label: r.text, amount: r.taxed ? r.amount : 0, testid: 'tax-row' as const }))
      : Number(inv.tax_amount) > 0 ? [{ label: `Tax (${String(inv.tax_rate)}%)`, amount: Number(inv.tax_amount), testid: 'tax-row' as const }] : []),
  ]
}

/** The stored columns hdInvoiceSummaryRows and the printed lines read. Nothing else. */
export const HD_INVOICE_PRINT_COLUMNS =
  'id, invoice_number, work_order_number, status, created_at, line_items, labor_rate, subtotal_labor, subtotal_parts, ' +
  'diagnostic_fee, road_call_fee, service_call_fee, travel_hours, travel_rate, travel_amount, mileage_miles, mileage_rate, ' +
  'mileage_amount, shop_supplies_fee, shop_supplies_percent_applied, shop_supplies_cap_applied, discount, tax_breakdown, ' +
  'tax_amount, tax_rate, total'
