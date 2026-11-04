// ─── The service call fee, LD and HD ──────────────────────────────────────────
//
// Pure: no React, no database. A flat fee for coming out to the job, with its own tax
// treatment:
//
//   'labor'  taxed in the labor bucket, so it follows the labor tax setting - taxed
//            where labor is, untaxed where labor is not. The default.
//   'none'   never taxed. Still in the subtotal.
//
// The treatment is RECORDED ON EACH DOCUMENT (service_call_tax) when it is priced, and
// a document is always taxed by its own record - never by today's setting. A fee with
// no recorded treatment is taxed as labor.
//
// HD got it in migration 178 (hd_* settings, hd_ documents); LD in migration 180
// (bill_service_call / service_call_fee / service_call_tax on profiles, and the same
// two document columns on quotes, work_orders and invoices). The document columns
// have the same names in both products, so the document helpers here serve both;
// lib/hd/hd-extras re-exports them for HD's callers.
//
// THE FEE IS ITS OWN LINE. It rides in the labor TAX bucket when taxed, but it is never
// folded into the labor subtotal or labor income: every document prints it on its own
// named line, and financials report it on its own.
//
// LD's tax rounding is not changed by any of this: wherever LD taxes drive time, the
// fee is taxed in the same call (lib/document-money, lib/segments/parent-extras, the
// converter, the invoice editor).

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const round2 = (n: number) => Math.round(n * 100) / 100

export type ServiceCallTax = 'labor' | 'none'

export function isServiceCallTax(v: unknown): v is ServiceCallTax {
  return v === 'labor' || v === 'none'
}

/** A shop's service call default. */
export interface ServiceCallSettings {
  bill: boolean
  /** NULL = never set. 0 is a real answer. */
  fee: number | null
  tax: ServiceCallTax
}

export const SERVICE_CALL_OFF: ServiceCallSettings = { bill: false, fee: null, tax: 'labor' }

/** The fee as one document carries it. fee 0 is none. */
export interface ServiceCall {
  fee: number
  tax: ServiceCallTax
}

export const NO_SERVICE_CALL: ServiceCall = { fee: 0, tax: 'labor' }

// ─── LD settings (migration 180) ──────────────────────────────────────────────

/** LD's columns on profiles. */
export const LD_SERVICE_CALL_SELECT = 'bill_service_call, service_call_fee, service_call_tax'

/** True when this profile row has the migration 180 columns. */
export function hasLdServiceCallColumns(profile: Record<string, unknown> | null | undefined): boolean {
  return profile != null && 'bill_service_call' in profile
}

/** LD's service call default. Off before migration 180. */
export function ldServiceCallFrom(profile: Record<string, unknown> | null | undefined): ServiceCallSettings {
  const p = profile ?? {}
  if (!hasLdServiceCallColumns(p)) return SERVICE_CALL_OFF
  return {
    bill: p.bill_service_call === true,
    fee:  num(p.service_call_fee),
    tax:  isServiceCallTax(p.service_call_tax) ? p.service_call_tax : 'labor',
  }
}

/** What a NEW document starts with: the shop's fee when it bills one, else none. */
export function serviceCallSeed(s: ServiceCallSettings): ServiceCall {
  return s.bill && (s.fee ?? 0) > 0 ? { fee: round2(s.fee!), tax: s.tax } : { fee: 0, tax: s.tax }
}

// ─── On a document ────────────────────────────────────────────────────────────

/** The service call fee a document charges. NULL and absent are none. */
export function serviceCallFee(doc: Record<string, unknown>): number {
  return num(doc.service_call_fee) ?? 0
}

/** Whether a document's service call fee is taxed - by its own record, never a setting. */
export function serviceCallTaxed(doc: Record<string, unknown>): boolean {
  return doc.service_call_tax !== 'none'
}

/** The fee a document recorded, and how it recorded taxing it. */
export function serviceCallOf(doc: Record<string, unknown> | null | undefined): ServiceCall {
  const d = doc ?? {}
  const fee = serviceCallFee(d)
  return { fee: fee > 0 ? round2(fee) : 0, tax: d.service_call_tax === 'none' ? 'none' : 'labor' }
}

/** True when the database this row came from has the two document columns. */
export function hasServiceCallColumn(doc: Record<string, unknown> | null | undefined): boolean {
  return doc != null && 'service_call_fee' in doc
}

/** Where the fee goes for tax: the labor bucket, or nowhere. Both are in the subtotal. */
export function serviceCallBuckets(sc: ServiceCall | null | undefined): { labor: number; untaxed: number } {
  const fee = sc && sc.fee > 0 ? round2(sc.fee) : 0
  return sc?.tax === 'none' ? { labor: 0, untaxed: fee } : { labor: fee, untaxed: 0 }
}

/**
 * The two columns a document stores for its service call fee. NULL fee when there is
 * none, so a document without one reads exactly as before.
 */
export function serviceCallColumns(fee: number | null | undefined, tax: ServiceCallTax): { service_call_fee: number | null; service_call_tax: ServiceCallTax | null } {
  const f = num(fee)
  return f != null && f > 0 ? { service_call_fee: round2(f), service_call_tax: tax } : { service_call_fee: null, service_call_tax: null }
}

/** The row a document prints for it, or none. Same label in both products. */
export function serviceCallRow(sc: ServiceCall | null | undefined): { key: 'service_call'; label: string; amount: number } | null {
  return sc && sc.fee > 0 ? { key: 'service_call', label: 'Service Call Fee', amount: round2(sc.fee) } : null
}

/** The two columns off a request body: only when sent, so a caller that does not know them changes nothing. */
export function serviceCallFromBody(body: Record<string, unknown>): { service_call_fee: number | null; service_call_tax: ServiceCallTax | null } | null {
  if (!('service_call_fee' in body) && !('service_call_tax' in body)) return null
  return serviceCallColumns(num(body.service_call_fee), isServiceCallTax(body.service_call_tax) ? body.service_call_tax : 'labor')
}

// ─── Before the migration is applied ──────────────────────────────────────────

/** True for a write refused because the service call columns are missing. */
export function isMissingServiceCallColumn(error: unknown): boolean {
  const e = (error ?? {}) as { code?: string; message?: string; details?: string }
  const text = `${e.message ?? ''} ${e.details ?? ''}`
  const missing = e.code === '42703' || e.code === 'PGRST204' || /does not exist|could not find|schema cache/i.test(text)
  return missing && /\b(bill_service_call|service_call_(fee|tax))\b/.test(text)
}

/** Drop the two document columns from a row, for a database without them. */
export function withoutServiceCall<T extends Record<string, unknown>>(row: T): T {
  const { service_call_fee: _f, service_call_tax: _t, ...rest } = row
  void _f; void _t
  return rest as T
}

export const MIGRATION_180_MESSAGE = 'A service call fee needs migration 180 (supabase/migrations/180_ld_service_call_fee.sql). Nothing was saved.'

/**
 * Run a write; if it fails only because migration 180's two document columns are not
 * in the database, run it again without them - unless the row CHARGES a fee. A fee
 * dropped from the record while the total still contains it would bill a charge the
 * document never prints, so that write is refused with MIGRATION_180_MESSAGE instead.
 */
export async function writeToleratingServiceCall<T extends Record<string, unknown>, R>(
  row: T,
  write: (r: T) => PromiseLike<{ data: R | null; error: unknown }>,
): Promise<{ data: R | null; error: unknown }> {
  const first = await write(row)
  if (!first.error || !isMissingServiceCallColumn(first.error)) return first
  if (serviceCallFee(row) > 0) return { data: null, error: { message: MIGRATION_180_MESSAGE, code: 'NWI180' } }
  return write(withoutServiceCall(row))
}

// ─── How the shop bills for getting to the job ────────────────────────────────
//
// One choice in Settings (LD, HD and Reefer Standalone) that SETS the underlying
// toggles; it does not replace them. Shop supplies is separate - it is a percentage of
// parts and applies however the shop bills the trip.

export type BillingMethod = 'service_call' | 'drive_time' | 'both'

export const BILLING_METHODS: ReadonlyArray<{ value: BillingMethod; label: string; hint: string }> = [
  { value: 'service_call', label: 'Flat service call fee', hint: 'One fee per job. Drive time and mileage are switched off.' },
  { value: 'drive_time',   label: 'Drive time and mileage', hint: 'Hours x rate and miles x rate. No flat fee.' },
  { value: 'both',         label: 'Both',                   hint: 'A flat fee, plus drive time and mileage.' },
]

/**
 * What a shop's toggles amount to, for the first open of Settings. A shop that bills
 * none of the three reads as "Drive time and mileage" with both off - exactly the
 * screen it had before, and nothing it bills changes.
 */
export function billingMethodFrom(t: { billServiceCall: boolean; billTravel: boolean; billMileage: boolean }): BillingMethod {
  const trip = t.billTravel || t.billMileage
  if (t.billServiceCall && trip) return 'both'
  if (t.billServiceCall) return 'service_call'
  return 'drive_time'
}

/** The toggles a pick sets. Each can still be switched afterwards; shop supplies is not touched. */
export function togglesFor(m: BillingMethod): { billServiceCall: boolean; billTravel: boolean; billMileage: boolean } {
  if (m === 'service_call') return { billServiceCall: true,  billTravel: false, billMileage: false }
  if (m === 'drive_time')   return { billServiceCall: false, billTravel: true,  billMileage: true }
  return { billServiceCall: true, billTravel: true, billMileage: true }
}

/** Which inputs a method shows. */
export function methodShows(m: BillingMethod): { serviceCall: boolean; driveTime: boolean } {
  return { serviceCall: m !== 'drive_time', driveTime: m !== 'service_call' }
}
