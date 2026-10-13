// What do we actually have before migration 151 is written?
//
// READ ONLY. The brief names migrations 148, 149 and "145 product_usage_log"; two of
// those three are not quite what is there, and there is a whole pre-existing detailer
// inventory system the brief does not mention. Measured, not assumed.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

async function probe(table: string): Promise<{ exists: boolean; count: string; cols: string[] }> {
  const res = await fetch(`${S}/rest/v1/${table}?select=*&limit=1`, {
    headers: { ...H, Prefer: 'count=exact' },
  })
  if (!res.ok) return { exists: false, count: '-', cols: [] }
  const rows = await res.json() as Array<Record<string, unknown>>
  const count = res.headers.get('content-range')?.split('/')[1] ?? '?'
  return { exists: true, count, cols: rows[0] ? Object.keys(rows[0]) : [] }
}

async function col(table: string, column: string): Promise<boolean> {
  const res = await fetch(`${S}/rest/v1/${table}?select=${column}&limit=1`, { headers: H })
  return res.ok
}

async function main() {
  console.log('\nINVENTORY PREFLIGHT  (read only)')
  console.log('='.repeat(100))

  const TABLES = [
    // From the brief
    ['inventory', 'migration 148'],
    ['parts', 'migration 148'],
    ['part_fitment', 'migration 148'],
    ['product_usage_log', 'migration 028 / 145'],
    // The pre-existing detailer system the brief does not mention
    ['products_inventory', 'migration 028'],
    ['service_products', 'migration 028'],
    // What 151 would add
    ['stock_location', 'migration 151 (not written yet)'],
    ['stock_movement', 'migration 151 (not written yet)'],
    ['stock_allocation', 'migration 151 (not written yet)'],
    // Work order lines, which is where a deduction has to hook in
    ['work_orders', 'LD'],
    ['hd_work_orders', 'HD'],
    ['hd_work_order_lines', 'HD'],
    ['invoices', 'LD'],
    ['hd_invoices', 'HD'],
  ] as const

  console.log('\n  TABLES')
  for (const [t, origin] of TABLES) {
    const p = await probe(t)
    console.log(`    ${t.padEnd(24)} ${p.exists ? `EXISTS  ${String(p.count).padStart(6)} rows` : 'ABSENT            '}  (${origin})`)
  }

  console.log('\n  inventory - what migration 148 actually gave us')
  const inv = await probe('inventory')
  if (inv.exists) {
    console.log(`    columns: ${inv.cols.join(', ') || '(no rows, so no column sample)'}`)
    for (const c of ['user_id', 'part_id', 'on_hand', 'min_qty', 'bin', 'location_type', 'location_name', 'last_cost', 'sell_price', 'location', 'location_id']) {
      const has = await col('inventory', c)
      console.log(`      ${c.padEnd(16)} ${has ? 'present' : 'ABSENT'}`)
    }
  }

  console.log('\n  parts - did migration 149 land?')
  for (const c of ['vendor_price', 'vendor_price_source']) {
    const has = await col('parts', c)
    console.log(`      parts.${c.padEnd(22)} ${has ? 'present - 149 IS applied' : 'ABSENT - 149 NOT applied'}`)
  }

  console.log('\n  products_inventory - the PRE-EXISTING detailer system')
  const pi = await probe('products_inventory')
  if (pi.exists) console.log(`    columns: ${pi.cols.join(', ') || '(empty table)'}`)
  else console.log('    absent')

  console.log('\n  WORK ORDER LINE STORAGE - where a deduction must hook in')
  for (const [t, c] of [['work_orders', 'line_items'], ['hd_work_orders', 'line_items']] as const) {
    const has = await col(t, c)
    console.log(`      ${t}.${c.padEnd(14)} ${has ? 'present (JSONB on the parent)' : 'ABSENT'}`)
  }
  const hdLines = await probe('hd_work_order_lines')
  console.log(`      hd_work_order_lines           ${hdLines.exists ? `EXISTS (${hdLines.count} rows): ${hdLines.cols.join(', ')}` : 'ABSENT'}`)

  console.log('\n  INVOICE FINALIZE - the committed event the brief wants to deduct on')
  for (const [t, c] of [['invoices', 'invoice_status'], ['invoices', 'finalized_at'], ['hd_invoices', 'status']] as const) {
    const has = await col(t, c)
    console.log(`      ${t}.${c.padEnd(16)} ${has ? 'present' : 'ABSENT'}`)
  }

  console.log(`\n${'='.repeat(100)}\n`)
}

main().catch(e => { console.error(e); process.exitCode = 1 })
