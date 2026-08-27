// QuickBooks export generators for HD Suite invoices.
//
// Two formats, because QuickBooks has two importers that share nothing:
//   • IIF  — QuickBooks Desktop. Tab-separated, CRLF, journal-style TRNS/SPL groups.
//   • CSV  — QuickBooks Online. Comma-separated, one row per LINE ITEM with the
//            invoice header repeated on every row.
//
// Everything here is a pure function so the route can stay a thin data fetch and the
// browser can build the file client-side (house pattern: blob + URL.createObjectURL).

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface QBLineItem {
  id?:           string
  type?:         'labor' | 'parts'
  description?:  string
  book_hours?:   number | string | null
  mobile_hours?: number | string | null
  part_number?:  string | null
  quantity?:     number | string | null
  unit_cost?:    number | string | null
  amount?:       number | string | null
}

export interface QBInvoice {
  id:              string
  invoice_number:  string | null
  customer_name:   string | null
  created_at:      string
  due_date:        string | null
  payment_terms:   string | null
  subtotal_labor:  number | null
  subtotal_parts:  number | null
  diagnostic_fee:  number | null
  road_call_fee:   number | null
  tax_amount:      number | null
  total:           number | null
  status:          string | null
  line_items:      QBLineItem[]
}

// ─── Primitives ────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

// 2dp, no thousands separators, no currency symbol — QuickBooks parses these as raw
// numbers and chokes on "$1,234.00".
function money(v: unknown): string {
  return num(v).toFixed(2)
}

// A tab, CR or LF inside any interpolated value silently splits the row and corrupts
// every field after it, so every value that reaches an IIF cell goes through here.
// Collapsed to single spaces rather than dropped so words don't get glued together.
export function sanitizeIIF(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).replace(/[\t\r\n]+/g, ' ').trim()
}

// House CSV escape: quote only when the value contains a comma, quote or newline,
// and double any internal quotes.
export function escapeCSV(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

// QuickBooks (both editions) rejects ISO dates — it wants MM/DD/YYYY.
// created_at is a UTC timestamp and due_date is a DATE column; both are sliced as
// strings rather than passed through `new Date()` so a browser in UTC-5 can't shift
// a midnight-stamped invoice back onto the previous day.
export function toQBDate(value: string | null | undefined): string {
  if (!value) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return ''
  return `${m[2]}/${m[3]}/${m[1]}`
}

// Net terms are stored as 'net30'; QuickBooks' term list reads "Net 30".
function termsLabel(terms: string | null | undefined): string {
  const t = (terms ?? '').toLowerCase()
  if (t === 'net15' || t === 'net30' || t === 'net45') return `Net ${t.slice(3)}`
  return (terms && terms.trim()) || 'Due on receipt'
}

function invoiceNo(inv: QBInvoice): string {
  return inv.invoice_number ?? `INV-${inv.id.slice(0, 6).toUpperCase()}`
}

function customerOf(inv: QBInvoice): string {
  return inv.customer_name?.trim() || 'Unknown Customer'
}

// ─── Split building (shared by both formats) ───────────────────────────────────

interface QBSplit {
  account:     string
  description: string
  item:        string
  quantity:    number
  amount:      number
}

const ACCT_AR   = 'Accounts Receivable'
const ACCT_INC  = 'Services'
const ACCT_TAX  = 'Sales Tax Payable'

// Labor rows carry hours instead of a quantity; parts carry quantity × unit_cost.
function lineQuantity(item: QBLineItem): number {
  if (item.type === 'labor') {
    const hours = num(item.book_hours) + num(item.mobile_hours)
    return hours > 0 ? hours : 1
  }
  const qty = num(item.quantity)
  return qty > 0 ? qty : 1
}

// Every income component of one invoice, in the order it should appear.
// diagnostic_fee and road_call_fee are NOT in line_items but ARE in `total`, so they
// must be emitted or the transaction will not balance.
function buildSplits(inv: QBInvoice): QBSplit[] {
  const splits: QBSplit[] = []

  for (const item of inv.line_items ?? []) {
    const amount = num(item.amount)
    if (amount === 0) continue
    const label = item.type === 'parts' && item.part_number
      ? `${item.description ?? 'Part'} (${item.part_number})`
      : (item.description ?? (item.type === 'labor' ? 'Labor' : 'Parts'))
    splits.push({
      account:     ACCT_INC,
      description: label,
      item:        item.type === 'parts' ? 'Parts' : 'Labor',
      quantity:    lineQuantity(item),
      amount,
    })
  }

  if (num(inv.diagnostic_fee) > 0) {
    splits.push({ account: ACCT_INC, description: 'Diagnostic Fee', item: 'Diagnostic', quantity: 1, amount: num(inv.diagnostic_fee) })
  }
  if (num(inv.road_call_fee) > 0) {
    splits.push({ account: ACCT_INC, description: 'Road Call Fee', item: 'Road Call', quantity: 1, amount: num(inv.road_call_fee) })
  }

  // An invoice saved with a total but no usable line items would otherwise export as a
  // TRNS with nothing behind it. Fall back to a single service line for the pre-tax amount.
  if (splits.length === 0) {
    const preTax = num(inv.total) - num(inv.tax_amount)
    if (preTax !== 0) {
      splits.push({ account: ACCT_INC, description: 'Heavy duty service', item: 'Labor', quantity: 1, amount: preTax })
    }
  }

  if (num(inv.tax_amount) > 0) {
    splits.push({ account: ACCT_TAX, description: 'Sales Tax', item: 'Sales Tax', quantity: 1, amount: num(inv.tax_amount) })
  }

  // Legacy rows can have a stored `total` that no longer matches their parts. QuickBooks
  // rejects (or worse, silently mangles) an unbalanced transaction, so any residual is
  // pushed into a visible adjusting line instead of breaking the import.
  const summed   = splits.reduce((s, sp) => s + sp.amount, 0)
  const residual = Math.round((num(inv.total) - summed) * 100) / 100
  if (Math.abs(residual) >= 0.01) {
    splits.push({ account: ACCT_INC, description: 'Rounding / adjustment', item: 'Adjustment', quantity: 1, amount: residual })
  }

  return splits
}

// ─── IIF (QuickBooks Desktop) ──────────────────────────────────────────────────

const TAB  = '\t'
const CRLF = '\r\n'

const IIF_HEADER = [
  ['!TRNS', 'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'DOCNUM', 'MEMO'].join(TAB),
  ['!SPL',  'SPLID',  'TRNSTYPE', 'DATE', 'ACCNT', 'NAME', 'CLASS', 'AMOUNT', 'DOCNUM', 'MEMO'].join(TAB),
  '!ENDTRNS',
]

/**
 * Build a QuickBooks Desktop .IIF file.
 *
 * Format rules that are not negotiable:
 *   • Fields are TAB separated — never commas.
 *   • Lines end with CRLF — QuickBooks' parser treats a bare LF as a malformed file.
 *   • One header block for the whole file, then a TRNS / SPL… / ENDTRNS group per invoice.
 *
 * SIGN CONVENTION — the reason a bad IIF imports as junk rather than failing loudly:
 * IIF is double-entry. The TRNS line is the DEBIT to Accounts Receivable and carries the
 * POSITIVE invoice total. Every SPL is the matching CREDIT to income / sales tax and is
 * therefore NEGATIVE. TRNS + all SPLs must sum to exactly zero for each transaction.
 */
export function generateIIF(invoices: QBInvoice[], companyName?: string | null): string {
  const memoTag = sanitizeIIF(companyName?.trim() || 'NWI HD Suite')
  const lines: string[] = [...IIF_HEADER]

  for (const inv of invoices) {
    const date     = toQBDate(inv.created_at)
    const customer = sanitizeIIF(customerOf(inv))
    const docNum   = sanitizeIIF(invoiceNo(inv))
    const splits   = buildSplits(inv)
    const total    = splits.reduce((s, sp) => s + sp.amount, 0)

    lines.push([
      'TRNS',
      '',                 // TRNSID — blank lets QuickBooks assign it
      'INVOICE',
      date,
      ACCT_AR,
      customer,
      '',                 // CLASS — unused
      money(total),       // POSITIVE: debit A/R
      docNum,
      `${memoTag} invoice ${docNum}`,
    ].join(TAB))

    for (const sp of splits) {
      lines.push([
        'SPL',
        '',                       // SPLID — blank lets QuickBooks assign it
        'INVOICE',
        date,
        sanitizeIIF(sp.account),
        customer,
        '',                       // CLASS — unused
        money(-sp.amount),        // NEGATIVE: credit income / sales tax
        '',                       // DOCNUM lives on the TRNS line only
        sanitizeIIF(sp.description),
      ].join(TAB))
    }

    lines.push('ENDTRNS')
  }

  return lines.join(CRLF) + CRLF
}

// ─── CSV (QuickBooks Online) ───────────────────────────────────────────────────

const CSV_COLUMNS = [
  'InvoiceNo',
  'Customer',
  'InvoiceDate',
  'DueDate',
  'Terms',
  'Item(Product/Service)',
  'ItemDescription',
  'ItemQuantity',
  'ItemRate',
  'ItemAmount',
  'Taxable',
  'TaxAmount',
]

/**
 * Build a QuickBooks Online invoice-import CSV.
 *
 * QBO's importer is row-per-line-item: the invoice header columns repeat on every row
 * and rows sharing an InvoiceNo are collapsed back into one invoice on import.
 */
export function generateQBOCsv(invoices: QBInvoice[]): string {
  const rows: string[] = [CSV_COLUMNS.join(',')]

  for (const inv of invoices) {
    const docNum   = invoiceNo(inv)
    const customer = customerOf(inv)
    const date     = toQBDate(inv.created_at)
    const due      = toQBDate(inv.due_date) || date
    const terms    = termsLabel(inv.payment_terms)
    const tax      = num(inv.tax_amount)

    // The tax split is a QuickBooks-side calculation in QBO, so it is not emitted as a
    // line item here — it rides in the TaxAmount column instead.
    const splits = buildSplits(inv).filter(sp => sp.account !== ACCT_TAX)

    splits.forEach((sp, i) => {
      const qty  = sp.quantity || 1
      const rate = sp.amount / qty
      rows.push([
        escapeCSV(docNum),
        escapeCSV(customer),
        escapeCSV(date),
        escapeCSV(due),
        escapeCSV(terms),
        escapeCSV(sp.item),
        escapeCSV(sp.description),
        escapeCSV(qty % 1 === 0 ? String(qty) : qty.toFixed(2)),
        escapeCSV(money(rate)),
        escapeCSV(money(sp.amount)),
        escapeCSV(tax > 0 ? 'Y' : 'N'),
        // Tax is an invoice-level figure. Repeating it on every row would multiply it by
        // the line count on import, so it only lands on the first row of each invoice.
        escapeCSV(i === 0 ? money(tax) : money(0)),
      ].join(','))
    })
  }

  return rows.join(CRLF) + CRLF
}
