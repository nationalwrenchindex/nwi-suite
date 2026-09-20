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

// ─────────────────────────────────────────────────────────────────────────────
// FLEET-MANAGER SCAN (authenticated)
//
// Everything above is shared by the two unauthenticated /api/inspect routes. What
// follows is additive, for the manager-side capture on /fleet-pro/units/[id]:
// /api/fleet-pro/service-entries/extract and .../service-entries.
//
// Same document, same sanitizer, two differences that justify the extra surface:
//
//   * the manager is logged in and membership-checked, so his photo CAN be kept —
//     the QR flow deliberately drops it, because an open endpoint plus object
//     storage is a free bucket for anyone holding a unit id;
//   * he is filing an invoice against a truck he picked from a list, so the unit
//     number and VIN printed on the page are worth reading: they are what catches
//     an invoice about to be filed against the wrong truck.
// ─────────────────────────────────────────────────────────────────────────────

/** fleet_pro_service_entries.source. Distinguishes the two capture paths in
 *  reporting. Nothing branches on it, and cost.ts deliberately does not filter on
 *  it, so both kinds of record roll into cost per mile identically. */
export const SERVICE_ENTRY_SOURCE_QR           = 'qr_tech_entry'
export const SERVICE_ENTRY_SOURCE_MANAGER_SCAN = 'fleet_manager_scan'

export const MAX_UNIT_NUMBER_CHARS = 64

/**
 * A VIN is 17 characters and never contains I, O or Q — they were left out of the
 * standard precisely because they are unreadable next to 1 and 0. That exclusion is
 * what makes this worth checking rather than accepting any 17-character run: it
 * rejects most OCR noise for free, and a misread VIN is worse than no VIN, because
 * it would silently preselect the wrong truck.
 */
export const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/

/** What the invoice says the truck IS, as opposed to what it cost. Deliberately NOT
 *  folded into ExtractedServiceEntry: neither field is ever written to a column —
 *  they only preselect a unit on the confirmation screen — and widening the shared
 *  interface would push two new nulls into the QR flow's extracted_raw audit copy. */
export interface ExtractedInvoiceIdentity {
  unit_number: string | null
  vin:         string | null
}

export const EMPTY_IDENTITY: ExtractedInvoiceIdentity = {
  unit_number: null,
  vin:         null,
}

/** Uppercased and stripped of the separators a shop writes into a VIN by hand.
 *  Anything that is not exactly a valid VIN afterwards becomes null: a partial VIN
 *  cannot match a truck, and must not look like it tried. */
export function normalizeVin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return VIN_RE.test(cleaned) ? cleaned : null
}

export function normalizeIdentity(value: unknown): ExtractedInvoiceIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...EMPTY_IDENTITY }
  const row = value as Record<string, unknown>
  return {
    unit_number: cleanText(row.unit_number, MAX_UNIT_NUMBER_CHARS),
    vin:         normalizeVin(row.vin),
  }
}

/**
 * The transcription prompt, verbatim from /api/inspect/extract-invoice.
 *
 * DUPLICATED, and that is a compromise rather than a preference. The route holds the
 * original as a module-private const, so there is nothing to import; this copy exists
 * because the manager path needs the identical rules and the alternative was writing
 * a second, weaker prompt. The two must be changed together until somebody points the
 * route at this constant and deletes its own copy — which is a one-line change, and
 * the reason the text is reproduced here exactly rather than paraphrased.
 */
export const INVOICE_EXTRACTION_SYSTEM = `You are a transcription system for heavy-truck repair invoices. You output JSON and nothing else.

You are looking at a photograph taken by a technician standing in a shop or a yard. It may be crooked, glared, creased, shadowed, folded, partly out of frame, or out of focus.

THE RULE: report only what you can actually READ on the document. If a value is not printed on the page, or is printed but not legible, return null for that field. Do not infer it. Do not estimate it. Do not calculate it from the other numbers. Do not fill it in from what repair invoices usually contain.

Null is a correct answer and it is expected. Every field you return is shown to the technician on a confirmation screen before anything is saved, and he types in whatever you left blank — that costs him a few seconds. A confident wrong number costs far more, because it does not look wrong: it is saved as this truck's cost history, it feeds the fleet's spend reports, and it is used to argue about a repair bill months later. Blank beats plausible, every time.

Specifically:
- NEVER add up line items to produce a subtotal, tax or total that is not printed. If the total is not printed, total is null.
- NEVER complete a partially legible value. If two characters of an invoice number are unreadable, invoice_number is null, not a guess.
- NEVER assume the year on a date. If the printed date has no year, service_date is null.
- If the invoice shows one lump sum with no breakdown, put it in total and leave labor_cost, parts_cost and tax null.
- Transcribe text as written on the page in the shop's own words. Do not summarize, translate, tidy up, or expand abbreviations.

Fields:
- service_date: the date the work was performed or invoiced, as "YYYY-MM-DD".
- labor_description: the work performed, transcribed from the page.
- parts: an array of the parts actually itemized as line items, each { "name": string, "qty": number|null, "cost": number|null } where cost is the extended line cost as printed. Use [] if no parts are itemized.
- labor_cost, parts_cost, tax, total: numbers, only where printed with that meaning.
- vendor_name: the shop or vendor that ISSUED the invoice. Not the customer, not the fleet, not the truck owner.
- invoice_number: the invoice or work-order number as printed.

Numbers must be plain JSON numbers: no currency symbols, no thousands separators, no quotes.

Return the JSON object alone. No markdown fence, no explanation, no commentary before or after.`

/**
 * Two extra fields for the manager path, appended to INVOICE_EXTRACTION_SYSTEM.
 *
 * An addendum rather than a second prompt on purpose: the hallucination guard in the
 * original — null beats plausible, never do arithmetic, never complete a partial
 * read — is the reason a figure on a cost report can be trusted, and a rewritten
 * prompt would quietly undo it. The route composes the two.
 *
 * The same rule is restated for the VIN specifically, because a VIN is the field a
 * model is most tempted to repair: it knows what a valid one looks like, and
 * seventeen characters that "look right" would preselect a truck nobody chose.
 */
export const INVOICE_IDENTITY_ADDENDUM = `

Two additional fields, used only to suggest which truck this invoice belongs to. A person confirms the truck before anything is saved.
- unit_number: the fleet's own unit, truck or trailer number as printed on the invoice, if one appears. Otherwise null.
- vin: the full 17-character VIN, only if all 17 characters are legible. If any character is unclear, or fewer than 17 are printed, return null. Never reconstruct or correct a VIN.`

/**
 * PNG and JPEG signatures — the only part of an upload that is actually evidence of
 * what the bytes are, since the declared MIME type is just a string the client chose.
 * Authentication does not change that: a logged-in manager can still post a
 * mislabelled blob, by accident or otherwise.
 */
export function imageMagicMatches(bytes: Uint8Array, declared: AllowedImageType): boolean {
  if (declared === 'image/png') {
    return bytes.length > 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  }
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}
