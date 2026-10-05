// INV-2026-0015 showed two different totals on one screen, then got finalized with
// the wrong one. This proves the mechanism, the fix, and the current damage.
//
// Read-only against production. Nothing is written.
//
//   npx tsx scripts/verify-inv-0015.ts
//
// WHAT HAPPENED, in order:
//   1. The converter wrote the correct figures: subtotal 139.63 (138.86 of lines plus
//      a 0.77 shop supplies fee), tax 10.82, total 150.45.
//   2. The in-progress editor RECOMPUTED on render. useExtrasSettings reports
//      EXTRAS_OFF until the profile fetch resolves, so the recomputed fee was 0.00 and
//      the screen subtracted a charge the invoice already carried: 138.86 / 10.76 /
//      149.62. Two totals, one screen.
//   3. Finalize PATCHed those recomputed figures over the stored ones and the invoice
//      moved to awaiting_payment holding them. shop_supplies_fee stayed 0.77, so the
//      row STATED a charge that was not inside its own subtotal.
//   4. REPAIRED 2026-10-05 via scripts/repair-inv-2026-0015.sql, Option A - corrected
//      up to 150.45, which was the honest choice because sent_to_customer_at was NULL,
//      times_sent 0 and customer_view_count 0, so nobody had seen the lower figure.
//
// This script stays because the MECHANISM is what matters, and it still runs: section
// 2 reproduces the bug from inputs, section 3 proves the fix on the same inputs, and
// section 1 asserts the invariant on whatever the row currently holds.

import fs from 'fs'
import {
  computeExtras, extrasTaxBuckets, extrasDisplayRows, extrasFromDocument,
  extrasAgree, partsBaseFromLines, EXTRAS_OFF,
} from '../src/lib/billable-extras'
import { computeTax, parseBreakdown, breakdownTaxTotal } from '../src/lib/tax'

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

const TAX = { tax_parts: true, tax_labor: true, tax_rate_parts: 7.75, tax_rate_labor: 7.75 }

async function main() {
  const rows = await get('invoices?select=*&invoice_number=eq.INV-2026-0015') as Array<Record<string, unknown>>
  ok(rows.length === 1, 'INV-2026-0015 exists')
  if (!rows.length) return
  const inv = rows[0]

  const lines   = Array.isArray(inv.line_items) ? inv.line_items as Array<Record<string, unknown>> : []
  const lineSum = r2(lines.reduce((n, l) => n + Number(l.total ?? 0), 0))
  const fee     = Number(inv.shop_supplies_fee ?? 0)
  const bd      = parseBreakdown(inv.tax_breakdown)
  const stored  = extrasFromDocument(inv)

  // The figures a correct row holds, derived from the parts that cannot drift: the
  // line items and the stated fee.
  const partsBase      = partsBaseFromLines(inv.line_items)
  const correctParts   = r2(partsBase + fee)
  const correctLabor   = Number(bd?.labor?.base ?? 135)
  const correctSub     = r2(lineSum + fee)
  const correctTax     = computeTax({ parts: correctParts, labor: correctLabor }, TAX).taxAmount
  const correctTotal   = r2(correctSub + correctTax)

  // ══ 1. THE STORED ROW, AND WHETHER IT ADDS UP ══════════════════════════════
  hr('1. The row as it stands, against the invariant')

  console.log(`  invoice_status       ${inv.invoice_status}`)
  console.log(`  lines sum            ${lineSum.toFixed(2)}`)
  console.log(`  shop_supplies_fee    ${fee.toFixed(2)}`)
  console.log(`  stored subtotal      ${Number(inv.subtotal).toFixed(2)}`)
  console.log(`  stored tax           ${Number(inv.tax_amount).toFixed(2)}`)
  console.log(`  stored total         ${Number(inv.total).toFixed(2)}`)
  console.log(`  taxed parts base     ${bd?.parts?.base}`)
  console.log(`  CORRECT would be     ${correctSub.toFixed(2)} / ${correctTax.toFixed(2)} / ${correctTotal.toFixed(2)}`)

  ok(lineSum === 138.86, `the two lines sum to 138.86 (got ${lineSum.toFixed(2)})`)
  ok(fee === 0.77, `a 0.77 supplies fee is stated (got ${fee.toFixed(2)})`)
  ok(correctTotal === 150.45, `so the correct total is 150.45 (got ${correctTotal.toFixed(2)})`)

  // THE INVARIANT, not a snapshot. This invoice was finalized mid-investigation, so
  // asserting yesterday's numbers would pin a moment rather than catch the damage.
  const consistent = Number(inv.subtotal) === correctSub
  ok(consistent,
    `the stored subtotal must INCLUDE the stated fee: ${lineSum.toFixed(2)} + ${fee.toFixed(2)} = ${correctSub.toFixed(2)} (stored ${Number(inv.subtotal).toFixed(2)})`)
  ok(breakdownTaxTotal(bd) === Number(inv.tax_amount),
    `the stored tax equals its own buckets (${breakdownTaxTotal(bd).toFixed(2)})`)
  ok(r2(Number(inv.subtotal) + Number(inv.tax_amount)) === Number(inv.total),
    'and subtotal + tax = total, so the row is at least internally arithmetic')

  if (!consistent) {
    const short = r2(correctTotal - Number(inv.total))
    console.log('')
    console.log('  >>> THIS INVOICE IS WRONG IN THE DATABASE.')
    console.log(`      It states a ${fee.toFixed(2)} shop supplies charge that is NOT inside its`)
    console.log(`      subtotal, its tax, or its total. invoice_status is "${inv.invoice_status}".`)
    console.log(`      The customer is under-billed by ${short.toFixed(2)}.`)
    console.log('      Repair SQL written, NOT run: scripts/repair-inv-2026-0015.sql')
    console.log('')
  }

  // ══ 2. THE MECHANISM, REPRODUCED ═══════════════════════════════════════════
  hr('2. The old behaviour, reproduced from the correct baseline')

  ok(partsBase === 3.86, `the parts base off the lines is 3.86 (got ${partsBase})`)

  // No recorded terms passed, so EXTRAS_OFF yielded zero for everything. That is the
  // first render of every page load, not an edge case.
  const oldExtras = computeExtras(partsBase, { travelHours: 0, mileageMiles: 0 }, EXTRAS_OFF, 0)
  ok(oldExtras.shopSupplies.amount === 0,
    'with the settings unresolved and no recorded terms, the recomputed fee was 0.00')

  // Reproduced from the CORRECT baseline, not from inv.subtotal - that value has since
  // been overwritten by the very bug being reproduced, which would make this circular.
  const reSub   = r2(correctSub - stored.total + oldExtras.total)
  const reParts = r2(correctParts - extrasTaxBuckets(stored).parts + extrasTaxBuckets(oldExtras).parts)
  const reTax   = computeTax({ parts: reParts, labor: correctLabor }, TAX).taxAmount
  const reTotal = r2(reSub + reTax)
  console.log(`  recompute from ${correctSub.toFixed(2)}: ${reSub.toFixed(2)} / ${reTax.toFixed(2)} / ${reTotal.toFixed(2)}`)

  ok(reSub === 138.86,   `reproduces the reported subtotal 138.86 (got ${reSub.toFixed(2)})`)
  ok(reTax === 10.76,    `reproduces the reported tax 10.76 (got ${reTax.toFixed(2)})`)
  ok(reTotal === 149.62, `reproduces the reported total 149.62 (got ${reTotal.toFixed(2)})`)
  // This asserted reTotal === inv.total, i.e. that the DAMAGED figure was still in
  // the database - which was the proof that the reproduction was the real mechanism.
  // The row was repaired on 2026-10-05 (Option A, nothing had been sent), so that
  // assertion had served its purpose and would now fail for the best possible reason.
  //
  // What remains worth asserting is the pair: the reproduction still lands on the
  // figure that WAS written, and the row no longer holds it.
  ok(reTotal === 149.62,
    'the reproduction still lands on 149.62, the figure finalize actually wrote')
  ok(Number(inv.total) !== reTotal,
    `and the row no longer holds it - repaired to ${Number(inv.total).toFixed(2)}`)
  ok(Number(inv.total) === correctTotal,
    `the repair landed on the correct ${correctTotal.toFixed(2)}, not an arbitrary number`)

  // ══ 3. THE FIX ON THE SAME INPUTS ══════════════════════════════════════════
  hr('3. With the recorded terms honoured, both blocks agree')

  const newExtras = computeExtras(
    partsBase,
    {
      travelHours:  Number(inv.travel_hours ?? 0),
      mileageMiles: Number(inv.mileage_miles ?? 0),
      shopSuppliesPercentOverride: inv.shop_supplies_percent_applied == null ? null : Number(inv.shop_supplies_percent_applied),
      shopSuppliesCapOverride:     inv.shop_supplies_cap_applied == null ? null : Number(inv.shop_supplies_cap_applied),
      travelRateOverride:          inv.travel_rate  == null ? null : Number(inv.travel_rate),
      mileageRateOverride:         inv.mileage_rate == null ? null : Number(inv.mileage_rate),
    },
    EXTRAS_OFF,   // deliberately: the settings are STILL unavailable
    0,
  )

  ok(newExtras.shopSupplies.amount === 0.77,
    `the fee is recovered from the recorded 20% even with settings off: 0.77 (got ${newExtras.shopSupplies.amount.toFixed(2)})`)

  const fixSub   = r2(correctSub - stored.total + newExtras.total)
  const fixParts = r2(correctParts - extrasTaxBuckets(stored).parts + extrasTaxBuckets(newExtras).parts)
  const fixTax   = computeTax({ parts: fixParts, labor: correctLabor }, TAX).taxAmount
  const fixTotal = r2(fixSub + fixTax)

  console.log(`\n  Authorized Work   subtotal ${correctSub.toFixed(2)}  tax ${correctTax.toFixed(2)}  total ${correctTotal.toFixed(2)}`)
  console.log(`  Running Total     subtotal ${fixSub.toFixed(2)}  tax ${fixTax.toFixed(2)}  total ${fixTotal.toFixed(2)}`)

  ok(fixSub === correctSub,     `BOTH BLOCKS AGREE on subtotal: ${fixSub.toFixed(2)}`)
  ok(fixTax === correctTax,     `and on tax: ${fixTax.toFixed(2)}`)
  ok(fixTotal === correctTotal, `and on total: ${fixTotal.toFixed(2)} - to the penny`)
  ok(fixTotal === 150.45,       'which is the correct 150.45')
  ok(fixTotal !== reTotal,      `and it is ${r2(fixTotal - reTotal).toFixed(2)} above what the bug produced`)

  // ══ 4. THE FEE IS ITEMIZED, NOT FOLDED ═════════════════════════════════════
  hr('4. The fee prints as its own line, on every surface that charges it')

  const storedRows = extrasDisplayRows(stored)
  ok(storedRows.length === 1, `the stored extras yield exactly one row (got ${storedRows.length})`)
  ok(storedRows[0]?.key === 'shop_supplies', 'and it is the shop supplies line')
  ok(storedRows[0]?.amount === 0.77, `showing 0.77 (got ${storedRows[0]?.amount})`)
  ok(storedRows[0]?.detail === '20% of parts', `labelled with the basis: "${storedRows[0]?.detail}"`)

  const printed = r2(lineSum + storedRows.reduce((n, r) => n + r.amount, 0))
  ok(printed === correctSub,
    `lines + itemized extras accounts for every charge: ${printed.toFixed(2)} - no unexplained gap on screen`)

  const surfaces: Array<[string, string]> = [
    ['invoice, in progress',   'src/app/financials/invoices/[id]/InvoiceInProgressClient.tsx'],
    ['invoice, finalized',     'src/app/financials/invoices/[id]/FinalizedInvoiceClient.tsx'],
    ['invoice, customer copy', 'src/app/invoice/[token]/page.tsx'],
    ['quote, customer copy',   'src/app/quote/[token]/page.tsx'],
    ['quote editor',           'src/components/financials/QuotesTab.tsx'],
    ['work order segments',    'src/components/shared/SegmentList.tsx'],
    ['HD invoice',             'src/app/hd/invoices/[id]/page.tsx'],
    ['HD invoice PDF',         'src/app/api/hd/invoices/[id]/pdf/route.ts'],
    ['HD quote',               'src/app/hd/quotes/[id]/page.tsx'],
    ['HD pay page',            'src/components/hd/PublicInvoicePay.tsx'],
  ]
  for (const [name, file] of surfaces) {
    const src = fs.readFileSync(file, 'utf8')
    // SegmentList itemizes from the rows the SERVER computed, so it renders them
    // without calling extrasDisplayRows itself. Accepting either is not a loosening:
    // the question is whether the surface prints the lines.
    const itemizes = src.includes('extrasDisplayRows(') ||
      (src.includes('extras.map(') && src.includes('r.label'))
    ok(itemizes, `${name} itemizes the extras`)
  }

  // ══ 5. THE GUARD RUNS IN PROGRESS ══════════════════════════════════════════
  hr('5. extrasAgree runs on the state a tech actually looks at')

  const prog = fs.readFileSync('src/app/financials/invoices/[id]/InvoiceInProgressClient.tsx', 'utf8')
  ok(prog.includes('runningExtrasMismatch'), 'the in-progress screen computes the check')
  ok(prog.includes('extrasAgree('), 'using extrasAgree')
  ok(prog.includes('This invoice does not add up'), 'and shows it to the tech')
  ok(prog.includes('if (runningExtrasMismatch) {'), 'and refuses to finalize while it fails')

  // It must be able to fire, on exactly this shape.
  const fires = extrasAgree(stored, 138.86, 138.86)
  ok(fires !== null, 'and it FIRES on exactly the INV-2026-0015 shape')
  console.log(`    message: ${fires}`)
  const quiet = extrasAgree(stored, correctSub, lineSum)
  ok(quiet === null, 'and passes once the 0.77 is inside the subtotal')

  // ══ 6. THE NOTE IS NO LONGER FALSE ═════════════════════════════════════════
  hr('6. The on-screen claim about the Running Total')

  ok(!prog.includes('computed into the\n          Running Total'),
    'the old unconditional claim is gone')
  ok(prog.includes('It shows as its own line in the'),
    'replaced with something true: it shows as its own line')
  ok(prog.includes('extrasResult.shopSupplies.amount > 0'),
    'and it names the actual figure rather than asserting one exists')

  console.log('\n' + '='.repeat(78))
  console.log(`${pass} passed, ${fail} failed`)
  console.log('='.repeat(78))
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
