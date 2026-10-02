// ─── The money on an invoice auto-created from an inspection ──────────────────
// SERVER ONLY. Shared by the DOT, aerial, equipment and reefer-PM routes, which all
// bill the same shape: one labour line for having performed the inspection.
//
// TWO BUGS LIVED IN THE GAP THIS FILLS.
//
// 1. A PHANTOM $125 DIAGNOSTIC FEE. hd_invoices.diagnostic_fee is declared
//    DEFAULT 125.00 (migration 057) and not one of the four routes set it. They
//    inserted without it, Postgres supplied 125, and the total they had already
//    computed never included it. The invoice then PRINTED a fee it had never charged:
//    INV-2026-0002, 0006 and 0014 each show Labor $135 + Diagnostic $125 and a total
//    of $135. Three real invoices, all sent, each understating by $125.
//
//    So the fee was not dropped from the sum and it was not a display bug. It was
//    never charged. The column default invented it.
//
// 2. NO TAX AT ALL. None of the four set tax_rate or tax_amount either, and those
//    default to 0 — so a shop charging 7.75% billed an inspection with no tax line.
//
// Both are fixed by being explicit. A column default is not a pricing decision.

import type { SupabaseClient } from '@supabase/supabase-js'
import { computeTax, type TaxBreakdown } from '@/lib/tax'
import { loadTaxSettings } from '@/lib/tax-settings.server'

export interface InspectionInvoiceMoney {
  subtotal_labor:  number
  subtotal_parts:  number
  /** EXPLICITLY ZERO. Performing an inspection is not a diagnostic call-out, and
   *  leaving it unset lets the column default bill the customer $125. */
  diagnostic_fee:  number
  road_call_fee:   number
  /** Percent, matching the column's existing unit on hd_invoices. */
  tax_rate:        number
  tax_amount:      number
  tax_breakdown:   TaxBreakdown | null
  total:           number
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Price an inspection invoice from its single labour amount.
 *
 * THE LABOUR FOLLOWS tax_labor. That was the spec when the parts/labor split shipped
 * and these four routes never saw it, because they never computed tax at all. An
 * inspection has no parts, so the parts bucket is absent rather than zeroed.
 */
export async function inspectionInvoiceMoney(
  supabase:    SupabaseClient,
  userId:      string,
  laborAmount: number,
): Promise<InspectionInvoiceMoney> {
  const labor    = r2(laborAmount)
  const settings = await loadTaxSettings(supabase, userId)
  const tax      = computeTax({ labor }, settings)

  return {
    subtotal_labor: labor,
    subtotal_parts: 0,
    diagnostic_fee: 0,
    road_call_fee:  0,
    // The rate that was actually applied to the labour. 0 when the shop does not tax
    // labour, which is a real answer and not a missing one.
    tax_rate:       tax.breakdown.labor?.rate ?? 0,
    tax_amount:     tax.taxAmount,
    tax_breakdown:  tax.breakdown,
    total:          r2(labor + tax.taxAmount),
  }
}
