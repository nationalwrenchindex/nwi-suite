// READ-ONLY. Which of the four carry-through columns already exist, and which need
// a migration?
//
// Selecting a column that does not exist is a 400 with 42703 and costs nothing, so
// this asks the live database rather than inferring from the migration files - a
// hand-applied migration can be ahead of or behind what is on disk.
//
// No writes.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

async function has(table: string, column: string): Promise<boolean> {
  const res = await fetch(`${S}/rest/v1/${table}?select=${column}&limit=1`, { headers: H })
  return res.ok
}

const TABLES = ['hd_quotes', 'hd_work_orders', 'hd_invoices'] as const
const COLUMNS = ['fleet_account_id', 'unit_number', 'payment_terms', 'unit_id', 'customer_id'] as const

async function main() {
  console.log('\n                   ' + TABLES.map(t => t.replace('hd_', '').padEnd(13)).join(''))
  const missing: string[] = []
  for (const col of COLUMNS) {
    const cells: string[] = []
    for (const t of TABLES) {
      const ok = await has(t, col)
      if (!ok) missing.push(`${t}.${col}`)
      cells.push((ok ? 'yes' : 'MISSING').padEnd(13))
    }
    console.log(`  ${col.padEnd(17)}${cells.join('')}`)
  }

  console.log('\nMISSING:')
  if (missing.length === 0) console.log('  nothing - no migration needed')
  for (const m of missing) console.log(`  ${m}`)

  // What the live invoices actually carry, so "my real invoices carry it" is checked
  // rather than taken on trust.
  const invs = await fetch(
    `${S}/rest/v1/hd_invoices?select=invoice_number,fleet_account_id,unit_number,payment_terms,work_order_id&order=invoice_number.desc&limit=8`,
    { headers: H })
  if (invs.ok) {
    const rows = await invs.json() as Array<Record<string, unknown>>
    console.log('\nTHE LAST 8 HD INVOICES')
    console.log('  invoice            fleet_account_id  unit_number  payment_terms')
    for (const r of rows) {
      console.log(`  ${String(r.invoice_number).padEnd(18)} ` +
        `${(r.fleet_account_id ? String(r.fleet_account_id).slice(0, 8) : 'null').padEnd(17)} ` +
        `${String(r.unit_number ?? 'null').padEnd(12)} ${String(r.payment_terms ?? 'null')}`)
    }
  }

  // And the quotes, to see what is there to carry FROM.
  const qs = await fetch(
    `${S}/rest/v1/hd_quotes?select=quote_number,unit_number,payment_terms,unit_model&order=created_at.desc&limit=5`,
    { headers: H })
  if (qs.ok) {
    const rows = await qs.json() as Array<Record<string, unknown>>
    console.log('\nTHE LAST 5 HD QUOTES')
    console.log('  quote              unit_number  payment_terms  unit_model')
    for (const r of rows) {
      console.log(`  ${String(r.quote_number).padEnd(18)} ` +
        `${String(r.unit_number ?? 'null').padEnd(12)} ` +
        `${String(r.payment_terms ?? 'null').padEnd(14)} ${String(r.unit_model ?? '')}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
