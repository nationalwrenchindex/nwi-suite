// ─── A customer's name, as typed ──────────────────────────────────────────────
//
// NEVER INVENT A SURNAME. "Jesus" is stored as first name "Jesus" and an empty last
// name, and prints as "Jesus". Five paths used to make one up - QuickWrench and its
// save route, the quote editor's save, the phone agent and the CSV import stored
// "Jesus Unknown", "Walk-up Customer" and the like - and every document the customer
// then received addressed them by it.
//
// customers.last_name is NOT NULL (001), so "no surname" is the empty string.

export interface SplitName { first_name: string; last_name: string }

/** First word is the first name, the rest the surname - '' when there is none. Null for a blank name. */
export function splitCustomerName(full: string | null | undefined): SplitName | null {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return null
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') }
}

/** The name as it prints: both parts, or the first alone. */
export function customerDisplayName(c: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  return [c?.first_name, c?.last_name].map(s => (s ?? '').trim()).filter(Boolean).join(' ')
}
