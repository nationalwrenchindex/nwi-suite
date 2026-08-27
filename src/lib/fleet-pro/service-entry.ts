// Technician service entry — shared shapes and the ONE sanitizer both API routes use.
//
// Why one file: /api/inspect/extract-invoice cleans what a language model produced and
// /api/inspect/service-entry cleans what a phone posted, and those two must agree on
// every cap and every clamp. If they drift, the confirmation screen shows one thing and
// the database stores another — on a cost record that a fleet later argues a bill from.
//
// Nothing here may import server-only modules: the browser component imports these types
// and the money/date helpers to render the confirmation form.

export interface ServiceEntryPart {
  name: string
  qty:  number | null
  cost: number | null
}

/** Exactly the field set the extraction prompt asks Claude for. Every scalar is
 *  nullable on purpose — "not legible" is a first-class answer, not a failure. */
export interface ExtractedServiceEntry {
  service_date:      string | null   // YYYY-MM-DD
  labor_description: string | null
  parts:             ServiceEntryPart[]
  labor_cost:        number | null
  parts_cost:        number | null
  tax:               number | null
  total:             number | null
  vendor_name:       string | null
  invoice_number:    string | null
}

/** What the device POSTs to /api/inspect/service-entry. unit_id identifies the unit;
 *  fleet_account_id is NEVER sent — the server derives it from the unit row. */
export interface ServiceEntrySubmission extends ExtractedServiceEntry {
  client_uuid:      string
  unit_id:          string
  technician_name:  string | null
  /** What the model returned before the tech corrected it. Kept for audit: it is the
   *  only way to ever answer "did the machine read this, or did a person type it?" */
  extracted_raw:    ExtractedServiceEntry | null
}

// ── abuse / sanity caps ───────────────────────────────────────────────────────
// Both routes are unauthenticated (a QR sticker on a truck is the capability), so
// every one of these is a hard ceiling and not a suggestion.

/** 5MB. A phone photo of an 8.5x11 invoice is 1-3MB; 5MB is generous. This is the
 *  single most important cap in the feature — see the comment in extract-invoice. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** JPEG and PNG only. HEIC, PDF, TIFF and friends are rejected: the browser converts
 *  HEIC on upload, and anything else is either unsupported by the vision API or is
 *  someone probing what this endpoint will forward. */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number]

export const MAX_JSON_BODY_CHARS   = 60_000
export const MAX_TECH_NAME_CHARS   = 120
export const MAX_VENDOR_CHARS      = 160
export const MAX_INVOICE_NO_CHARS  = 64
export const MAX_DESCRIPTION_CHARS = 4_000
export const MAX_PART_NAME_CHARS   = 200
export const MAX_PARTS             = 60

/** hd/fleet money columns are NUMERIC(10,2) — 99,999,999.99 is the column ceiling.
 *  A single truck repair invoice past a million dollars is a typo or an attack, so
 *  clamp well below the column rather than letting the insert fail on overflow. */
export const MAX_MONEY = 1_000_000
export const MAX_QTY   = 10_000

/** A tech legitimately enters a stack of old paper invoices, so five years back is
 *  normal here (unlike a pre-trip, which is same-day). The future is always wrong;
 *  one day of slack covers a phone in another timezone. */
export const MAX_BACKDATE_DAYS = 1_825
export const MAX_FUTURE_DAYS   = 1

export const EMPTY_EXTRACTION: ExtractedServiceEntry = {
  service_date:      null,
  labor_description: null,
  parts:             [],
  labor_cost:        null,
  parts_cost:        null,
  tax:               null,
  total:             null,
  vendor_name:       null,
  invoice_number:    null,
}

// ── primitives ────────────────────────────────────────────────────────────────

/** Trimmed, capped, and '' collapsed to null so a blank box never stores an empty
 *  string that later renders as a real-but-empty value. */
export function cleanText(value: unknown, max: number): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, max)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/**
 * Money as a non-negative number with two decimals, or null.
 *
 * Accepts the string forms a form control and an OCR pass actually produce —
 * '$1,234.50', '1234.50', ' 1234 ' — because rejecting those would silently drop a
 * figure the tech typed. A negative, NaN or Infinity becomes null rather than a
 * credit that nobody entered.
 */
export function money(value: unknown, max = MAX_MONEY): number | null {
  if (value === null || value === undefined || value === '') return null
  const raw = typeof value === 'string' ? value.replace(/[$,\s]/g, '') : value
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(Math.min(n, max) * 100) / 100
}

/** Quantity: non-negative, capped, two decimals (a tech bills 0.5 of a gallon). */
export function quantity(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const raw = typeof value === 'string' ? value.replace(/[,\s]/g, '') : value
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(Math.min(n, MAX_QTY) * 100) / 100
}

function dayOffset(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * YYYY-MM-DD inside the allowed window, else null.
 *
 * Returns NULL rather than today's date, deliberately: an unreadable date on an
 * invoice must show up as an empty box the tech has to fill, not as a silent
 * "today" that files a two-year-old repair against this week's spend.
 */
export function serviceDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  if (Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())) return null
  if (value < dayOffset(-MAX_BACKDATE_DAYS)) return null
  if (value > dayOffset(MAX_FUTURE_DAYS)) return null
  return value
}

// ── the sanitizer ─────────────────────────────────────────────────────────────

function normalizeParts(value: unknown): ServiceEntryPart[] {
  if (!Array.isArray(value)) return []
  const out: ServiceEntryPart[] = []
  for (const entry of value.slice(0, MAX_PARTS)) {
    if (!entry || typeof entry !== 'object') continue
    const row  = entry as Record<string, unknown>
    const name = cleanText(row.name, MAX_PART_NAME_CHARS)
    const qty  = quantity(row.qty)
    const cost = money(row.cost)
    // A line with no name is not a part — it is OCR noise or an empty form row.
    if (!name) continue
    out.push({ name, qty, cost })
  }
  return out
}

/**
 * The single choke point. Anything that reaches the database or the confirmation
 * screen passes through here first, whether it came from Claude or from a phone.
 */
export function normalizeExtraction(value: unknown): ExtractedServiceEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...EMPTY_EXTRACTION }
  const row = value as Record<string, unknown>
  return {
    service_date:      serviceDate(row.service_date),
    labor_description: cleanText(row.labor_description, MAX_DESCRIPTION_CHARS),
    parts:             normalizeParts(row.parts),
    labor_cost:        money(row.labor_cost),
    parts_cost:        money(row.parts_cost),
    tax:               money(row.tax),
    total:             money(row.total),
    vendor_name:       cleanText(row.vendor_name, MAX_VENDOR_CHARS),
    invoice_number:    cleanText(row.invoice_number, MAX_INVOICE_NO_CHARS),
  }
}

// ── UI support ────────────────────────────────────────────────────────────────

export type ServiceEntryFieldKey =
  | 'service_date' | 'vendor_name' | 'invoice_number' | 'labor_description'
  | 'labor_cost' | 'parts_cost' | 'tax' | 'total'

export const SERVICE_ENTRY_FIELD_LABELS: Record<ServiceEntryFieldKey, string> = {
  service_date:      'Service date',
  vendor_name:       'Vendor / shop',
  invoice_number:    'Invoice #',
  labor_description: 'Work performed',
  labor_cost:        'Labor',
  parts_cost:        'Parts',
  tax:               'Tax',
  total:             'Total',
}

/** Which fields the model could not read. The confirmation screen marks these so the
 *  tech's eye goes straight to the boxes that need him, instead of trusting the whole
 *  form because most of it looks filled in. */
export function unreadFields(extracted: ExtractedServiceEntry): ServiceEntryFieldKey[] {
  const keys: ServiceEntryFieldKey[] = [
    'service_date', 'vendor_name', 'invoice_number', 'labor_description',
    'labor_cost', 'parts_cost', 'tax', 'total',
  ]
  return keys.filter(k => extracted[k] === null)
}

/** null -> '' for a controlled input; a number keeps two decimals so the box does not
 *  show 1234.5 for $1,234.50. */
export function moneyToInput(value: number | null): string {
  return value === null ? '' : value.toFixed(2)
}

export function numberToInput(value: number | null): string {
  return value === null ? '' : String(value)
}

/**
 * Pull the first complete JSON object out of arbitrary model output.
 *
 * A model asked for "JSON only" still sometimes wraps it in a ```json fence or leads
 * with a sentence, and that must not be treated as an extraction failure. Brace
 * counting rather than a regex, and string-aware, so a `{` inside a part name like
 * "BRACKET {LH}" does not end the object early.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null

  let depth    = 0
  let inString = false
  let escaped  = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}
