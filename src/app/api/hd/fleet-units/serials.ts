/**
 * Duplicate serial numbers on hd_units, said in words a shop can act on.
 *
 * Migration 161's hd_units_user_serial_unique allows one ACTIVE unit per serial per
 * shop, compared as upper(btrim(serial_number)) - the same rule as normSerial in
 * src/lib/hd/unit-match.ts. Retired units (active = false) are outside the index, so
 * a merged-away duplicate never blocks anything. Without these messages the shop sees
 * "duplicate key value violates unique constraint", which names neither the serial
 * nor the unit that already has it.
 *
 * Pure - no database - so scripts/verify-equipment-categories.ts can hold it.
 */

import { normSerial } from '@/lib/hd/unit-match'

export const SERIAL_UNIQUE_INDEX = 'hd_units_user_serial_unique'

export interface SerialHolder {
  id:            string
  unit_number:   string | null
  manufacturer:  string | null
  model:         string | null
  serial_number: string | null
  active?:       boolean | null
}

// Placeholders the form and importer write when nothing was entered. Saying
// "unit 103 (UNKNOWN Unknown)" reads worse than leaving them out.
const PLACEHOLDER = new Set(['', 'UNKNOWN'])

/** "unit 103 (International S1800)", or just "unit 103" when make and model are blank. */
export function describeUnit(u: Pick<SerialHolder, 'unit_number' | 'manufacturer' | 'model'>): string {
  const label = `unit ${(u.unit_number ?? '').trim() || '(no number)'}`
  const makeModel = [u.manufacturer, u.model]
    .map(s => (s ?? '').trim())
    .filter(s => !PLACEHOLDER.has(s.toUpperCase()))
    .join(' ')
  return makeModel ? `${label} (${makeModel})` : label
}

export function duplicateSerialMessage(serial: string, holder: SerialHolder): string {
  return `Serial ${serial.trim()} is already on ${describeUnit(holder)}.`
}

/** True for the unique-serial violation, as PostgREST reports it. */
export function isSerialUniqueViolation(err: { code?: string; message?: string } | null | undefined): boolean {
  return !!err && err.code === '23505' && (err.message ?? '').includes(SERIAL_UNIQUE_INDEX)
}

/** The ACTIVE unit (other than `exceptId`) holding this serial, under the index's own rule. */
export function findSerialHolder<T extends SerialHolder>(units: T[], serial: string | null | undefined, exceptId?: string | null): T | null {
  const want = normSerial(serial)
  if (!want) return null
  return units.find(u => u.id !== exceptId && u.active !== false && normSerial(u.serial_number) === want) ?? null
}

/** Escape a value for use inside an ilike pattern, so a serial with % or _ matches literally. */
export function ilikeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, ch => `\\${ch}`)
}

export interface ImportSkip {
  row:           number   // spreadsheet line: line 1 is the header, so data row 0 is line 2
  unit_number:   string | null
  serial_number: string | null
  reason:        string
}

/**
 * Split CSV unit rows into the ones to insert and the ones skipped, with why.
 *
 * Checked against the shop's existing ACTIVE units and against earlier rows of the same
 * file, under the index's rule (trim + uppercase). The first row with a serial wins
 * within the file; later ones are skipped and point back at it. Rows with neither a unit
 * number nor a manufacturer are skipped too - they were always dropped, silently.
 */
export function partitionImportRows<R extends { unit_number?: string; manufacturer?: string; serial_number?: string }>(
  rows: R[],
  existing: SerialHolder[],
): { keep: R[]; skipped: ImportSkip[] } {
  const keep: R[] = []
  const skipped: ImportSkip[] = []
  const seenInFile = new Map<string, number>()   // normalized serial -> line it first appeared on

  rows.forEach((r, i) => {
    const line   = i + 2
    const unitNo = r.unit_number?.trim() || null
    const serial = r.serial_number?.trim() || null

    if (!unitNo && !r.manufacturer?.trim()) {
      skipped.push({ row: line, unit_number: null, serial_number: serial, reason: 'no unit number or manufacturer' })
      return
    }

    const key = normSerial(serial)
    if (key) {
      const holder = findSerialHolder(existing, serial)
      if (holder) {
        skipped.push({ row: line, unit_number: unitNo, serial_number: serial, reason: duplicateSerialMessage(serial!, holder) })
        return
      }
      const earlier = seenInFile.get(key)
      if (earlier != null) {
        skipped.push({ row: line, unit_number: unitNo, serial_number: serial, reason: `Serial ${serial} is also on line ${earlier} of this file.` })
        return
      }
      seenInFile.set(key, line)
    }
    keep.push(r)
  })

  return { keep, skipped }
}

/** One line per skip for an error banner, capped so a large file stays readable. */
export function summarizeSkips(skipped: ImportSkip[], max = 10): string {
  const lines = skipped.slice(0, max).map(s =>
    `Line ${s.row}${s.unit_number ? ` (unit ${s.unit_number})` : ''}: ${s.reason}`)
  if (skipped.length > max) lines.push(`...and ${skipped.length - max} more.`)
  return lines.join(' ')
}
