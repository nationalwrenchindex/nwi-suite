// npx tsx scripts/verify-work-order-number.ts
//
// Work order numbering (src/lib/work-order-number.ts). Pure: no database. The fixtures
// are the real number lists read from the database on Nov 2, 2026 - the founder's LD
// account (a gap at 0022, and 0028 out of sequence), the founder's HD account (imported
// INV-numbered history, then WO-2026-1526..1569) and C&K's HD account (1,740 imported
// work orders with no number, then WO-2026-0001..0007). The race runs two saves against
// an in-memory table that enforces the unique key the way Postgres does.

import type { SupabaseClient } from '@supabase/supabase-js'
import { nextWorkOrderNumber, isWorkOrderNumberCollision, insertWithWorkOrderNumber } from '../src/lib/work-order-number'
import { stateFrom, checkNextNumber, parseNextNumber, formatDocNumber } from '../src/lib/hd/document-number-start'

let failures = 0
let passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++
  else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}
const wo = (n: number, y = 2026) => `WO-${y}-${String(n).padStart(4, '0')}`

console.log('\nNext number = highest + 1, never the count')
const founderLd = [...Array.from({ length: 21 }, (_, i) => wo(i + 1)), wo(28), wo(23), wo(24), wo(25), wo(26)]
check('founder LD: 26 rows, highest 0028 -> WO-2026-0029 (count + 1 would be 0027, then 0028 collides)',
  founderLd.length === 26 && nextWorkOrderNumber(founderLd, 2026) === 'WO-2026-0029', nextWorkOrderNumber(founderLd, 2026))
const founderHd = ['INV5001262', 'INV10383', 'INV5001764 WARRANTY REPAI', ...Array.from({ length: 44 }, (_, i) => wo(1526 + i))]
check('founder HD: INV-numbered history ignored, highest 1569 -> WO-2026-1570',
  nextWorkOrderNumber(founderHd, 2026) === 'WO-2026-1570', nextWorkOrderNumber(founderHd, 2026))
const ck = [...Array(1740).fill(null), ...Array.from({ length: 7 }, (_, i) => wo(i + 1))]
check('C&K HD: 1,740 unnumbered rows ignored, highest 0007 -> WO-2026-0008',
  nextWorkOrderNumber(ck, 2026) === 'WO-2026-0008', nextWorkOrderNumber(ck, 2026))
check('no numbers at all -> WO-2026-0001', nextWorkOrderNumber([], 2026) === 'WO-2026-0001')
check('the sequence carries across years: highest WO-2026-0041 -> WO-2027-0042',
  nextWorkOrderNumber([wo(40), wo(41)], 2027) === 'WO-2027-0042')
check('compared as numbers, not text: WO-2026-9999 and WO-2026-10000 -> WO-2026-10001',
  nextWorkOrderNumber([wo(9999), 'WO-2026-10000'], 2026) === 'WO-2026-10001')
check('a near-miss shape is not part of the sequence (WO-2026-0050-B, WO-50)',
  nextWorkOrderNumber([wo(3), 'WO-2026-0050-B', 'WO-50'], 2026) === 'WO-2026-0004')

console.log('\nThe shop\'s starting number (Settings > Document numbers, HD floor)')
check('a floor above every number wins: highest 0007, floor 2846 -> WO-2026-2847',
  nextWorkOrderNumber(ck, 2026, 2846) === 'WO-2026-2847', nextWorkOrderNumber(ck, 2026, 2846))
check('a floor below the highest is ignored: highest 1569, floor 100 -> WO-2026-1570',
  nextWorkOrderNumber(founderHd, 2026, 100) === 'WO-2026-1570')
check('no numbers, floor 2846 -> WO-2026-2847', nextWorkOrderNumber([], 2026, 2846) === 'WO-2026-2847')
check('once the floor number is used, the next is above it: 2847 exists, floor 2846 -> 2848',
  nextWorkOrderNumber([wo(2847)], 2026, 2846) === 'WO-2026-2848')

console.log('\nForward only (lib/hd/document-number-start)')
{
  const inv = (n: number) => `INV-2026-${String(n).padStart(4, '0')}`
  const s = stateFrom('hd_invoice', [inv(1), inv(183), 'SMOKE-INV-1', inv(12)], 183)
  check('state: highest issued INV-2026-0183, next 184', s.next === 184 && s.highest?.number === 'INV-2026-0183')
  const r183 = checkNextNumber(s, 183)
  check('183 is refused, naming INV-2026-0183',
    !r183.ok && r183.error === 'You have already issued INV-2026-0183. The next number must be 184 or higher.', r183.ok ? 'accepted' : r183.error)
  check('1 is refused the same way', !checkNextNumber(s, 1).ok)
  check('184 (the current next) is accepted', checkNextNumber(s, 184).ok)
  check('2847 is accepted', checkNextNumber(s, 2847).ok)
  const deleted = stateFrom('hd_invoice', [inv(183)], 190)
  const r188 = checkNextNumber(deleted, 188)
  check('a number the counter already handed out (a deleted invoice) is refused',
    deleted.next === 191 && !r188.ok && /already 0191/.test(r188.error), r188.ok ? 'accepted' : r188.error)
  const wos = stateFrom('hd_work_order', [wo(7), null, 'INV5001262'], null)
  check('work orders: no counter row, highest WO-2026-0007 -> next 8', wos.next === 8 && wos.highest?.number === wo(7))
  check('parse: "0184" is 184', (() => { const p = parseNextNumber('0184'); return p.ok && p.n === 184 })())
  check('parse: 0, 10000, 12.5, "abc" and "" are refused',
    [0, 10000, 12.5, 'abc', ''].every(v => !parseNextNumber(v).ok))
  check('format: INV-2026-2847, Q-2026-0009, WO-2027-0100',
    formatDocNumber('hd_invoice', 2026, 2847) === 'INV-2026-2847' && formatDocNumber('hd_quote', 2026, 9) === 'Q-2026-0009'
      && formatDocNumber('hd_work_order', 2027, 100) === 'WO-2027-0100')
}

console.log('\nWhich errors are a number collision')
check('the LD key, as the smoke run of Oct 30 saw it -> retry',
  isWorkOrderNumberCollision({ code: '23505', message: 'duplicate key value violates unique constraint "work_orders_user_id_work_order_number_key"' }))
check('the HD key from migration 176 -> retry',
  isWorkOrderNumberCollision({ code: '23505', message: 'duplicate key value violates unique constraint "hd_work_orders_user_id_work_order_number_key"' }))
check('one work order per quote (hd_work_orders_one_per_quote) -> NOT retried',
  !isWorkOrderNumberCollision({ code: '23505', message: 'duplicate key value violates unique constraint "hd_work_orders_one_per_quote"' }))
check('any other error -> NOT retried',
  !isWorkOrderNumberCollision({ code: '23502', message: 'null value in column "work_order_number"' }) && !isWorkOrderNumberCollision(null))

// ── an in-memory table: the select chain allocateWorkOrderNumber uses, and an insert
//    that refuses a (user_id, number) already taken, with Postgres's message ──────────
function fakeTable(seed: string[], table: string) {
  const rows = seed.map(n => ({ user_id: 'u1', work_order_number: n }))
  let reads = 0
  const client = {
    from: () => {
      const q = {
        select: () => q, eq: () => q, like: () => q, order: () => q,
        range: async (from: number, to: number) => { reads++; return { data: rows.slice(from, to + 1).map(r => ({ work_order_number: r.work_order_number })), error: null } },
      }
      return q
    },
  } as unknown as SupabaseClient
  const insert = async (n: string) => {
    await new Promise(r => setTimeout(r, 5))
    if (rows.some(r => r.work_order_number === n)) {
      return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${table}_user_id_work_order_number_key"` } }
    }
    rows.push({ user_id: 'u1', work_order_number: n }); return { data: { work_order_number: n }, error: null }
  }
  return { client, insert, rows, reads: () => reads }
}

async function race() {
  console.log('\nTwo saves at once')
  for (const table of ['work_orders', 'hd_work_orders'] as const) {
    const t = fakeTable(founderLd, table)
    const [a, b] = await Promise.all([
      insertWithWorkOrderNumber(t.client, table, 'u1', t.insert),
      insertWithWorkOrderNumber(t.client, table, 'u1', t.insert),
    ])
    const got = [a.data?.work_order_number, b.data?.work_order_number].sort()
    check(`${table}: both save, neither errors`, !a.error && !b.error, JSON.stringify([a.error, b.error]))
    check(`${table}: they take WO-2026-0029 and WO-2026-0030, never the same number`,
      got[0] === 'WO-2026-0029' && got[1] === 'WO-2026-0030', JSON.stringify(got))
    check(`${table}: the loser read the numbers again before retrying (3 reads for 2 saves)`, t.reads() === 3, String(t.reads()))
  }

  const t = fakeTable(founderLd, 'work_orders')
  let calls = 0
  const other = await insertWithWorkOrderNumber(t.client, 'work_orders', 'u1', async () => {
    calls++; return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "hd_work_orders_one_per_quote"' } }
  })
  check('a different unique key is handed back on the first attempt, untouched', calls === 1 && (other.error as { message: string }).message.includes('one_per_quote'))

  let tries = 0
  const stuck = await insertWithWorkOrderNumber(t.client, 'work_orders', 'u1', async () => {
    tries++; return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "work_orders_user_id_work_order_number_key"' } }
  })
  check('a collision that never clears stops after 5 attempts and returns the error', tries === 5 && !!stuck.error, String(tries))
}

race().then(() => {
  console.log(`\n${passes} passed, ${failures} failed`)
  if (failures) process.exit(1)
})
