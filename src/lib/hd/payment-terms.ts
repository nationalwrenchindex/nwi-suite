// ─── Payment terms, BOTH PRODUCTS ─────────────────────────────────────────────
//
// THE ONLY SOURCE OF TRUTH. It already was for HD — the invoice page, the print
// copy, the public pay page and the late-fee cron all read termsDisplay/termDays
// from here — so Part 3 widened it rather than building a second one. LD now reads
// it too.
//
// WHAT IS ACTUALLY STORED IN PRODUCTION:
//   hd_invoices : "net30" x 8, "net15" x 7, "Due on receipt" x 3
//   hd_quotes   : "net30" x 5
//   invoices    : nothing — the column arrives with migration 143
//
// The canonical set is 'due_on_receipt' | 'net_7' | 'net_15' | 'net_30'. The old
// spellings are NORMALISED ON READ rather than rewritten, because an UPDATE across
// 23 rows including sent invoices is not a thing to do silently. 'net_45' is still
// understood, because the previous vocabulary allowed it and a value that was once
// valid must not become unreadable; it is simply not offered any more.

/** The terms a picker offers, in the order they appear. */
export const PAYMENT_TERMS = ['due_on_receipt', 'net_7', 'net_15', 'net_30'] as const
export type PaymentTerms = (typeof PAYMENT_TERMS)[number]

/** Including the ones only understood for reading. */
export type PaymentTermsRead = PaymentTerms | 'net_45'

export const PAYMENT_TERMS_LABEL: Record<PaymentTermsRead, string> = {
  due_on_receipt: 'Due on receipt',
  net_7:          'Net 7',
  net_15:         'Net 15',
  net_30:         'Net 30',
  net_45:         'Net 45',
}

export const DEFAULT_PAYMENT_TERMS: PaymentTerms = 'net_7'

/**
 * True when a write failed only because migration 143 has not been applied.
 *
 * Mirrors isMissingTaxBreakdownColumn and missingMigration142Column. Narrow on
 * purpose: it names the two columns, so an unrelated failure still surfaces.
 */
export function isMissingPaymentTermsColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { message?: unknown; code?: unknown }
  const text = String(e.message ?? '').toLowerCase()
  const looksMissing =
    text.includes('does not exist') ||
    text.includes('could not find') ||
    text.includes('schema cache') ||
    String(e.code ?? '') === 'PGRST204' ||
    String(e.code ?? '') === '42703'
  return looksMissing && (text.includes('payment_terms') || text.includes('due_date'))
}

/**
 * Any stored spelling -> the canonical one, or null when it is not recognised.
 *
 * Returning NULL rather than guessing matters: an unrecognised value is free text
 * a shop typed, and it should render verbatim rather than be silently reinterpreted
 * as some number of days.
 */
export function normalisePaymentTerms(terms: string | null | undefined): PaymentTermsRead | null {
  const t = (terms ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  switch (t) {
    case 'due_on_receipt':
    case 'due_upon_receipt':
    case 'cod':
      return 'due_on_receipt'
    case 'net_7':  case 'net7':  return 'net_7'
    case 'net_15': case 'net15': return 'net_15'
    case 'net_30': case 'net30': return 'net_30'
    case 'net_45': case 'net45': return 'net_45'
    default: return null
  }
}

export function termDays(terms: string | null | undefined): number {
  const t = normalisePaymentTerms(terms)
  switch (t) {
    case 'due_on_receipt': return 0
    case 'net_7':          return 7
    case 'net_15':         return 15
    case 'net_30':         return 30
    case 'net_45':         return 45
    // Unrecognised free text. 30 days is the pre-existing fallback and is kept so
    // the late-fee cron's arithmetic does not change for any row it already reads.
    default:               return 30
  }
}

// Human label. A recognised value gets its canonical label; anything else renders
// verbatim, because it is a sentence the shop wrote.
export function termsDisplay(terms: string | null | undefined): string {
  const t = normalisePaymentTerms(terms)
  if (t) return PAYMENT_TERMS_LABEL[t]
  return (terms && terms.trim()) || 'Due on receipt'
}

/**
 * "Net 7 — due 10/10/2026", the one phrasing used on every surface.
 *
 * No due date gives the terms alone. NOTHING HERE DERIVES ONE: an invoice that was
 * sent without a due date must keep reading exactly as the customer received it.
 */
export function termsWithDueDate(
  terms:   string | null | undefined,
  dueDate: string | null | undefined,
): string {
  const label = termsDisplay(terms)
  if (!dueDate) return label
  // "Due on receipt — due 10/3/2026" is redundant, and the date it repeats is the
  // invoice date, which is printed two lines above. The label already says when.
  if (normalisePaymentTerms(terms) === 'due_on_receipt') return label
  const [y, m, d] = String(dueDate).split('-').map(Number)
  if (!y || !m || !d) return label
  const short = new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'numeric', day: 'numeric', year: 'numeric',
  })
  return `${label} — due ${short}`
}

/**
 * Days past due, or null when the question does not apply.
 *
 * DUE ON RECEIPT IS PAST DUE THE DAY AFTER IT IS SENT, per the brief — so for those
 * the clock starts at the sent date rather than at a stored due date, which such an
 * invoice will not have.
 *
 * Returns null, never 0, when there is nothing to measure from. A 0 would read as
 * "due today" on an invoice nobody has sent.
 */
export function daysPastDue(
  invoice: { payment_terms?: string | null; due_date?: string | null; sent_at?: string | null; sent_to_customer_at?: string | null },
  today = new Date(),
): number | null {
  const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const todayUtc = startOfDay(today)

  let dueUtc: number | null = null
  if (invoice.due_date) {
    const [y, m, d] = String(invoice.due_date).split('-').map(Number)
    if (y && m && d) dueUtc = Date.UTC(y, m - 1, d)
  } else if (normalisePaymentTerms(invoice.payment_terms) === 'due_on_receipt') {
    const sent = invoice.sent_at ?? invoice.sent_to_customer_at ?? null
    if (sent) {
      const s = new Date(sent)
      if (!Number.isNaN(s.getTime())) dueUtc = startOfDay(s)
    }
  }
  if (dueUtc === null) return null

  const days = Math.floor((todayUtc - dueUtc) / 86_400_000)
  return days > 0 ? days : 0
}

// Due date = sent date + N days, returned as a YYYY-MM-DD string (DATE column).
export function computeDueDate(sentAtISO: string, terms: string | null | undefined): string {
  const d = new Date(sentAtISO)
  d.setDate(d.getDate() + termDays(terms))
  return d.toISOString().slice(0, 10)
}

// Format a YYYY-MM-DD date-only string without timezone drift.
export function formatDueDate(d: string | null | undefined): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
