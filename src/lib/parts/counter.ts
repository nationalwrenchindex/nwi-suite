// The parts counter's rules, as pure functions.
//
// Pure for the same reason src/lib/parts/search.ts is: the counter's answers - which
// tier a claim is, what a technician is told about it, which supersession is followed
// and which is only reported - are testable without a database, a session or a screen.
// The counter route and its tests call these; nothing else decides them.
//
// CONFIDENCE BEFORE AND AFTER MIGRATION 175
//
// 175 adds a `confidence` tier to parts, part_fitment, part_supersession and
// part_cross_reference. Until it is applied, and on every row loaded before it, the
// only trust signal is 148's boolean `verified`. The counter never invents a tier from
// that boolean - mapping verified onto confirmed or oem_matrix is a decision Brock has
// not made. It shows `verified` as what it is: "verified" or "unverified".

export const CONFIDENCE_TIERS = [
  'confirmed', 'oem_matrix', 'field_observed', 'dealer', 'derived', 'unconfirmed', 'conflict',
] as const

export type ConfidenceTier = typeof CONFIDENCE_TIERS[number]

export const isConfidenceTier = (v: unknown): v is ConfidenceTier =>
  typeof v === 'string' && (CONFIDENCE_TIERS as readonly string[]).includes(v)

/**
 * How a claim is shown at the counter. Four screens, not seven: the spec's section 4.
 *
 *   plain       confirmed / oem_matrix, or a pre-175 row marked verified
 *   observed    field_observed - shown plainly with how often it was fitted
 *   one_source  dealer / derived / unconfirmed, or a pre-175 row not marked verified
 *   conflict    sources disagree
 */
export type Display = 'plain' | 'observed' | 'one_source' | 'conflict'

export interface Trust {
  tier: ConfidenceTier | null
  verified: boolean
}

export function displayOf(t: Trust): Display {
  switch (t.tier) {
    case 'confirmed': case 'oem_matrix':                 return 'plain'
    case 'field_observed':                                return 'observed'
    case 'dealer': case 'derived': case 'unconfirmed':   return 'one_source'
    case 'conflict':                                      return 'conflict'
    default:                                              return t.verified ? 'plain' : 'one_source'
  }
}

/** The badge text. A pre-175 row says "verified" / "unverified", never a tier it was not given. */
export function badgeOf(t: Trust): string {
  if (t.tier) return t.tier.replace('_', ' ')
  return t.verified ? 'verified' : 'unverified'
}

/** What the technician is told under the part number. */
export function adviceOf(d: Display): string | null {
  switch (d) {
    case 'one_source': return 'One source - verify by serial before ordering.'
    case 'conflict':   return 'Sources disagree - check the filter head or the OEM parts lookup by serial before ordering.'
    default:           return null
  }
}

/**
 * Sort key, lower is more trusted. A pre-175 verified row ranks with confirmed; an
 * unverified one with unconfirmed. Conflict ranks last so a settled answer is never
 * pushed below a disputed one.
 */
export function trustRank(t: Trust): number {
  if (t.tier) return CONFIDENCE_TIERS.indexOf(t.tier)
  return t.verified ? 0 : CONFIDENCE_TIERS.indexOf('unconfirmed')
}

/** The most trusted of several claims (a part matched by more than one fitment row). */
export function bestTrust(ts: Trust[]): Trust | null {
  if (!ts.length) return null
  return [...ts].sort((a, b) => trustRank(a) - trustRank(b))[0]
}

// ── supersession ────────────────────────────────────────────────────────────

export interface SupersessionLink {
  old_number: string
  new_number: string
  old_number_normalized: string
  new_number_normalized: string
  manufacturer: string
  note: string | null
  verified: boolean
  confidence: ConfidenceTier | null
}

/**
 * Is this link strong enough to SUBSTITUTE the new number for the old one?
 *
 * Only confirmed and oem_matrix links are followed. Anything weaker is shown as
 * "reported replaced by" and the number the tech typed stays the answer - otherwise an
 * unconfirmed 2026 renumbering would push a number with no fitment above one with
 * forty confirmed rows. Before 175, `verified` stands in.
 */
export function followable(link: Pick<SupersessionLink, 'confidence' | 'verified'>): boolean {
  if (link.confidence) return link.confidence === 'confirmed' || link.confidence === 'oem_matrix'
  return link.verified
}

export interface ChainResult {
  /** The number to show first. The starting number when nothing followable replaces it. */
  current: string
  currentNormalized: string
  /** Older numbers, newest first, that a followed link replaced. */
  was: string[]
  /** A weaker link out of `current`, reported but not followed. */
  reported: { to: string; note: string | null; trust: Trust } | null
}

/**
 * Follow the followable links forward from a number, stopping at a cycle or after
 * eight hops - a real chain is two or three long, and a loop in the data must not hang
 * the counter.
 */
export function followChain(startNumber: string, startNormalized: string, links: SupersessionLink[]): ChainResult {
  const byOld = new Map<string, SupersessionLink[]>()
  for (const l of links) byOld.set(l.old_number_normalized, [...(byOld.get(l.old_number_normalized) ?? []), l])

  let current = startNumber
  let currentNormalized = startNormalized
  const was: string[] = []
  const seen = new Set([startNormalized])

  for (let hop = 0; hop < 8; hop++) {
    const out = byOld.get(currentNormalized) ?? []
    const next = out.find(followable)
    if (!next || seen.has(next.new_number_normalized)) break
    was.unshift(current)
    seen.add(next.new_number_normalized)
    current = next.new_number
    currentNormalized = next.new_number_normalized
  }

  const weak = (byOld.get(currentNormalized) ?? []).find(l => !followable(l))
  return {
    current, currentNormalized, was,
    reported: weak
      ? { to: weak.new_number, note: weak.note, trust: { tier: weak.confidence, verified: weak.verified } }
      : null,
  }
}

// ── part types: category and synonyms ──────────────────────────────────────

// The spec's reefer categories (section 5), used as GROUP HEADERS in a flat list -
// never a navigation step until the list outgrows one screen.
export const CATEGORY_ORDER = [
  'Engine', 'Fuel', 'Maintenance & Wear', 'Belts & Drives', 'Refrigeration',
  'Electrical & Controls', 'Air Flow & Structure', 'Electric Standby', 'Other',
] as const

const CATEGORY_RULES: Array<[RegExp, typeof CATEGORY_ORDER[number]]> = [
  [/fuel|water separator|strainer/i,                   'Fuel'],
  [/filter|fluid|gasket|pm kit|oil/i,                   'Maintenance & Wear'],
  [/starter|alternator|engine|head|block|thermostat|water pump/i, 'Engine'],
  [/belt|idler|clutch|coupling|pulley/i,                'Belts & Drives'],
  [/compressor|condenser|evaporator|valve|drier|refriger/i, 'Refrigeration'],
  [/sensor|harness|relay|battery|controller|microprocessor|switch/i, 'Electrical & Controls'],
  [/door|bulkhead|fan|chute|seal|cab air/i,             'Air Flow & Structure'],
  [/motor|contactor|overload|cordset|standby/i,         'Electric Standby'],
]

export function categoryOf(partType: string): typeof CATEGORY_ORDER[number] {
  if (/cab air/i.test(partType)) return 'Air Flow & Structure'
  for (const [re, cat] of CATEGORY_RULES) if (re.test(partType)) return cat
  return 'Other'
}

/** Part types grouped under their category headers, in the spec's order. */
export function groupTypes(types: string[]): Array<{ category: string; types: string[] }> {
  const groups = new Map<string, string[]>()
  for (const t of [...new Set(types)].sort()) {
    const c = categoryOf(t)
    groups.set(c, [...(groups.get(c) ?? []), t])
  }
  return CATEGORY_ORDER.filter(c => groups.has(c)).map(c => ({ category: c, types: groups.get(c)! }))
}

// Techs do not type catalog names. Each entry: words a tech uses -> a test on part_type.
const SYNONYMS: Array<[RegExp, RegExp]> = [
  [/^(starter|starter motor|cranking motor)$/i,                        /starter/i],
  [/^(alternator|generator|charging)$/i,                               /alternator|generator/i],
  [/^(oil filter|engine oil filter|lube filter|lube)$/i,               /filter - oil/i],
  [/^(fuel filter|fuel|diesel filter)$/i,                              /filter - fuel(?!\/)|fuel strainer/i],
  [/^(water separator|fuel water sep|sep|water sep)$/i,                /water separator|fuel\/water/i],
  [/^(air filter|air cleaner|air element)$/i,                          /filter - air/i],
  [/^(cab filter|evap filter|evaporator filter)$/i,                    /cab air/i],
  [/^(belt|drive belt|fan belt)$/i,                                    /belt/i],
]

/**
 * Does typed text name this part type? Synonyms first ("lube filter" finds
 * "Filter - oil (engine)"), then a plain substring. Returns false for text with a
 * digit - that is a part number, matched elsewhere.
 */
export function typeSynonymMatches(partType: string, typed: string | null | undefined): boolean {
  const q = typed?.trim()
  if (!q || /[0-9]/.test(q)) return false
  for (const [words, type] of SYNONYMS) if (words.test(q)) return type.test(partType)
  return partType.toLowerCase().includes(q.toLowerCase())
}

// ── scope: one code path, two surfaces ──────────────────────────────────────

export type CounterScope = 'all' | 'reefer'

/**
 * Is this part sold on this surface? A DATA filter, not a second code path: the Reefer
 * surface shows parts whose equipment_type is reefer. A NULL equipment_type - every row
 * loaded before migration 175 - counts as reefer, because every one of them came from
 * reefer sources.
 */
export function inScope(equipmentType: string | null | undefined, scope: CounterScope): boolean {
  if (scope === 'all') return true
  return equipmentType == null || equipmentType === 'reefer'
}

// ── BM ranges (migration 175) ───────────────────────────────────────────────

const bmDigits = (s: string) => s.replace(/[^0-9]/g, '')

/**
 * Does a BM number fall in a fitment row's BM range? Inclusive at both ends. Compared as
 * numbers when both sides are all digits, never as strings - "99" is not after "100".
 * Null when either side cannot be read as a number, so the caller says so.
 */
export function bmInRange(bm: string, from: string, to: string | null): boolean | null {
  const b = bmDigits(bm), f = bmDigits(from), t = to ? bmDigits(to) : f
  if (!b || !f || !t) return null
  const n = Number(b)
  return n >= Number(f) && n <= Number(t)
}
