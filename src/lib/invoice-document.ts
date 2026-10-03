// ─── What a customer-facing invoice says ──────────────────────────────────────
//
// PRESENTATION ONLY. Nothing here writes, and nothing here recomputes money.
// Totals come from src/lib/tax.ts and src/lib/hd/inspection-invoice.ts, both of
// which just shipped and are not touched from this module.
//
// WHY THIS EXISTS. There are five customer-facing invoice templates in this
// codebase and they shared nothing:
//
//   LD  /invoice/[token]                        page, the actual document
//   LD  invoiceHtmlEmail()                      short email with a link
//   HD  /hd/invoices/pay/[token]                page, the actual document
//   HD  GET /api/hd/invoices/[id]/pdf           the print copy
//   HD  buildInvoiceEmail()                     short email with a link
//
// Every one of them decided independently what a shop block is, whether a fee
// prints, and whether a date appears. That is why the LD document had no date at
// all while the HD print copy had three. The rules live here now, so a fix lands
// on every surface at once.

import { resolveBranding, type BrandingSource } from '@/lib/branding'
import { addressFrom, formatAddressLine, isAddressEmpty, type Address } from '@/lib/address'

// ─── Shop identity ────────────────────────────────────────────────────────────

export interface ShopBlock {
  name:    string
  logoUrl: string | null
  /** Street/city/state/zip as printable lines. Empty when the shop has no address. */
  addressLines: string[]
  phone:   string | null
  email:   string | null
}

/**
 * Columns a caller must select for shopBlockFrom to be complete.
 *
 * NOTE ON WHAT IS MISSING. `profiles` has `city` and `state` and nothing else —
 * there is no street or zip column for a subscriber's own address. So the shop
 * block can print a city and a state today and no more. addressFrom() is fed the
 * profile anyway: the moment a street column exists it is picked up here with no
 * change to any template. That is the seam, and it is deliberately not wired to
 * anything that does not exist yet.
 */
export const SHOP_BLOCK_SELECT =
  'business_name, full_name, phone, email, business_logo_url, hd_company_logo_url, city, state'

/**
 * The street columns migration 143 adds. SEPARATE from SHOP_BLOCK_SELECT on
 * purpose: migrations here are applied by hand, and naming a column that does not
 * exist fails the WHOLE query. Every caller selects both and falls back to
 * SHOP_BLOCK_SELECT alone, so a document renders with city and state until the SQL
 * is run rather than not rendering at all.
 */
export const SHOP_ADDRESS_SELECT_143 = 'address_line1, address_line2, zip'

export interface ShopSource extends BrandingSource {
  email?: string | null
  city?:  string | null
  state?: string | null
  /** Honoured if a street address ever lands on profiles. Absent today. */
  address_line1?: string | null
  address_line2?: string | null
  zip?:           string | null
}

export function shopBlockFrom(profile: ShopSource | null | undefined): ShopBlock {
  const b = resolveBranding(profile)
  return {
    name:         b.name,
    logoUrl:      b.logoUrl,
    addressLines: addressLines(addressFrom(profile)),
    phone:        b.phone,
    email:        profile?.email?.trim() || null,
  }
}

/**
 * An address as the two lines an envelope would carry: street (plus unit), then
 * "City, ST 12345". Returns [] when there is nothing to print, so a caller can
 * hide the block rather than render a heading over blank space.
 */
export function addressLines(a: Address): string[] {
  if (isAddressEmpty(a)) return []
  const out: string[] = []
  if (a.address_line1) out.push(a.address_line1)
  if (a.address_line2) out.push(a.address_line2)
  const tail = [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  if (tail) out.push(tail)
  // A state+zip with no city, or a city with neither, is still worth printing —
  // but an address consisting only of a line-2 unit number is not.
  return out.length === 1 && !a.address_line1 && !a.city && !a.state ? [] : out
}

/** The same thing on one line, for an email or an SMS. */
export function addressOneLine(a: Address): string {
  return formatAddressLine(a)
}

// ─── The customer ─────────────────────────────────────────────────────────────

export interface PartyBlock {
  name:         string
  addressLines: string[]
  phone:        string | null
  email:        string | null
}

/** LD: built from the embedded `customers` row. */
export function customerBlockFrom(
  customer: Record<string, unknown> | null | undefined,
  fallbackName = 'Valued Customer',
): PartyBlock {
  const c = customer ?? {}
  const name = [c.first_name, c.last_name]
    .map(v => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .join(' ')
  return {
    name:         name || fallbackName,
    addressLines: addressLines(addressFrom(c)),
    phone:        typeof c.phone === 'string' && c.phone.trim() ? c.phone.trim() : null,
    email:        typeof c.email === 'string' && c.email.trim() ? c.email.trim() : null,
  }
}

/** HD: the five columns live on the invoice row itself, denormalised at create. */
export function hdBillToFrom(inv: Record<string, unknown>): PartyBlock {
  return {
    name:         (typeof inv.customer_name === 'string' && inv.customer_name.trim()) || 'Customer',
    addressLines: addressLines(addressFrom(inv)),
    phone:        typeof inv.customer_phone === 'string' && inv.customer_phone.trim() ? inv.customer_phone.trim() : null,
    email:        typeof inv.customer_email === 'string' && inv.customer_email.trim() ? inv.customer_email.trim() : null,
  }
}

// ─── Dates and terms ──────────────────────────────────────────────────────────

export interface InvoiceDates {
  /** The date of the invoice. Never null — a document headed "Total Due" needs one. */
  issued:    string
  /** Only ever a stored due date. Never derived here. See the comment below. */
  due:       string | null
  /** "Net 30", "Due on receipt", or whatever free text was stored. May be null. */
  termsText: string | null
}

/**
 * NO DUE DATE IS INVENTED HERE.
 *
 * Every LD invoice in production has due_date NULL, because nothing writes it
 * yet. It would be easy to print issued + 30 days and call it a due date, and
 * that is exactly the wrong thing to do: a date a customer can be held to must
 * come from terms the shop actually set, not from this module's guess. So an
 * unset due date prints the terms line alone, and the stored value is used the
 * moment one exists.
 */
export function ldInvoiceDates(inv: Record<string, unknown>): InvoiceDates {
  const issued =
    firstString(inv.invoice_date) ??
    firstString(inv.finalized_at) ??
    firstString(inv.created_at) ??
    new Date().toISOString()
  return {
    issued,
    due:       firstString(inv.due_date),
    termsText: firstString(inv.terms),
  }
}

function firstString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Month-day-year, and timezone-safe for a DATE column that has no time part. */
export function formatDocDate(s: string | null | undefined): string | null {
  if (!s) return null
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  const d = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

// ─── Line items ───────────────────────────────────────────────────────────────

export interface DocLine {
  description: string
  /** "2 hrs", "×4", or null when the quantity is 1 and says nothing. */
  quantityText: string | null
  /** "$95.00/hr" or "$7.22 ea", when a unit price is known and worth showing. */
  unitText:    string | null
  total:       number
  isLabor:     boolean
}

/**
 * Is this line labour?
 *
 * PROVABLE SIGNALS ONLY. HD line items carry an explicit `type`, so HD is
 * certain. LD's older {description, quantity, unit_price, total} shape carries no
 * type at all, so the only honest signals are:
 *
 *   - a description that starts with "Labor" ("Labor", "Labor — Tire Rotation"),
 *     which is what the converter and the quote builder actually write, and
 *   - a quantity and unit price that match the source quote's labor_hours and
 *     labor_rate exactly, which identifies the quote's labour roll-up.
 *
 * It deliberately does NOT guess from "unit_price happens to equal the labor
 * rate". Printing "4 hrs" against a part that costs the same as an hour of
 * labour is a worse document than printing "Qty 4" against labour.
 */
export function isLaborLine(
  line: Record<string, unknown>,
  ctx?: { laborHours?: number | null; laborRate?: number | null },
): boolean {
  if (line.type === 'labor') return true
  if (line.type === 'parts') return false

  const d = typeof line.description === 'string' ? line.description.trim() : ''
  if (/^labor\b/i.test(d)) return true

  const hours = ctx?.laborHours == null ? null : Number(ctx.laborHours)
  const rate  = ctx?.laborRate  == null ? null : Number(ctx.laborRate)
  if (hours != null && rate != null && hours > 0 && rate > 0) {
    if (Number(line.quantity) === hours && Number(line.unit_price) === rate) return true
  }
  return false
}

/**
 * Give a bare "Labor" line something a customer can read.
 *
 * The description is only ever ENRICHED, never replaced — a tech who typed
 * "Labor — replaced TCM" keeps their words. "Labor" on its own is the case worth
 * fixing, and the replacement text comes from what the invoice already stores:
 * the job subtype, then the first heading in the job notes.
 */
export function enrichLaborDescription(
  description: string,
  ctx: { jobSubtype?: string | null; jobCategory?: string | null; jobNotes?: string | null },
): string {
  const d = (description ?? '').trim()
  if (!/^labor$/i.test(d)) return d || 'Labor'

  const subtype = ctx.jobSubtype?.trim() || null
  if (subtype) return `Labor — ${subtype}`

  const category = ctx.jobCategory?.trim() || null
  if (category) return `Labor — ${category}`

  // "Segment 1 — replaced TCM\n<body>" → the heading, which is the complaint the
  // segment was opened for.
  const firstHeading = (ctx.jobNotes ?? '').split('\n').map(l => l.trim()).find(Boolean)
  if (firstHeading) {
    const dashed = firstHeading.split(/\s+[—-]\s+/)
    const tail = dashed.length > 1 ? dashed.slice(1).join(' — ').trim() : firstHeading
    if (tail) return `Labor — ${tail}`
  }
  return 'Labor'
}

/** Hours get the word "hours". Everything else keeps a count. */
export function quantityText(qty: number, labor: boolean): string | null {
  if (!Number.isFinite(qty) || qty === 0) return null
  if (labor) return `${trimNum(qty)} ${qty === 1 ? 'hour' : 'hours'}`
  // A fractional quantity is PROVABLY not a count of discrete items — nobody
  // buys 2.5 of a part. So it keeps its number but loses the "×" multiplier
  // framing, rather than being asserted as hours it has not been proven to be.
  if (!Number.isInteger(qty)) return trimNum(qty)
  return qty === 1 ? null : `×${trimNum(qty)}`
}

/**
 * The grey line under a description: "2 hours × $95.00/hr", "×4 × $7.22 ea".
 *
 * WHY "ea" IS CONDITIONAL. A converted segment line reads "Segment 1 — diagnose
 * and replace tcm", quantity 2.5, unit price 95. That is plainly labour, but the
 * LD line_items shape {description, quantity, unit_price, total} carries no type
 * field, so it cannot be PROVEN labour from the invoice row alone — the same
 * schema gap that loses part numbers on conversion.
 *
 * Rather than guess, a non-integer quantity simply stops claiming to be a count:
 * "2.5 × $95.00" instead of the nonsense "×2.5 × $95.00 ea". Only a proven
 * labour line says "hours", and only a whole-number quantity says "ea".
 */
export function lineMeta(qty: number, unitPrice: number, labor: boolean): string | null {
  const q = quantityText(qty, labor)
  const unit = Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : null
  if (unit == null) return q
  const suffix = labor ? '/hr' : Number.isInteger(qty) ? ' ea' : ''
  const priceText = `${formatMoney(unit)}${suffix}`
  return q ? `${q} × ${priceText}` : priceText
}

/** Local money formatter so this module stays free of display dependencies. */
function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`
}

function trimNum(n: number): string {
  return String(Math.round(n * 100) / 100)
}

// ─── HD: the unit the work was done on ────────────────────────────────────────

export interface LabelledLine { label: string | null; value: string }

/**
 * The Service Unit block, as printable lines.
 *
 * Returns [] when the invoice knows nothing about the unit, which is the whole
 * point: the HD print copy rendered a "Service Unit" heading unconditionally, so
 * an invoice auto-created from an aerial inspection printed the header over
 * nothing at all. One production invoice (INV-2026-0014) does exactly that.
 */
export function serviceUnitLines(inv: Record<string, unknown>): LabelledLine[] {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v))
  const out: LabelledLine[] = []

  // THE UNIT NUMBER COMES FIRST, and it is the headline.
  //
  // It is the identifier a shop and a fleet actually use to refer to a piece of
  // equipment — chassis 1, reefer 1R, APU 2APU. The serial is for a warranty
  // claim. A document that leads with "Carrier Transicold X2 2500A, Serial
  // NAV91291602" cannot be filed against a customer's own equipment list, which
  // is the whole purpose of them keeping it.
  const unitNo = s(inv.unit_number)
  const model  = [s(inv.unit_manufacturer), s(inv.unit_model)].filter(Boolean).join(' ')

  if (unitNo) {
    out.push({ label: 'Unit', value: unitNo })
    if (model) out.push({ label: null, value: model })
  } else if (model) {
    out.push({ label: null, value: model })
  }

  if (s(inv.unit_serial)) out.push({ label: 'Serial',  value: s(inv.unit_serial) })
  if (s(inv.unit_year))   out.push({ label: 'Year',    value: s(inv.unit_year) })

  const truck = [s(inv.truck_year), s(inv.truck_make), s(inv.truck_model)].filter(Boolean).join(' ')
  if (truck) out.push({ label: 'Truck', value: truck })
  if (s(inv.vin)) out.push({ label: 'VIN', value: s(inv.vin) })

  return out
}

/**
 * The unit fields a document copies off a unit record at creation time.
 *
 * ONE PLACE, because there are eleven capture points and unit_number was about
 * to be added to each of them by hand. Denormalising is the existing convention
 * and is correct: a document is billed history and must still read properly after
 * the unit is renumbered, re-serialled or deleted.
 *
 * Accepts either an `hd_units` row (unit_number / manufacturer / model /
 * serial_number / year) or an LD `vehicles` row (unit_number / make / model /
 * vin / year), because callers on both sides need the same snapshot.
 */
export function unitSnapshot(unit: Record<string, unknown> | null | undefined): {
  unit_number:       string | null
  unit_manufacturer: string | null
  unit_model:        string | null
  unit_serial:       string | null
  unit_year:         number | null
} {
  const u = unit ?? {}
  const s = (v: unknown): string | null => {
    const t = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
    return t || null
  }
  const yr = Number(u.year)
  return {
    unit_number:       s(u.unit_number),
    unit_manufacturer: s(u.manufacturer ?? u.make),
    unit_model:        s(u.model),
    unit_serial:       s(u.serial_number ?? u.unit_serial ?? u.vin),
    unit_year:         Number.isFinite(yr) && yr > 0 ? yr : null,
  }
}

// ─── HD: the fee rows in the totals box ───────────────────────────────────────

export interface MoneyRow { label: string; amount: number }

/**
 * The diagnostic and road-call fee rows, which exist only when charged.
 *
 * A ZERO FEE MUST NOT PRINT A LINE. hd_invoices.diagnostic_fee carried
 * `DEFAULT 125.00` from migration 057, so an invoice that never set it got 125
 * from Postgres, printed a "Diagnostic Fee $125.00" line, and excluded it from
 * the total — a fee on the document that was never charged. Phase 1 fixed the
 * writers; this is the read side, in one place so both HD templates share the
 * rule rather than each repeating `Number(x) > 0`.
 */
export function feeRows(inv: Record<string, unknown>): MoneyRow[] {
  const rows: MoneyRow[] = []
  const diag = Number(inv.diagnostic_fee ?? 0)
  const road = Number(inv.road_call_fee ?? 0)
  if (Number.isFinite(diag) && diag > 0) rows.push({ label: 'Diagnostic Fee', amount: diag })
  if (Number.isFinite(road) && road > 0) rows.push({ label: 'Road Call Fee',  amount: road })
  return rows
}

// ─── HD: manufacturer and certification disclaimers ───────────────────────────

/**
 * Which manufacturer marks this invoice actually references.
 *
 * The HD print copy carried "EPA Section 608 certified refrigeration work" on
 * every invoice it generated, including a DOT inspection on an International
 * tractor and an aerial lift inspection. Claiming a refrigeration certification
 * on an aerial inspection is not a cosmetic problem — it is a certification
 * statement on a document the customer keeps.
 *
 * So the test is what the invoice says about itself: the unit manufacturer and
 * model, the complaint, the diagnosis, the notes, and the line descriptions.
 * Nothing is inferred from the subscriber's trade.
 */
const THERMO_KING = /thermo\s*-?\s*king|thermoking/i
const CARRIER     = /\bcarrier\b|transicold/i
const REFRIGERATION = /refrigerat|\breefer\b|\bfreon\b|\br-?404a\b|\br-?134a\b|\brefrig\b|evaporator|condenser\s*(coil|fan)|compressor|receiver\s*tank|expansion\s*valve|\bTXV\b|\bsuction\b|\bdischarge\s*(line|pressure)\b/i

function invoiceText(inv: Record<string, unknown>): string {
  const items = Array.isArray(inv.line_items) ? inv.line_items : []
  return [
    inv.unit_manufacturer,
    inv.unit_model,
    inv.complaint,
    inv.diagnosis,
    inv.notes,
    ...items.map(i => (i as Record<string, unknown>)?.description),
    ...items.map(i => (i as Record<string, unknown>)?.part_number),
  ]
    .filter((v): v is string => typeof v === 'string')
    .join(' • ')
}

export interface DocDisclaimers {
  /** Manufacturer trademark notices to print, in order. Empty means print none. */
  manufacturers: string[]
  /** Whether the EPA 608 refrigeration certification line belongs on this invoice. */
  epa608: boolean
}

export function documentDisclaimers(inv: Record<string, unknown>): DocDisclaimers {
  const hay = invoiceText(inv)
  const manufacturers: string[] = []

  if (THERMO_KING.test(hay)) {
    manufacturers.push('Thermo King® is a registered trademark of Thermo King Corporation.')
  }
  if (CARRIER.test(hay)) {
    manufacturers.push('Carrier® and Carrier Transicold® are registered trademarks of Carrier Corporation.')
  }

  // The certification claim needs refrigeration work, not merely a reefer brand
  // in the unit field: a tyre change on a trailer that happens to carry a Thermo
  // King unit is not EPA 608 work.
  const epa608 = REFRIGERATION.test(hay) || THERMO_KING.test(hay) || CARRIER.test(hay)

  if (manufacturers.length > 0) {
    manufacturers.push('Named only to identify the equipment serviced. No affiliation or endorsement is implied.')
  }

  return { manufacturers, epa608 }
}

/** The certification sentence, with the real cert number when the shop set one. */
export function epa608Line(certNumber: string | null | undefined): string {
  const n = certNumber?.trim()
  return n
    ? `Refrigeration work performed under EPA Section 608 certification ${n}.`
    : 'Refrigeration work performed by an EPA Section 608 certified technician.'
}

// ─── Attached inspections ─────────────────────────────────────────────────────

/**
 * How an attached inspection's outcome reads on the invoice.
 *
 * THE NULL CONTRACT FROM MIGRATION 141 HOLDS HERE. `removed_from_service` is
 * three-valued:
 *
 *   true  — the tech took it out of service. Say so, loudly.
 *   false — the tech was asked and said no. "Remains in service" is a real
 *           answer and worth printing.
 *   null  — nobody was ever asked, because the inspection predates 141. Print
 *           nothing. Writing "remains in service" here would put a
 *           certification on a document that no technician signed.
 */
export function inspectionOutcome(
  overallResult: string | null | undefined,
  removedFromService: boolean | null | undefined,
): string[] {
  const out: string[] = []
  const r = overallResult?.trim()
  if (r) out.push(r.toUpperCase())

  if (removedFromService === true)  out.push('UNIT TAKEN OUT OF SERVICE')
  else if (removedFromService === false) out.push('Unit remains in service')
  // null falls through deliberately — see above.

  return out
}
