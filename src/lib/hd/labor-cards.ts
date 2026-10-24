// Labor cards: the hand-authored side of the labor library (hd_repair_items, migration
// 166). Pure - no database - so the screen, the route and the verify script all read
// one set of rules.
//
// TWO HOUR PAIRS, never collapsed into one:
//   field  (mobile_hours .. mobile_hours_high)  a reefer in a parking lot, no lift
//   shop   (shop_hours   .. shop_hours_high)    the same job in a bay with a lift
// Either pair may be empty - a field-only job has no shop time - but a card needs at
// least one figure. A pair is a single value when only the low end is given (the high
// is stored NULL), or a range when the high is above it.
//
// 0 MEANS EMPTY. Rows saved before this screen store 0 where nothing was typed ("Replace
// engine mounts" has shop_hours 0). A 0 is shown as an empty field and a typed 0 is
// stored as NULL. Existing 0s are never rewritten unless that row is edited here.
//
// LABOR CODES (migration 167). Every row carries a permanent code, PREFIX-NNNN, the
// prefix from its equipment type (RF reefer, TC truck, ...). The database assigns it on
// insert and refuses any change to it, so nothing here ever writes labor_code. A code is
// never reused: a soft-deleted card keeps its code and the counter never goes back.
// oem_labor_code is the shop's own reference (free text, optional) - shown and searched
// on this screen only, never in the quote picker.

export const EQUIPMENT_TYPES = [
  { value: 'reefer',         label: 'Reefer' },
  { value: 'truck',          label: 'Truck' },
  { value: 'trailer',        label: 'Trailer' },
  { value: 'boom',           label: 'Boom' },
  { value: 'aerial',         label: 'Aerial / Bucket' },
  { value: 'digger_derrick', label: 'Digger Derrick' },
  { value: 'apu',            label: 'APU' },
  { value: 'genset',         label: 'Genset' },
  { value: 'other',          label: 'Other' },
] as const

export type EquipmentType = typeof EQUIPMENT_TYPES[number]['value']

const TYPE_VALUES: readonly string[] = EQUIPMENT_TYPES.map(t => t.value)

export function equipmentTypeLabel(v: string | null | undefined): string {
  return EQUIPMENT_TYPES.find(t => t.value === v)?.label ?? ''
}

/** Columns the screen reads and writes. */
export const LABOR_CARD_COLUMNS =
  'id, labor_code, oem_labor_code, description, mobile_hours, mobile_hours_high, shop_hours, shop_hours_high, ' +
  'detail, suggested_related, equipment_type, equipment_category_id, created_at, updated_at'

/** The prefix each equipment type's codes carry (hd_labor_code_prefix in 167). */
export const LABOR_CODE_PREFIX: Record<EquipmentType, string> = {
  reefer: 'RF', truck: 'TC', trailer: 'TR', boom: 'BM', aerial: 'AE',
  digger_derrick: 'DD', apu: 'AP', genset: 'GS', other: 'OT',
}

/** The format 167 enforces. GN is the prefix for rows that had no type at backfill. */
export const LABOR_CODE_FORMAT = /^(RF|TC|TR|BM|AE|DD|AP|GS|OT|GN)-[0-9]{4,}$/

export interface LaborCard {
  id: string
  labor_code: string
  oem_labor_code: string | null
  description: string
  mobile_hours: number | string | null
  mobile_hours_high: number | string | null
  shop_hours: number | string | null
  shop_hours_high: number | string | null
  detail: string | null
  suggested_related: string | null
  equipment_type: string | null
  equipment_category_id: string | null
  created_at: string
  updated_at: string
}

/** What the form holds: every field as typed. */
export interface LaborCardDraft {
  description: string
  mobile_low: string
  mobile_high: string
  shop_low: string
  shop_high: string
  detail: string
  suggested_related: string
  equipment_type: string
  equipment_category_id: string
  oem_labor_code: string
}

export const EMPTY_DRAFT: LaborCardDraft = {
  description: '', mobile_low: '', mobile_high: '', shop_low: '', shop_high: '',
  detail: '', suggested_related: '', equipment_type: '', equipment_category_id: '', oem_labor_code: '',
}

/** The row's columns a save writes. */
export interface LaborCardWrite {
  description: string
  mobile_hours: number | null
  mobile_hours_high: number | null
  shop_hours: number | null
  shop_hours_high: number | null
  detail: string | null
  suggested_related: string | null
  equipment_type: string
  equipment_category_id: string | null
  oem_labor_code: string | null
}

// DECIMAL(4,2): 99.99 is the largest figure the column holds.
const MAX_HOURS = 99.99
const MAX_TEXT  = 500
const MAX_OEM   = 60

/** A stored or typed figure as a positive number of hours, else null. 0 is empty. */
export function positiveHours(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

type PairResult = { ok: true; low: number | null; high: number | null } | { ok: false; error: string }

/**
 * One hour pair from what was typed. Blank low and blank high = empty pair. A high
 * equal to the low is a single value (high stored NULL). Rounded to 2 places, the
 * column's precision.
 */
export function parseHourPair(lowRaw: unknown, highRaw: unknown, label: string): PairResult {
  const read = (raw: unknown, end: string): { ok: true; n: number | null } | { ok: false; error: string } => {
    if (raw == null) return { ok: true, n: null }
    const s = String(raw).trim()
    if (s === '') return { ok: true, n: null }
    const n = Number(s)
    if (!Number.isFinite(n)) return { ok: false, error: `${label} ${end} must be a number of hours.` }
    if (n < 0) return { ok: false, error: `${label} ${end} cannot be negative.` }
    if (n > MAX_HOURS) return { ok: false, error: `${label} ${end} must be ${MAX_HOURS} hours or less.` }
    const r = Math.round(n * 100) / 100
    return { ok: true, n: r > 0 ? r : null }
  }
  const lo = read(lowRaw, 'hours')
  if (!lo.ok) return lo
  const hi = read(highRaw, 'high end')
  if (!hi.ok) return hi
  if (hi.n != null && lo.n == null) {
    return { ok: false, error: `${label}: enter the low end first, or put a single value in the first box.` }
  }
  if (lo.n != null && hi.n != null && hi.n < lo.n) {
    return { ok: false, error: `${label}: the high end (${hi.n}) is below the low end (${lo.n}).` }
  }
  return { ok: true, low: lo.n, high: lo.n != null && hi.n != null && hi.n > lo.n ? hi.n : null }
}

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, MAX_TEXT) : null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type CleanResult = { ok: true; row: LaborCardWrite } | { ok: false; error: string }

/**
 * A request body (or a draft) as the columns to write, or the one sentence that says
 * why not. Accepts either the draft's field names or the column names, so the route
 * can take what the screen sends and a script can send columns.
 */
export function cleanLaborCard(body: Record<string, unknown>): CleanResult {
  const description = text(body.description)
  if (!description) return { ok: false, error: 'Enter the operation name.' }

  const field = parseHourPair(body.mobile_low ?? body.mobile_hours, body.mobile_high ?? body.mobile_hours_high, 'Field time')
  if (!field.ok) return field
  const shop = parseHourPair(body.shop_low ?? body.shop_hours, body.shop_high ?? body.shop_hours_high, 'Shop time')
  if (!shop.ok) return shop
  if (field.low == null && shop.low == null) {
    return { ok: false, error: 'Enter field time, shop time, or both.' }
  }

  // Required: the type picks the code's prefix, and a code never changes once given.
  const typeRaw = typeof body.equipment_type === 'string' ? body.equipment_type.trim() : ''
  if (!typeRaw) return { ok: false, error: 'Pick the equipment type.' }
  if (!TYPE_VALUES.includes(typeRaw)) return { ok: false, error: `Unknown equipment type "${typeRaw}".` }

  const oemRaw = typeof body.oem_labor_code === 'string' ? body.oem_labor_code.trim() : ''
  if (oemRaw.length > MAX_OEM) return { ok: false, error: `OEM labor code must be ${MAX_OEM} characters or less.` }

  const catRaw = typeof body.equipment_category_id === 'string' ? body.equipment_category_id.trim() : ''
  if (catRaw && !UUID.test(catRaw)) return { ok: false, error: 'Unknown equipment category.' }

  return {
    ok: true,
    row: {
      description,
      mobile_hours:          field.low,
      mobile_hours_high:     field.high,
      shop_hours:            shop.low,
      shop_hours_high:       shop.high,
      detail:                text(body.detail),
      suggested_related:     text(body.suggested_related),
      equipment_type:        typeRaw,
      equipment_category_id: catRaw || null,
      oem_labor_code:        oemRaw || null,
    },
  }
}

const field = (v: unknown): string => {
  const n = positiveHours(v)
  return n == null ? '' : String(n)
}

/** A saved card back into the form. A stored 0 comes back as an empty field. */
export function draftFromCard(c: LaborCard): LaborCardDraft {
  const mLow = field(c.mobile_hours)
  const sLow = field(c.shop_hours)
  return {
    description:           c.description ?? '',
    mobile_low:            mLow,
    mobile_high:           mLow ? field(c.mobile_hours_high) : '',
    shop_low:              sLow,
    shop_high:             sLow ? field(c.shop_hours_high) : '',
    detail:                c.detail ?? '',
    suggested_related:     c.suggested_related ?? '',
    equipment_type:        c.equipment_type ?? '',
    equipment_category_id: c.equipment_category_id ?? '',
    oem_labor_code:        c.oem_labor_code ?? '',
  }
}

/** "1.5 hr", "1.5 to 2.5 hr", or '' for an empty pair (0 included). */
export function hoursText(low: unknown, high: unknown): string {
  const lo = positiveHours(low)
  if (lo == null) return ''
  const hi = positiveHours(high)
  return hi != null && hi > lo ? `${lo} to ${hi} hr` : `${lo} hr`
}

export type LaborCardSort = 'edited' | 'description'

export interface LaborCardFilter {
  search: string
  equipmentType: string
  categoryId: string
  sort: LaborCardSort
}

/** Search (description, detail, related, both codes), filter by type and category, then sort. */
export function filterLaborCards(cards: LaborCard[], f: LaborCardFilter): LaborCard[] {
  const q = f.search.trim().toLowerCase()
  const out = cards.filter(c => {
    if (f.equipmentType && (c.equipment_type ?? '') !== f.equipmentType) return false
    if (f.categoryId === 'none' && c.equipment_category_id) return false
    if (f.categoryId && f.categoryId !== 'none' && c.equipment_category_id !== f.categoryId) return false
    if (!q) return true
    return [c.description, c.detail, c.suggested_related, c.labor_code, c.oem_labor_code]
      .some(s => (s ?? '').toLowerCase().includes(q))
  })
  return out.sort(f.sort === 'description'
    ? (a, b) => a.description.localeCompare(b.description, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)
    : (a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id))
}

/** How two operation names compare: trimmed, case and inner spacing ignored. */
export function sameOperationName(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  return n(a) !== '' && n(a) === n(b)
}

/**
 * The shop's own card already named this, for the "You already have a card named this"
 * hint. Display only - nothing reads it to decide a write. The card being edited is
 * left out, so editing a card does not warn about itself.
 */
export function cardNamed<T extends { id: string; description: string }>(
  cards: readonly T[], name: string, exceptId?: string | null,
): T | null {
  return cards.find(c => c.id !== exceptId && sameOperationName(c.description, name)) ?? null
}

/** A write against a database without migration 166's columns. */
export function isMissing166Column(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  if (err.code !== '42703' && err.code !== 'PGRST204') return false
  return /mobile_hours_high|shop_hours_high|detail|suggested_related|equipment_type|equipment_category_id|scope|origin/
    .test(err.message ?? '')
}

export const MIGRATION_166_MESSAGE =
  'Labor cards need migration 166 (supabase/migrations/166_labor_cards.sql). Apply it in the Supabase SQL editor, then save again.'

/** A write against a database without migration 167's columns. */
export function isMissing167Column(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false
  if (err.code !== '42703' && err.code !== 'PGRST204') return false
  return /labor_code/.test(err.message ?? '')
}

export const MIGRATION_167_MESSAGE =
  'Labor codes need migration 167 (supabase/migrations/167_labor_codes.sql). Apply it in the Supabase SQL editor, then save again.'
