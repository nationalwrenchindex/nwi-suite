// ─── The unit's hour reading on an HD document (migration 179) ────────────────
//
// THE READING WHEN THE WORK WAS DONE, frozen on the document. A work order records
// what the tech entered; its invoice carries that figure at convert; nothing ever
// re-reads hd_units to fill or refresh it. NULL means no reading was taken and the
// document prints no hours - never a guess, never the unit's current figure.
//
// The unit's identity (number, make, model, serial) follows the same rule: recorded
// on the document. unitIdentityFill copies it from the linked unit only into fields
// the document left EMPTY, at the moment the document is written - so it is frozen
// there from then on, and a later edit to the unit record changes no document.

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export const MAX_UNIT_HOURS = 999999

/** A reading as entered: a number, NULL for blank, or 'invalid'. Rounded to 0.1. */
export function parseUnitHours(v: unknown): number | null | 'invalid' {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null
  const n = Number(typeof v === 'string' ? v.replace(/,/g, '') : v)
  if (!Number.isFinite(n) || n < 0 || n > MAX_UNIT_HOURS) return 'invalid'
  return Math.round(n * 10) / 10
}

/** "9,110" / "9,110.5". NULL for a document with no reading. */
export function formatUnitHours(v: unknown): string | null {
  const n = num(v)
  return n == null ? null : n.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

/**
 * The unit's last known reading, for PRE-FILLING the work order's input only. A unit
 * record's 0 is the column default, not a reading, so it pre-fills nothing.
 */
export function lastKnownHours(unit: Record<string, unknown> | null | undefined): number | null {
  const h = num(unit?.total_hours)
  return h != null && h > 0 ? h : null
}

/** The linked unit's identity, for the document fields that are empty. Never overwrites. */
export function unitIdentityFill(doc: Record<string, unknown>, unit: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!unit) return {}
  const blank = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '')
  const pairs: Array<[string, unknown]> = [
    ['unit_number', unit.unit_number], ['unit_manufacturer', unit.manufacturer],
    ['unit_model', unit.model], ['unit_serial', unit.serial_number],
  ]
  const out: Record<string, string> = {}
  for (const [k, v] of pairs) if (blank(doc[k]) && !blank(v)) out[k] = String(v).trim()
  return out
}

export function isMissingUnitHoursColumn(error: unknown): boolean {
  const e = (error ?? {}) as { code?: string; message?: string }
  return (e.code === '42703' || e.code === 'PGRST204') && /unit_hours/.test(String(e.message ?? ''))
}

// ─── The truck or trailer's odometer (migration 183) ──────────────────────────
//
// The reefer unit records HOURS; the truck or trailer it is on records MILES. Same
// rules as the hours: the reading at THIS service, frozen on the quote, the work order
// and the invoice; NULL = none taken and nothing prints - no "0", no placeholder. For
// warranty: a receipt at 123,000 miles is the proof of what was done and when.
//
// Migration 183 also gives hd_quotes the unit_hours column the work order and invoice
// have had since 179, so a reading taken at the quote carries to both.

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

/** The two reading columns, as a document stores them. */
export const READING_COLUMNS = ['unit_hours', 'vehicle_odometer'] as const

/**
 * The readings off a request body, parsed - only the keys the body sent, so a caller
 * that knows nothing of them changes nothing. An unparseable value is an error, never
 * silently stored as blank.
 */
export function readingsFromBody(body: Record<string, unknown>): { update: Record<string, number | null> } | { error: string } {
  const update: Record<string, number | null> = {}
  if ('unit_hours' in body) {
    const h = parseUnitHours(body.unit_hours)
    if (h === 'invalid') return { error: 'Unit hours must be a number from 0 to 999,999, or blank.' }
    update.unit_hours = h
  }
  if ('vehicle_odometer' in body) {
    const o = parseOdometer(body.vehicle_odometer)
    if (o === 'invalid') return { error: 'The odometer must be whole miles from 0 to 9,999,999, or blank.' }
    update.vehicle_odometer = o
  }
  return { update }
}

/** The readings a document carries to the next one: only the columns the source has. */
export function readingsCarry(doc: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of READING_COLUMNS) if (k in doc) out[k] = doc[k] ?? null
  return out
}

/** True for a write refused because a reading column (179 or 183) is missing. */
export function isMissingReadingColumn(error: unknown): boolean {
  const e = (error ?? {}) as { code?: string; message?: string }
  return (e.code === '42703' || e.code === 'PGRST204') && /unit_hours|vehicle_odometer/.test(String(e.message ?? ''))
}

/**
 * The row without the reading columns the database lacks, or the refusal when one of
 * them holds a reading: a typed reading is never dropped silently (Brock, Nov 6).
 */
export function withoutMissingReadings(row: Record<string, unknown>, error: unknown): { row: Record<string, unknown> } | { error: string } {
  const msg = String((error as { message?: string } | null)?.message ?? '')
  const out = { ...row }
  for (const k of READING_COLUMNS) {
    if (!msg.includes(k)) continue
    if (out[k] != null) {
      return { error: k === 'unit_hours'
        ? 'Unit hours on this document need a migration that is not applied yet (179 for work orders and invoices, 183 for quotes). Nothing was saved - clear the hours to save without them.'
        : 'The odometer needs migration 183, which is not applied yet. Nothing was saved - clear the odometer to save without it.' }
    }
    delete out[k]
  }
  return { row: out }
}

/**
 * The readings an EDIT changed, for a document editor's save body: only a column whose
 * text differs from what the document opened with, so an untouched reading is never
 * rewritten. Values go as typed; the route parses them (readingsFromBody).
 */
export function readingEditBody(fields: Partial<Record<typeof READING_COLUMNS[number], [opened: string, now: string]>>): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const k of READING_COLUMNS) {
    const f = fields[k]
    if (!f) continue
    const was = f[0].trim(), now = f[1].trim()
    if (was !== now) out[k] = now === '' ? null : now
  }
  return out
}
