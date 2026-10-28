// THE part number normalizer. Every parts search and every parts import goes through
// parsePartNumber, so "what number did the tech mean" is decided in one place.
//
// The numbering rules are Brock's, from 17 years at the counter, and are ground truth
// (CLAUDE.md, "Part numbers"). Do not re-derive them from the data:
//
//   1. THERMO KING OEM: 6 digits, dash after the first two.            11-9959
//   2. CARRIER TRANSICOLD: 9 digits, dashes after the first two and
//      before the last two.                                            30-60143-01
//   3. A leading "37-" is a vendor's catalog addition and is NOT part
//      of the number. Strip it.                         37-11-9959 IS 11-9959
//   4. A leading "20-" on a TK number is Carrier selling an aftermarket
//      part for a TK application.              20-11-9959 relates to 11-9959
//   5. An "8" on the front of the first segment means reman.
//                                         845-1234 is the reman of 45-1234
//   6. A LOST LEADING ZERO IS DAMAGED DATA, NOT A DIFFERENT PART (Oct 28).
//      The canonical form keeps the zero.          78-603 IS 78-0603
//
// Only rule 3 changes what a number IS. Rules 4 and 5 are RECOGNIZED and reported
// (form + relatesTo) but the canonical number is left alone: whether a 20- part or a
// reman merges with, crosses to, or stays apart from the OEM number is Brock's call,
// not this function's. relatesTo is information, never a search key.
//
// The canonical number's key (uppercase, alphanumerics only) is exactly what
// public.normalize_part_number stores in parts.part_number_normalized, so a search
// key from here compares directly against the database.
//
// Rule 6, exactly as far as it goes and no further. A dashed number is padded only
// where ONE leading zero restores the shape:
//   TK       NN-NNN -> NN-0NNN      N-NNNN -> 0N-NNNN
//   Carrier  NN-NNNNN-N -> NN-NNNNN-0N      N-NNNNN-NN -> 0N-NNNNN-NN
// Never padded, only reported in shortSegment: a Carrier MIDDLE segment that is short
// (30-6143-01 could be 30-06143-01 or a different part with a digit missing anywhere),
// and any number short in two places at once (8-603). A bare run of digits is never
// padded - with no dashes there is no telling which segment lost the zero.
//
// Real numbers that fit no shape (306-221, 204-2436, 18-00091-105, 96-153-01K) keep
// their own dash positions and are matched as written.

export type PartNumberForm =
  | 'thermo_king'              // rule 1
  | 'carrier'                  // rule 2
  | 'thermo_king_37'           // rule 3, what was left is a TK number
  | 'carrier_37'               // rule 3, what was left is a Carrier number
  | 'other_37'                 // rule 3, what was left fits neither shape (stripped anyway)
  | 'carrier_for_thermo_king'  // rule 4
  | 'thermo_king_reman'        // rule 5 on a TK number
  | 'carrier_reman'            // rule 5 on a Carrier number
  | 'other'                    // none of the rules; matched exactly as typed
  | 'empty'

export interface ParsedPartNumber {
  /** What was typed, untouched. */
  input: string
  /** The number as it should be printed and stored. 37- stripped, dashes laid out. */
  canonical: string
  /** Uppercase alphanumerics of canonical - the same value as parts.part_number_normalized. */
  key: string
  form: PartNumberForm
  /** Which shape the number has, when it has one of the two. */
  maker: 'thermo_king' | 'carrier' | null
  /** True when a leading 37- was removed. */
  stripped37: boolean
  /** Rules 4 and 5 only: the OEM number this one relates to. NOT a match. */
  relatesTo: string | null
  /** Trailing letters (SV, K, KIT, ...), kept on the number. Their meaning is not one of the rules. */
  suffix: string | null
  /** True when rule 6 restored a lost leading zero. */
  padded: boolean
  /** Set when the number looks like a TK/Carrier number short a digit that rule 6 will NOT guess at. */
  shortSegment: string | null
}

/** Uppercase alphanumerics. Identical to public.normalize_part_number in SQL. */
export const partNumberKey = (value: string): string =>
  String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

type Shape = { canonical: string; maker: 'thermo_king' | 'carrier'; padded: boolean }

// Rule 6 for dashed digits: the shape after restoring ONE lost leading zero, or why not.
const zero = (g: string) => `0${g}`
function paddedShape(groups: string[]): Shape | null {
  const lens = groups.map(g => g.length).join(',')
  if (lens === '2,3') return { canonical: `${groups[0]}-${zero(groups[1])}`, maker: 'thermo_king', padded: true }
  if (lens === '1,4') return { canonical: `${zero(groups[0])}-${groups[1]}`, maker: 'thermo_king', padded: true }
  if (lens === '2,5,1') return { canonical: `${groups[0]}-${groups[1]}-${zero(groups[2])}`, maker: 'carrier', padded: true }
  if (lens === '1,5,2') return { canonical: `${zero(groups[0])}-${groups[1]}-${groups[2]}`, maker: 'carrier', padded: true }
  return null
}
function shortNote(groups: string[]): string | null {
  const lens = groups.map(g => g.length).join(',')
  if (groups.length === 3 && groups[0].length <= 2 && groups[2].length <= 2 && groups[1].length < 5)
    return `Carrier middle segment has ${groups[1].length} digits, not 5 - not padded`
  if (lens === '1,3') return 'TK number short in both segments - not padded'
  if (lens === '1,5,1') return 'Carrier number short in both end segments - not padded'
  return null
}

// Rule 1 or rule 2, from the digit groups. Bare digits are laid out by count; dashed
// digits must already sit in the rule's positions, or be one lost zero away (rule 6).
function oemShape(groups: string[]): Shape | null {
  const digits = groups.join('')
  if (groups.length === 1) {
    if (digits.length === 6) return { canonical: `${digits.slice(0, 2)}-${digits.slice(2)}`, maker: 'thermo_king', padded: false }
    if (digits.length === 9) return { canonical: `${digits.slice(0, 2)}-${digits.slice(2, 7)}-${digits.slice(7)}`, maker: 'carrier', padded: false }
    return null
  }
  const lens = groups.map(g => g.length).join(',')
  if (lens === '2,4') return { canonical: groups.join('-'), maker: 'thermo_king', padded: false }
  if (lens === '2,5,2') return { canonical: groups.join('-'), maker: 'carrier', padded: false }
  return paddedShape(groups)
}

/**
 * Read a part number the way the counter does.
 *
 * Whitespace, dots, underscores and slashes between digits count as dashes; case is
 * ignored. A number that fits no rule is returned as typed (uppercased, separators
 * made dashes) with form 'other', so it still searches on its own key.
 */
export function parsePartNumber(input: string): ParsedPartNumber {
  const raw = String(input ?? '')
  const cleaned = raw.toUpperCase().trim().replace(/[\s._/\\-]+/g, '-').replace(/^-+|-+$/g, '')
  const base = { input: raw, stripped37: false, relatesTo: null, suffix: null, maker: null, padded: false, shortSegment: null }
  if (!cleaned) return { ...base, canonical: '', key: '', form: 'empty' }

  // Digits in dash-separated groups, then optional trailing letters (with or without
  // a dash before them). Anything else is not a shape the rules speak to.
  const m = cleaned.match(/^([0-9]+(?:-[0-9]+)*)(?:-?([A-Z][A-Z0-9]*))?$/)
  if (!m) {
    // Rule 3 still applies to a 37- in front of something that is not digits:
    // 37-EGR-KIT is the vendor's EGR-KIT.
    if (/^37-./.test(cleaned)) {
      const rest = cleaned.slice(3)
      return { ...base, canonical: rest, key: partNumberKey(rest), form: 'other_37', stripped37: true }
    }
    return { ...base, canonical: cleaned, key: partNumberKey(cleaned), form: 'other' }
  }
  const groups = m[1].split('-')
  const suffix = m[2] ?? null
  // Keep the suffix the way it was attached: 37-41-5459-KIT, 50-00215-01SV.
  const withSuffix = (core: string) => suffix == null ? core : cleaned.endsWith(`-${suffix}`) ? `${core}-${suffix}` : `${core}${suffix}`
  const done = (canonical: string, form: PartNumberForm, extra: Partial<ParsedPartNumber> = {}): ParsedPartNumber =>
    ({ ...base, suffix, ...extra, canonical, key: partNumberKey(canonical), form })

  // Rules 1 and 2 on the whole number come first. A number that already IS a TK or a
  // Carrier number is never stripped or reinterpreted - 37-1234 is TK 37-1234.
  const whole = oemShape(groups)
  if (whole) return done(withSuffix(whole.canonical), whole.maker, { maker: whole.maker, padded: whole.padded })

  const digits = groups.join('')

  // Rule 3: 37- in front. Dashed: the first group is exactly 37. Bare: the digits
  // start 37 and what is left is a TK (6) or Carrier (9) number.
  const after37 = groups.length > 1 && groups[0] === '37' ? groups.slice(1)
    : groups.length === 1 && digits.startsWith('37') && [6, 9].includes(digits.length - 2) ? [digits.slice(2)]
    : null
  if (after37) {
    const rest = oemShape(after37)
    if (rest) return done(withSuffix(rest.canonical), rest.maker === 'thermo_king' ? 'thermo_king_37' : 'carrier_37', { maker: rest.maker, stripped37: true, padded: rest.padded })
    return done(withSuffix(after37.join('-')), 'other_37', { stripped37: true, shortSegment: shortNote(after37) })
  }

  // Rule 4: 20- in front of a TK number. Recognized, not rewritten.
  const after20 = groups.length > 1 && groups[0] === '20' ? groups.slice(1)
    : groups.length === 1 && digits.length === 8 && digits.startsWith('20') ? [digits.slice(2)]
    : null
  if (after20) {
    const tk = oemShape(after20)
    if (tk?.maker === 'thermo_king') {
      return done(withSuffix(`20-${tk.canonical}`), 'carrier_for_thermo_king', { relatesTo: tk.canonical, padded: tk.padded })
    }
  }

  // Rule 5: an 8 on the front of the first segment. 845-1234 / 8451234 for TK,
  // 830-60143-01 / 8306014301 for Carrier.
  const reman = groups.length > 1 && groups[0].length === 3 && groups[0].startsWith('8') ? [groups[0].slice(1), ...groups.slice(1)]
    : groups.length === 1 && digits.startsWith('8') && [7, 10].includes(digits.length) ? [digits.slice(1)]
    : null
  if (reman) {
    const oem = oemShape(reman)
    if (oem) {
      return done(withSuffix(`8${oem.canonical}`), oem.maker === 'thermo_king' ? 'thermo_king_reman' : 'carrier_reman', { maker: oem.maker, relatesTo: oem.canonical, padded: oem.padded })
    }
  }

  return done(withSuffix(groups.join('-')), 'other', { shortSegment: shortNote(groups) })
}

/**
 * Every key a typed number should find, best first: the canonical key, then the key of
 * exactly what was typed (so a number still stored the old way - 37-11-9959 in the
 * legacy table - is found too). relatesTo is deliberately NOT a key.
 */
export function partNumberSearchKeys(input: string): string[] {
  const p = parsePartNumber(input)
  return [...new Set([p.key, partNumberKey(input)].filter(Boolean))]
}

/** Does a stored number (or its stored key) contain any of the typed number's keys? */
export function partNumberMatches(stored: string | null | undefined, input: string): boolean {
  const s = partNumberKey(stored ?? '')
  if (!s) return false
  return partNumberSearchKeys(input).some(k => s.includes(k))
}
