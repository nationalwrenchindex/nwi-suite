// ─── Saving an EXISTING HD invoice from the editor ────────────────────────────
//
// Pure: no React, no database. EditInvoiceForm prices with it, and the replay
// (scripts/replay-hd-invoice-save.ts) runs it against every stored invoice, so what
// the replay proves is what the form does.
//
// MONEY IS FROZEN. An invoice already carries the terms it was priced under, and an
// edit prices only what the edit changed:
//
//   EXTRAS   Bill exactly what the invoice recorded (documentExtras - the same reader
//            LD's work order editor uses). A rate or percentage it did not record is
//            none, never the shop's setting today. Untouched hours, miles and parts
//            keep the stored amounts verbatim.
//
//   TAX      Carried, never re-derived: stored tax + (tax on the edited invoice - tax
//            on the invoice as opened). An unchanged save adds exactly zero. Before
//            this, three pre-split invoices (0001, 0011, 0012) re-rounded a cent high
//            and INV-2026-0020 dropped 2.72 of tax on an unchanged save. An invoice
//            with no stored split keeps none; one with a split keeps it summing to the
//            tax, to the cent.
//
//   BODY     Only the fields that differ from the stored row are sent. An unchanged
//            save writes nothing at all - so it cannot re-derive costing from the line
//            items or re-resolve fleet links as a side effect.
//
//   DISCOUNT Migration 168, the shared engine via hdApplyDiscount. A discounted invoice
//            stores POST-discount tax, so the tax is carried from the figures BEFORE
//            the discount (the record's tax_before / pre_tax_breakdown) and the
//            discount is applied once on top - never twice. Labor and parts lines
//            only; the extras and fees are never discounted.
//
// THE CASE IT REFUSES. A stored invoice whose total is not its own lines + fees +
// extras + tax (INV-2026-0002, 0006, 0014 - a 125.00 diagnostic fee outside the total)
// is never saved silently: any save would quietly "correct" it. The form offers one
// explicit correction (correctionFor) that recalculates on purpose and says so in
// internal_notes. Nothing here guesses which number was meant.

import { computeExtras, extrasColumns, extrasFromDocument, round2, type ExtrasResult } from '@/lib/billable-extras'
import { documentExtras } from '@/lib/document-money'
import { computeTax, parseBreakdown, type TaxBreakdown, type TaxBucket, type TaxSettings } from '@/lib/tax'
import { editableLines, type EditLine } from '@/lib/hd/invoice-edit-lines'
import { parseDiscount, type DiscountInput, type DocumentDiscount } from '@/lib/document-discount'
import { hdApplyDiscount, recordedRate } from '@/lib/hd/hd-discount'

const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const usd = (n: number) => `$${n.toFixed(2)}`

/** What the editor holds. Seeded by openInvoiceEdit, changed by the tech. */
export interface InvoiceEditState {
  customer_name: string; customer_phone: string; customer_email: string
  unit_number: string; unit_manufacturer: string; unit_model: string; unit_serial: string
  notes: string
  /** Blank stays blank and prints nothing. Never defaulted. */
  payment_terms: string
  /** NULL only when the invoice recorded none AND the shop has no rate set. */
  labor_rate: number | null
  diagnostic_fee: number
  road_call_fee: number
  /** The hd_invoices.tax_rate column. Written back only when the tech changes it. */
  tax_rate: number
  /** The rates this invoice taxed each bucket at, off its own stored split. */
  tax_rate_parts: number
  tax_rate_labor: number
  travelHours: number
  mileageMiles: number
  lines: EditLine[]
  /** What the discount is (type, value, scope, reason). Its amounts are re-derived. */
  discount: DiscountInput | null
}

export interface OpenedInvoice {
  state: InvoiceEditState
  /** True when the invoice recorded no labor rate and the shop's current one is shown. */
  laborRateAssumed: boolean
}

/** The discount's four answers off a stored record, or null. */
function discountInputOf(invoice: Record<string, unknown>): DiscountInput | null {
  const d = parseDiscount(invoice.discount)
  return d ? { type: d.type, value: d.value, scope: d.scope, reason: d.reason } : null
}

/**
 * The editor's starting point, from the stored row alone.
 *
 * labor_rate: the invoice's own. If it recorded none, the shop's current HD rate
 * (hd_labor_rate, then default_labor_rate - the order the work order converter uses),
 * flagged as assumed so the screen says so and the save notes it. Never 125, never any
 * number the shop did not set.
 */
export function openInvoiceEdit(invoice: Record<string, unknown>, shopLaborRate: number | null): OpenedInvoice {
  const storedTax = parseBreakdown(invoice.tax_breakdown)
  const recordedRate = invoice.labor_rate == null || invoice.labor_rate === '' ? null : num(invoice.labor_rate, NaN)
  const hasRecorded = recordedRate != null && Number.isFinite(recordedRate)
  return {
    laborRateAssumed: !hasRecorded && shopLaborRate != null,
    state: {
      customer_name:     str(invoice.customer_name),
      customer_phone:    str(invoice.customer_phone),
      customer_email:    str(invoice.customer_email),
      unit_number:       str(invoice.unit_number),
      unit_manufacturer: str(invoice.unit_manufacturer),
      unit_model:        str(invoice.unit_model),
      unit_serial:       str(invoice.unit_serial),
      notes:             str(invoice.notes),
      payment_terms:     str(invoice.payment_terms),
      labor_rate:        hasRecorded ? recordedRate : shopLaborRate,
      diagnostic_fee:    num(invoice.diagnostic_fee),
      road_call_fee:     num(invoice.road_call_fee),
      tax_rate:          num(invoice.tax_rate),
      // The converter stores a BLENDED effective rate in tax_rate, so the bucket's own
      // recorded rate wins over the column.
      tax_rate_parts:    storedTax?.parts?.rate ?? num(invoice.tax_rate),
      // What THIS invoice taxed labor at, off its own stored split. A legacy invoice has
      // none, and a legacy invoice taxed labor at its single rate.
      tax_rate_labor:    storedTax?.labor?.rate ?? num(invoice.tax_rate),
      travelHours:       num(invoice.travel_hours),
      mileageMiles:      num(invoice.mileage_miles),
      lines:             editableLines(invoice.line_items),
      discount:          discountInputOf(invoice),
    },
  }
}

/** Whether parts and labor are taxed: the invoice's own record. Pre-140 taxed both. */
function taxSettingsFor(invoice: Record<string, unknown>, s: InvoiceEditState): TaxSettings {
  const storedTax = parseBreakdown(invoice.tax_breakdown)
  return {
    tax_parts:      storedTax?.parts ? storedTax.parts.taxed : true,
    tax_labor:      storedTax?.labor ? storedTax.labor.taxed : true,
    tax_rate_parts: s.tax_rate_parts,
    tax_rate_labor: s.tax_rate_labor,
  }
}

function subtotals(s: InvoiceEditState) {
  const labor = round2(s.lines.filter(i => i.type === 'labor').reduce((t, i) => t + num(i.amount), 0))
  const parts = round2(s.lines.filter(i => i.type === 'parts').reduce((t, i) => t + num(i.amount), 0))
  return { labor, parts, fees: round2(s.diagnostic_fee + s.road_call_fee) }
}

/**
 * The taxable buckets. Diagnostic and road call fees are labor; travel is labor;
 * shop supplies is parts; mileage is taxed nowhere (it is still in the subtotal).
 */
function taxFor(s: InvoiceEditState, extras: ExtrasResult, settings: TaxSettings) {
  const t = subtotals(s)
  return computeTax(
    { parts: round2(t.parts + extras.shopSupplies.amount), labor: round2(t.labor + t.fees + extras.travel.amount) },
    settings,
  )
}

/**
 * The extras on the edited invoice. When nothing they depend on moved, they are the
 * stored amounts exactly; otherwise they are re-priced at the rates this invoice
 * recorded, and an extra it never recorded stays off.
 */
export function editedExtras(invoice: Record<string, unknown>, opened: InvoiceEditState, s: InvoiceEditState): ExtrasResult {
  const unchanged = s.travelHours === opened.travelHours && s.mileageMiles === opened.mileageMiles
    && subtotals(s).parts === subtotals(opened).parts
  if (unchanged) return extrasFromDocument(invoice)
  const doc = documentExtras(invoice)
  return computeExtras(
    subtotals(s).parts,
    { ...doc.input, travelHours: s.travelHours, mileageMiles: s.mileageMiles },
    doc.settings,
    num(s.labor_rate),
  )
}

/** The settings the extras inputs show under: exactly what the invoice bills. */
export function invoiceExtrasSettings(invoice: Record<string, unknown>) {
  return documentExtras(invoice).settings
}

export interface InvoicePrice {
  subtotalLabor: number
  subtotalParts: number
  extras: ExtrasResult
  extrasChanged: boolean
  /** Subtotal including fees and extras, BEFORE any discount - printed as "Subtotal". */
  subtotal: number
  /** After the discount. */
  taxAmount: number
  /** NULL when the invoice has no stored split - it keeps none. After the discount. */
  breakdown: TaxBreakdown | null
  total: number
  /** The discount as applied, or null for none. */
  discount: DocumentDiscount | null
  /** Why the discount cannot be applied. The figures are then undiscounted and the
   *  form refuses to save. */
  discountError: string | null
  /** Shown beside the discount: the invoice recorded no tax rate. */
  discountNotice: string | null
}

/** A bucket plus a difference, dropped when nothing is left in it. */
function shiftBucket(stored: TaxBucket | undefined, before: TaxBucket | undefined, after: TaxBucket | undefined): TaxBucket | null {
  const base   = round2((stored?.base ?? 0)   + (after?.base ?? 0)   - (before?.base ?? 0))
  const amount = round2((stored?.amount ?? 0) + (after?.amount ?? 0) - (before?.amount ?? 0))
  if (base === 0 && amount === 0) return null
  return { base, rate: after?.rate ?? stored?.rate ?? 0, amount, taxed: after?.taxed ?? stored?.taxed ?? false }
}

/**
 * Price the edited invoice.
 *
 * `baseline` is what the tax is carried from. Normally the stored row. After a
 * deliberate correction (correctionFor) it is the recalculated figures instead.
 */
export function priceInvoiceEdit(
  invoice: Record<string, unknown>,
  opened: InvoiceEditState,
  s: InvoiceEditState,
  baseline: { taxAmount: number; breakdown: TaxBreakdown | null } = storedTaxOf(invoice),
): InvoicePrice {
  const t = subtotals(s)
  const openedExtras = extrasFromDocument(invoice)
  const extras = editedExtras(invoice, opened, s)
  const before = taxFor(opened, openedExtras, taxSettingsFor(invoice, opened))
  const after  = taxFor(s, extras, taxSettingsFor(invoice, s))

  const taxAmount = round2(baseline.taxAmount + after.taxAmount - before.taxAmount)
  let breakdown: TaxBreakdown | null = null
  if (baseline.breakdown) {
    breakdown = { version: 1 }
    for (const k of ['parts', 'labor', 'services'] as const) {
      const b = shiftBucket(baseline.breakdown[k], before.breakdown[k], after.breakdown[k])
      if (b) breakdown[k] = b
    }
  }
  const subtotal = round2(t.labor + t.parts + t.fees + extras.total)
  const cols = (e: ExtrasResult) => JSON.stringify(extrasColumns(e))
  const d = hdApplyDiscount({
    discount: s.discount, laborLines: t.labor, partsLines: t.parts, subtotal, breakdown, taxAmount,
    taxRatePct: rateFor(invoice, opened, s),
  })
  const priced = {
    subtotalLabor: t.labor,
    subtotalParts: t.parts,
    extras,
    extrasChanged: cols(extras) !== cols(openedExtras),
    subtotal,
  }
  if (!d.ok) {
    return { ...priced, taxAmount, breakdown, total: round2(subtotal + taxAmount),
      discount: null, discountError: d.error, discountNotice: null }
  }
  return { ...priced, taxAmount: d.taxAmount, breakdown: d.breakdown, total: d.grandTotal,
    discount: d.discount, discountError: null, discountNotice: d.notice ?? null }
}

/**
 * The single rate a discount on a split-less invoice takes its tax off at: the one the
 * tech just typed, else the one the invoice recorded - NULL, never 0, when it has none.
 */
function rateFor(invoice: Record<string, unknown>, opened: InvoiceEditState, s: InvoiceEditState): number | null {
  return s.tax_rate !== opened.tax_rate ? s.tax_rate : recordedRate(invoice.tax_rate)
}

/** The tax to carry from: before the discount, when the invoice has one. */
function storedTaxOf(invoice: Record<string, unknown>) {
  const d = parseDiscount(invoice.discount)
  if (d) return { taxAmount: d.tax_before, breakdown: d.pre_tax_breakdown }
  return { taxAmount: round2(num(invoice.tax_amount)), breakdown: parseBreakdown(invoice.tax_breakdown) }
}

/**
 * Does the stored invoice add up? Its total must be its own lines + fees + extras +
 * stored tax, and a stored split must sum to the stored tax. NULL when it does.
 */
export function invoiceDoesNotAddUp(invoice: Record<string, unknown>): { stored: number; own: number; reason: string } | null {
  const s = openInvoiceEdit(invoice, null).state
  const t = subtotals(s)
  const extras = extrasFromDocument(invoice)
  const stored = round2(num(invoice.total))
  const discounted = parseDiscount(invoice.discount)?.amount ?? 0
  const own = round2(t.labor + t.parts + t.fees + extras.total - discounted + num(invoice.tax_amount))
  if (own !== stored) return { stored, own: correctionFor(invoice).total, reason: 'total' }
  const bd = parseBreakdown(invoice.tax_breakdown)
  if (bd) {
    const sum = round2((bd.parts?.amount ?? 0) + (bd.labor?.amount ?? 0) + (bd.services?.amount ?? 0))
    if (sum !== round2(num(invoice.tax_amount))) return { stored, own: correctionFor(invoice).total, reason: 'tax split' }
  }
  return null
}

/**
 * The deliberate correction: the invoice recalculated from its own lines, fees and
 * extras, taxed at the rates it recorded. Only ever applied when the tech confirms it.
 */
export function correctionFor(invoice: Record<string, unknown>): {
  total: number; taxAmount: number; breakdown: TaxBreakdown | null; subtotalLabor: number; subtotalParts: number
  discount: DocumentDiscount | null
} {
  const s = openInvoiceEdit(invoice, null).state
  const t = subtotals(s)
  const extras = extrasFromDocument(invoice)
  const tax = taxFor(s, extras, taxSettingsFor(invoice, s))
  const subtotal = round2(t.labor + t.parts + t.fees + extras.total)
  // A recorded discount is applied to the recalculated figures, so the correction
  // does not quietly drop it. One that no longer fits is left as stored: the invoice
  // then still does not add up, and is still refused.
  const d = hdApplyDiscount({ discount: s.discount, laborLines: t.labor, partsLines: t.parts,
    subtotal, breakdown: tax.breakdown, taxAmount: tax.taxAmount, taxRatePct: null })
  if (d.ok && d.discount) {
    return { total: d.grandTotal, taxAmount: d.taxAmount, breakdown: d.breakdown,
      subtotalLabor: t.labor, subtotalParts: t.parts, discount: d.discount }
  }
  return { total: round2(subtotal + tax.taxAmount), taxAmount: tax.taxAmount, breakdown: tax.breakdown,
    subtotalLabor: t.labor, subtotalParts: t.parts, discount: null }
}

/** The one sentence the editor shows on an invoice that does not add up. */
export function doesNotAddUpMessage(p: { stored: number; own: number }): string {
  return `This invoice does not add up. Its stored total is ${usd(p.stored)} and its own lines and fees come to ${usd(p.own)}. Bring it to ${usd(p.own)}?`
}

/** A dated line appended to internal_notes. */
export function appendNote(existing: unknown, line: string, now = new Date()): string {
  const stamped = `[${now.toISOString().slice(0, 16).replace('T', ' ')} UTC] ${line}`
  const prior = str(existing).trim()
  return prior ? `${prior}\n${stamped}` : stamped
}

/** The body of the deliberate correction PUT. No line items, so nothing else moves. */
export function correctionBody(invoice: Record<string, unknown>, now = new Date()): Record<string, unknown> {
  const c = correctionFor(invoice)
  const stored = round2(num(invoice.total))
  return {
    subtotal_labor: c.subtotalLabor,
    subtotal_parts: c.subtotalParts,
    tax_amount:     c.taxAmount,
    tax_breakdown:  c.breakdown,
    total:          c.total,
    ...(c.discount ? { discount: c.discount } : {}),
    internal_notes: appendNote(invoice.internal_notes,
      `Total corrected on purpose from ${usd(stored)} to ${usd(c.total)} in the invoice editor: the stored total was not its own lines, fees, extras and tax ` +
      `(tax ${usd(round2(num(invoice.tax_amount)))} -> ${usd(c.taxAmount)}).`, now),
  }
}

const TEXT_KEYS = ['customer_name', 'customer_phone', 'customer_email', 'unit_number', 'unit_manufacturer',
  'unit_model', 'unit_serial', 'notes', 'payment_terms'] as const

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    if (a == null || b == null) return a == null && b == null
    return Math.abs(Number(a) - Number(b)) < 1e-9
  }
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * The PUT body: every field the edit changed, and nothing else. An unchanged save
 * returns {} and the form writes nothing.
 */
export function invoiceSaveBody(
  invoice: Record<string, unknown>,
  opened: OpenedInvoice,
  s: InvoiceEditState,
  now = new Date(),
): Record<string, unknown> {
  const price = priceInvoiceEdit(invoice, opened.state, s)
  // The form refuses first and shows why. Throwing here keeps any other caller from
  // writing undiscounted figures over a discount it could not apply.
  if (price.discountError) throw new Error(price.discountError)
  const full: Record<string, unknown> = {}
  for (const k of TEXT_KEYS) {
    // Blank and missing are the same thing to the customer; "" over NULL is not an edit.
    const v = s[k].trim() === '' ? null : s[k]
    if (str(invoice[k]).trim() === '' ? v !== null : v !== invoice[k]) full[k] = v
  }
  const linesChanged = JSON.stringify(s.lines) !== JSON.stringify(opened.state.lines)
  if (linesChanged) full.line_items = s.lines
  const money: Record<string, unknown> = {
    labor_rate:     s.labor_rate,
    subtotal_labor: price.subtotalLabor,
    subtotal_parts: price.subtotalParts,
    diagnostic_fee: round2(s.diagnostic_fee),
    road_call_fee:  round2(s.road_call_fee),
    tax_rate:       s.tax_rate,
    tax_amount:     price.taxAmount,
    total:          price.total,
    ...(price.extrasChanged ? extrasColumns(price.extras) : {}),
  }
  for (const [k, v] of Object.entries(money)) {
    // A NULL fee is no fee: 0 over NULL is not an edit.
    if ((k === 'diagnostic_fee' || k === 'road_call_fee') && invoice[k] == null && v === 0) continue
    if (!sameValue(v, invoice[k])) full[k] = v
  }
  if (JSON.stringify(parseBreakdown(price.breakdown)) !== JSON.stringify(parseBreakdown(invoice.tax_breakdown))) {
    full.tax_breakdown = price.breakdown
  }
  // The discount record, compared through the one reader so key order cannot make an
  // unchanged discount look edited. Removing it writes NULL.
  if (JSON.stringify(parseDiscount(price.discount)) !== JSON.stringify(parseDiscount(invoice.discount))) {
    full.discount = price.discount
  }
  // A4: a rate taken from Settings is written with a note saying so.
  if (opened.laborRateAssumed && 'labor_rate' in full && s.labor_rate === opened.state.labor_rate) {
    full.internal_notes = appendNote(invoice.internal_notes,
      `Labor rate ${usd(num(s.labor_rate))}/hr taken from shop settings - the invoice had none recorded.`, now)
  }
  return full
}
