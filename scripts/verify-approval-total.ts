// The approval total and the invoice total must agree to the cent.
//
// Read-only against production. Nothing is written.
//
//   npx tsx scripts/verify-approval-total.ts
//
// Reported from real tests: WO-2026-0011 approved 156.66, the invoice screen showed
// 156.67. WO-2026-0009 approved 374.85, the screen showed 374.87.

import fs from 'fs'
import { computeTax, mergeBreakdowns, parseBreakdown, breakdownTaxTotal, taxSettingsFrom } from '../src/lib/tax'
import { MIGRATION_146_COLUMNS, missingMigration142Column, withoutMigration142Columns, withoutColumnsForMissing } from '../src/lib/migration-142'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) pass++; else fail++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}
const hr = (t: string) => { console.log('\n' + '='.repeat(78)); console.log(t); console.log('='.repeat(78)) }
const get = async (p: string) => (await fetch(`${U}/rest/v1/${p}`, { headers: H })).json()
const r2 = (n: number) => Math.round(n * 100) / 100

const PAIRS = [
  { wo: 'WO-2026-0009', inv: 'INV-2026-0009', approved: 374.85, wasShowing: 374.87 },
  { wo: 'WO-2026-0011', inv: 'INV-2026-0011', approved: 156.66, wasShowing: 156.67 },
  { wo: 'WO-2026-0008', inv: 'INV-2026-0008', approved: 158.39, wasShowing: 158.39 },
]

async function main() {
  // ══ 1. THE CENT, ON REAL DOCUMENTS ═════════════════════════════════════════
  hr('1. The approved total and the billed total, to the cent')

  for (const pair of PAIRS) {
    const wos = await get(`work_orders?select=id&work_order_number=eq.${pair.wo}`) as Array<{ id: string }>
    if (!wos.length) { ok(false, `${pair.wo} exists`); continue }
    const segs = await get(
      `work_order_segments?select=sequence,status,tax_amount,grand_total,tax_breakdown&ld_work_order_id=eq.${wos[0].id}&order=sequence`,
    ) as Array<{ sequence: number; status: string; tax_amount: number; grand_total: number; tax_breakdown: unknown }>

    const billable = segs.filter(s => s.status === 'authorized' || s.status === 'complete')
    const invs = await get(`invoices?select=subtotal,tax_amount,total,tax_breakdown&invoice_number=eq.${pair.inv}`) as Array<{ subtotal: number; tax_amount: number; total: number; tax_breakdown: unknown }>
    if (!invs.length) { ok(false, `${pair.inv} exists`); continue }
    const inv = invs[0]

    console.log(`\n  ${pair.wo} -> ${pair.inv}`)

    // What the work order approved: each segment's own rounded total, summed.
    const approvedTotal = r2(billable.reduce((n, s) => n + Number(s.grand_total ?? 0), 0))
    console.log(`    work order approves      ${approvedTotal.toFixed(2)}  (sum of ${billable.length} segment totals)`)

    // THE FIX: the invoice carries those figures and sums them.
    const stored = parseBreakdown(inv.tax_breakdown)
    const carried = breakdownTaxTotal(stored)
    const carriedTotal = r2(Number(inv.subtotal) + carried)
    console.log(`    carried (the fix)        ${carriedTotal.toFixed(2)}  tax ${carried.toFixed(2)}`)

    // THE OLD BEHAVIOUR: re-round the merged bases.
    const settings = { tax_parts: true, tax_labor: true, tax_rate_parts: 7.75, tax_rate_labor: 7.75 }
    const reRounded = stored
      ? computeTax({ parts: stored.parts?.base ?? 0, labor: stored.labor?.base ?? 0 }, settings).taxAmount
      : 0
    const reRoundedTotal = r2(Number(inv.subtotal) + reRounded)
    console.log(`    re-rounded (the bug)     ${reRoundedTotal.toFixed(2)}  tax ${reRounded.toFixed(2)}`)

    ok(approvedTotal === pair.approved,
      `${pair.wo} approves ${pair.approved.toFixed(2)} (got ${approvedTotal.toFixed(2)})`)
    ok(carriedTotal === approvedTotal,
      `carrying the approved tax makes the invoice agree with the work order (${carriedTotal.toFixed(2)} = ${approvedTotal.toFixed(2)})`)
    ok(carriedTotal === Number(inv.total),
      `and it matches what is STORED on the invoice (${Number(inv.total).toFixed(2)}) - the stored row was always right`)

    if (pair.approved !== pair.wasShowing) {
      ok(reRoundedTotal === pair.wasShowing,
        `the old method reproduces the wrong figure that was on screen (${pair.wasShowing.toFixed(2)})`)
      ok(reRoundedTotal !== approvedTotal,
        `which really did disagree with the approval, by ${Math.abs(r2(reRoundedTotal - approvedTotal)).toFixed(2)}`)
    } else {
      ok(reRoundedTotal === approvedTotal,
        'this one agreed under both methods - a single-category segment cannot drift')
    }
  }

  // ══ 2. ADDING WORK MUST STILL BE TAXED ═════════════════════════════════════
  hr('2. The approved figure is carried, but ADDED work is still priced')

  const settings = { tax_parts: true, tax_labor: true, tax_rate_parts: 7.75, tax_rate_labor: 7.75 }
  const approvedBreakdown = parseBreakdown({
    version: 1,
    parts: { base: 10.4, rate: 7.75, taxed: true, amount: 0.80 },
    labor: { base: 135,  rate: 7.75, taxed: true, amount: 10.46 },
  })
  ok(breakdownTaxTotal(approvedBreakdown) === 11.26, 'the approved breakdown totals 11.26')

  // Nothing added: tax must be exactly the approved figure.
  const none = mergeBreakdowns([approvedBreakdown, null])
  ok(breakdownTaxTotal(none) === 11.26,
    'with nothing added the tax is UNCHANGED at 11.26 - not re-derived to 11.27')

  // A $100 part added: its tax is computed and ADDED, not folded into a re-round.
  const added = computeTax({ parts: 100, labor: 0 }, settings)
  ok(added.taxAmount === 7.75, 'a 100.00 part added is taxed 7.75 on its own')
  const merged = mergeBreakdowns([approvedBreakdown, added.breakdown])
  ok(breakdownTaxTotal(merged) === r2(11.26 + 7.75),
    `tax becomes approved + added = ${r2(11.26 + 7.75).toFixed(2)} (got ${breakdownTaxTotal(merged).toFixed(2)})`)
  ok(merged?.parts?.base === 110.4, 'the parts BASE still reflects everything taxable (110.40)')
  // The thing that must NOT happen: re-rounding the merged base.
  const wrong = computeTax({ parts: 110.4, labor: 135 }, settings).taxAmount
  ok(wrong !== breakdownTaxTotal(merged),
    `re-rounding the merged bases would give ${wrong.toFixed(2)}, which is the drift being removed`)

  // A labor-only addition, and a zero addition.
  const zero = mergeBreakdowns([approvedBreakdown, null])
  ok(breakdownTaxTotal(zero) === 11.26, 'a zero addition changes nothing')
  ok(breakdownTaxTotal(null) === 0, 'no breakdown at all is zero tax, not NaN')

  // ══ 3. THE NEW LINK ════════════════════════════════════════════════════════
  hr('3. invoices.source_work_order_id (migration 146)')

  const probe = await fetch(`${U}/rest/v1/invoices?select=source_work_order_id&limit=1`, { headers: H })
  const applied = probe.status === 200
  console.log(`\n  migration 146 applied: ${applied}`)

  if (!applied) {
    console.log('  (expected until it is run - the code tolerates its absence)')
    ok(true, 'the column is absent, which is the state before 146 is applied')
  } else {
    const rows = await get('invoices?select=invoice_number,source,source_work_order_id&source=eq.work_order&order=invoice_number') as Array<{ invoice_number: string; source_work_order_id: string | null }>
    const linked = rows.filter(r => r.source_work_order_id)
    console.log(`  work-order invoices: ${rows.length}, linked: ${linked.length}`)
    for (const r of rows.filter(x => !x.source_work_order_id)) console.log(`    UNLINKED: ${r.invoice_number}`)
    ok(linked.length === rows.length,
      `every work-order invoice is linked back to its work order (${linked.length} of ${rows.length})`)
  }

  // The backfill source must still exist and still be populated, applied or not.
  const wos = await get('work_orders?select=work_order_number,converted_invoice_id') as Array<{ converted_invoice_id: string | null }>
  const fwd = wos.filter(w => w.converted_invoice_id).length
  ok(fwd > 0, `work_orders.converted_invoice_id is populated (${fwd} rows) - so the 146 backfill is exact, not a guess`)

  // ══ 4. THE RETRY MUST NOT OVER-STRIP ═══════════════════════════════════════
  hr('4. One pending migration must only cost its own columns')

  ok(MIGRATION_146_COLUMNS.includes('source_work_order_id'),
    'source_work_order_id is a tolerated column')

  const missing = missingMigration142Column({
    code: 'PGRST204',
    message: "Could not find the 'source_work_order_id' column of 'invoices' in the schema cache",
  })
  ok(missing === 'source_work_order_id', `a 146 column is detected as missing (got ${JSON.stringify(missing)})`)

  const row = {
    invoice_number: 'INV-TEST',
    source_work_order_id: 'abc',
    parts_markup_percent: 30,
    unit_number: '1R',
    labor_subtotal: 95,
  }

  // THE REGRESSION THIS CATCHES: stripping everything when only 146 is missing would
  // silently throw away the markup and the unit number on a perfectly good invoice.
  const strippedFor146 = withoutColumnsForMissing(row, 'source_work_order_id')
  ok(!('source_work_order_id' in strippedFor146), 'the 146 retry drops source_work_order_id')
  ok(strippedFor146.parts_markup_percent === 30,
    'and KEEPS parts_markup_percent - a missing 146 must not cost a 142 column')
  ok(strippedFor146.unit_number === '1R', 'and keeps unit_number')
  ok(strippedFor146.labor_subtotal === 95, 'and keeps labor_subtotal')

  const strippedFor142 = withoutColumnsForMissing(row, 'parts_markup_percent')
  ok(!('parts_markup_percent' in strippedFor142), 'a 142 retry drops the 142 columns')
  ok(strippedFor142.source_work_order_id === 'abc',
    'and keeps source_work_order_id - the groups are independent in both directions')

  // The old direct-call helper must keep its original 142-only behaviour, because
  // several routes call it without knowing which column was missing.
  const legacy = withoutMigration142Columns(row)
  ok(!('parts_markup_percent' in legacy), 'withoutMigration142Columns still strips 142')
  ok(legacy.source_work_order_id === 'abc',
    'and deliberately does NOT strip 146 - its direct callers never set that column')

  console.log('\n' + '='.repeat(78))
  console.log(`${pass} passed, ${fail} failed`)
  console.log('='.repeat(78))
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
