import type { PostgrestError } from '@supabase/supabase-js'

/**
 * PostgREST caps every response at `db-max-rows` (1,000 on this project), and it
 * does so silently — you get 1,000 rows and a 200, not an error. Any query that
 * feeds a total, an export, or a cron sweep must therefore page until the table
 * is exhausted, or it quietly under-reports once a tenant crosses the cap.
 *
 * Aggregate functions are NOT an option here: this project's PostgREST returns
 * `PGRST123: Use of aggregate functions is not allowed`, so `.select('total.sum()')`
 * would 400 at runtime. For a plain row count prefer `{ count: 'exact', head: true }`,
 * which is cheap and needs no paging; reach for this helper when you need the rows.
 */

const PAGE_SIZE = 1000

type PageResult<T> = { data: T[] | null; error: PostgrestError | null }

/**
 * Runs `buildPage` with successive `.range()` windows until a short page comes
 * back, and returns every row.
 *
 * `buildPage` MUST apply BOTH `.range(from, to)` AND a deterministic `.order()`.
 * The ordering is not cosmetic and not optional: `.range()` is a LIMIT/OFFSET window,
 * and Postgres guarantees no row order without an ORDER BY, so paging an unordered
 * query can hand back one row twice and never show another — silently corrupting the
 * very totals this helper exists to make correct.
 *
 * A date column alone is NOT a total order either: ties are free to shuffle between
 * windows, so pair it with a unique tiebreaker, e.g.
 *   .order('invoice_date', { ascending: false }).order('id', { ascending: true })
 *
 * Throws on the first PostgREST error so callers surface a failure instead of
 * silently returning a truncated list, which is the bug this helper exists to fix.
 */
export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = []

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildPage(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    rows.push(...data)

    // A short page means we reached the end; a full page means there may be more.
    if (data.length < pageSize) break
  }

  return rows
}
