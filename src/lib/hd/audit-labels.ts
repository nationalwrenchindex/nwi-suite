// The words printed on the audit exports, so matching an insurer's form is a settings
// change and not a rebuild.
//
// Spec: docs/KURT-EQUIPMENT-TRACKING-SPEC.md section 5.2 - "equipment class" should
// become whatever the shop's policy calls it, and the category names should match the
// insurer's wording rather than ours.
//
// PURE. No Supabase, no React. Stored per shop in profiles.hd_report_labels (JSONB,
// migration 162). Until 162 is applied, or when the column is null, every label is its
// default - the exports never depend on the column existing.
//
// SHAPE OF THE STORED VALUE
//
//   { "text": { "classColumn": "Vehicle type", ... },
//     "categories": { "<category id>": "Aerial lift", "__uncategorized__": "Other" } }
//
// Category overrides are keyed by category ID, not name, so renaming a category in the
// shop's own list does not silently orphan the insurer wording attached to it. The two
// synthetic rows the rollup produces ("Uncategorized", "No unit recorded") use the
// rollup's own keys.

import { UNCATEGORIZED, NO_UNIT } from './equipment-rollup'

export const AUDIT_TEXT_DEFAULTS = {
  scheduleTitle:  'Equipment Schedule',
  packetTitle:    'Audit Packet - Work Order Documentation',
  appendixTitle:  'Appendix - Units Serviced in the Period',
  policyPeriod:   'Policy period',
  classColumn:    'Equipment class',
  unitsInClass:   'Units in class',
  unitsServiced:  'Units serviced',
  jobs:           'Jobs',
  laborHours:     'Labor hours',
  totalInvoiced:  'Total invoiced',
  unitIdentifier: 'Unit',
  make:           'Make',
  model:          'Model',
  year:           'Year',
  serial:         'Serial / VIN',
} as const

export type AuditTextKey = keyof typeof AUDIT_TEXT_DEFAULTS
export const AUDIT_TEXT_KEYS = Object.keys(AUDIT_TEXT_DEFAULTS) as AuditTextKey[]

/** What each key is, for the settings form. */
export const AUDIT_TEXT_DESCRIPTIONS: Record<AuditTextKey, string> = {
  scheduleTitle:  'Title of the equipment schedule export',
  packetTitle:    'Title of the audit packet export',
  appendixTitle:  'Heading of the per-unit appendix',
  policyPeriod:   'Label for the date range',
  classColumn:    'Equipment class column',
  unitsInClass:   'Units in class column',
  unitsServiced:  'Units serviced column',
  jobs:           'Jobs column',
  laborHours:     'Labor hours column',
  totalInvoiced:  'Total invoiced column',
  unitIdentifier: 'Unit identifier column',
  make:           'Make column',
  model:          'Model column',
  year:           'Year column',
  serial:         'Serial / VIN column',
}

/** Titles get more room than column headers. */
export const TITLE_KEYS: ReadonlySet<AuditTextKey> = new Set(['scheduleTitle', 'packetTitle', 'appendixTitle'])
export const MAX_TITLE_LEN = 120
export const MAX_COLUMN_LEN = 60
export const MAX_CATEGORY_LEN = 80
export const MAX_CATEGORY_OVERRIDES = 200

export const SYNTHETIC_CATEGORY_KEYS = [UNCATEGORIZED, NO_UNIT] as const
export const SYNTHETIC_CATEGORY_NAMES: Record<string, string> = {
  [UNCATEGORIZED]: 'Uncategorized',
  [NO_UNIT]: 'No unit recorded',
}

export interface StoredAuditLabels {
  text?: Partial<Record<AuditTextKey, string>>
  categories?: Record<string, string>
}

export interface AuditLabels {
  text: Record<AuditTextKey, string>
  /** Only the overrides; use categoryLabel() to resolve a name. */
  categories: Record<string, string>
}

export const DEFAULT_AUDIT_LABELS: AuditLabels = { text: { ...AUDIT_TEXT_DEFAULTS }, categories: {} }

const clean = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  // Control characters out, whitespace collapsed. A label is one line on a PDF.
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length ? s : null
}

/**
 * The labels to print, from whatever the column holds. Never throws: a null column, a
 * missing column, junk JSON or an unknown key all fall back to the defaults, key by key.
 */
export function resolveAuditLabels(stored: unknown): AuditLabels {
  const out: AuditLabels = { text: { ...AUDIT_TEXT_DEFAULTS }, categories: {} }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out
  const s = stored as Record<string, unknown>

  const text = s.text
  if (text && typeof text === 'object' && !Array.isArray(text)) {
    for (const key of AUDIT_TEXT_KEYS) {
      const v = clean((text as Record<string, unknown>)[key])
      const cap = TITLE_KEYS.has(key) ? MAX_TITLE_LEN : MAX_COLUMN_LEN
      if (v) out.text[key] = v.slice(0, cap)
    }
  }
  const cats = s.categories
  if (cats && typeof cats === 'object' && !Array.isArray(cats)) {
    for (const [k, raw] of Object.entries(cats as Record<string, unknown>)) {
      const v = clean(raw)
      if (v && isCategoryKey(k)) out.categories[k] = v.slice(0, MAX_CATEGORY_LEN)
    }
  }
  return out
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isCategoryKey(k: string): boolean {
  return UUID_RE.test(k) || (SYNTHETIC_CATEGORY_KEYS as readonly string[]).includes(k)
}

/** The name a report prints for a category: the shop's override, else its own name. */
export function categoryLabel(labels: AuditLabels, key: string, ownName: string): string {
  return labels.categories[key] ?? ownName
}

export type LabelValidation =
  | { ok: true; value: StoredAuditLabels }
  | { ok: false; errors: string[] }

/**
 * Validate a PATCH body before it is stored. STRICT, unlike resolveAuditLabels: an
 * unknown key or an over-long value is refused with a reason, not silently dropped, so
 * a shop that typed into the wrong box is told.
 *
 * Empty strings mean "back to the default" and are omitted from what is stored. When
 * knownCategoryIds is given, a category override must name one of the shop's own
 * categories (or one of the two synthetic rows).
 */
export function validateAuditLabels(body: unknown, knownCategoryIds?: ReadonlySet<string>): LabelValidation {
  const errors: string[] = []
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: ['Body must be a JSON object.'] }
  const b = body as Record<string, unknown>
  for (const k of Object.keys(b)) if (k !== 'text' && k !== 'categories') errors.push(`Unknown field "${k}".`)

  const value: StoredAuditLabels = {}

  if (b.text !== undefined && b.text !== null) {
    if (typeof b.text !== 'object' || Array.isArray(b.text)) errors.push('"text" must be an object.')
    else {
      const text: Partial<Record<AuditTextKey, string>> = {}
      for (const [k, raw] of Object.entries(b.text as Record<string, unknown>)) {
        if (!(AUDIT_TEXT_KEYS as string[]).includes(k)) { errors.push(`Unknown label "${k}".`); continue }
        if (raw === null || raw === '') continue
        if (typeof raw !== 'string') { errors.push(`Label "${k}" must be text.`); continue }
        const key = k as AuditTextKey
        const cap = TITLE_KEYS.has(key) ? MAX_TITLE_LEN : MAX_COLUMN_LEN
        const v = clean(raw)
        if (!v) continue
        if (v.length > cap) { errors.push(`Label "${k}" is longer than ${cap} characters.`); continue }
        if (v !== AUDIT_TEXT_DEFAULTS[key]) text[key] = v
      }
      if (Object.keys(text).length) value.text = text
    }
  }

  if (b.categories !== undefined && b.categories !== null) {
    if (typeof b.categories !== 'object' || Array.isArray(b.categories)) errors.push('"categories" must be an object.')
    else {
      const cats: Record<string, string> = {}
      const entries = Object.entries(b.categories as Record<string, unknown>)
      if (entries.length > MAX_CATEGORY_OVERRIDES) errors.push(`At most ${MAX_CATEGORY_OVERRIDES} category names.`)
      for (const [k, raw] of entries.slice(0, MAX_CATEGORY_OVERRIDES)) {
        if (!isCategoryKey(k)) { errors.push(`Unknown category "${k}".`); continue }
        const synthetic = (SYNTHETIC_CATEGORY_KEYS as readonly string[]).includes(k)
        if (!synthetic && knownCategoryIds && !knownCategoryIds.has(k)) { errors.push(`Category "${k}" is not one of this shop's categories.`); continue }
        if (raw === null || raw === '') continue
        if (typeof raw !== 'string') { errors.push(`Category name for "${k}" must be text.`); continue }
        const v = clean(raw)
        if (!v) continue
        if (v.length > MAX_CATEGORY_LEN) { errors.push(`Category name for "${k}" is longer than ${MAX_CATEGORY_LEN} characters.`); continue }
        cats[k] = v
      }
      if (Object.keys(cats).length) value.categories = cats
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, value }
}

/** True when a read or write failed only because profiles.hd_report_labels is absent (migration 162). */
export function isMissingLabelsColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown }
  const text = [e.message, e.details, e.hint].map(v => String(v ?? '')).join(' ').toLowerCase()
  const code = String(e.code ?? '')
  const looksMissing = code === 'PGRST204' || code === '42703' ||
    text.includes('schema cache') || text.includes('could not find') || text.includes('does not exist')
  return looksMissing && text.includes('hd_report_labels')
}
