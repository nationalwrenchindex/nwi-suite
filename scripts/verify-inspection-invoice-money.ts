// Phase 1 verification: the phantom diagnostic fee and the missing tax.
//
// Runs the REAL helper against the REAL shop settings and the REAL stored invoices,
// read-only. Nothing is written — the three affected invoices were already sent and
// are deliberately left exactly as the customer received them.
//
//   npx tsx scripts/verify-inspection-invoice-money.ts

import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { inspectionInvoiceMoney } from '../src/lib/hd/inspection-invoice'
import { taxDisplayRows } from '../src/lib/tax'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) pass++; else fail++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}
const n = (v: unknown) => Number(v ?? 0)
const usd = (x: number) => `$${x.toFixed(2)}`
const r2 = (x: number) => Math.round(x * 100) / 100

async function main() {
  const { data: invs } = await supabase
    .from('hd_invoices')
    .select('invoice_number, user_id, status, subtotal_labor, subtotal_parts, diagnostic_fee, road_call_fee, tax_rate, tax_amount, total, work_order_id, created_at')
    .order('created_at')

  const { data: profs } = await supabase
    .from('profiles')
    .select('id, business_name, tax_parts, tax_labor, tax_rate_parts, tax_rate_labor')
  const shop = new Map((profs ?? []).map(p => [p.id, p]))

  // The signature of an inspection auto-invoice: parts 0, no work order, and a stored
  // diagnostic fee that is not in the total.
  const affected = (invs ?? []).filter(i =>
    n(i.diagnostic_fee) > 0 &&
    r2(n(i.total)) !== r2(n(i.subtotal_labor) + n(i.subtotal_parts) + n(i.diagnostic_fee) + n(i.road_call_fee) + n(i.tax_amount)),
  )

  console.log('='.repeat(78))
  console.log(`Invoices whose stored total excludes a stored fee: ${affected.length}`)
  console.log('='.repeat(78))

  for (const i of affected) {
    const s = shop.get(i.user_id)!
    console.log(`\n${i.invoice_number}   ${s.business_name}   status=${i.status}`)
    console.log('  AS STORED AND AS THE CUSTOMER SAW IT (unchanged by this fix):')
    console.log(`    Labor            ${usd(n(i.subtotal_labor)).padStart(10)}`)
    console.log(`    Parts            ${usd(n(i.subtotal_parts)).padStart(10)}`)
    console.log(`    Diagnostic Fee   ${usd(n(i.diagnostic_fee)).padStart(10)}   <- printed, never charged`)
    console.log(`    Road Call        ${usd(n(i.road_call_fee)).padStart(10)}`)
    console.log(`    Tax (${n(i.tax_rate)}%)        ${usd(n(i.tax_amount)).padStart(10)}   <- none, on a ${s.tax_rate_parts}% business`)
    console.log(`    TOTAL DUE        ${usd(n(i.total)).padStart(10)}`)
    const shouldHaveBeen = r2(n(i.subtotal_labor) + n(i.subtotal_parts) + n(i.diagnostic_fee) + n(i.road_call_fee) + n(i.tax_amount))
    console.log(`    (its own lines add to ${usd(shouldHaveBeen)} — understated by ${usd(shouldHaveBeen - n(i.total))})`)

    const money = await inspectionInvoiceMoney(supabase, i.user_id, n(i.subtotal_labor))
    console.log('  WHAT THE SAME INSPECTION BILLS NOW:')
    console.log(`    Labor            ${usd(money.subtotal_labor).padStart(10)}`)
    console.log(`    Diagnostic Fee   ${usd(money.diagnostic_fee).padStart(10)}   <- explicitly zero, not printed`)
    console.log(`    Road Call        ${usd(money.road_call_fee).padStart(10)}`)
    for (const row of taxDisplayRows(money.tax_breakdown)) {
      console.log(`    ${row.text.padEnd(17)}${usd(row.amount).padStart(10)}`)
    }
    console.log(`    TOTAL DUE        ${usd(money.total).padStart(10)}`)

    ok(money.diagnostic_fee === 0, `${i.invoice_number}: diagnostic fee is 0, so nothing prints a fee that was not charged`)
    ok(money.road_call_fee === 0, `${i.invoice_number}: road call fee is 0 for the same reason`)
    ok(r2(money.subtotal_labor + money.subtotal_parts + money.diagnostic_fee + money.road_call_fee + money.tax_amount) === money.total,
      `${i.invoice_number}: the new total equals the sum of its own lines (${usd(money.total)})`)
    const expectTax = shop.get(i.user_id)!.tax_labor === true
    ok((money.tax_amount > 0) === expectTax,
      `${i.invoice_number}: tax ${expectTax ? 'IS' : 'is not'} charged on the labour, matching tax_labor=${expectTax}`)
    ok(money.tax_breakdown?.labor?.taxed === expectTax,
      `${i.invoice_number}: the labour bucket records taxed=${expectTax}`)
  }

  // ── Three more real invoices that were already correct must stay correct ──
  console.log('\n' + '='.repeat(78))
  console.log('Invoices that were already right — the fix must not move them')
  console.log('='.repeat(78))
  const healthy = (invs ?? []).filter(i => !affected.includes(i) && n(i.subtotal_labor) > 0).slice(0, 3)
  for (const i of healthy) {
    const stored = r2(n(i.subtotal_labor) + n(i.subtotal_parts) + n(i.diagnostic_fee) + n(i.road_call_fee) + n(i.tax_amount))
    console.log(`  ${String(i.invoice_number).padEnd(14)} stored total ${usd(n(i.total))}  lines add to ${usd(stored)}  wo=${i.work_order_id ? 'Y' : '.'}`)
    ok(r2(n(i.total)) === stored, `${i.invoice_number}: still adds up, untouched`)
  }

  ok(affected.length > 0, `the audit found real affected invoices (${affected.length}) — guards a vacuous pass`)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
