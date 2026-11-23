// THE ONE COPY of the column headings the HD importers read, shared by the server routes
// (/api/hd/import/fullbay, /api/hd/import/invoices) and the import wizard's pre-flight
// check. Nothing here is a guess and nothing is AI: a heading matches or it does not.
//
// WHY (Nov 23, 2026): a customer imported 1,740 Fullbay rows on Oct 20 and only the
// customer column matched a heading below. Work order number, unit number, service date,
// total, status, technician and description landed on zero rows each, the import reported
// success, and nobody found out for a month. The wizard now compares the file's headings
// against THIS table before anything is posted, and refuses when a required one is missing.
//
// The aliases were moved here unchanged from the routes (same words, same order). Do not
// add, remove or reword one without deciding it on purpose: a file that matched yesterday
// must match today.

/** How a column's headings are compared with the file's headings. */
export type HeaderMatch =
  /** Case-insensitive, ends trimmed; the first alias that is present wins (Fullbay). */
  | 'alias'
  /** The heading exactly as written, case included (the invoice route reads row['CLIENT']). */
  | 'exact'

export interface ImportColumn {
  key: string
  label: string
  /** In the importer's own lookup order. */
  aliases: readonly string[]
  required: boolean
  /** Read only for a row that creates a new unit (the unit's own details). */
  unitDetail?: boolean
}

export interface ImportFormatColumns {
  match: HeaderMatch
  columns: readonly ImportColumn[]
}

// ── Fullbay work order export (src/app/api/hd/import/fullbay/route.ts) ─────────────────
export const FULLBAY = {
  workOrderNumber: { key: 'work_order_number', label: 'Work order number', required: true,  aliases: ['Work Order Number', 'Work Order #', 'WO Number', 'WO#', 'Work Order'] },
  customer:        { key: 'customer',          label: 'Customer',          required: true,  aliases: ['Customer Name', 'Customer', 'Fleet', 'Client'] },
  unitNumber:      { key: 'unit_number',       label: 'Unit number',       required: true,  aliases: ['Unit Number', 'Unit #', 'Unit No', 'Unit'] },
  serviceDate:     { key: 'service_date',      label: 'Service date',      required: true,  aliases: ['Service Date', 'Date', 'Start Date', 'Work Date'] },
  completedDate:   { key: 'completed_date',    label: 'Completed date',    required: false, aliases: ['Completed Date', 'Completion Date', 'End Date'] },
  status:          { key: 'status',            label: 'Status',            required: false, aliases: ['Status'] },
  technician:      { key: 'technician',        label: 'Technician',        required: false, aliases: ['Technician', 'Tech', 'Tech Name', 'Assigned To'] },
  description:     { key: 'description',       label: 'Service description', required: false, aliases: ['Service Description', 'Description', 'Services', 'Work Done'] },
  internalNotes:   { key: 'internal_notes',    label: 'Internal notes',    required: false, aliases: ['Internal Notes', 'Notes', 'Comments'] },
  total:           { key: 'total',             label: 'Total',             required: false, aliases: ['Total', 'Grand Total', 'Invoice Total'] },
  laborTotal:      { key: 'labor_total',       label: 'Labor total',       required: false, aliases: ['Labor Total', 'Labor'] },
  partsTotal:      { key: 'parts_total',       label: 'Parts total',       required: false, aliases: ['Parts Total', 'Parts'] },
  tax:             { key: 'tax',               label: 'Tax',               required: false, aliases: ['Tax'] },
  amountPaid:      { key: 'amount_paid',       label: 'Amount paid',       required: false, aliases: ['Amount Paid', 'Paid', 'Payment'] },
  balanceDue:      { key: 'balance_due',       label: 'Balance due',       required: false, aliases: ['Balance Due', 'Balance', 'Owed'] },
  make:            { key: 'make',              label: 'Make',              required: false, unitDetail: true, aliases: ['Make', 'Manufacturer', 'Brand'] },
  model:           { key: 'model',             label: 'Model',             required: false, unitDetail: true, aliases: ['Model'] },
  serial:          { key: 'serial',            label: 'VIN / serial',      required: false, unitDetail: true, aliases: ['VIN', 'Serial Number', 'Serial'] },
  year:            { key: 'year',              label: 'Year',              required: false, unitDetail: true, aliases: ['Year'] },
  engineHours:     { key: 'engine_hours',      label: 'Engine hours',      required: false, unitDetail: true, aliases: ['Engine Hours', 'Hours'] },
  // Not a bare "Type": in a work-order export that can be the job's type, not the unit's.
  unitType:        { key: 'unit_type',         label: 'Unit type',         required: false, unitDetail: true, aliases: ['Unit Type', 'Equipment Type', 'Asset Type', 'Vehicle Type'] },
} as const satisfies Record<string, ImportColumn>

// ── Sales journal invoice export (src/app/api/hd/import/invoices/route.ts) ─────────────
// Read exactly as written, case included: the route reads row['CLIENT'], row['INV NO'] ...
// This format reads NO unit column, so an invoice import never attaches to a unit.
export const INVOICES = {
  invoiceNumber: { key: 'work_order_number', label: 'Work order number', required: true,  aliases: ['INV NO'] },
  customer:      { key: 'customer',          label: 'Customer',          required: true,  aliases: ['CLIENT'] },
  invoiceDate:   { key: 'service_date',      label: 'Service date',      required: true,  aliases: ['INV DATE'] },
  total:         { key: 'total',             label: 'Total',             required: false, aliases: ['TOTAL'] },
  paid:          { key: 'amount_paid',       label: 'Amount paid',       required: false, aliases: ['PAID'] },
} as const satisfies Record<string, ImportColumn>

export const FULLBAY_COLUMNS: ImportFormatColumns = { match: 'alias', columns: Object.values(FULLBAY) }
export const INVOICE_COLUMNS: ImportFormatColumns = { match: 'exact', columns: Object.values(INVOICES) }

// ── Custom fleet-unit CSV (src/app/api/hd/import/analyze/route.ts) ─────────────────────
// The fields a custom unit file can map to. Their headings come from the mapping the user
// reviews on screen, not from an alias list.
export const UNIT_FIELDS = [
  { key: 'unit_number',   label: 'Unit Number',        required: true  },
  { key: 'manufacturer',  label: 'Manufacturer / Make', required: true  },
  { key: 'model',         label: 'Model',               required: false },
  { key: 'year',          label: 'Year',                required: false },
  { key: 'serial_number', label: 'Serial / VIN',        required: false },
  { key: 'engine_hours',  label: 'Engine Hours',        required: false },
  { key: 'total_hours',   label: 'Total Hours / SMH',   required: false },
  { key: 'fleet_name',    label: 'Fleet / Customer',    required: false },
  { key: 'unit_type',     label: 'Equipment type (matches a category name)', required: false },
  { key: 'notes',         label: 'Notes',               required: false },
] as const

// ── Reading a row (the routes) ──────────────────────────────────────────────────────────

/**
 * Flexible column lookup - the Fullbay route's own function, moved here unchanged.
 * Case-insensitive, ends trimmed, first alias present wins. A heading that is present with
 * an empty cell returns '' and does NOT fall through to the next alias.
 */
export function col(row: Record<string, string | undefined>, ...keys: readonly string[]): string {
  for (const k of keys) {
    const found = Object.entries(row).find(
      ([h]) => h.toLowerCase().trim() === k.toLowerCase().trim()
    )?.[1]
    if (found !== undefined) return found.trim()
  }
  return ''
}

/** The invoice route's lookup: the heading exactly as written (row['CLIENT']). */
export function exactCell(row: Record<string, string | undefined>, column: ImportColumn): string | undefined {
  return row[column.aliases[0]]
}

// ── The file (the wizard) ───────────────────────────────────────────────────────────────

export interface ParsedCSV {
  headers: string[]
  rows: string[][]
}

/** The wizard's CSV parser, moved here unchanged so the pre-flight tests read files exactly as the wizard does. */
export function parseCSV(text: string): ParsedCSV {
  // Normalize line endings, strip BOM
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = clean.split('\n')
  if (lines.length === 0) return { headers: [], rows: [] }

  function parseLine(line: string): string[] {
    const cells: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = !inQ
      } else if (ch === ',' && !inQ) {
        cells.push(cur.trim()); cur = ''
      } else {
        cur += ch
      }
    }
    cells.push(cur.trim())
    return cells
  }

  const nonEmpty = lines.filter(l => l.trim())
  if (nonEmpty.length === 0) return { headers: [], rows: [] }

  const headers = parseLine(nonEmpty[0])
  const rows    = nonEmpty.slice(1).map(parseLine)
  return { headers, rows }
}

// ── The pre-flight check ────────────────────────────────────────────────────────────────

export interface PreflightField { key: string; label: string; required: boolean; unitDetail?: boolean }

export interface Preflight {
  /** Each field the file supplies, and the heading the importer will read it from. */
  recognized: Array<{ field: PreflightField; header: string }>
  /** Every heading in the file the importer reads for nothing. */
  unrecognized: Array<{ header: string; note: string | null }>
  /** Every field the importer looks for that the file has no heading for. */
  missing: PreflightField[]
  missingRequired: PreflightField[]
  missingOptional: PreflightField[]
  blocked: boolean
}

/**
 * The heading the importer will read a column from, by the importer's own rule: the first
 * alias (in order) that some heading matches, and among headings the first in the file -
 * exactly what `col()` does for 'alias' and `row[alias]` does for 'exact'.
 */
export function headerFor(headers: readonly string[], column: ImportColumn, match: HeaderMatch): string | null {
  for (const alias of column.aliases) {
    const found = match === 'exact'
      ? headers.find(h => h === alias)
      : headers.find(h => h.toLowerCase().trim() === alias.toLowerCase().trim())
    if (found !== undefined) return found
  }
  return null
}

function settle(
  headers: readonly string[],
  recognized: Preflight['recognized'],
  fields: readonly PreflightField[],
  noteFor: (header: string) => string | null,
): Preflight {
  const used = new Set(recognized.map(r => r.header))
  const have = new Set(recognized.map(r => r.field.key))
  const missing = fields.filter(f => !have.has(f.key))
  const missingRequired = missing.filter(f => f.required)
  return {
    recognized,
    unrecognized: headers.filter(h => !used.has(h)).map(h => ({ header: h, note: noteFor(h) })),
    missing,
    missingRequired,
    missingOptional: missing.filter(f => !f.required),
    blocked: missingRequired.length > 0,
  }
}

/** Pre-flight for a format with a heading table (Fullbay, invoices). */
export function preflightColumns(headers: readonly string[], format: ImportFormatColumns): Preflight {
  const recognized: Preflight['recognized'] = []
  for (const column of format.columns) {
    const header = headerFor(headers, column, format.match)
    if (header !== null) recognized.push({ field: column, header })
  }
  const used = new Set(recognized.map(r => r.header))
  // A heading that is an alias of a field already read from an earlier alias is ignored by
  // the importer, and is said so rather than called unknown.
  const noteFor = (h: string) => {
    if (used.has(h)) return null
    const column = format.columns.find(c => c.aliases.some(a => format.match === 'exact' ? a === h : a.toLowerCase().trim() === h.toLowerCase().trim()))
    if (!column) return null
    const winner = recognized.find(r => r.field.key === column.key)
    return winner ? `${column.label} is read from "${winner.header}" instead` : null
  }
  return settle(headers, recognized, format.columns, noteFor)
}

/** Pre-flight for the custom unit format: the headings the user mapped, by the mapping on screen. */
export function preflightMapping(
  headers: readonly string[],
  mapping: ReadonlyArray<{ csv_header: string; field_key: string | null }>,
  fields: readonly PreflightField[],
): Preflight {
  const recognized: Preflight['recognized'] = []
  for (const m of mapping) {
    const field = m.field_key ? fields.find(f => f.key === m.field_key) : undefined
    if (field && headers.includes(m.csv_header) && !recognized.some(r => r.field.key === field.key)) {
      recognized.push({ field, header: m.csv_header })
    }
  }
  return settle(headers, recognized, fields, () => null)
}

/**
 * The words on the blocked screen. A work order import (Fullbay, invoices) says exactly what
 * Brock wrote (Nov 23, 2026). A unit file is not a work order export, so it gets the first
 * sentence only - telling someone to "export your work orders" for a unit list would be wrong.
 */
export function missingColumnsMessage(missingRequired: readonly PreflightField[], kind: 'work_orders' | 'units' = 'work_orders'): string {
  const first = `This file is missing columns the import needs: ${missingRequired.map(f => f.label).join(', ')}.`
  if (kind === 'units') return first
  return `${first} ` +
    'Without a unit number, repairs will not attach to any unit and the unit\'s history will be empty. ' +
    'Export your work orders (not customers) with these columns and try again.'
}
