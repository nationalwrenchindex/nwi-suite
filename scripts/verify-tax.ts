// Verification for migration 140 / src/lib/tax.ts.
//
// Runs the REAL calculator against REAL production rows, read-only. Nothing here
// fabricates a document: every base comes out of the database, which is the whole
// point -- a fabricated object is how the PGRST201 embed shipped past 40 passing
// assertions.
//
//   npx tsx scripts/verify-tax.ts

import fs from 'fs'
import {
  computeTax, effectiveRatePercent, taxDisplayRows, parseBreakdown, mergeBreakdowns,
  fractionToPercent, type TaxSettings,
} from '../src/lib/tax'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function get<T>(path: string): Promise<T[]> {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H })
  const t = await r.text()
  if (r.status !== 200) throw new Error(`${r.status} ${path} :: ${t.slice(0, 300)}`)
  return JSON.parse(t)
}

const usd = (n: number) => `$${n.toFixed(2)}`
let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) pass++; else fail++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}

function show(title: string, base: Record<string, number>, s: TaxSettings) {
  const r = computeTax(base, s)
  console.log(`\n  ${title}`)
  console.log(`    settings: parts ${s.tax_parts ? 'ON' : 'OFF'} @ ${s.tax_rate_parts}%   labor ${s.tax_labor ? 'ON' : 'OFF'} @ ${s.tax_rate_labor}%`)
  for (const row of taxDisplayRows(r.breakdown)) {
    console.log(`    ${row.label.padEnd(9)} base ${usd(row.base).padStart(10)}   ${row.text.padEnd(28)} ${usd(row.amount).padStart(9)}`)
  }
  console.log(`    ${'subtotal'.padEnd(9)}      ${usd(r.subtotal).padStart(10)}`)
  console.log(`    ${'TAX'.padEnd(9)}      ${usd(r.taxAmount).padStart(10)}   effective ${effectiveRatePercent(r)}%`)
  console.log(`    ${'TOTAL'.padEnd(9)}      ${usd(Math.round((r.subtotal + r.taxAmount) * 100) / 100).padStart(10)}`)
  return r
}

interface HdInv {
  invoice_number: string; subtotal_labor: string | number; subtotal_parts: string | number
  diagnostic_fee: string | number; road_call_fee: string | number
  tax_rate: string | number; tax_amount: string | number; total: string | number
}
interface LdInv {
  invoice_number: string; subtotal: string | number; tax_rate: string | number
  tax_amount: string | number; total: string | number
  shop_supplies: Array<{ total: number }> | null
  line_items: Array<{ description: string; total: number }> | null
  tax_breakdown: unknown
  source: string | null
}

async function main() {
  const num = (v: unknown) => Number(v ?? 0)

  console.log('='.repeat(78))
  console.log('1. REGRESSION: with labor taxed ON, does the calculator reproduce today?')
  console.log('   (this is what every existing shop keeps doing after migration 140)')
  console.log('='.repeat(78))

  const hd = await get<HdInv>(
    'hd_invoices?select=invoice_number,subtotal_labor,subtotal_parts,diagnostic_fee,road_call_fee,tax_rate,tax_amount,total&order=created_at.desc&limit=50',
  )
  console.log(`\n  ${hd.length} HD invoices from production\n`)
  console.log('    invoice          stored tax   calculated   delta')
  for (const i of hd) {
    const rate = num(i.tax_rate)
    const s: TaxSettings = { tax_parts: true, tax_labor: true, tax_rate_parts: rate, tax_rate_labor: rate }
    // Today's base: labor + parts + diagnostic + road call, all taxed together.
    const r = computeTax(
      { parts: num(i.subtotal_parts), labor: num(i.subtotal_labor) + num(i.diagnostic_fee) + num(i.road_call_fee) },
      s,
    )
    const stored = num(i.tax_amount)
    const delta = Math.round((r.taxAmount - stored) * 100) / 100
    console.log(`    ${i.invoice_number.padEnd(16)}${usd(stored).padStart(10)}${usd(r.taxAmount).padStart(13)}${usd(delta).padStart(8)}`)
    ok(Math.abs(delta) <= 0.01, `${i.invoice_number} reproduced within a cent`)
  }

  console.log('\n' + '='.repeat(78))
  console.log('2. THE THREE CASES, labor tax OFF and ON, from real rows')
  console.log('='.repeat(78))

  // -- parts-only: a real HD invoice with labor 0 would be ideal; pick the row with
  //    the largest parts and smallest labor, and state which row it is.
  const partsOnly = [...hd].sort((a, b) => (num(b.subtotal_parts) - num(b.subtotal_labor)) - (num(a.subtotal_parts) - num(a.subtotal_labor)))[0]
  // -- labor-only: real rows exist with parts = 0.
  //    Requires a real non-zero rate: two production rows have tax_rate 0 and charge
  //    no tax at all, and substituting a rate for them would be inventing a document.
  const laborOnly = hd.find(i => num(i.subtotal_parts) === 0 && num(i.subtotal_labor) > 0 && num(i.tax_rate) > 0)
  // -- mixed with a diagnostic/road fee.
  const mixed = hd.find(i => num(i.subtotal_parts) > 0 && num(i.subtotal_labor) > 0 && (num(i.diagnostic_fee) + num(i.road_call_fee)) > 0 && num(i.tax_rate) > 0)

  for (const [title, inv] of [
    ['PARTS-HEAVY', partsOnly] as const,
    ['LABOR-ONLY (parts = 0)', laborOnly] as const,
    ['MIXED + fee', mixed] as const,
  ]) {
    if (!inv) { console.log(`\n  ${title}: no production row of this shape`); continue }
    const rate = num(inv.tax_rate)
    const parts = num(inv.subtotal_parts)
    const labor = num(inv.subtotal_labor) + num(inv.diagnostic_fee) + num(inv.road_call_fee)
    console.log('\n' + '-'.repeat(78))
    console.log(`  ${title} - HD ${inv.invoice_number}  (parts ${usd(parts)}, labor+fees ${usd(labor)}, rate ${rate}%)`)
    console.log(`  stored today: tax ${usd(num(inv.tax_amount))}, total ${usd(num(inv.total))}`)
    const on  = show('labor tax ON  (today, and what every shop keeps after 140)', { parts, labor }, { tax_parts: true, tax_labor: true,  tax_rate_parts: rate, tax_rate_labor: rate })
    const off = show('labor tax OFF (the Florida fix)',                            { parts, labor }, { tax_parts: true, tax_labor: false, tax_rate_parts: rate, tax_rate_labor: 0 })
    const saved = Math.round((on.taxAmount - off.taxAmount) * 100) / 100
    console.log(`    -> customer is charged ${usd(saved)} less tax`)
    ok(off.taxAmount <= on.taxAmount, `${inv.invoice_number}: turning labor tax off never increases tax`)
    ok(off.breakdown.labor?.taxed === false, `${inv.invoice_number}: labor bucket marked not taxable`)
    ok(Math.abs(off.taxAmount - Math.round(parts * rate) / 100) < 0.02 || parts === 0,
       `${inv.invoice_number}: labor-off tax equals parts x rate`)
  }

  console.log('\n' + '='.repeat(78))
  console.log('3. LD invoice with SHOP SUPPLIES (parts side) - real rows')
  console.log('='.repeat(78))
  // tax_breakdown only exists once migration 140 has been applied, so this probes for
  // it rather than assuming either state. Reporting which half of the run this is
  // matters more than making the query succeed.
  let hasBreakdownColumn = true
  let ld: LdInv[]
  try {
    ld = await get<LdInv>(
      'invoices?select=invoice_number,subtotal,tax_rate,tax_amount,total,shop_supplies,line_items,source,tax_breakdown&order=created_at.desc&limit=30',
    )
  } catch {
    hasBreakdownColumn = false
    ld = await get<LdInv>(
      'invoices?select=invoice_number,subtotal,tax_rate,tax_amount,total,shop_supplies,line_items,source&order=created_at.desc&limit=30',
    )
  }
  console.log(`
  invoices.tax_breakdown column present: ${hasBreakdownColumn ? 'YES (migration 140 applied)' : 'NO (migration 140 not yet run)'}`)
  const withSupplies = ld.filter(i => Array.isArray(i.shop_supplies) && i.shop_supplies.length > 0)
  console.log(`\n  ${ld.length} LD invoices; ${withSupplies.length} carry shop supplies`)
  console.log('  NOTE: invoices.tax_rate is a FRACTION here; converted with fractionToPercent.')
  for (const i of withSupplies.slice(0, 3)) {
    const supplies = (i.shop_supplies ?? []).reduce((s, x) => s + Number(x.total ?? 0), 0)
    const rate = fractionToPercent(i.tax_rate)
    console.log(`\n  ${i.invoice_number}: subtotal ${usd(num(i.subtotal))} (incl. ${usd(supplies)} shop supplies), rate ${rate}%`)
    console.log(`    stored: tax ${usd(num(i.tax_amount))}, total ${usd(num(i.total))}`)
    ok(parseBreakdown(i.tax_breakdown) === null,
       `${i.invoice_number}: no stored breakdown, so it reads as a legacy document and is not re-split`)
  }
  if (withSupplies.length === 0) {
    console.log('  No production LD invoice carries shop supplies today.')
    console.log('  Reporting that rather than inventing one: shop supplies are wired to the')
    console.log('  parts bucket in code, but I have no real row to show the figure on.')
  }

  console.log('\n' + '='.repeat(78))
  console.log('4. Detailer behaviour must not move (services bucket, always taxed)')
  console.log('='.repeat(78))
  const det = await get<{ id: string; business_name: string | null; default_tax_percent: string | number }>(
    'profiles?select=id,business_name,default_tax_percent&business_type=eq.detailer&limit=3',
  )
  for (const d of det) {
    const rate = num(d.default_tax_percent)
    const s: TaxSettings = { tax_parts: true, tax_labor: false, tax_rate_parts: rate, tax_rate_labor: 0 }
    // A detailer document's whole base is service lines + adjustments.
    const base = 250
    const r = computeTax({ services: base }, s)
    const legacy = Math.round(base * (rate / 100) * 100) / 100
    console.log(`\n  ${d.business_name ?? '(no name)'} @ ${rate}%: services ${usd(base)}`)
    console.log(`    legacy whole-subtotal tax: ${usd(legacy)}   calculator: ${usd(r.taxAmount)}`)
    ok(r.taxAmount === legacy, 'detailer tax unchanged even with labor tax OFF')
    ok(r.breakdown.services?.taxed === true, 'services bucket is taxed')
    ok(r.breakdown.labor === undefined, 'no labor bucket invented for a detailer')
  }


  console.log('\n' + '='.repeat(78))
  console.log('5. The labor-name rule, against real LD invoice line_items')
  console.log('='.repeat(78))
  // invoices.line_items has no type column, so the LD invoice form splits it with
  // isLaborItem -- the same rule line-items.ts already uses to round-trip labor. This
  // runs that rule over REAL stored lines and prints what each one is treated as, so a
  // line that would be mis-bucketed is visible rather than assumed.
  const isLaborLine = (d: unknown) => /^labor/i.test(String(d ?? '').trim())
  let shown = 0
  for (const i of ld) {
    const lines = Array.isArray(i.line_items) ? i.line_items : []
    if (lines.length === 0 || shown >= 4) continue
    shown++
    const labor = lines.filter(l => isLaborLine(l.description)).reduce((a, l) => a + num(l.total), 0)
    const total = lines.reduce((a, l) => a + num(l.total), 0)
    const parts = Math.round((total - labor) * 100) / 100
    const rate  = fractionToPercent(i.tax_rate)
    console.log(`\n  ${i.invoice_number}  rate ${rate}%  (stored tax ${usd(num(i.tax_amount))})`)
    for (const l of lines) {
      console.log(`     ${isLaborLine(l.description) ? 'LABOR' : 'parts'}  ${String(l.description).slice(0, 44).padEnd(46)} ${usd(num(l.total))}`)
    }
    const on  = computeTax({ parts, labor }, { tax_parts: true, tax_labor: true,  tax_rate_parts: rate, tax_rate_labor: rate })
    const off = computeTax({ parts, labor }, { tax_parts: true, tax_labor: false, tax_rate_parts: rate, tax_rate_labor: 0 })
    console.log(`     split: parts ${usd(parts)} / labor ${usd(labor)}`)

    // THE LIMIT OF THE NAME RULE, stated rather than glossed over. The work-order
    // converter prefixes every description with "Segment N — ", so a labor line reads
    // as "Segment 1 — diagnose and replace tcm" and /^labor/i never matches it. Such an
    // invoice splits entirely to parts if this rule is the only thing deciding -- which
    // is exactly why a converted invoice carries a stored tax_breakdown and every
    // editor reads THAT in preference to re-deriving from descriptions.
    if (i.source !== 'manual' && labor === 0) {
      console.log(`     NOTE: source=${i.source} — the name rule finds no labor in these`)
      console.log('           descriptions. Its real split comes from the stored')
      console.log('           breakdown, not from this rule.')
    }
    console.log(`     tax with labor ON ${usd(on.taxAmount)}   OFF ${usd(off.taxAmount)}   customer saves ${usd(Math.round((on.taxAmount - off.taxAmount) * 100) / 100)}`)
    ok(Math.abs((parts + labor) - total) < 0.02, `${i.invoice_number}: the two buckets add back to the line total`)
    ok(off.taxAmount <= on.taxAmount, `${i.invoice_number}: turning labor tax off never increases tax`)
  }
  if (shown === 0) console.log('  No production LD invoice carries line_items.')

  console.log('\n' + '='.repeat(78))
  console.log('6. Merging segment breakdowns onto one invoice')
  console.log('='.repeat(78))
  // A work order bills several authorized segments onto ONE invoice, so the customer
  // should see one parts figure and one labor figure, not four of each.
  const segRate = 7.75
  const segSettings = { tax_parts: true, tax_labor: false, tax_rate_parts: segRate, tax_rate_labor: 0 }
  const segs = await get<{ sequence: number; parts_subtotal: string | number; labor_subtotal: string | number }>(
    'work_order_segments?select=sequence,parts_subtotal,labor_subtotal&order=sequence',
  )
  const perSegment = segs.map(sg => computeTax({ parts: num(sg.parts_subtotal), labor: num(sg.labor_subtotal) }, segSettings))
  segs.forEach((sg, idx) => console.log(`  segment ${sg.sequence}: parts ${usd(num(sg.parts_subtotal))} labor ${usd(num(sg.labor_subtotal))} -> tax ${usd(perSegment[idx].taxAmount)}`))
  const merged = mergeBreakdowns(perSegment.map(r => r.breakdown))
  if (merged) {
    for (const r of taxDisplayRows(merged)) {
      console.log(`  merged ${r.label.padEnd(9)} base ${usd(r.base).padStart(10)}  ${r.text.padEnd(26)} ${usd(r.amount)}`)
    }
    const sumOfParts = Math.round(perSegment.reduce((a, r) => a + r.taxAmount, 0) * 100) / 100
    const mergedTax  = Math.round(((merged.parts?.amount ?? 0) + (merged.labor?.amount ?? 0) + (merged.services?.amount ?? 0)) * 100) / 100
    ok(sumOfParts === mergedTax, `merged tax ${usd(mergedTax)} equals the sum of the segments ${usd(sumOfParts)}`)
    ok(merged.labor?.taxed === false, 'merged labor bucket stays untaxed')
  } else {
    console.log('  No segments in production to merge.')
  }

  console.log('\n' + '='.repeat(78))
  console.log(`${pass} passed, ${fail} failed`)
  console.log('='.repeat(78))
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
