// ─── Fleet Pro — paging an id-scoped read ─────────────────────────────────────
// SERVER-ONLY. Pairs with @/lib/supabase/fetch-all: that helper walks one query's
// `.range()` windows to exhaustion, this one adds the second limit every Fleet Pro
// rollup runs into.
//
// TWO CEILINGS, NOT ONE:
//   1. PostgREST answers at most 1,000 rows and still returns 200, so any query
//      feeding a money total has to be paged — that is fetchAllRows' job.
//   2. `.in()` travels in the URL query string. Once the parent query (units,
//      fleet accounts) is itself paged, its id list is no longer capped at 1,000,
//      and a few hundred UUIDs is already enough to blow the URL length limit —
//      which on this stack surfaces as a fetch failure, i.e. a silently zeroed
//      cost panel, not an obvious error.
//
// So the id list is chunked and each chunk is paged. Chunks run in SEQUENCE: the
// callers already fan several of these out concurrently through Promise.all, and
// multiplying that by a per-chunk fan-out would turn one dashboard load into
// hundreds of simultaneous requests.

import { fetchAllRows } from '@/lib/supabase/fetch-all'
import type { PostgrestError } from '@supabase/supabase-js'

/** UUIDs are 36 chars plus a separator, so 200 ids is a ~7.5 KB query string. */
export const ID_CHUNK = 200

type PageResult<T> = { data: T[] | null; error: PostgrestError | null }

/** Split a list into fixed-size slices, preserving order. */
export function chunkIds<T>(items: readonly T[], size: number = ID_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Run an `.in()`-scoped query over every id, paging each chunk to exhaustion, and
 * return the concatenated rows.
 *
 * `buildPage` MUST apply `.in(column, ids)`, `.range(from, to)` AND a deterministic
 * `.order()` with a unique tiebreaker — see the contract on fetchAllRows. Throws on
 * the first PostgREST error, exactly as fetchAllRows does, so a caller that used to
 * degrade to an empty list must catch.
 */
export async function fetchAllRowsForIds<TRow, TId>(
  ids: readonly TId[],
  buildPage: (ids: TId[], from: number, to: number) => PromiseLike<PageResult<TRow>>,
  chunkSize: number = ID_CHUNK,
): Promise<TRow[]> {
  if (ids.length === 0) return []

  const rows: TRow[] = []
  for (const slice of chunkIds(ids, chunkSize)) {
    rows.push(...await fetchAllRows<TRow>((from, to) => buildPage(slice, from, to)))
  }
  return rows
}
