// Sort, filter, range and format helpers for the Financials "By Equipment" view, as
// PURE functions.
//
// Spec: docs/KURT-EQUIPMENT-TRACKING-SPEC.md section 5. Every figure on the screen comes
// from equipment-rollup.ts (rollupByCategory / rollupByUnit). Nothing here adds money up
// or recomputes it - this file only decides ORDER, WHICH ROWS and HOW A VALUE PRINTS, so
// the screen cannot drift from the audit exports that read the same rollup.
//
// THE PRINTING RULES THIS FILE HOLDS
//
//   * UNKNOWN IS NOT ZERO. A PartialSum whose value is null prints "-", never "$0" or
//     "0.0 h" - an imported job with no hours did not take no time.
//   * A PARTIAL SUM SAYS SO. When `missing` > 0 the figure carries a dagger and a note
//     ("3 jobs not recorded"), so a sum over some of the jobs is never read as all.
//   * UNKNOWN SORTS LAST, in either direction. Sorting "collected" ascending must not
//     put the units nobody knows about at the top as if they had collected nothing.

import type { CategoryRollup, DateRange, PartialSum, Totals, UnitRollup } from './equipment-rollup'

// ─── Date range ─────────────────────────────────────────────────────────────

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a real calendar date written YYYY-MM-DD (2026-02-30 is not one). */
export function isYmd(s: string | null | undefined): s is string {
  const m = YMD.exec(String(s ?? ''))
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/** Today's date on the shop's calendar, YYYY-MM-DD. */
export function shopToday(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** January 1 to today, in the shop's time zone - the view's default range. */
export function currentYearRange(timeZone: string, now: Date = new Date()): DateRange {
  const today = shopToday(timeZone, now)
  return { from: `${today.slice(0, 4)}-01-01`, to: today }
}

/** The longest range the view will roll up. Past this the request is refused, not cut. */
export const MAX_RANGE_YEARS = 3

function addYears(d: string, n: number): string {
  const [y, m, day] = d.split('-').map(Number)
  const t = new Date(Date.UTC(y + n, m - 1, day))
  return t.toISOString().slice(0, 10)
}

export type RangeResult = { ok: true; range: DateRange } | { ok: false; error: string }

/**
 * Validate a from/to pair off the query string. Both absent means the current year in
 * the shop's zone; one absent is an error rather than a guess. Inclusive dates; the
 * span may cover at most MAX_RANGE_YEARS (2024-01-01 to 2026-12-31 is allowed,
 * 2024-01-01 to 2027-01-01 is not).
 */
export function parseRange(from: string | null, to: string | null, timeZone: string, now: Date = new Date()): RangeResult {
  if (!from && !to) return { ok: true, range: currentYearRange(timeZone, now) }
  if (!from || !to) return { ok: false, error: 'from and to must both be given, as YYYY-MM-DD' }
  if (!isYmd(from) || !isYmd(to)) return { ok: false, error: 'from and to must be real dates, YYYY-MM-DD' }
  if (from > to) return { ok: false, error: 'from must not be after to' }
  if (to >= addYears(from, MAX_RANGE_YEARS)) return { ok: false, error: `the range may cover at most ${MAX_RANGE_YEARS} years` }
  return { ok: true, range: { from, to } }
}

// ─── Unit table: filter ─────────────────────────────────────────────────────

export const ALL = '__all__'
/** Fleet filter value for units with no fleet account. */
export const NO_FLEET = '__no_fleet__'

export interface UnitFilter { categoryKey: string; fleetId: string }
export const DEFAULT_FILTER: UnitFilter = { categoryKey: ALL, fleetId: ALL }

export function filterUnits(rows: UnitRollup[], f: UnitFilter): UnitRollup[] {
  return rows.filter(r =>
    (f.categoryKey === ALL || r.categoryKey === f.categoryKey) &&
    (f.fleetId === ALL || (f.fleetId === NO_FLEET ? r.fleetAccountId == null : r.fleetAccountId === f.fleetId)))
}

export interface Option { value: string; label: string }

/** The category filter: every category any unit row is in, in the category table's order. */
export function categoryOptions(units: UnitRollup[], categories: CategoryRollup[]): Option[] {
  const present = new Set(units.map(u => u.categoryKey))
  return categories.filter(c => present.has(c.key)).map(c => ({ value: c.key, label: c.name }))
}

/** The fleet filter: fleets the unit rows belong to, by name, then "No fleet account". */
export function fleetOptions(units: UnitRollup[]): Option[] {
  const byId = new Map<string, string>()
  let none = false
  for (const u of units) {
    if (u.fleetAccountId == null) none = true
    else if (!byId.has(u.fleetAccountId)) byId.set(u.fleetAccountId, u.fleetName ?? 'Unnamed fleet')
  }
  const opts = [...byId].map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value))
  if (none) opts.push({ value: NO_FLEET, label: 'No fleet account' })
  return opts
}

// ─── Unit table: sort ───────────────────────────────────────────────────────

export type UnitSortKey = 'unit' | 'category' | 'fleet' | 'jobs' | 'laborHours' | 'invoiced' | 'collected' | 'lastService'
export type SortDir = 'asc' | 'desc'
export interface UnitSort { key: UnitSortKey; dir: SortDir }

/** "Which pieces of equipment get worked on most" - the spec's default. */
export const DEFAULT_SORT: UnitSort = { key: 'jobs', dir: 'desc' }

/** The direction a column sorts in on its first click: numbers and dates high first. */
export function firstDir(key: UnitSortKey): SortDir {
  return key === 'unit' || key === 'category' || key === 'fleet' ? 'asc' : 'desc'
}

/** The sort after a header click: same column flips, a new column starts at firstDir. */
export function nextSort(cur: UnitSort, key: UnitSortKey): UnitSort {
  return cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: firstDir(key) }
}

/** How a unit is named on screen: its number, else make/model, else serial. */
export function unitLabel(u: Pick<UnitRollup, 'unitNumber' | 'manufacturer' | 'model' | 'serial'>): string {
  const n = (u.unitNumber ?? '').trim()
  if (n) return n
  const mm = [u.manufacturer, u.model].filter(Boolean).join(' ').trim()
  if (mm) return mm
  return u.serial ? `S/N ${u.serial}` : 'Unit (no number)'
}

type SortVal = string | number | null

function valueOf(u: UnitRollup, key: UnitSortKey): SortVal {
  switch (key) {
    case 'unit':        return unitLabel(u).toLowerCase()
    case 'category':    return u.categoryName.toLowerCase()
    case 'fleet':       return u.fleetName == null ? null : u.fleetName.toLowerCase()
    case 'jobs':        return u.jobs
    case 'laborHours':  return u.laborHours.value
    case 'invoiced':    return u.invoiced
    case 'collected':   return u.collected.value
    case 'lastService': return u.lastServiceDate
  }
}

function cmp(a: SortVal, b: SortVal): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'en-US', { numeric: true })
}

/**
 * Sorted copy. Unknown values (null) go last in BOTH directions. Ties break the same
 * way every time - jobs desc, then invoiced desc, then unit label asc, then unit id -
 * so the table never reshuffles rows with equal figures between renders.
 */
export function sortUnits(rows: UnitRollup[], s: UnitSort = DEFAULT_SORT): UnitRollup[] {
  const sign = s.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const va = valueOf(a, s.key), vb = valueOf(b, s.key)
    if (va == null && vb != null) return 1
    if (vb == null && va != null) return -1
    if (va != null && vb != null) {
      const c = cmp(va, vb)
      if (c !== 0) return sign * c
    }
    return (b.jobs - a.jobs)
      || (b.invoiced - a.invoiced)
      || cmp(unitLabel(a).toLowerCase(), unitLabel(b).toLowerCase())
      || cmp(a.unitId, b.unitId)
  })
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export const DASH = '-'
/** Marks a figure summed over only some of its jobs. Explained in the view's legend. */
export const DAGGER = '†'

export function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `-$${s}` : `$${s}`
}

export function fmtHoursValue(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH
  return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
}

export interface Cell { text: string; partial: boolean; note: string | null }

/** "n job(s) not recorded", or null when every job had the figure. */
export function missingNote(missing: number): string | null {
  if (!missing) return null
  return `${missing} job${missing === 1 ? '' : 's'} not recorded`
}

/**
 * A PartialSum as a cell. null prints "-" (and is not "partial": nothing was summed);
 * a value with missing > 0 is partial and carries the note for a tooltip / footnote.
 */
export function partialCell(p: PartialSum, kind: 'money' | 'hours'): Cell {
  const text = kind === 'money' ? fmtMoney(p.value) : fmtHoursValue(p.value)
  const partial = p.value != null && p.missing > 0
  return { text, partial, note: missingNote(p.missing) }
}

/** "3 from invoices, 2 from closed work orders" - where a row's jobs came from. */
export function sourceNote(t: Pick<Totals, 'jobsFromInvoices' | 'jobsFromWorkOrders'>): string {
  const parts: string[] = []
  if (t.jobsFromInvoices) parts.push(`${t.jobsFromInvoices} from invoice${t.jobsFromInvoices === 1 ? '' : 's'}`)
  if (t.jobsFromWorkOrders) parts.push(`${t.jobsFromWorkOrders} from closed work order${t.jobsFromWorkOrders === 1 ? '' : 's'}`)
  return parts.length ? parts.join(', ') : 'no jobs'
}

/** "2 inv / 1 WO" - the short form of sourceNote for a narrow cell. */
export function sourceBadge(t: Pick<Totals, 'jobsFromInvoices' | 'jobsFromWorkOrders'>): string {
  const parts: string[] = []
  if (t.jobsFromInvoices) parts.push(`${t.jobsFromInvoices} inv`)
  if (t.jobsFromWorkOrders) parts.push(`${t.jobsFromWorkOrders} WO`)
  return parts.join(' / ')
}

/** "Oct 17, 2026" for a YYYY-MM-DD shop date, never shifted by a zone. */
export function fmtDay(d: string | null | undefined): string {
  if (!isYmd(d)) return DASH
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day, 12)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** The audit export link for the range on screen. Track C's page reads from/to. */
export function auditHref(range: DateRange): string {
  return `/hd/reports/audit?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
}
