// ACCEPTANCE: two shops on different rates must both land exactly.
//
// Shop B is the one that matters. If anything in the pricing path is hardcoded to the
// first shop's numbers - 135/hr, 2.00/mi, 20%, a 100 cap, 30% markup, 7.75% on both
// buckets - then Shop A will pass and Shop B will not.
//
//   npx tsx scripts/verify-two-shops.ts
//
// Pure computation plus a real database read at the end. Nothing is written.

import fs from 'fs'
import {
  computeExtras, extrasTaxBuckets, extrasDelta, extrasDisplayRows,
  type ExtrasSettings,
} from '../src/lib/billable-extras'
import { computeTax, type TaxSettings } from '../src/lib/tax'

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
const r2 = (n: number) => Math.round(n * 100) / 100
const usd = (n: number) => n.toFixed(2)

interface Shop {
  name:        string
  laborRate:   number
  markupPct:   number
  extras:      ExtrasSettings
  tax:         TaxSettings
  // The job
  partBase:    number
  laborHours:  number
  travelHours: number
  miles:       number
  // What it must come to
  expect: {
    parts: number; labor: number; travel: number; mileage: number; supplies: number
    subtotal: number; taxParts: number; taxLabor: number; tax: number; total: number
  }
}

const SHOPS: Shop[] = [
  {
    name: 'Shop A',
    laborRate: 135, markupPct: 30,
    extras: {
      billTravel: true,       travelRatePerHour:   135,
      billMileage: true,      mileageRatePerMile:  2.00,
      billShopSupplies: true, shopSuppliesPercent: 20, shopSuppliesCap: 100,
    },
    tax: { tax_parts: true, tax_labor: true, tax_rate_parts: 7.75, tax_rate_labor: 7.75 },
    partBase: 100, laborHours: 2, travelHours: 2, miles: 40,
    expect: {
      parts: 130, labor: 270, travel: 270, mileage: 80, supplies: 26,
      subtotal: 776, taxParts: 12.09, taxLabor: 41.85, tax: 53.94, total: 829.94,
    },
  },
  {
    name: 'Shop B',
    laborRate: 110, markupPct: 25,
    extras: {
      billTravel: true,       travelRatePerHour:   95,
      billMileage: true,      mileageRatePerMile:  0.65,
      billShopSupplies: true, shopSuppliesPercent: 10, shopSuppliesCap: 50,
    },
    // 6.5% on parts, 0% on labour.
    tax: { tax_parts: true, tax_labor: true, tax_rate_parts: 6.5, tax_rate_labor: 0 },
    partBase: 200, laborHours: 3, travelHours: 1.5, miles: 100,
    expect: {
      parts: 250, labor: 330, travel: 142.50, mileage: 65, supplies: 25,
      subtotal: 812.50, taxParts: 17.88, taxLabor: 0, tax: 17.88, total: 830.38,
    },
  },
]

async function main() {
  for (const shop of SHOPS) {
    hr(`${shop.name}: labor ${shop.laborRate}, travel ${shop.extras.travelRatePerHour}, mileage ${shop.extras.mileageRatePerMile}, supplies ${shop.extras.shopSuppliesPercent}% cap ${shop.extras.shopSuppliesCap}, markup ${shop.markupPct}%`)

    // The document's own money, before extras.
    const parts = r2(shop.partBase * (1 + shop.markupPct / 100))
    const labor = r2(shop.laborHours * shop.laborRate)

    // The three extras, from THIS shop's settings and nothing else.
    const extras = computeExtras(
      parts,
      { travelHours: shop.travelHours, mileageMiles: shop.miles },
      shop.extras,
      shop.laborRate,
    )
    const delta   = extrasDelta(extras, shop.tax)
    const buckets = extrasTaxBuckets(extras)

    // Tax on the document plus the extras, each bucket rounded once then summed.
    const taxable = computeTax(
      { parts: r2(parts + buckets.parts), labor: r2(labor + buckets.labor) },
      shop.tax,
    )
    const subtotal = r2(parts + labor + delta.subtotalDelta)
    const total    = r2(subtotal + taxable.taxAmount)

    console.log(`  Parts    ${usd(parts)}`)
    console.log(`  Labor    ${usd(labor)}`)
    for (const r of extrasDisplayRows(extras)) {
      console.log(`  ${r.label.padEnd(8)} ${usd(r.amount).padStart(8)}   ${r.detail ?? ''}`)
    }
    console.log(`  Subtotal ${usd(subtotal)}`)
    console.log(`  Tax      ${usd(taxable.taxAmount)}   parts ${usd(taxable.breakdown.parts?.base ?? 0)} -> ${usd(taxable.breakdown.parts?.amount ?? 0)}, labor ${usd(taxable.breakdown.labor?.base ?? 0)} -> ${usd(taxable.breakdown.labor?.amount ?? 0)}`)
    console.log(`  TOTAL    ${usd(total)}`)
    console.log('')

    const e = shop.expect
    ok(parts === e.parts,              `parts ${usd(e.parts)} (got ${usd(parts)})`)
    ok(labor === e.labor,              `labor ${usd(e.labor)} (got ${usd(labor)})`)
    ok(extras.travel.amount === e.travel,       `travel ${usd(e.travel)} (got ${usd(extras.travel.amount)})`)
    ok(extras.mileage.amount === e.mileage,     `mileage ${usd(e.mileage)} (got ${usd(extras.mileage.amount)})`)
    ok(extras.shopSupplies.amount === e.supplies, `supplies ${usd(e.supplies)} (got ${usd(extras.shopSupplies.amount)})`)
    ok(subtotal === e.subtotal,        `subtotal ${usd(e.subtotal)} (got ${usd(subtotal)})`)
    ok(r2(taxable.breakdown.parts?.amount ?? 0) === e.taxParts,
      `tax on parts ${usd(e.taxParts)} (got ${usd(taxable.breakdown.parts?.amount ?? 0)})`)
    ok(r2(taxable.breakdown.labor?.amount ?? 0) === e.taxLabor,
      `tax on labor ${usd(e.taxLabor)} (got ${usd(taxable.breakdown.labor?.amount ?? 0)})`)
    ok(taxable.taxAmount === e.tax,    `tax total ${usd(e.tax)} (got ${usd(taxable.taxAmount)})`)
    ok(total === e.total,              `GRAND TOTAL ${usd(e.total)} (got ${usd(total)})`)

    // The taxable bases, because that is where a hardcoded rate would hide.
    ok(r2(taxable.breakdown.parts?.base ?? 0) === r2(parts + e.supplies),
      `the parts bucket is parts + supplies = ${usd(r2(parts + e.supplies))}`)
    ok(r2(taxable.breakdown.labor?.base ?? 0) === r2(labor + e.travel),
      `the labour bucket is labor + travel = ${usd(r2(labor + e.travel))}`)
    ok(buckets.untaxed === e.mileage,
      `and the mileage ${usd(e.mileage)} is untaxed, in the subtotal only`)
  }

  // ══ THE TWO SHOPS MUST NOT AGREE ═══════════════════════════════════════════
  hr('The two shops must produce DIFFERENT numbers')

  const totals = SHOPS.map(s => s.expect.total)
  ok(totals[0] !== totals[1],
    `A lands on ${usd(totals[0])} and B on ${usd(totals[1])} - if these matched, the test could not detect a hardcoded rate`)

  // Run Shop B's job through SHOP A's settings. If the code is reading settings
  // properly this MUST differ from B's expected total. If it equals B's total, the
  // settings are being ignored.
  const b = SHOPS[1], a = SHOPS[0]
  const bPartsOnA = r2(b.partBase * (1 + a.markupPct / 100))
  const bOnA = computeExtras(bPartsOnA, { travelHours: b.travelHours, mileageMiles: b.miles }, a.extras, a.laborRate)
  const bOnATax = computeTax(
    { parts: r2(bPartsOnA + extrasTaxBuckets(bOnA).parts), labor: r2(b.laborHours * a.laborRate + extrasTaxBuckets(bOnA).labor) },
    a.tax)
  const bOnATotal = r2(bPartsOnA + b.laborHours * a.laborRate + extrasDelta(bOnA, a.tax).subtotalDelta + bOnATax.taxAmount)
  console.log(`  Shop B's job priced on Shop A's settings: ${usd(bOnATotal)}`)
  ok(bOnATotal !== b.expect.total,
    `which is NOT B's ${usd(b.expect.total)} - so the rates genuinely come from the settings passed in`)

  // ══ THE CAP ════════════════════════════════════════════════════════════════
  hr('Cap test: 20% with a 100 cap against 1000.00 of post-markup parts')

  const capped = computeExtras(1000, { travelHours: 0, mileageMiles: 0 }, {
    billTravel: false, travelRatePerHour: null,
    billMileage: false, mileageRatePerMile: null,
    billShopSupplies: true, shopSuppliesPercent: 20, shopSuppliesCap: 100,
  }, 0)
  ok(capped.shopSupplies.amount === 100,
    `bills 100.00, not 200.00 (got ${usd(capped.shopSupplies.amount)})`)
  ok(capped.shopSupplies.capped === true, 'and reports that the cap bit')

  // Shop B's smaller cap, on the same parts, must give a different answer.
  const cappedB = computeExtras(1000, { travelHours: 0, mileageMiles: 0 }, {
    billTravel: false, travelRatePerHour: null,
    billMileage: false, mileageRatePerMile: null,
    billShopSupplies: true, shopSuppliesPercent: 10, shopSuppliesCap: 50,
  }, 0)
  ok(cappedB.shopSupplies.amount === 50,
    `Shop B's 10% with a 50 cap bills 50.00 on the same parts (got ${usd(cappedB.shopSupplies.amount)})`)
  ok(cappedB.shopSupplies.amount !== capped.shopSupplies.amount,
    'and the two caps give different answers, so the cap is read not assumed')

  // ══ BOTH PRICING MODES, AGAINST REAL ROWS ══════════════════════════════════
  hr('Both pricing modes must carry a supplies fee')

  const get = async (p: string) => (await fetch(`${U}/rest/v1/${p}`, { headers: H })).json()
  const wos = await get('work_orders?select=id,work_order_number,shop_supplies_fee,shop_supplies_percent_applied,parts_subtotal,parts_markup_percent,line_items&order=work_order_number') as Array<Record<string, unknown>>
  const segs = await get('work_order_segments?select=ld_work_order_id,status,line_items') as Array<Record<string, unknown>>
  const segOf = new Set(segs.map(s => String(s.ld_work_order_id ?? '')))

  const lineItemWos = wos.filter(w => !segOf.has(String(w.id)))
  const segmentWos  = wos.filter(w =>  segOf.has(String(w.id)))
  console.log(`  work orders: ${wos.length} total, ${segmentWos.length} segment-priced, ${lineItemWos.length} line-item`)

  // Which of each mode have parts at all, and of those, which carry a fee.
  const partsOf = (w: Record<string, unknown>) => {
    const lines = Array.isArray(w.line_items) ? w.line_items as Array<Record<string, unknown>> : []
    const fromLines = lines.filter(l => l.type !== 'labor').reduce((n, l) => n + Number(l.total ?? 0), 0)
    if (fromLines > 0) return r2(fromLines)
    const b = Number(w.parts_subtotal ?? 0), m = Number(w.parts_markup_percent ?? 0)
    return b > 0 ? r2(b * (1 + m / 100)) : 0
  }
  const lineWithParts = lineItemWos.filter(w => partsOf(w) > 0)
  const lineWithFee   = lineWithParts.filter(w => Number(w.shop_supplies_fee ?? 0) > 0)
  console.log(`  line-item work orders WITH parts: ${lineWithParts.length}, of which carry a fee: ${lineWithFee.length}`)
  for (const w of lineWithParts) {
    console.log(`    ${w.work_order_number}  parts ${usd(partsOf(w))}  fee ${usd(Number(w.shop_supplies_fee ?? 0))}  pct ${w.shop_supplies_percent_applied ?? 'null'}`)
  }

  // This is the gap being closed. It is reported honestly rather than asserted green:
  // existing rows were written before the server-side computer existed, and nothing
  // backfills them - they get a fee the next time the work order is saved.
  if (lineWithParts.length > 0 && lineWithFee.length === 0) {
    console.log('')
    console.log('  NOTE: no EXISTING line-item work order carries a fee yet. These rows were')
    console.log('  written before the server-side computer existed and nothing backfills them;')
    console.log('  each gets one the next time it is saved. The code path is asserted below.')
  }

  // PROVE THE COMPUTATION ON THE REAL ROWS, read-only. The sync has not run on these
  // yet, so instead of asserting a stored fee that is not there, this asks the real
  // question: given each row's actual parts base and its OWN shop settings, does the
  // function produce a fee? If it returns zero on a work order with parts, the line-item
  // path is still broken regardless of what the code looks like.
  const profiles = await get('profiles?select=id,bill_shop_supplies,shop_supplies_percent,shop_supplies_cap,bill_travel,travel_rate_per_hour,bill_mileage,mileage_rate_per_mile') as Array<Record<string, unknown>>
  const settingsOf = new Map(profiles.map(p => [String(p.id), {
    billTravel:          !!p.bill_travel,
    travelRatePerHour:   p.travel_rate_per_hour  == null ? null : Number(p.travel_rate_per_hour),
    billMileage:         !!p.bill_mileage,
    mileageRatePerMile:  p.mileage_rate_per_mile == null ? null : Number(p.mileage_rate_per_mile),
    billShopSupplies:    !!p.bill_shop_supplies,
    shopSuppliesPercent: p.shop_supplies_percent == null ? null : Number(p.shop_supplies_percent),
    shopSuppliesCap:     p.shop_supplies_cap     == null ? null : Number(p.shop_supplies_cap),
  } as ExtrasSettings]))

  const owned = await get('work_orders?select=id,work_order_number,user_id,parts_subtotal,parts_markup_percent,line_items') as Array<Record<string, unknown>>
  const ownedLineItem = owned.filter(w => !segOf.has(String(w.id)) && partsOf(w) > 0)
  let billing = 0, wouldCharge = 0
  console.log('')
  console.log('  what the function WOULD produce from each real row and its own settings:')
  for (const w of ownedLineItem) {
    const st = settingsOf.get(String(w.user_id))
    if (!st) continue
    if (!st.billShopSupplies) continue
    billing++
    const base = partsOf(w)
    const got  = computeExtras(base, { travelHours: 0, mileageMiles: 0 }, st, 0).shopSupplies
    if (got.amount > 0) wouldCharge++
    const expect = st.shopSuppliesCap != null && r2(base * (st.shopSuppliesPercent! / 100)) > st.shopSuppliesCap
      ? r2(st.shopSuppliesCap)
      : r2(base * (st.shopSuppliesPercent! / 100))
    console.log(`    ${w.work_order_number}  parts ${usd(base)}  at ${st.shopSuppliesPercent}% cap ${st.shopSuppliesCap ?? 'none'}  ->  ${usd(got.amount)}${got.capped ? ' (capped)' : ''}  expected ${usd(expect)}`)
    ok(got.amount === expect,
      `${w.work_order_number}: the line-item parts base yields ${usd(expect)} from its own settings`)
  }
  console.log(`  line-item work orders belonging to a shop that bills supplies: ${billing}, all of which would charge: ${wouldCharge}`)
  ok(billing === 0 || wouldCharge === billing,
    `every line-item work order with parts at a supplies-billing shop WOULD get a fee (${wouldCharge} of ${billing})`)

  const sync = fs.readFileSync('src/lib/segments/parent-extras.ts', 'utf8')
  ok(sync.includes('lineItemPartsBase('),
    'the server-side sync has a line-item parts base')
  ok(sync.includes('const segmented = Array.isArray(segRows) && segRows.length > 0'),
    'and chooses the base by pricing mode rather than assuming segments')
  for (const f of ['src/app/api/work-orders/route.ts', 'src/app/api/work-orders/[id]/route.ts']) {
    const src = fs.readFileSync(f, 'utf8')
    ok(src.includes('syncParentExtrasQuietly('),
      `${f.split('/').slice(-2).join('/')} syncs the extras on write`)
  }

  console.log('\n' + '='.repeat(78))
  console.log(`${pass} passed, ${fail} failed`)
  console.log('='.repeat(78))
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
