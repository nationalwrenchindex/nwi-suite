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
