// READ-ONLY. Does hd_invoices have a PO column, and under what name?
//
// The converter (src/lib/hd/wo-to-invoice.ts) already writes po_number into the
// invoice payload, and nothing in the migrations adds po_number to hd_invoices -
// migration 135 adds it to LD's quotes and invoices, and 153 adds
// customer_po_number to hd_quotes and hd_work_orders. If hd_invoices really has
// neither, every HD work-order conversion carrying a PO fails the insert.
//
// Selecting a column that does not exist is a 400 with 42703 and costs nothing.
// No writes. No DDL.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

async function probe(table: string, column: string) {
  const res = await fetch(`${S}/rest/v1/${table}?select=${column}&limit=1`, { headers: H })
  const body = await res.text()
  const exists = res.ok
  console.log(`  ${exists ? 'EXISTS  ' : 'absent  '} ${table}.${column}${exists ? '' : `  (${res.status})`}`)
  if (!exists && !/42703|does not exist|schema cache/i.test(body)) {
    console.log(`           unexpected: ${body.slice(0, 200)}`)
  }
  return exists
}

async function main() {
  console.log('\nhd_invoices PO columns')
  const a = await probe('hd_invoices', 'po_number')
  const b = await probe('hd_invoices', 'customer_po_number')

  console.log('\nfor comparison')
  await probe('hd_quotes', 'customer_po_number')
  await probe('hd_work_orders', 'customer_po_number')
  await probe('invoices', 'po_number')

  console.log('')
  if (!a && !b) {
    console.log('RESULT: hd_invoices has NO PO column. The converter writes po_number,')
    console.log('        so a work order carrying a customer PO cannot be billed.')
  } else {
    console.log(`RESULT: hd_invoices stores the PO as ${a ? 'po_number' : 'customer_po_number'}.`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
