// ─── The vehicle's odometer at a service, LD and HD ───────────────────────────
//
// Pure: no React, no database. One parser and one formatter for both products:
//
//   HD  hd_quotes / hd_work_orders / hd_invoices.vehicle_odometer   (migration 183)
//   LD  quotes / work_orders / invoices.mileage_at_service          (migration 184;
//       invoices has had the column since 098, set from the send dialog)
//
// lib/hd/unit-hours re-exports parseOdometer / formatOdometer / MAX_ODOMETER, so HD
// callers are unchanged. The LD helpers below are LD's only copy of the rules.
//
// THE READING AT THAT SERVICE, frozen on each document. It carries quote -> work order
// -> invoice and is never read live from vehicles.mileage. NULL means no reading was
// taken and the document prints NOTHING - no "0 mi", no placeholder, no label. 0 is a
// real reading and prints ("Odometer: 0 mi").

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export const MAX_ODOMETER = 9999999

/** An odometer as entered: whole miles, NULL for blank, or 'invalid'. */
export function parseOdometer(v: unknown): number | null | 'invalid' {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null
  const n = Number(typeof v === 'string' ? v.replace(/[,\s]/g, '').replace(/mi(les)?$/i, '') : v)
  if (!Number.isFinite(n) || n < 0 || n > MAX_ODOMETER) return 'invalid'
  return Math.round(n)
}

/** "123,000". NULL for a document with no reading. */
export function formatOdometer(v: unknown): string | null {
  const n = num(v)
  return n == null ? null : Math.round(n).toLocaleString('en-US')
}

/** The refusal for a value parseOdometer cannot read. Both products say the same thing. */
export const ODOMETER_INVALID_MESSAGE = 'The odometer must be whole miles from 0 to 9,999,999, or blank.'

// ─── LD: mileage_at_service on quotes, work orders and invoices ───────────────

/** ONE NAME across LD. No other odometer column exists on an LD document. */
export const LD_ODOMETER_COLUMN = 'mileage_at_service'

export const MIGRATION_184_MESSAGE =
  'The odometer needs migration 184 (supabase/migrations/184_ld_mileage_at_service_on_documents.sql), ' +
  'which is not applied yet. Nothing was saved - clear the odometer to save without it.'

/** The code on the error writeToleratingOdometer returns when it refuses. */
export const ODOMETER_REFUSED_CODE = 'NWI184'

/** "Odometer: 123,000 mi" for a customer copy, or NULL when none was recorded. */
export function odometerLine(doc: Record<string, unknown> | null | undefined): string | null {
  const f = formatOdometer(doc?.[LD_ODOMETER_COLUMN])
  return f == null ? null : `Odometer: ${f} mi`
}

/** True when the row was read with the column, i.e. migration 184 (or 098 for invoices) is in. */
export function hasOdometerColumn(doc: Record<string, unknown> | null | undefined): boolean {
  return !!doc && LD_ODOMETER_COLUMN in doc
}

/** The reading as an editor's input text: '' for none. */
export function odometerText(doc: Record<string, unknown> | null | undefined): string {
  const n = num(doc?.[LD_ODOMETER_COLUMN])
  return n == null ? '' : String(Math.round(n))
}

/**
 * The odometer for a save body. On a document read WITH the column the box is always
 * sent (blank clears it). Otherwise - a new document, or one read before 184 - it is
 * sent only when something is typed, so a save with no reading works on a database
 * without 184, and one with a reading is refused there with MIGRATION_184_MESSAGE.
 * Sent as typed; the route parses it.
 */
export function odometerBody(text: string, columnPresent: boolean): Record<string, string | null> {
  const t = text.trim()
  return columnPresent || t !== '' ? { [LD_ODOMETER_COLUMN]: t === '' ? null : t } : {}
}

/**
 * The reading off a request body, parsed - only when the body sent the key, so a
 * caller that knows nothing of it changes nothing. Unreadable is an error (400),
 * never silently stored as blank.
 */
export function odometerFromBody(body: Record<string, unknown>): { update: Record<string, number | null> } | { error: string } {
  if (!(LD_ODOMETER_COLUMN in body)) return { update: {} }
  const o = parseOdometer(body[LD_ODOMETER_COLUMN])
  if (o === 'invalid') return { error: ODOMETER_INVALID_MESSAGE }
  return { update: { [LD_ODOMETER_COLUMN]: o } }
}

/** What a document carries to the next one: the reading when there is one, else nothing. */
export function odometerCarry(doc: Record<string, unknown>): Record<string, number> {
  const n = num(doc[LD_ODOMETER_COLUMN])
  return n == null ? {} : { [LD_ODOMETER_COLUMN]: Math.round(n) }
}

/** True for a write refused because mileage_at_service is missing (184 not applied). */
export function isMissingOdometerColumn(error: unknown): boolean {
  const e = (error ?? {}) as { code?: string; message?: string; details?: string }
  const text = `${e.message ?? ''} ${e.details ?? ''}`
  const missing = e.code === '42703' || e.code === 'PGRST204' || /does not exist|could not find|schema cache/i.test(text)
  return missing && text.includes(LD_ODOMETER_COLUMN)
}

/**
 * The row without mileage_at_service, for a database without it - or the refusal
 * when the row holds a reading: a typed reading is never dropped silently. HD's
 * withoutMissingReadings, for LD's one column.
 */
export function withoutMissingOdometer(row: Record<string, unknown>, error: unknown): { row: Record<string, unknown> } | { error: string } {
  if (!isMissingOdometerColumn(error)) return { row }
  if (row[LD_ODOMETER_COLUMN] != null) return { error: MIGRATION_184_MESSAGE }
  const out = { ...row }
  delete out[LD_ODOMETER_COLUMN]
  return { row: out }
}

/**
 * Run a write; if it fails only because migration 184's column is missing, run it
 * again without it - unless the row holds a reading, which is refused with
 * MIGRATION_184_MESSAGE (code ODOMETER_REFUSED_CODE) instead.
 */
export async function writeToleratingOdometer<T extends Record<string, unknown>, R>(
  row: T,
  write: (r: T) => PromiseLike<{ data: R | null; error: unknown }>,
): Promise<{ data: R | null; error: unknown }> {
  const first = await write(row)
  if (!first.error || !isMissingOdometerColumn(first.error)) return first
  const r = withoutMissingOdometer(row, first.error)
  if ('error' in r) return { data: null, error: { message: r.error, code: ODOMETER_REFUSED_CODE } }
  return write(r.row as T)
}

/** The refusal message when a write was refused for want of 184, else NULL. */
export function odometerRefusal(error: unknown): string | null {
  const e = (error ?? null) as { code?: string; message?: string } | null
  if (!e) return null
  if (e.code === ODOMETER_REFUSED_CODE) return String(e.message ?? MIGRATION_184_MESSAGE)
  return isMissingOdometerColumn(e) ? MIGRATION_184_MESSAGE : null
}
