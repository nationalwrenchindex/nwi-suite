import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

/**
 * Work order numbers: WO-YYYY-NNNN, one sequence per account, for both `work_orders`
 * (LD) and `hd_work_orders` (HD).
 *
 * THE NEXT NUMBER IS THE HIGHEST EXISTING SEQUENCE PLUS ONE, NEVER THE ROW COUNT. A
 * count collides as soon as an account has a gap - a deleted work order, or history
 * imported with no number - and from then on the account cannot save a work order at
 * all. On Nov 2 the founder's LD account had 26 work orders, skipped WO-2026-0022 and
 * held WO-2026-0028, so its second new save asked for 0028 and failed on the unique key.
 *
 * The sequence runs across years, as the count did: WO-2027-NNNN carries on from the
 * last 2026 number instead of restarting. A number in any other shape (imported history
 * numbered INV1234) is not part of the sequence and is ignored.
 *
 * Two saves at once can still read the same highest number. The UNIQUE (user_id,
 * work_order_number) constraint refuses the second insert, and
 * insertWithWorkOrderNumber reads the highest again and retries, so the loser takes the
 * next number instead of failing. hd_work_orders gets that constraint in migration 176;
 * work_orders has had it since 135.
 */

const SEQUENCE = /^WO-\d{4}-(\d+)$/
const UNIQUE_VIOLATION = '23505'
const ATTEMPTS = 5

export type WorkOrderTable = 'work_orders' | 'hd_work_orders'

/** The number after the highest WO-YYYY-NNNN in `existing`, dated `year`. */
export function nextWorkOrderNumber(
  existing: ReadonlyArray<string | null | undefined>,
  year: number,
): string {
  let highest = 0
  for (const n of existing) {
    const m = SEQUENCE.exec(String(n ?? '').trim())
    if (m) highest = Math.max(highest, Number(m[1]))
  }
  return `WO-${year}-${String(highest + 1).padStart(4, '0')}`
}

/**
 * True only for a clash on the work order NUMBER. Other unique keys on these tables
 * (one HD work order per quote) mean something else and must not be retried.
 */
export function isWorkOrderNumberCollision(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; details?: unknown } | null
  if (!e || e.code !== UNIQUE_VIOLATION) return false
  return /work_order_number/.test(`${e.message ?? ''} ${e.details ?? ''}`)
}

/** The next free number for this account, read from every WO- number it holds. */
export async function allocateWorkOrderNumber(
  supabase: SupabaseClient,
  table: WorkOrderTable,
  userId: string,
): Promise<string> {
  const rows = await fetchAllRows<{ work_order_number: string | null }>((from, to) =>
    supabase
      .from(table)
      .select('work_order_number')
      .eq('user_id', userId)
      .like('work_order_number', 'WO-%')
      .order('id', { ascending: true })
      .range(from, to))
  return nextWorkOrderNumber(rows.map(r => r.work_order_number), new Date().getFullYear())
}

/**
 * Inserts with a freshly allocated number, and on a number collision allocates again
 * and retries. `insert` is called with the number to use and returns the insert result.
 * Any other error is handed back on the first attempt, untouched.
 */
export async function insertWithWorkOrderNumber<R extends { error: unknown }>(
  supabase: SupabaseClient,
  table: WorkOrderTable,
  userId: string,
  insert: (workOrderNumber: string) => PromiseLike<R>,
): Promise<R> {
  let result = await insert(await allocateWorkOrderNumber(supabase, table, userId))
  for (let attempt = 1; attempt < ATTEMPTS && isWorkOrderNumberCollision(result.error); attempt++) {
    result = await insert(await allocateWorkOrderNumber(supabase, table, userId))
  }
  return result
}
