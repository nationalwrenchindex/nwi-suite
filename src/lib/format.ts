// ─── One money formatter ──────────────────────────────────────────────────────
// Every screen that shows a dollar amount goes through here. Before this existed
// there were four idioms in use — Intl currency, `$${n.toFixed(2)}`,
// `$${n.toFixed(0)}` and a bare `toLocaleString()` — so the same invoice read
// $561.89 on its own page and $562 on the dashboard.
//
// DISPLAY ONLY. Nothing in this file may be used to compute, accumulate or store
// a value. Rounding for presentation and rounding for arithmetic are different
// jobs: a total must be summed from the real amounts and rounded once at the end,
// never summed from figures that were already rounded for a screen.

const USD = new Intl.NumberFormat('en-US', {
  style:                 'currency',
  currency:              'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Coerces the shapes money arrives in. Supabase returns NUMERIC as a string, so a
 *  numeric column can reach a component as '561.89' rather than 561.89. */
function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * `$1,565.00`, `$561.89`, `-$12.50`.
 *
 * A null, undefined, empty or unparseable value renders `$0.00`. That is the right
 * default for a running total; where the distinction between "zero" and "not
 * recorded" matters to the reader, use `moneyOrDash`.
 */
export function money(value: number | string | null | undefined): string {
  return USD.format(toNumber(value) ?? 0)
}

/**
 * Same, but an absent value renders an em dash.
 *
 * Use this wherever $0.00 would be a claim rather than a fact — an unknown parts
 * cost, a margin that cannot be computed. Reporting a missing number as zero is
 * how a screen states something it does not know.
 */
export function moneyOrDash(value: number | string | null | undefined): string {
  const n = toNumber(value)
  return n === null ? '—' : USD.format(n)
}

/**
 * For values stored in cents (Stripe prices, detailer adjustments).
 *
 * The division happens here rather than at the call site so `/ 100` cannot drift
 * out of step with the formatting.
 */
export function moneyFromCents(cents: number | string | null | undefined): string {
  const n = toNumber(cents)
  return USD.format(n === null ? 0 : n / 100)
}

/** Thousands separators, no currency symbol and no forced decimals — counts of
 *  units, invoices, work orders. Here so callers stop reaching for a money
 *  formatter to print a count. */
export function count(value: number | string | null | undefined): string {
  const n = toNumber(value)
  return (n ?? 0).toLocaleString('en-US')
}
