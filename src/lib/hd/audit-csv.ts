// RFC 4180 CSV for the audit exports, and the policy-period parsing both routes share.
//
// PURE. The choices, written down because an auditor's spreadsheet is the reader:
//
//   * CRLF between records, a header row first, every field quoted only when it must be
//     (comma, double quote, CR or LF), double quotes doubled.
//   * NUMBERS ARE UNFORMATTED. 1234.5, never "$1,234.50" - a currency symbol or a
//     thousands separator turns a number into text in most spreadsheets.
//   * NULL IS AN EMPTY FIELD, never 0. Where an empty field could be misread as zero,
//     the export carries a separate count column saying how many jobs lacked the
//     figure (jobs_without_recorded_hours) or a yes/no "recorded" column
//     (approved_by_recorded) - only there, not on every column.
//   * Text that a spreadsheet would execute as a formula (a leading = + @, or a tab or
//     CR) is prefixed with a single quote. Numbers are never touched, so a negative
//     amount stays a number.

export type CsvValue = string | number | boolean | null | undefined

function cell(v: CsvValue): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  let s = String(v)
  if (/^[=+@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One CSV document. The header defines the column count; short rows are padded. */
export function toCsv(header: string[], rows: CsvValue[][]): string {
  const lines = [header.map(cell).join(',')]
  for (const r of rows) {
    const padded = header.map((_, i) => r[i])
    lines.push(padded.map(cell).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

/**
 * Parse a CSV produced by toCsv back into fields. Used by the tests to prove the
 * quoting round-trips; not a general-purpose parser.
 */
export function parseCsv(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = [], field = '', i = 0, quoted = false
  while (i < text.length) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue }
      if (ch === '"') { quoted = false; i++; continue }
      field += ch; i++; continue
    }
    if (ch === '"') { quoted = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\r' && text[i + 1] === '\n') { row.push(field); out.push(row); row = []; field = ''; i += 2; continue }
    field += ch; i++
  }
  if (field.length || row.length) { row.push(field); out.push(row) }
  return out
}

// ─── The policy period ──────────────────────────────────────────────────────

export const MAX_RANGE_YEARS = 3

export type RangeResult =
  | { ok: true; from: string; to: string }
  | { ok: false; error: string }

function isCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/** The shop's current calendar year, Jan 1 to Dec 31, from today's date in its zone. */
export function currentYearRange(todayLocal: string): { from: string; to: string } {
  const y = todayLocal.slice(0, 4)
  return { from: `${y}-01-01`, to: `${y}-12-31` }
}

/**
 * Validate ?from&to. Both absent = the current year. One absent, a malformed or
 * impossible date, from after to, or a span over three years is refused.
 */
export function parseRange(from: string | null | undefined, to: string | null | undefined, todayLocal: string): RangeResult {
  const f = (from ?? '').trim(), t = (to ?? '').trim()
  if (!f && !t) return { ok: true, ...currentYearRange(todayLocal) }
  if (!f || !t) return { ok: false, error: 'Both from and to are required (YYYY-MM-DD).' }
  if (!isCalendarDate(f)) return { ok: false, error: `"from" is not a valid date: ${f.slice(0, 20)}` }
  if (!isCalendarDate(t)) return { ok: false, error: `"to" is not a valid date: ${t.slice(0, 20)}` }
  if (f > t) return { ok: false, error: '"from" must not be after "to".' }
  // Three years from `from`: the same month and day, three years on, inclusive of the
  // day before. 2024-01-01 to 2026-12-31 is allowed; to 2027-01-01 is not.
  const limit = new Date(`${f}T12:00:00Z`)
  limit.setUTCFullYear(limit.getUTCFullYear() + MAX_RANGE_YEARS)
  limit.setUTCDate(limit.getUTCDate() - 1)
  if (t > limit.toISOString().slice(0, 10)) return { ok: false, error: `The period may be at most ${MAX_RANGE_YEARS} years.` }
  return { ok: true, from: f, to: t }
}

/** "audit-schedule-2026-01-01-to-2026-12-31.csv" - ASCII only, safe in a header. */
export function exportFilename(kind: string, from: string, to: string, ext: 'pdf' | 'csv'): string {
  return `${kind}-${from}-to-${to}.${ext}`.replace(/[^A-Za-z0-9._-]/g, '-')
}
