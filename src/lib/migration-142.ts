// ─── Surviving a deploy that lands before its migration is run ────────────────
//
// Named for 142 because that is where it started; it now covers 146 as well. The
// column lists are kept SEPARATE per migration, and a retry strips only the group
// the missing column belongs to - see withoutColumnsForMissing for why that matters
// the moment two migrations are pending at once.
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

/**
 * Columns added by migration 146, tolerated by the same machinery.
 *
 * Kept as its own named list rather than appended to the 142 one, so it stays clear
 * which migration a column is waiting on - the warning below names the file to run,
 * and naming the wrong one sends you to a migration that is already applied.
 *
 * One module rather than a second copy of this pattern: these functions are already
 * wired into every document write path, and a parallel migration-146.ts would mean
 * remembering to wrap each call site twice.
 */
export const MIGRATION_146_COLUMNS = [
  'source_work_order_id',
] as const

const TOLERATED_COLUMNS = [...MIGRATION_142_COLUMNS, ...MIGRATION_146_COLUMNS] as const

/** Which migration a tolerated column belongs to, for the warning message. */
function migrationFor(col: string): string {
  return (MIGRATION_146_COLUMNS as readonly string[]).includes(col)
    ? '146_invoice_source_work_order.sql'
    : '142_billable_extras_and_document_self_containment.sql'
}

type Col = (typeof TOLERATED_COLUMNS)[number]

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
  const byLength = [...TOLERATED_COLUMNS].sort((a, b) => b.length - a.length)
  for (const c of byLength) if (text.includes(c)) return c
  return null
}

/**
 * Strip every migration-142 column from a row so the write can be retried.
 *
 * Deliberately 142 ONLY, not every tolerated column. Several call sites invoke this
 * directly after a missing-column error, and if it also stripped 146's column those
 * paths would drop metadata for a migration that was never the problem.
 */
export function withoutMigration142Columns<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row }
  for (const c of MIGRATION_142_COLUMNS) delete copy[c]
  return copy
}

/**
 * Strip only the columns belonging to the migration the MISSING column came from.
 *
 * This matters as soon as there is more than one pending migration. 146 is not
 * applied yet while 142 is, so a conversion fails on source_work_order_id - and
 * stripping everything on that retry would throw away parts_markup_percent,
 * unit_number, labor_subtotal and the rest, silently downgrading an invoice because
 * of an unrelated column. One missing migration must only cost its own columns.
 */
export function withoutColumnsForMissing<T extends Record<string, unknown>>(
  row: T,
  missing: Col,
): T {
  const group: readonly string[] = (MIGRATION_146_COLUMNS as readonly string[]).includes(missing)
    ? MIGRATION_146_COLUMNS
    : MIGRATION_142_COLUMNS
  const copy = { ...row }
  for (const c of group) delete copy[c]
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
    `[pending-migration] '${missing}' is not in the database yet - retrying the write ` +
    `without it. Apply supabase/migrations/${migrationFor(missing)}.`,
  )
  const second = await write(withoutColumnsForMissing(row, missing))
  return { ...second, degraded: true }
}
