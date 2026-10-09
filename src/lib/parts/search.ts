// The parts search rules, as pure functions.
//
// Pure and in one file on purpose: these are the rules a Carrier Supra 660 returned
// 12 parts for instead of 3, and every one of them is testable without a database,
// a session or a screen. The API route and the work-order picker both call these, so
// the two surfaces cannot drift into disagreeing about what fits.
//
// THE FOUR RULES, AND WHY EACH ONE EXISTS
//
//   1. MANUFACTURER CONSTRAINS ABSOLUTELY. A Carrier unit never returns a Thermo King
//      part. Six of the twelve wrong answers were TK parts offered for a Carrier unit.
//   2. A CATCH-ALL NEVER MATCHES A MODEL SEARCH. Eleven of the twelve were rows whose
//      fitment named no model at all. They are real parts and they are shown - but
//      only when no model is selected, because "fits everything" is not an answer to
//      "what fits THIS unit".
//   3. MATCH ON NORMALIZED VALUES. SUPRA-660, "Supra 660" and supra660 are one model;
//      78-1341 and 781341 are one part.
//   4. A SERIAL SPLIT IS DECLARED, AND FILTERED WHEN A SERIAL IS KNOWN. Fourteen
//      fitment rows differ only by serial break. Returning both without saying which
//      is which makes the technician guess, which is the failure the whole feature is
//      meant to remove.

export const normalizePartNumber = (value: string): string =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, '')

export const normalizeModel = (value: string): string =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, '')

// ── manufacturer ────────────────────────────────────────────────────────────
//
// The same company is written four ways across these tables: "Carrier Transicold",
// "Carrier", "TK", "Thermo King". Equality on the raw string would silently drop
// correct parts, so both sides are reduced to one token first.
//
// "Both" is a real value in hd_parts_reference and means the row applies to either
// make, so it matches anything rather than nothing.
const MANUFACTURER_ALIASES: Array<[RegExp, string]> = [
  [/^(carrier|carriertranscold|carriertransicold|ct)$/, 'carrier'],
  [/^(tk|thermoking)$/, 'thermoking'],
  [/^(both|any|all|generic|universal)$/, 'any'],
]

export function canonicalManufacturer(value: string | null | undefined): string | null {
  if (!value) return null
  const squashed = value.toLowerCase().replace(/[^a-z]/g, '')
  if (!squashed) return null
  for (const [pattern, canonical] of MANUFACTURER_ALIASES) {
    if (pattern.test(squashed)) return canonical
  }
  return squashed
}

/**
 * Does a part from `partMfr` belong in a search for `wantedMfr`?
 *
 * Absolute when a manufacturer is asked for: a Thermo King part is never an answer
 * for a Carrier unit. A part marked as fitting either make still matches.
 */
export function manufacturerMatches(partMfr: string | null | undefined, wantedMfr: string | null | undefined): boolean {
  const wanted = canonicalManufacturer(wantedMfr)
  if (!wanted || wanted === 'any') return true
  const part = canonicalManufacturer(partMfr)
  if (!part) return false
  if (part === 'any') return true
  return part === wanted
}

// ── models ──────────────────────────────────────────────────────────────────

/**
 * Is this fitment value a catch-all - a family or a blanket rather than a model?
 *
 * part_fitment cannot hold one (migration 148 forbids it), but the legacy
 * hd_parts_reference is full of them and the same screens read both, so the test
 * lives here and is applied to whatever it is given.
 *
 * NOTE THE HYPHEN. An earlier version of this test used whitespace word boundaries
 * and so did not match "ALL-TK" or "ALL-Carrier" - which are exactly the two values
 * the old matcher treats as universal. Separators are squashed before the test.
 */
const UNIVERSAL_EXACT = new Set([
  'ALL', 'ALLTK', 'ALLCARRIER', 'ANY', 'UNIVERSAL', 'GENERIC',
  'TK', 'THERMOKING', 'CARRIER', 'CARRIERTRANSICOLD',
])

export function isCatchAllModel(value: string | null | undefined): boolean {
  if (!value || !value.trim()) return true
  if (UNIVERSAL_EXACT.has(normalizeModel(value))) return true
  return /(^|[^a-z0-9])(all|any|every|universal|various|series|family)([^a-z0-9]|$)/i.test(value)
}

/**
 * Does a fitment's model answer a search for `wanted`?
 *
 * EXACT on the normalized value, not a substring. Substring matching is how "Supra 6"
 * would quietly answer for a Supra 660, and how "X4" matched the Thermo King X426 and
 * X430 compressors - a mistake this code made once already while measuring the bug.
 *
 * A catch-all never matches. That is rule 2, and it is the single biggest cause of the
 * twelve wrong answers.
 */
export function modelMatches(fitmentModel: string | null | undefined, wanted: string | null | undefined): boolean {
  if (!wanted || !wanted.trim()) return true
  if (!fitmentModel) return false
  if (isCatchAllModel(fitmentModel)) return false
  return normalizeModel(fitmentModel) === normalizeModel(wanted)
}

// ── serial splits ───────────────────────────────────────────────────────────

export type SerialSide = 'before' | 'from' | 'all' | 'unknown'

export interface SerialRange {
  serial_from?: string | null
  serial_before?: string | null
}

/** Which side of a split a fitment row is for. `all` means it has no split. */
export function serialSide(row: SerialRange): SerialSide {
  if (row.serial_from && row.serial_before) return 'unknown'
  if (row.serial_from) return 'from'
  if (row.serial_before) return 'before'
  return 'all'
}

/**
 * Plain words for the split, for the screen.
 *
 * The technician has to be told which side a result is for even when no serial was
 * typed - otherwise two air filters come back for one unit with nothing to choose by.
 */
export function serialLabel(row: SerialRange): string | null {
  if (row.serial_from && row.serial_before) return `Serial ${row.serial_from} to ${row.serial_before}`
  if (row.serial_from)   return `Units from serial ${row.serial_from} onward`
  if (row.serial_before) return `Units before serial ${row.serial_before}`
  return null
}

/**
 * Can these two serials be compared at all?
 *
 * Carrier serials look like GAG90483303: a letter prefix identifying the plant and
 * line, then a sequence. Comparing GAG90483303 against LAA90946117 as strings would
 * produce an answer, and the answer would be meaningless. So comparison is allowed
 * only when the alphabetic prefixes match, and refused otherwise - which is reported
 * rather than guessed.
 */
export function serialsComparable(a: string, b: string): boolean {
  const prefix = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').match(/^[A-Z]*/)?.[0] ?? ''
  return prefix(a) === prefix(b)
}

const serialDigits = (s: string): string => s.toUpperCase().replace(/[^0-9]/g, '')

/**
 * Does a fitment row apply to the unit with this serial?
 *
 * Returns `true` when it applies, `false` when the serial rules it out, and `null`
 * when the two serials cannot be compared - which the caller must surface as "could
 * not narrow this by serial" rather than silently including or excluding it.
 */
export function serialApplies(row: SerialRange, serial: string | null | undefined): boolean | null {
  if (!serial || !serial.trim()) return true
  const side = serialSide(row)
  if (side === 'all') return true

  const bounds = [row.serial_from, row.serial_before].filter(Boolean) as string[]
  if (!bounds.every(b => serialsComparable(b, serial))) return null

  const want = serialDigits(serial)
  if (!want) return null

  if (row.serial_before && want >= serialDigits(row.serial_before)) return false
  if (row.serial_from   && want <  serialDigits(row.serial_from))   return false
  return true
}

// ── ranking ─────────────────────────────────────────────────────────────────

export interface RankableFitment extends SerialRange {
  verified?: boolean | null
  unit_model?: string | null
  engine_model?: string | null
  compressor_model?: string | null
}

/**
 * Sort order for results. Verified first, then rows that name a unit model over ones
 * that fit by engine or compressor, then narrower fitment before broader.
 *
 * Deliberately NOT a confidence score. The screen shows a list with the
 * distinguishing detail; it never picks one and presents it as the answer.
 */
export function fitmentRank(row: RankableFitment): number {
  let rank = 0
  if (!row.verified) rank += 100
  if (!row.unit_model) rank += 10
  if (serialSide(row) === 'all') rank += 1
  return rank
}

// ── free text ───────────────────────────────────────────────────────────────

/**
 * Does the typed text match this part?
 *
 * Text containing a digit is treated as a number in hand and matched against the
 * part number on its NORMALIZED form, so 781341 finds 78-1341. Plain words are
 * matched against the description and the type, never against number columns - that
 * is how "belt" used to match any row whose notes merely mentioned one.
 */
export function textMatches(
  part: { part_number?: string | null; part_number_normalized?: string | null; description?: string | null; part_type?: string | null },
  needle: string | null | undefined,
): boolean {
  const q = needle?.trim()
  if (!q) return true

  if (/[0-9]/.test(q)) {
    const wanted = normalizePartNumber(q)
    if (!wanted) return false
    const stored = part.part_number_normalized ?? (part.part_number ? normalizePartNumber(part.part_number) : '')
    if (stored.includes(wanted)) return true
    // A number can also appear in a description - "Belt 3VX630", "Air filter 196mm".
    return [part.description, part.part_type].some(v => v && normalizePartNumber(v).includes(wanted))
  }

  const lower = q.toLowerCase()
  return [part.description, part.part_type].some(v => v && v.toLowerCase().includes(lower))
}

/** Does the type filter match? Substring, so "filter" covers "Filter - fuel". */
export function typeMatches(partType: string | null | undefined, wanted: string | null | undefined): boolean {
  if (!wanted || !wanted.trim()) return true
  if (!partType) return false
  return partType.toLowerCase().includes(wanted.trim().toLowerCase())
}
