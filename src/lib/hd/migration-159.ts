// Surviving a deploy that lands before migration 159 is run.
//
// 159 adds the fee and unit columns to hd_work_orders that hd_quotes and hd_invoices
// already have. Migrations are applied by hand, so until it is, a work-order write
// that names one of these fails with PGRST204 / 42703.
//
// HD_WORK_ORDERS ONLY. Every one of these names already exists on hd_quotes and
// hd_invoices, so this list must never be fed into a write against those tables -
// stripping road_call_fee off an invoice because some other column was missing is
// exactly the dropped-fee bug 159 exists to fix. That is why this is its own module
// rather than another group in src/lib/migration-142.ts, whose lists are stripped
// from every document table.

export const MIGRATION_159_WO_COLUMNS = [
  'diagnostic_fee', 'road_call_fee',
  'unit_year', 'truck_make', 'truck_model', 'truck_year', 'vin',
] as const

/** True when a write failed only because migration 159 has not been applied. */
export function isMissingMigration159Column(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { message?: unknown; code?: unknown; details?: unknown }
  const text = [e.message, e.details].map(v => String(v ?? '')).join(' ').toLowerCase()
  const looksMissing =
    text.includes('does not exist') ||
    text.includes('could not find') ||
    text.includes('schema cache') ||
    String(e.code ?? '') === 'PGRST204' ||
    String(e.code ?? '') === '42703'
  return looksMissing && MIGRATION_159_WO_COLUMNS.some(c => text.includes(c))
}

/** The row without any migration-159 column, for the retry. */
export function withoutMigration159Columns<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row }
  for (const c of MIGRATION_159_WO_COLUMNS) delete copy[c]
  return copy
}
