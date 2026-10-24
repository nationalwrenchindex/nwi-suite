// The labor library's pick and search rules, as one set the quote form, QuickWrench,
// the repair-items route and the smoke suite all read.
//
// BILLED HOURS COME FROM FIELD TIME ONLY (Oct 24). The quote bills field (mobile) time,
// so a shop figure filled into the billed field silently underbills a job done in a
// parking lot. A card with field time fills it (both ends when it is a range); a card
// with only shop time leaves the field BLANK, and the form says so and offers a button
// that bills the shop figure when pressed. A 0 counts as missing: "test labor" was
// saved with mobile 0 and a pick once priced it at 0 hrs x $135.00 = $0.00.

const positive = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** The billed-hours pre-fill for a pick: the field figure, else ''. Never shop time. */
export function billedHoursFromLibrary(mobileHours: number | string | null | undefined): string {
  const h = positive(mobileHours)
  return h == null ? '' : String(h)
}

/** The field range's high end when it is above the low, else ''. */
export function billedHighFromLibrary(
  mobileHours: number | string | null | undefined,
  mobileHoursHigh: number | string | null | undefined,
): string {
  const lo = positive(mobileHours)
  const hi = positive(mobileHoursHigh)
  return lo != null && hi != null && hi > lo ? String(hi) : ''
}

/** Shop time as reference text: "Shop: 3 hr", "Shop: 3 to 4 hr", or ''. */
export function shopReferenceText(
  shopHours: number | string | null | undefined,
  shopHoursHigh?: number | string | null,
): string {
  const lo = positive(shopHours)
  if (lo == null) return ''
  const hi = positive(shopHoursHigh)
  return hi != null && hi > lo ? `Shop: ${lo} to ${hi} hr` : `Shop: ${lo} hr`
}

// ── Search ──────────────────────────────────────────────────────────────────
//
// The picker searches on the server, never on a capped list in the browser. The
// search text is matched as typed: % and _ are LIKE wildcards, so they are escaped,
// and the pattern goes inside a double-quoted PostgREST value so a comma or a bracket
// in the text cannot break the or() filter. Inside the quotes PostgREST reads \\ as one
// backslash, which is what LIKE then needs as its escape (checked against the live
// database on 2026-10-24: "%r\\&r%" matches R&R rows, "%r\\%r%" matches nothing).

export const MAX_SEARCH = 100

/** The text as a LIKE pattern with every wildcard escaped. */
export function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, c => `\\${c}`)
}

/** A LIKE pattern as a double-quoted PostgREST filter value. */
export function postgrestQuoted(pattern: string): string {
  return `"${pattern.replace(/[\\"]/g, c => `\\${c}`)}"`
}

/** The or() filter for "description or labor code contains the text". */
export function librarySearchFilter(q: string): string {
  const v = postgrestQuoted(`%${likeEscape(q)}%`)
  return `description.ilike.${v},labor_code.ilike.${v}`
}

/** A category list as a safe in() filter that also keeps rows with no category. */
export function libraryCategoryFilter(categories: string[]): string | null {
  const clean = categories.map(c => c.trim().toLowerCase()).filter(c => /^[a-z_]+$/.test(c))
  return clean.length ? `category.is.null,category.in.(${clean.join(',')})` : null
}

/** "Showing 8 of 23" when a result set was trimmed, else ''. One text node. */
export function trimmedNotice(shown: number, total: number): string {
  return total > shown ? `Showing ${shown} of ${total}. Keep typing to narrow it down.` : ''
}
