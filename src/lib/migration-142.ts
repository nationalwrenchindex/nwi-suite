// ─── Surviving a deploy that lands before migration 142 is run ────────────────
//
// WHY THIS EXISTS. Migrations in this project are applied BY HAND in the Supabase
// SQL editor, and code deploys independently. So there is always a window where
// the code knows about a column the database has never heard of, and in that
// window every write that mentions it fails with PGRST204 / "could not find the
// 'x' column of 'y' in the schema cache".
//
// Generalises the pattern src/lib/tax.ts established for tax_breakdown
// (isMissingTaxBreakdownColumn / withoutTaxBreakdown) to the whole of migration
// 142, because 142 adds columns to six tables at once and hand-writing a retry
// per call site is how one gets missed.
//
// THE CONTRACT. A retry drops the new columns and writes the row WITHOUT them.
// That is correct and deliberate: the document saves, the money is right, and
// the only thing lost is the new metadata — which is better than refusing to
// save a tech's work because a migration has not been run yet. Once 142 is
// applied, the first write is a normal one and this never fires again.

/** Every column migration 142 adds. Order is for readability only. */
export const MIGRATION_142_COLUMNS = [
  // Billable extras, on all six document tables
  'travel_hours', 'travel_rate', 'travel_amount',
  'mileage_miles', 'mileage_rate', 'mileage_amount',
  'shop_supplies_percent_applied', 'shop_supplies_cap_applied', 'shop_supplies_fee',
  // Identity and notes
  'unit_number', 'internal_notes',
  // The pricing terms an invoice could not previously record
  'parts_markup_percent', 'parts_subtotal', 'parts_cost_total',
  'labor_subtotal', 'labor_hours', 'labor_rate',
  // NOTE: hd_quotes.customer_id is also added by 142 and is deliberately NOT in
  // this list. `invoices.customer_id` and `hd_invoices.customer_id` have existed
  // since migrations 001 and 118, so stripping the name globally would drop the
  // customer link off an LD invoice on any retry — turning a cosmetic degradation
  // into exactly the orphan this run is trying to eliminate. The hd_quotes write
  // path guards that one column on its own.
  // profiles pricing defaults
  'bill_travel', 'travel_rate_per_hour',
  'bill_mileage', 'mileage_rate_per_mile',
  'bill_shop_supplies', 'shop_supplies_percent', 'shop_supplies_cap',
] as const

type Col = (typeof MIGRATION_142_COLUMNS)[number]

/**
 * Does this error say a column does not exist, and is it one of ours?
 *
 * Deliberately narrow. It matches only the named columns, so a genuine typo in
 * some unrelated column name still surfaces as an error rather than being
 * silently retried into a partial write.
 */
export function missingMigration142Column(error: unknown): Col | null {
  if (!error || typeof error !== 'object') return null
  const e = error as { message?: unknown; code?: unknown; details?: unknown }
  const text = [e.message, e.details].map(v => String(v ?? '')).join(' ').toLowerCase()

  const looksMissing =
    text.includes('does not exist') ||
    text.includes('could not find') ||
    text.includes('schema cache') ||
    String(e.code ?? '') === 'PGRST204' ||
    String(e.code ?? '') === '42703'
  if (!looksMissing) return null

  // Longest name first, so 'shop_supplies_percent_applied' is not shadowed by
  // 'shop_supplies_percent'.
  const byLength = [...MIGRATION_142_COLUMNS].sort((a, b) => b.length - a.length)
  for (const c of byLength) if (text.includes(c)) return c
  return null
}

/** Strip every migration-142 column from a row so the write can be retried. */
export function withoutMigration142Columns<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row }
  for (const c of MIGRATION_142_COLUMNS) delete copy[c]
  return copy
}

/**
 * Run a write; if it fails only because migration 142 has not been applied,
 * run it again without those columns.
 *
 * `write` is called with the row to use, so the caller keeps ownership of the
 * query. It returns the Supabase-shaped { data, error } so the caller's existing
 * error handling is unchanged.
 */
export async function writeToleratingMigration142<T extends Record<string, unknown>, R>(
  row: T,
  // PromiseLike, not Promise: a Supabase PostgrestBuilder is thenable but is not a
  // Promise, so typing this as Promise rejects every real call site.
  write: (r: T) => PromiseLike<{ data: R | null; error: unknown }>,
): Promise<{ data: R | null; error: unknown; degraded: boolean }> {
  const first = await write(row)
  if (!first.error) return { ...first, degraded: false }

  const missing = missingMigration142Column(first.error)
  if (!missing) return { ...first, degraded: false }

  console.warn(
    `[migration-142] '${missing}' is not in the database yet — retrying the write without ` +
    `the 142 columns. Apply supabase/migrations/142_billable_extras_and_document_self_containment.sql.`,
  )
  const second = await write(withoutMigration142Columns(row))
  return { ...second, degraded: true }
}
