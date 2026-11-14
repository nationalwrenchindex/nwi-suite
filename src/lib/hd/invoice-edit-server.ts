// ─── The HD invoice PUT's money, priced on the SERVER ──────────────────────────
//
// Pure: no database. The PUT route calls it with the stored row and the request body.
//
// WHAT WAS WRONG (open since Oct 15). The PUT spread the raw body onto the row, so
// subtotal_labor, subtotal_parts, tax_amount, tax_breakdown and total were whatever the
// browser sent. A script, a stale tab or a bug in the form could write any total on
// any invoice and nothing would notice.
//
// WHAT THIS DOES. Every total the body carries is DROPPED. The inputs it carries -
// lines, labor rate, fees, tax rate, drive time, mileage, discount - are laid over the
// invoice as stored, and the result is priced by the same functions the editor prices
// with (lib/hd/invoice-edit-save: recorded extras only, tax carried from what was
// stored plus the tax on what changed). So what the form shows is what the server
// writes, and a body that sends only a total changes nothing.
//
// LINE AMOUNTS are not trusted either:
//   parts  amount = quantity x unit price, always. All 89 stored part lines obey this
//          (scripts/scan-hd-invoice-line-amounts.ts, Nov 14).
//   labor  a line matching a stored labor line (same hours, same amount) keeps its
//          stored amount; any other is priced hours x the invoice's labor rate - the
//          rule every editor path uses. Three stored lines (INV-2026-0022, 0023, 0025)
//          were priced at $145 on a $135 invoice; matching keeps them as billed.
//
// THE DELIBERATE CORRECTION (an invoice whose stored total is not its own figures) is
// asked for with { correct_total: true } and computed here, never sent as figures.

import { round2, type ExtrasSettings } from '@/lib/billable-extras'
import type { ServiceCallTax } from '@/lib/hd/hd-extras'
import { isServiceCallTax } from '@/lib/hd/hd-extras'
import { parseDiscount } from '@/lib/document-discount'
import { editableLines, type EditLine } from '@/lib/hd/invoice-edit-lines'
import {
  openInvoiceEdit, invoiceSaveBody, invoiceDoesNotAddUp, correctionBody, doesNotAddUpMessage,
  type InvoiceEditState,
} from '@/lib/hd/invoice-edit-save'

/** Body keys that are inputs to the money. Laid over the stored invoice, then priced. */
export const MONEY_INPUT_KEYS = [
  'line_items', 'labor_rate', 'diagnostic_fee', 'road_call_fee', 'service_call_fee', 'service_call_tax',
  'tax_rate', 'travel_hours', 'mileage_miles', 'discount',
] as const

/** Body keys that are OUTPUTS of the money. Never taken from a request. */
export const DERIVED_MONEY_KEYS = [
  'subtotal_labor', 'subtotal_parts', 'tax_amount', 'tax_breakdown', 'total',
  'travel_rate', 'travel_amount', 'mileage_rate', 'mileage_amount',
  'shop_supplies_fee', 'shop_supplies_percent_applied', 'shop_supplies_cap_applied',
  'parts_cost', 'parts_sell',
] as const

export interface ServerShop {
  /** hd_labor_rate (lib/hd/labor-rate). Used only when the invoice recorded none. */
  laborRate: number | null
  extras: ExtrasSettings | null
  serviceCallTax?: ServiceCallTax
}

export type ServerPriced =
  | { ok: true; update: Record<string, unknown>; priced: boolean; ignoredTotals: string[] }
  | { ok: false; status: number; error: string }

const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }

/** The lines as the server bills them: part amounts and changed labor amounts re-derived. */
export function serverLines(incoming: unknown, storedLines: EditLine[], laborRate: number | null): EditLine[] {
  const pool = storedLines.filter(l => l.type === 'labor').map(l => ({ h: num(l.mobile_hours), a: round2(num(l.amount)) }))
  return editableLines(incoming).map(l => {
    if (l.type === 'parts') return { ...l, amount: round2(num(l.quantity) * num(l.unit_cost)) }
    const h = num(l.mobile_hours), a = round2(num(l.amount))
    const i = pool.findIndex(p => p.h === h && p.a === a)
    if (i >= 0) { pool.splice(i, 1); return l }
    return { ...l, amount: round2(h * num(laborRate)) }
  })
}

/**
 * The update for an invoice PUT: the body's non-money fields as sent, and the money
 * priced here. `body` must already have had its readings and discount record checked.
 */
export function serverPricedUpdate(
  stored: Record<string, unknown>,
  body: Record<string, unknown>,
  shop: ServerShop,
  now = new Date(),
): ServerPriced {
  const rest: Record<string, unknown> = { ...body }
  const ignoredTotals = DERIVED_MONEY_KEYS.filter(k => k in rest)
  for (const k of DERIVED_MONEY_KEYS) delete rest[k]
  const wantsCorrection = rest.correct_total === true
  delete rest.correct_total

  if (wantsCorrection) {
    if (!invoiceDoesNotAddUp(stored)) {
      return { ok: false, status: 409, error: 'This invoice already adds up, so there is nothing to correct.' }
    }
    return { ok: true, update: { ...rest, ...correctionBody(stored, now) }, priced: true, ignoredTotals }
  }

  const inputs = MONEY_INPUT_KEYS.filter(k => k in rest)
  if (!inputs.length) return { ok: true, update: rest, priced: false, ignoredTotals }

  // An invoice that does not add up is never re-priced silently: any save would
  // quietly "correct" it. The form offers the deliberate correction instead.
  const broken = invoiceDoesNotAddUp(stored)
  if (broken) return { ok: false, status: 409, error: doesNotAddUpMessage(broken) }

  const opened = openInvoiceEdit(stored, shop.laborRate, { extras: shop.extras, serviceCallTax: shop.serviceCallTax })
  const o = opened.state
  const s: InvoiceEditState = { ...o }
  if ('labor_rate' in rest) s.labor_rate = rest.labor_rate == null || rest.labor_rate === '' ? null : num(rest.labor_rate)
  if ('diagnostic_fee' in rest) s.diagnostic_fee = num(rest.diagnostic_fee)
  if ('road_call_fee' in rest) s.road_call_fee = num(rest.road_call_fee)
  if ('service_call_fee' in rest) s.service_call_fee = num(rest.service_call_fee)
  if ('service_call_tax' in rest && isServiceCallTax(rest.service_call_tax)) s.service_call_tax = rest.service_call_tax
  if ('tax_rate' in rest) {
    const v = num(rest.tax_rate)
    if (v !== o.tax_rate) {
      // The form's one tax input: parts take it, labor follows when the two matched.
      s.tax_rate = v
      s.tax_rate_parts = v
      s.tax_rate_labor = o.tax_rate_labor === o.tax_rate_parts ? v : o.tax_rate_labor
    }
  }
  if ('travel_hours' in rest) s.travelHours = num(rest.travel_hours)
  if ('mileage_miles' in rest) s.mileageMiles = num(rest.mileage_miles)
  if ('discount' in rest) {
    const d = parseDiscount(rest.discount)
    s.discount = d ? { type: d.type, value: d.value, scope: d.scope, reason: d.reason } : null
  }
  if ('line_items' in rest) s.lines = serverLines(rest.line_items, o.lines, s.labor_rate)

  let full: Record<string, unknown>
  try {
    full = invoiceSaveBody(stored, opened, s, now)
  } catch (e) {
    return { ok: false, status: 422, error: e instanceof Error ? e.message : 'The discount cannot be applied.' }
  }

  for (const k of MONEY_INPUT_KEYS) delete rest[k]
  // The note the editor writes for an assumed rate is the server's own; any other note
  // the body carries stands.
  if ('internal_notes' in full) delete rest.internal_notes
  return { ok: true, update: { ...rest, ...full }, priced: true, ignoredTotals }
}
