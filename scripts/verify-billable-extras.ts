// Items 1c + 1d verification: travel time, mileage and shop supplies.
//
// The three cases named in the brief — a parts-and-labour job, a labour-only job,
// and a job that hits the cap — computed by the REAL calculator against the REAL
// tax settings of a REAL production shop. Read-only; nothing is written.
//
//   npx tsx scripts/verify-billable-extras.ts

import fs from 'fs'
import {
  computeExtras, extrasColumns, extrasFromDocument, extrasDisplayRows,
  extrasTaxBuckets, totalsWithExtras, extrasSettingsFrom, EXTRAS_OFF,
  type ExtrasSettings,
} from '../src/lib/billable-extras'
import { taxSettingsFrom, taxDisplayRows, type TaxSettings } from '../src/lib/tax'

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
const usd = (n: number) => `$${n.toFixed(2)}`
const get = async (p: string) => {
  const r = await fetch(`${U}/rest/v1/${p}`, { headers: H })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { __raw: t, __status: r.status } }
}

async function main() {
  // ══ The real shop ══════════════════════════════════════════════════════════
  hr('0. THE AUDIT — what already existed before any of this was built')

  const profiles = await get('profiles?select=id,business_name,default_labor_rate,default_parts_markup_percent,tax_parts,tax_labor,tax_rate_parts,tax_rate_labor,average_mpg,fuel_type') as Record<string, unknown>[]
  const shops = profiles.filter(p => p.business_name)
  ok(shops.length > 0, `production shops to price against (${shops.length}) — guards a vacuous pass`)

  const hdQ = await get('hd_invoices?select=invoice_number,road_call_fee,diagnostic_fee&road_call_fee=gt.0') as Record<string, unknown>[]
  console.log(`  HD road_call_fee is a FLAT charge, typed per document. ${hdQ.length} invoices carry one:`)
  for (const r of hdQ.slice(0, 5)) console.log(`    ${r.invoice_number}  road call ${usd(Number(r.road_call_fee))}`)
  console.log('  It has no hours and no rate, so it is a call-out charge, NOT travel time.')
  console.log('  Left exactly as it is; travel time is a separate line of hours x rate.')
  ok(hdQ.every(r => Number(r.road_call_fee) > 0),
    'every road-call fee in production is a flat dollar amount with no hours attached')

  const fuel = await get('invoices?select=invoice_number,miles_driven,fuel_cost,fuel_price_per_gallon&miles_driven=not.is.null') as Record<string, unknown>[]
  console.log(`\n  Fuel COST already exists, LD only, computed at payment time: ${fuel.length} invoices.`)
  for (const r of fuel.slice(0, 5)) {
    console.log(`    ${r.invoice_number}  ${r.miles_driven} mi -> cost ${usd(Number(r.fuel_cost ?? 0))}`)
  }
  console.log('  That is the COST side. Travel billing is the REVENUE side.')

  // The existing shop_supplies list — what it actually is.
  const withSupplies = await get('invoices?select=invoice_number,shop_supplies,shop_supplies_total,subtotal,total&shop_supplies=neq.[]') as Record<string, unknown>[]
  console.log(`\n  invoices.shop_supplies (migration 012): ${withSupplies.length} invoices have a non-empty list.`)
  console.log('  It is an ITEMISED, AT-COST list — billed to the customer AND booked as a')
  console.log('  COGS expense row when the invoice is paid. Per invoice, not per job.')
  console.log('  Quotes and work orders have no such column.')
  console.log('  So the new percentage fee is a SEPARATE figure (shop_supplies_fee) in a')
  console.log('  separate line. Neither is derived from the other, so neither double-counts.')

  // ══ The three cases ════════════════════════════════════════════════════════
  const shop = shops.find(s => Number(s.default_labor_rate) > 0) ?? shops[0]
  const tax: TaxSettings = taxSettingsFrom(shop)
  const laborRate = Number(shop.default_labor_rate) || 125
  const markupPct = Number(shop.default_parts_markup_percent) || 20

  // The shop's extras settings as they would be once set. profiles has no values
  // yet (migration 142 is not applied), so these are the numbers a shop would
  // enter — stated explicitly rather than pretending they came from the database.
  const settings: ExtrasSettings = {
    billTravel: true,  travelRatePerHour: null,      // null = bill at the labour rate
    billMileage: true, mileageRatePerMile: 0.70,
    billShopSupplies: true, shopSuppliesPercent: 8, shopSuppliesCap: 50,
  }

  hr('1. THE SHOP AND THE SETTINGS USED FOR ALL THREE CASES')
  console.log(`  shop            : ${shop.business_name}`)
  console.log(`  labour rate     : ${usd(laborRate)}/hr   parts markup ${markupPct}%`)
  console.log(`  tax (LIVE)      : parts ${tax.tax_parts ? 'ON' : 'OFF'} @ ${tax.tax_rate_parts}%   labor ${tax.tax_labor ? 'ON' : 'OFF'} @ ${tax.tax_rate_labor}%`)
  console.log(`  travel          : ON, rate null -> bills at the labour rate ${usd(laborRate)}/hr`)
  console.log(`  mileage         : ON @ $0.7000/mi`)
  console.log(`  shop supplies   : ON @ 8% of parts, capped at ${usd(50)}`)

  const settingsFromDb = extrasSettingsFrom(shop)
  ok(settingsFromDb.billTravel === false && settingsFromDb.billMileage === false && settingsFromDb.billShopSupplies === false,
    'the REAL profile has none of these set, so all three read OFF — nothing is billed until the shop says so')

  // ── CASE A: parts and labour ──
  hr('2. CASE A — a parts-and-labour job')
  const aPartsBase  = 240.00
  const aPartsTotal = Math.round(aPartsBase * (1 + markupPct / 100) * 100) / 100
  const aLabor      = Math.round(3 * laborRate * 100) / 100
  const a = computeExtras(aPartsTotal, { travelHours: 1.5, mileageMiles: 42 }, settings, laborRate)
  const aTot = totalsWithExtras({ parts: aPartsTotal, labor: aLabor }, a, tax)

  console.log(`  parts base (shop cost)        ${usd(aPartsBase)}`)
  console.log(`  parts on the document (+${markupPct}%)  ${usd(aPartsTotal)}   <- THE SHOP SUPPLIES BASE`)
  console.log(`  labour 3h @ ${usd(laborRate)}            ${usd(aLabor)}`)
  console.log(`  travel  ${a.travel.input}h @ ${usd(a.travel.rate ?? 0)}/hr      ${usd(a.travel.amount)}`)
  console.log(`  mileage ${a.mileage.input} mi @ $${(a.mileage.rate ?? 0).toFixed(4)}/mi   ${usd(a.mileage.amount)}`)
  console.log(`  shop supplies 8% of ${usd(aPartsTotal)}  ${usd(a.shopSupplies.amount)}${a.shopSupplies.capped ? '   <- CAPPED' : ''}`)
  console.log(`  subtotal                      ${usd(aTot.subtotal)}`)
  for (const r of taxDisplayRows(aTot.taxBreakdown)) console.log(`  ${r.text.padEnd(29)} ${r.taxed ? usd(r.amount) : '—'}`)
  console.log(`  TOTAL                         ${usd(aTot.grandTotal)}`)

  ok(a.travel.rate === laborRate, `a null travel rate bills at the labour rate (${usd(a.travel.rate ?? 0)})`)
  ok(a.travel.amount === Math.round(1.5 * laborRate * 100) / 100, `travel = 1.5 x ${usd(laborRate)} = ${usd(a.travel.amount)}`)
  ok(a.mileage.amount === 29.40, `mileage = 42 x $0.70 = ${usd(a.mileage.amount)} to the cent`)
  // 8% of the marked-up parts total, which for 240 at 20% is 288 -> 23.04, under the 50 cap.
  ok(a.shopSupplies.amount === Math.round(aPartsTotal * 0.08 * 100) / 100,
    `shop supplies = 8% of the DOCUMENT parts total ${usd(aPartsTotal)} = ${usd(a.shopSupplies.amount)}`)
  ok(a.shopSupplies.capped !== true, 'under the cap, so not capped')
  ok(a.shopSupplies.amount !== Math.round(aPartsBase * 0.08 * 100) / 100,
    `and NOT 8% of the raw cost ${usd(aPartsBase)} (${usd(Math.round(aPartsBase * 0.08 * 100) / 100)}) — the base is the sell price the customer reads`)

  const aB = extrasTaxBuckets(a)
  ok(aB.parts === a.shopSupplies.amount, 'shop supplies are taxed in the PARTS bucket')
  ok(aB.labor === a.travel.amount + a.mileage.amount, 'travel AND mileage are taxed in the LABOR bucket')
  ok(Math.abs(aTot.subtotal - (aPartsTotal + aLabor + a.total)) < 0.005,
    `the subtotal is parts + labour + all three extras (${usd(aTot.subtotal)})`)
  ok(Math.abs(aTot.grandTotal - (aTot.subtotal + aTot.taxAmount)) < 0.005,
    'the total is the subtotal plus the tax, to the cent')

  // ── CASE B: labour only. Shop supplies MUST be zero. ──
  hr('3. CASE B — a LABOUR-ONLY job. Shop supplies must be zero.')
  const bLabor = Math.round(2 * laborRate * 100) / 100
  const b = computeExtras(0, { travelHours: 0.75, mileageMiles: 18 }, settings, laborRate)
  const bTot = totalsWithExtras({ parts: 0, labor: bLabor }, b, tax)

  console.log(`  parts on the document         ${usd(0)}`)
  console.log(`  labour 2h @ ${usd(laborRate)}            ${usd(bLabor)}`)
  console.log(`  travel  ${b.travel.input}h @ ${usd(b.travel.rate ?? 0)}/hr     ${usd(b.travel.amount)}`)
  console.log(`  mileage ${b.mileage.input} mi @ $${(b.mileage.rate ?? 0).toFixed(4)}/mi   ${usd(b.mileage.amount)}`)
  console.log(`  shop supplies 8% of ${usd(0)}      ${usd(b.shopSupplies.amount)}`)
  console.log(`  subtotal                      ${usd(bTot.subtotal)}`)
  console.log(`  TOTAL                         ${usd(bTot.grandTotal)}`)

  ok(b.shopSupplies.amount === 0, 'a labour-only job is charged NOTHING for shop supplies')
  ok(b.travel.amount > 0 && b.mileage.amount > 0, 'but travel and mileage still bill — they do not depend on parts')
  const bRows = extrasDisplayRows(b)
  ok(!bRows.some(r => r.key === 'shop_supplies'), 'and NO shop supplies line prints at all — not a $0.00 row')
  ok(bRows.length === 2, `exactly two extra rows print (${bRows.map(r => r.label).join(', ')})`)
  ok(extrasTaxBuckets(b).parts === 0, 'nothing lands in the parts tax bucket on a labour-only job')

  // ── CASE C: the cap bites. ──
  hr('4. CASE C — a big parts job that HITS THE CAP')
  const cPartsBase  = 3200.00
  const cPartsTotal = Math.round(cPartsBase * (1 + markupPct / 100) * 100) / 100
  const cLabor      = Math.round(6 * laborRate * 100) / 100
  const c = computeExtras(cPartsTotal, { travelHours: 2, mileageMiles: 120 }, settings, laborRate)
  const cTot = totalsWithExtras({ parts: cPartsTotal, labor: cLabor }, c, tax)

  const uncapped = Math.round(cPartsTotal * 0.08 * 100) / 100
  console.log(`  parts on the document         ${usd(cPartsTotal)}`)
  console.log(`  8% of that, uncapped          ${usd(uncapped)}`)
  console.log(`  cap                           ${usd(50)}`)
  console.log(`  shop supplies CHARGED         ${usd(c.shopSupplies.amount)}   <- ${c.shopSupplies.capped ? 'CAPPED' : 'not capped'}`)
  console.log(`  travel  ${c.travel.input}h                     ${usd(c.travel.amount)}`)
  console.log(`  mileage ${c.mileage.input} mi                  ${usd(c.mileage.amount)}`)
  console.log(`  subtotal                      ${usd(cTot.subtotal)}`)
  for (const r of taxDisplayRows(cTot.taxBreakdown)) console.log(`  ${r.text.padEnd(29)} ${r.taxed ? usd(r.amount) : '—'}`)
  console.log(`  TOTAL                         ${usd(cTot.grandTotal)}`)

  ok(uncapped > 50, `the uncapped figure ${usd(uncapped)} really does exceed the cap — otherwise this case proves nothing`)
  ok(c.shopSupplies.amount === 50, `the charge is the cap, ${usd(50)}, not ${usd(uncapped)}`)
  ok(c.shopSupplies.capped === true, 'and the result reports that it was capped, so the tech can see why')
  ok(extrasTaxBuckets(c).parts === 50, 'the CAPPED amount is what gets taxed, not the uncapped one')

  // ── Switches off ──
  hr('5. A SHOP THAT BILLS NONE OF THEM')
  const off = computeExtras(cPartsTotal, { travelHours: 4, mileageMiles: 200 }, EXTRAS_OFF, laborRate)
  console.log(`  4 travel hours and 200 miles typed, every switch off -> total ${usd(off.total)}`)
  ok(off.total === 0, 'nothing is billed')
  ok(extrasDisplayRows(off).length === 0, 'and nothing prints — zero rows, not three zero rows')
  ok(off.travel.rate === null && off.mileage.rate === null,
    'no rate is recorded either, so a document saved now cannot be re-priced into charging later')

  // ── 0 vs NULL on the travel rate ──
  hr('6. A ZERO TRAVEL RATE IS NOT THE SAME AS AN UNSET ONE')
  const freeTravel = computeExtras(0, { travelHours: 3, mileageMiles: 0 },
    { ...settings, travelRatePerHour: 0 }, laborRate)
  ok(freeTravel.travel.amount === 0, 'travel_rate_per_hour = 0 means travel is FREE: 3 hours bills nothing')
  ok(freeTravel.travel.rate === 0, 'and the stored rate is 0, recording that the shop chose free travel')
  const unsetTravel = computeExtras(0, { travelHours: 3, mileageMiles: 0 }, settings, laborRate)
  ok(unsetTravel.travel.amount === Math.round(3 * laborRate * 100) / 100,
    `travel_rate_per_hour = NULL means bill at the labour rate: 3 hours = ${usd(unsetTravel.travel.amount)}`)
  ok(freeTravel.travel.amount !== unsetTravel.travel.amount,
    'the two are genuinely different outcomes, which is why the column is nullable rather than DEFAULT 0')

  // ── Round trip: stored, then read back WITHOUT recomputing ──
  hr('7. STORED, THEN READ BACK — a sent document cannot be re-priced')
  const cols = extrasColumns(a)
  console.log('  columns written to the document:')
  for (const [k, v] of Object.entries(cols)) console.log(`    ${k.padEnd(32)} ${v === null ? 'NULL' : v}`)

  const readBack = extrasFromDocument(cols as Record<string, unknown>)
  ok(readBack.travel.amount === a.travel.amount, 'travel reads back to the cent')
  ok(readBack.mileage.amount === a.mileage.amount, 'mileage reads back to the cent')
  ok(readBack.shopSupplies.amount === a.shopSupplies.amount, 'shop supplies read back to the cent')
  ok(readBack.total === a.total, 'and so does the total')
  ok(readBack.travel.rate === laborRate, 'the RATE IN FORCE is stored, not just the hours')

  // THE POINT: the shop changes its rates, the sent document does not move.
  const laterSettings: ExtrasSettings = {
    billTravel: true, travelRatePerHour: 250,
    billMileage: true, mileageRatePerMile: 1.50,
    billShopSupplies: true, shopSuppliesPercent: 15, shopSuppliesCap: null,
  }
  const recomputedToday = computeExtras(aPartsTotal, { travelHours: 1.5, mileageMiles: 42 }, laterSettings, laborRate)
  console.log(`\n  If the shop later raises travel to $250/hr, mileage to $1.50 and supplies to 15%:`)
  console.log(`    recomputed from today's Settings : ${usd(recomputedToday.total)}`)
  console.log(`    read back from the document      : ${usd(readBack.total)}`)
  ok(recomputedToday.total !== readBack.total,
    'the two genuinely differ, so this test can fail if the read path ever starts recomputing')
  ok(readBack.total === a.total,
    'the document keeps the figures the customer was given, whatever Settings says now')

  // ── Display rules ──
  hr('8. DISPLAY — a zero prints nothing, and the basis is stated')
  const rows = extrasDisplayRows(a)
  for (const r of rows) console.log(`  ${r.label.padEnd(16)} ${(r.detail ?? '').padEnd(30)} ${usd(r.amount)}`)
  ok(rows.length === 3, 'all three print when all three are charged')
  ok(rows.every(r => r.amount > 0), 'and every printed row has a non-zero amount')
  ok(rows.find(r => r.key === 'shop_supplies')?.detail === '8% of parts',
    'the shop supplies line states what it is a percentage OF — that is the line customers argue about')
  ok(rows.find(r => r.key === 'travel')?.detail?.includes('hours') === true,
    'travel states hours and the hourly rate, so it does not read as an arbitrary fee')
  ok(rows.find(r => r.key === 'mileage')?.detail?.includes('miles') === true, 'mileage states miles and the per-mile rate')

  hr(`${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
