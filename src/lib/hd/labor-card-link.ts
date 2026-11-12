// SERVER ONLY. The labor card a work order line came from (migration 187,
// hd_work_order_line_items.repair_item_id).
//
// The id arrives from the client (the ADD LABOR LINE modal) or out of a quote's
// line_items JSON, so it is CHECKED before it is stored: it must be a card this shop can
// use - its own, or an NWI catalog card. Anything else is dropped to NULL, never
// refused: a bad link must not cost the tech his line. The labor guide will learn hours
// from these links, so a link to another shop's card would teach one shop's card from
// another shop's work.
//
// Code deploys before 187 is applied, so every write and read here falls back to the
// old shape when the column is missing.

import type { SupabaseClient } from '@supabase/supabase-js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

/** True when an error is PostgREST / Postgres saying repair_item_id does not exist yet. */
export function isMissingRepairItemColumn(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null
  if (!e) return false
  return (e.code === '42703' || e.code === 'PGRST204') && /repair_item_id/.test(String(e.message ?? ''))
}

/**
 * The subset of `ids` that are cards `ownerId` may link to: its own, or the catalog's.
 * Read with the service role or the owner's client alike - the filter is explicit.
 */
export async function usableCardIds(supabase: SupabaseClient, ownerId: string, ids: unknown[]): Promise<Set<string>> {
  const want = [...new Set(ids.filter(isUuid))]
  if (want.length === 0) return new Set()
  const { data, error } = await supabase
    .from('hd_repair_items')
    .select('id, user_id, is_master')
    .in('id', want)
  if (error || !data) return new Set()
  return new Set(
    (data as Array<{ id: string; user_id: string | null; is_master: boolean | null }>)
      .filter(r => r.is_master === true || r.user_id === ownerId)
      .map(r => r.id),
  )
}

/** Rows without the column, for a database where 187 is not applied yet. */
export function withoutRepairItem<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map(r => { const { repair_item_id: _drop, ...rest } = r; void _drop; return rest as T })
}
