// Did migrations 154, 155, 156 and 157 land? (149 and 152 checked too.)
//
// COLUMNS ARE READ-ONLY PROBES. Selecting a column that does not exist is a 400 with
// 42703 and costs nothing.
//
// AN INDEX AND A CHECK CANNOT BE READ THAT WAY. PostgREST does not expose pg_indexes
// or pg_constraint, and this project has no SQL-exec RPC - so the only honest test of
// a guard is to try what it promises to refuse. Those probes create rows and delete
// them in a finally, and the row they use is a throwaway carrying the VERIFY marker,
// never a real invoice.
//
// "The column exists" is NOT the same claim as "the guard works", so the two are
// reported separately and labelled.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
// Same owner the smoke suite uses, and the same fallback, so this script does not
// silently skip its guard probes on a machine without SMOKE_OWNER_ID set.
const OWNER = process.env.SMOKE_OWNER_ID ?? '4a8c046f-7db3-42bb-8422-fd47efb7678c'

const MARK = 'VERIFY-154-157'

interface Row { migration: string; what: string; ok: boolean; detail: string }
const rows: Row[] = []
function record(migration: string, what: string, ok: boolean, detail: string): boolean {
  rows.push({ migration, what, ok, detail })
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${migration.padEnd(5)} ${what.padEnd(54)} ${detail}`)
  return ok
}

/** True when the column is selectable. 42703 / PGRST means it is not there. */
async function column(table: string, col: string): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch(`${S}/rest/v1/${table}?select=${col}&limit=1`, { headers: H })
  if (res.ok) return { ok: true, detail: 'present' }
  const body = await res.text()
  const code = /"code":"([^"]+)"/.exec(body)?.[1] ?? String(res.status)
  return { ok: false, detail: code === '42703' ? 'ABSENT (42703)' : `unexpected: ${body.slice(0, 90)}` }
}

async function post(table: string, body: unknown) {
  const res = await fetch(`${S}/rest/v1/${table}`, {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body),
  })
  const text = await res.text()
  let json: unknown = null
  try { json = JSON.parse(text) } catch { /* a non-JSON body is reported as text */ }
  return { status: res.status, text, json: json as Record<string, unknown>[] | Record<string, unknown> | null }
}

async function patch(table: string, query: string, body: unknown) {
  const res = await fetch(`${S}/rest/v1/${table}?${query}`, {
    method: 'PATCH', headers: H, body: JSON.stringify(body),
  })
  return { status: res.status, text: await res.text() }
}

async function del(table: string, query: string) {
  await fetch(`${S}/rest/v1/${table}?${query}`, { method: 'DELETE', headers: H })
}

const cleanup: Array<() => Promise<void>> = []

async function main() {
  console.log('')
  console.log('COLUMNS (read-only)')

  // ── 149 ──────────────────────────────────────────────────────────────────
  for (const col of ['vendor_price', 'vendor_price_source']) {
    const r = await column('parts', col)
    record('149', `parts.${col}`, r.ok, r.detail)
  }

  // ── 155 ──────────────────────────────────────────────────────────────────
  for (const col of ['sent_at', 'last_sent_at', 'sent_count', 'sent_to_phone', 'sent_to_email']) {
    const r = await column('hd_quotes', col)
    record('155', `hd_quotes.${col}`, r.ok, r.detail)
  }

  // ── 156 ──────────────────────────────────────────────────────────────────
  for (const col of ['hd_diagnostic_fee', 'hd_road_call_fee']) {
    const r = await column('profiles', col)
    record('156', `profiles.${col}`, r.ok, r.detail)
  }

  // ── 157 ──────────────────────────────────────────────────────────────────
  {
    const r = await column('hd_invoices', 'customer_po_number')
    record('157', 'hd_invoices.customer_po_number', r.ok, r.detail)
  }

  console.log('')
  console.log('GUARDS (proved by trying what they refuse)')

  // ── 154: one invoice per HD work order ───────────────────────────────────
  //
  // A throwaway work order of its own, so a real invoice is never involved. The second
  // insert is the test: 23505 means the index is doing its job, 201 means it is absent
  // and this script just created a duplicate - which it then deletes.
  if (!OWNER) {
    record('154', 'hd_invoices_one_per_work_order refuses a 2nd invoice', false,
      'SMOKE_OWNER_ID is not set, so the probe could not run')
  } else {
    const wo = await post('hd_work_orders', {
      user_id: OWNER,
      work_order_number: `WO-${MARK}`,
      customer_name: `${MARK} index probe`,
      status: 'completed',
      service_type: `${MARK}`,
    })
    const woRow = Array.isArray(wo.json) ? wo.json[0] : null
    const woId = String(woRow?.id ?? '')

    if (!woId) {
      record('154', 'a throwaway work order could be created', false,
        `-> ${wo.status} ${wo.text.slice(0, 90)}`)
    } else {
      cleanup.push(async () => { await del('hd_work_orders', `id=eq.${woId}`) })

      const invBody = {
        user_id: OWNER,
        invoice_number: `INV-${MARK}`,
        customer_name: `${MARK} index probe`,
        work_order_id: woId,
        status: 'unpaid',
        total: 1,
      }
      const first = await post('hd_invoices', invBody)
      const firstRow = Array.isArray(first.json) ? first.json[0] : null
      const firstId = String(firstRow?.id ?? '')
      if (firstId) cleanup.push(async () => { await del('hd_invoices', `id=eq.${firstId}`) })

      if (!record('154', 'the FIRST invoice for that work order is accepted',
        first.status === 201, `-> ${first.status}${firstId ? '' : ' ' + first.text.slice(0, 90)}`)) {
        // Nothing to conclude about the index if the baseline insert failed.
      } else {
        const second = await post('hd_invoices', { ...invBody, invoice_number: `INV-${MARK}-2` })
        const secondRow = Array.isArray(second.json) ? second.json[0] : null
        const secondId = String(secondRow?.id ?? '')
        if (secondId) cleanup.push(async () => { await del('hd_invoices', `id=eq.${secondId}`) })

        const is23505 = /23505/.test(second.text)
        const namesIndex = /one_per_work_order/.test(second.text)
        record('154', 'a SECOND invoice for the same work order is REFUSED',
          second.status === 409 && is23505,
          second.status === 201
            ? '-> 201: the index is ABSENT, a duplicate was created and deleted'
            : `-> ${second.status}${is23505 ? ' 23505' : ''}`)
        record('154', 'and the refusal names hd_invoices_one_per_work_order',
          namesIndex, namesIndex ? 'named' : second.text.slice(0, 90))
      }
    }
  }

  // ── 156: the non-negative CHECK ──────────────────────────────────────────
  //
  // The owner's own profile is the only row with these columns, so the probe reads
  // both values first and restores them in the finally. A working CHECK means the
  // UPDATE is refused and nothing changed anyway.
  if (OWNER) {
    const before = await fetch(`${S}/rest/v1/profiles?select=hd_diagnostic_fee,hd_road_call_fee&id=eq.${OWNER}`, { headers: H })
    if (before.ok) {
      const prior = ((await before.json()) as Record<string, unknown>[])[0] ?? {}
      cleanup.push(async () => {
        await patch('profiles', `id=eq.${OWNER}`, {
          hd_diagnostic_fee: prior.hd_diagnostic_fee ?? null,
          hd_road_call_fee:  prior.hd_road_call_fee  ?? null,
        })
      })
      const bad = await patch('profiles', `id=eq.${OWNER}`, { hd_diagnostic_fee: -1 })
      const is23514 = /23514/.test(bad.text)
      record('156', 'profiles_hd_fees_nonnegative refuses a negative fee',
        is23514,
        is23514 ? 'refused (23514)'
          : bad.status < 300 ? `-> ${bad.status}: the CHECK is ABSENT, -1 was written and has been restored`
          : `-> ${bad.status} ${bad.text.slice(0, 90)}`)
      console.log(`  note  the shop's saved fees were ${JSON.stringify(prior)} and are restored on exit`)
    } else {
      record('156', 'the fee columns could be read back', false, `-> ${before.status}`)
    }
  }

  // ── 152: the on_hand CHECK must be GONE ──────────────────────────────────
  //
  // The opposite shape: this one passes when the write is ACCEPTED. A deduction that
  // takes stock below zero has to be possible, or every deduct fails 23514.
  {
    const anyPart = await fetch(`${S}/rest/v1/parts?select=id&limit=1`, { headers: H })
    const part = anyPart.ok ? ((await anyPart.json()) as Record<string, unknown>[])[0] : null
    if (!part?.id || !OWNER) {
      record('152', 'inventory_on_hand_check is dropped', false,
        !OWNER ? 'SMOKE_OWNER_ID is not set' : 'no catalog part to probe with')
    } else {
      const neg = await post('inventory', {
        user_id: OWNER, part_id: part.id, on_hand: -1,
        location_type: 'shop', bin: MARK,
      })
      const negRow = Array.isArray(neg.json) ? neg.json[0] : null
      const negId = String(negRow?.id ?? '')
      if (negId) cleanup.push(async () => { await del('inventory', `id=eq.${negId}`) })
      record('152', 'inventory accepts on_hand below zero (check dropped)',
        neg.status === 201,
        neg.status === 201 ? 'accepted -1, row deleted'
          : /23514/.test(neg.text) ? '-> 23514: inventory_on_hand_check is STILL THERE - run migration 152'
          : `-> ${neg.status} ${neg.text.slice(0, 90)}`)
    }
  }
}

async function runCleanup() {
  console.log('\nCleaning up...')
  // Reverse order: the invoices reference the work order.
  for (const fn of cleanup.reverse()) {
    try { await fn() } catch (e) { console.error('  cleanup step failed:', e) }
  }
  // Belt and braces - anything carrying the marker, whatever the step list says.
  for (const [table, col] of [['hd_invoices', 'customer_name'], ['hd_work_orders', 'customer_name']] as const) {
    try { await del(table, `${col}=like.${MARK}*`) } catch { /* reported by the sweep below */ }
  }
  try { await del('inventory', `bin=eq.${MARK}`) } catch { /* ditto */ }

  for (const [table, q] of [
    ['hd_invoices',    `select=id&customer_name=like.${MARK}*`],
    ['hd_work_orders', `select=id&customer_name=like.${MARK}*`],
    ['inventory',      `select=id&bin=eq.${MARK}`],
  ] as const) {
    const res = await fetch(`${S}/rest/v1/${table}?${q}`, { headers: { ...H, Prefer: 'count=exact' } })
    const left = Number((res.headers.get('content-range') ?? '/0').split('/')[1] ?? 0)
    console.log(`  ${left === 0 ? 'clean' : 'LEFT ' + left} ${table}`)
  }
}

function table() {
  const wM = Math.max(9, ...rows.map(r => r.migration.length))
  const wW = Math.max(4, ...rows.map(r => r.what.length))
  console.log('\n' + '='.repeat(96))
  console.log('MIGRATION VERIFICATION')
  console.log('='.repeat(96))
  console.log('  ' + 'MIG'.padEnd(wM + 2) + 'WHAT'.padEnd(wW + 2) + 'RESULT  DETAIL')
  console.log('  ' + '-'.repeat(wM + wW + 28))
  for (const r of rows) {
    console.log('  ' + r.migration.padEnd(wM + 2) + r.what.padEnd(wW + 2) +
      (r.ok ? 'pass' : 'FAIL').padEnd(8) + r.detail)
  }
  const failed = rows.filter(r => !r.ok)
  console.log('  ' + '-'.repeat(wM + wW + 28))
  console.log(`  ${rows.length - failed.length} passed, ${failed.length} failed`)
  if (failed.length) {
    console.log('\n  NOT CONFIRMED:')
    for (const f of failed) console.log(`    ${f.migration} ${f.what} -- ${f.detail}`)
  }
  console.log('='.repeat(96))
}

main()
  .catch(e => {
    rows.push({ migration: 'suite', what: 'ran to completion', ok: false, detail: e instanceof Error ? e.message : String(e) })
    console.error('\nERROR:', e)
  })
  .finally(async () => {
    await runCleanup()
    table()
    process.exit(rows.some(r => !r.ok) ? 1 : 0)
  })
