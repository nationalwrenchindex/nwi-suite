// Customer-facing SMS bodies for the HD Suite.
//
// WHITE-LABEL RULE: every string that leaves this file is branded with the
// SUBSCRIBER's business, never National Wrench Index. The customer hired the
// contractor, not the contractor's software vendor — a text signed "NWI" reads
// as a scam to the customer and undercuts the subscriber's brand. Nothing in
// here may reference NWI, National Wrench Index, or nationalwrenchindex.com.
//
// Pure functions only: no supabase, no fetch, no process.env. Kept importable
// from anywhere (route handlers, cron jobs, tests) without pulling server deps.

/** Hard ceiling for an outbound body: 320 chars, the stated 2-SMS budget.
 *
 *  Twilio bills per SEGMENT, not per message. GSM-7 fits 160 chars in a single
 *  segment, but a concatenated message spends 7 bits per segment on the
 *  reassembly header and only carries 153 — so two segments is really 306 chars,
 *  and char 307 silently starts a third billed segment. TWO_SEGMENTS is what the
 *  builder actually aims at; MAX_SMS_CHARS is the absolute ceiling. */
export const MAX_SMS_CHARS = 320
const TWO_SEGMENTS = 306

/** Body must stay 7-bit ASCII. A single curly quote, en-dash, or emoji flips the
 *  whole message to UCS-2, which collapses the budget to 70/67 chars per segment
 *  and triples the bill. Callers pass business names verbatim, so we strip. */
function toGsmSafe(s: string): string {
  return s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    // Anything still outside printable ASCII would force UCS-2 — drop it.
    .replace(/[^\x20-\x7E\n]/g, '')
    .trim()
}

/** "$1,234.50". Accepts the string DECIMAL that Supabase returns for numerics. */
export function formatInvoiceTotal(total: number | string | null | undefined): string {
  const n = typeof total === 'string' ? Number(total) : total
  if (n == null || !Number.isFinite(n)) return '$0.00'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

/** Digits-only phone rendered as (555) 555-5555 so the customer can tap to call
 *  back. Anything that isn't a US 10/11-digit number is passed through as typed
 *  rather than mangled — subscribers do enter extensions and shop lines. */
export function formatBusinessPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const d = phone.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return toGsmSafe(phone)
}

/** Long legal names ("Smith & Sons Heavy Equipment Service of Central Texas LLC")
 *  would eat a whole segment on their own. Trim rather than pay for it. */
const MAX_BUSINESS_NAME = 40

export function normalizeBusinessName(name: string | null | undefined): string {
  const clean = toGsmSafe(name ?? '')
  // Fallback is deliberately generic and vendor-neutral: a subscriber who never
  // filled in business_name still must not sign the text as NWI.
  if (!clean) return 'Your service provider'
  if (clean.length <= MAX_BUSINESS_NAME) return clean

  // Cut on a word boundary. A mid-word chop ("Smith & Sons Heavy Equipment Serv")
  // looks like a corrupted message; dropping the trailing word does not.
  const cut  = clean.slice(0, MAX_BUSINESS_NAME)
  const gap  = cut.lastIndexOf(' ')
  return (gap > MAX_BUSINESS_NAME / 2 ? cut.slice(0, gap) : cut).trimEnd()
}

export interface InvoiceSmsInput {
  businessName:  string | null | undefined
  businessPhone: string | null | undefined
  invoiceNumber: string
  total:         number | string | null | undefined
  url:           string
  /** True when a PM / DOT / aerial report is attached. Mentioned, never linked:
   *  three more URLs would blow the 2-segment budget, and the public invoice page
   *  already carries the reports. */
  hasReports?:   boolean
}

/**
 * The invoice-ready text. Assembled longest-first, then degraded in a fixed
 * order until it fits TWO_SEGMENTS, so the two things that must never be lost
 * — the amount and the pay link — survive every trim.
 *
 * Budget, worst case: business name 40 + " is ready. View and pay: " etc. 40 +
 * invoice number ~12 + total ~10 + URL ~120 (the token is 64 hex chars) = ~222.
 * With the report note (36) and callback (32) and STOP line (23) a fully loaded
 * message lands near 313 — over the 306 two-segment line, which is exactly why
 * the degradation below exists. Order of sacrifice:
 *   1. the attached-report note   2. the callback phone   3. nothing else
 * The STOP line stays: 10DLC carriers require an opt-out on the first message
 * of a conversation, and dropping it risks the campaign, not just the send.
 */
export function buildInvoiceSms(input: InvoiceSmsInput): string {
  const biz   = normalizeBusinessName(input.businessName)
  const num   = toGsmSafe(input.invoiceNumber || 'invoice')
  const total = formatInvoiceTotal(input.total)
  const url   = input.url.trim()
  const phone = formatBusinessPhone(input.businessPhone)

  const lead    = `${biz}: Invoice ${num} for ${total} is ready. View and pay: ${url}`
  const reports = input.hasReports ? ' Your inspection report is included.' : ''
  const callMe  = phone ? ` Questions? Call ${phone}.` : ''
  const optOut  = ' Reply STOP to opt out.'

  const full = `${lead}${reports}${callMe}${optOut}`
  if (full.length <= TWO_SEGMENTS) return full

  const noReports = `${lead}${callMe}${optOut}`
  if (noReports.length <= TWO_SEGMENTS) return noReports

  // Bare minimum. Still branded to the subscriber, still opt-outable. Can only
  // exceed MAX_SMS_CHARS if the URL itself is pathological, which the token
  // format rules out — asserted here rather than truncated, because a chopped
  // pay link is worse than a third segment.
  return `${lead}${optOut}`
}

/**
 * Subject + plain-text body for the email channel, kept here so the branding
 * rule has exactly one home. Same white-label constraint as the SMS.
 */
export function buildInvoiceEmail(input: InvoiceSmsInput): { subject: string; text: string } {
  const biz   = normalizeBusinessName(input.businessName)
  const total = formatInvoiceTotal(input.total)
  const phone = formatBusinessPhone(input.businessPhone)

  return {
    subject: `Invoice ${input.invoiceNumber} from ${biz} — ${total} due`,
    text: [
      `Your invoice from ${biz} is ready.`,
      '',
      `Invoice: ${input.invoiceNumber}`,
      `Total due: ${total}`,
      '',
      `View and pay: ${input.url}`,
      ...(input.hasReports ? ['', 'Your inspection report is attached to the invoice.'] : []),
      '',
      phone ? `Questions? Call ${biz} at ${phone}.` : `Questions? Contact ${biz}.`,
    ].join('\n'),
  }
}
