// npx tsx scripts/verify-163-applied.ts
//
// Migration 163 dropped hd_units.unit_type DEFAULT 'trailer'. This proves it against
// the live database: insert a marked unit that names NO unit_type and NO category, read
// back what the database stored, delete it in a finally. Before 163 it came back
// 'trailer'; after 163 it must come back null.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const OWNER = process.env.SMOKE_OWNER_ID ?? '4a8c046f-7db3-42bb-8422-fd47efb7678c'

async function main() {
  let id = ''
  try {
    const res = await fetch(`${S}/rest/v1/hd_units`, {
      method: 'POST',
      headers: { ...H, Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: OWNER, unit_number: 'ZZ-163-CHECK', manufacturer: 'Test', model: 'Test',
        serial_number: 'ZZSERIAL163', status: 'active',
      }),
    })
    const rows = res.ok ? (await res.json()) as Record<string, unknown>[] : []
    id = String(rows[0]?.id ?? '')
    if (!id) throw new Error(`insert failed: ${res.status} ${await res.text()}`)
    const row = rows[0]
    const ok = row.unit_type === null && row.category_id === null
    console.log(`  ${ok ? 'pass' : 'FAIL'}  a unit saved with no type stores unit_type=${JSON.stringify(row.unit_type)}, category_id=${JSON.stringify(row.category_id)}`)
    if (!ok) process.exitCode = 1
  } finally {
    if (id) {
      const d = await fetch(`${S}/rest/v1/hd_units?id=eq.${id}`, { method: 'DELETE', headers: H })
      console.log(`  cleanup: test unit deleted -> ${d.status}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
