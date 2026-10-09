// What can one subscriber actually DO to the parts tables and to another shop's stock?
//
// Policy TEXT cannot be read from here - PostgREST does not expose pg_policies, and the
// service role bypasses RLS so it can never show what a subscriber is allowed. So this
// asks the only question that settles it: it talks to PostgREST as a REAL LOGGED-IN
// USER and tries the writes.
//
// Every probe row is clearly marked and deleted in a finally. The one row created for a
// second account is created BY THE SERVICE ROLE, so the test of "can shop A touch shop
// B's stock" never depends on shop A being able to create it.

import { loadEnv, openSession } from './lib/smoke-session'

loadEnv()
const S    = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const OWNER = process.env.SMOKE_OWNER_ID ?? '4a8c046f-7db3-42bb-8422-fd47efb7678c'

const svcH = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }

const rows: Array<{ step: string; ok: boolean; detail: string }> = []
function record(step: string, ok: boolean, detail: string): boolean {
  rows.push({ step, ok, detail })
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${step.padEnd(64)} ${detail}`)
  return ok
}

async function main() {
  console.log(`\nPARTS RLS - WHAT A SUBSCRIBER CAN ACTUALLY DO  ${S}`)
  console.log('='.repeat(108))

  const session = await openSession(OWNER)
  const userH = {
    apikey: ANON,
    Authorization: `Bearer ${session.accessToken}`,
    'Content-Type': 'application/json',
  }
  console.log(`  acting as: ${session.email}\n`)

  async function asUser(method: string, path: string, body?: unknown) {
    const res = await fetch(`${S}/rest/v1/${path}`, {
      method,
      headers: { ...userH, Prefer: method === 'POST' ? 'return=representation' : 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let json: unknown = null
    try { json = JSON.parse(text) } catch { /* not json */ }
    return { status: res.status, text, json }
  }

  const created: Array<{ table: string; filter: string }> = []

  try {
    // ── 1. The SHARED catalog tables ────────────────────────────────────────
    console.log('  1. SHARED TABLES - can one subscriber rewrite what every subscriber reads?\n')

    const SHARED: Array<[string, Record<string, unknown>]> = [
      ['hd_parts_reference', { manufacturer: 'TK', part_category: 'ZZ-RLS-PROBE', part_function: 'ZZ-RLS-PROBE delete me' }],
      ['hd_parts',           { part_number: 'ZZ-RLS-PROBE', manufacturer: 'Thermo King', description: 'ZZ-RLS-PROBE delete me', category: 'ZZ-RLS-PROBE' }],
      ['parts',              { part_number: 'ZZ-RLS-PROBE-2', manufacturer: 'ZZ Probe', part_type: 'ZZ-RLS-PROBE', source: 'verify-parts-rls' }],
      ['part_supersession',  { old_number: 'ZZ-RLS-A', new_number: 'ZZ-RLS-B', manufacturer: 'ZZ Probe', source: 'verify-parts-rls' }],
    ]

    for (const [table, row] of SHARED) {
      const res = await asUser('POST', table, [row])
      const wrote = res.status < 400
      const expectWritable = table === 'hd_parts_reference'
      if (wrote) {
        const made = Array.isArray(res.json) ? (res.json[0] as Record<string, unknown>) : null
        if (made?.id) created.push({ table, filter: `id=eq.${made.id}` })
      }
      record(
        `${table.padEnd(20)} INSERT as a subscriber`,
        wrote === expectWritable,
        wrote
          ? `ALLOWED -> ${res.status}  ${expectWritable ? 'this is the known hd_parts_reference hole' : 'UNEXPECTED - a subscriber can write a shared table'}`
          : `refused -> ${res.status} ${String((res.json as { code?: string })?.code ?? '')}`,
      )
    }

    // Can a subscriber UPDATE a shared row that already exists?
    const anyRef = await (await fetch(`${S}/rest/v1/hd_parts_reference?select=id,part_function&limit=1`, { headers: svcH })).json() as Array<Record<string, unknown>>
    if (anyRef[0]) {
      const original = String(anyRef[0].part_function)
      const upd = await asUser('PATCH', `hd_parts_reference?id=eq.${anyRef[0].id}`, { part_function: 'ZZ-RLS-PROBE-OVERWRITE' })
      const changed = Array.isArray(upd.json) && upd.json.length > 0
      record('hd_parts_reference  UPDATE someone else\'s row', !changed,
        changed ? 'ALLOWED - a subscriber can edit the shared library' : `refused / no rows -> ${upd.status}`)
      if (changed) {
        await fetch(`${S}/rest/v1/hd_parts_reference?id=eq.${anyRef[0].id}`, {
          method: 'PATCH', headers: svcH, body: JSON.stringify({ part_function: original }),
        })
        console.log(`        restored part_function to "${original}"`)
      }
    }

    const anyPart = await (await fetch(`${S}/rest/v1/parts?select=id&limit=1`, { headers: svcH })).json() as Array<Record<string, unknown>>
    if (anyPart[0]) {
      const upd = await asUser('PATCH', `parts?id=eq.${anyPart[0].id}`, { notes: 'ZZ-RLS-PROBE' })
      const changed = Array.isArray(upd.json) && upd.json.length > 0
      record('parts               UPDATE a catalog row', !changed,
        changed ? 'ALLOWED - UNEXPECTED' : `refused / no rows -> ${upd.status}`)
      if (changed) {
        await fetch(`${S}/rest/v1/parts?id=eq.${anyPart[0].id}`, {
          method: 'PATCH', headers: svcH, body: JSON.stringify({ notes: null }),
        })
      }
    }

    // ── 2. inventory - is stock scoped to the owning account? ───────────────
    console.log('\n  2. INVENTORY - can one shop reach another shop\'s stock, cost and price?\n')

    const partForStock = anyPart[0]?.id as string | undefined
    if (!partForStock) { record('a part exists to stock', false, 'the catalog is empty'); return }

    // 2a. Own row: must be allowed.
    const mine = await asUser('POST', 'inventory', [{
      user_id: session.userId, part_id: partForStock, on_hand: 1,
      bin: 'ZZ-RLS-PROBE', location_type: 'shop', last_cost: 1.23, sell_price: 4.56,
    }])
    const mineRow = Array.isArray(mine.json) ? (mine.json[0] as Record<string, unknown>) : null
    if (mineRow?.id) created.push({ table: 'inventory', filter: `id=eq.${mineRow.id}` })
    record('inventory  INSERT my own stock row', mine.status < 400, `-> ${mine.status}`)

    // 2b. A row claiming to belong to someone else: must be refused by WITH CHECK.
    const others = await (await fetch(
      `${S}/rest/v1/profiles?select=id&id=neq.${session.userId}&limit=1`, { headers: svcH })).json() as Array<Record<string, unknown>>
    const otherId = others[0]?.id as string | undefined
    if (!otherId) { record('a second account exists to test against', false, 'only one profile'); return }

    const forged = await asUser('POST', 'inventory', [{
      user_id: otherId, part_id: partForStock, on_hand: 99, bin: 'ZZ-RLS-FORGED', location_type: 'shop',
    }])
    const forgedRow = Array.isArray(forged.json) ? (forged.json[0] as Record<string, unknown>) : null
    if (forgedRow?.id) created.push({ table: 'inventory', filter: `id=eq.${forgedRow.id}` })
    record('inventory  INSERT a row owned by ANOTHER account', forged.status >= 400,
      forged.status >= 400
        ? `refused -> ${forged.status} ${String((forged.json as { code?: string })?.code ?? '')}`
        : 'ALLOWED - one shop can create stock against another account')

    // 2c. A real row belonging to the other account, created by the SERVICE ROLE.
    const seeded = await fetch(`${S}/rest/v1/inventory`, {
      method: 'POST', headers: { ...svcH, Prefer: 'return=representation' },
      body: JSON.stringify([{
        user_id: otherId, part_id: partForStock, on_hand: 7,
        bin: 'ZZ-RLS-OTHER-SHOP', location_type: 'shop', last_cost: 11.11, sell_price: 22.22,
      }]),
    })
    const seededRow = (await seeded.json() as Array<Record<string, unknown>>)[0]
    if (!seededRow?.id) { record('seeded a row for the other account', false, `-> ${seeded.status}`); return }
    created.push({ table: 'inventory', filter: `id=eq.${seededRow.id}` })
    record('seeded a row for the other account (service role)', true, `on_hand 7, cost 11.11, price 22.22`)

    const read = await asUser('GET', `inventory?id=eq.${seededRow.id}&select=id,on_hand,last_cost,sell_price`)
    const visible = Array.isArray(read.json) && read.json.length > 0
    record('inventory  SELECT another shop\'s row', !visible,
      visible ? `VISIBLE - ${JSON.stringify(read.json).slice(0, 90)}` : 'invisible, 0 rows')

    const edit = await asUser('PATCH', `inventory?id=eq.${seededRow.id}`, { sell_price: 999.99, on_hand: 0 })
    const edited = Array.isArray(edit.json) && edit.json.length > 0
    record('inventory  UPDATE another shop\'s price and stock', !edited,
      edited ? 'CHANGED IT - one shop can reprice another shop\'s parts' : `no rows affected -> ${edit.status}`)

    const wipe = await asUser('DELETE', `inventory?id=eq.${seededRow.id}`)
    const wiped = Array.isArray(wipe.json) && wipe.json.length > 0
    record('inventory  DELETE another shop\'s row', !wiped,
      wiped ? 'DELETED IT' : `no rows affected -> ${wipe.status}`)

    // And confirm from the service role that the other shop's numbers are untouched.
    const after = await (await fetch(
      `${S}/rest/v1/inventory?id=eq.${seededRow.id}&select=on_hand,last_cost,sell_price`, { headers: svcH })).json() as Array<Record<string, unknown>>
    const intact = after[0] && Number(after[0].on_hand) === 7 && Number(after[0].sell_price) === 22.22
    record('the other shop\'s numbers are unchanged', !!intact,
      after[0] ? `on_hand ${after[0].on_hand}, cost ${after[0].last_cost}, price ${after[0].sell_price}` : 'row gone')
  } finally {
    for (const c of created) {
      await fetch(`${S}/rest/v1/${c.table}?${c.filter}`, { method: 'DELETE', headers: svcH })
    }
    // Belt and braces: sweep anything marked as a probe.
    await fetch(`${S}/rest/v1/inventory?bin=like.ZZ-RLS*`, { method: 'DELETE', headers: svcH })
    await fetch(`${S}/rest/v1/hd_parts_reference?part_category=eq.ZZ-RLS-PROBE`, { method: 'DELETE', headers: svcH })
    await fetch(`${S}/rest/v1/hd_parts?part_number=eq.ZZ-RLS-PROBE`, { method: 'DELETE', headers: svcH })
    await fetch(`${S}/rest/v1/parts?part_number=eq.ZZ-RLS-PROBE-2`, { method: 'DELETE', headers: svcH })
    await fetch(`${S}/rest/v1/part_supersession?manufacturer=eq.ZZ%20Probe`, { method: 'DELETE', headers: svcH })

    const left = await Promise.all([
      fetch(`${S}/rest/v1/inventory?bin=like.ZZ-RLS*&select=id`, { headers: svcH }).then(r => r.json()),
      fetch(`${S}/rest/v1/hd_parts_reference?part_category=eq.ZZ-RLS-PROBE&select=id`, { headers: svcH }).then(r => r.json()),
      fetch(`${S}/rest/v1/parts?part_number=like.ZZ-RLS*&select=id`, { headers: svcH }).then(r => r.json()),
    ]) as unknown[][]
    const total = left.reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0)
    record('every probe row deleted', total === 0, `rows left ${total}`)
  }

  const failed = rows.filter(r => !r.ok)
  console.log('='.repeat(108))
  console.log(`  ${rows.length - failed.length} passed, ${failed.length} failed`)
  if (failed.length) { console.log('\n  NEEDS FIXING:'); failed.forEach(f => console.log(`    ${f.step} -- ${f.detail}`)) }
  console.log('='.repeat(108) + '\n')
  process.exitCode = failed.length ? 1 : 0
}

main().catch(e => { console.error(e); process.exitCode = 1 })
