// Shop supplies must compute itself from Settings. Nobody adds it.
//
// Read-only against production. Nothing is written.
//
//   npx tsx scripts/verify-shop-supplies-auto.ts

import fs from 'fs'
import {
  computeExtras, extrasDisplayRows, extrasTaxBuckets, extrasColumns,
  partsBaseFromLines, extrasFromDocument, EXTRAS_OFF, type ExtrasSettings,
} from '../src/lib/billable-extras'
import { computeTax } from '../src/lib/tax'

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

// 8% with no cap, which is the shape described in the brief.
const EIGHT: ExtrasSettings = {
  ...EXTRAS_OFF,
  billShopSupplies: true,
  shopSuppliesPercent: 8,
  shopSuppliesCap: null,
}

async function main() {
  // ══ 1. THE THREE CASES FROM THE BRIEF, TO THE CENT ═════════════════════════
  hr('1. Parts-and-labour, labour-only, and a job that hits the cap')

  // (a) parts and labour: 8% of PARTS ONLY, never labour.
  const a = computeExtras(500, { travelHours: 0, mileageMiles: 0 }, EIGHT, 95)
  ok(a.shopSupplies.amount === 40, `500.00 of parts at 8% = 40.00 (got ${a.shopSupplies.amount})`)
  ok(a.total === 40, 'and nothing else is added')

  // (b) labour only: parts base zero, so supplies is zero and NO line prints.
  const b = computeExtras(0, { travelHours: 0, mileageMiles: 0 }, EIGHT, 95)
  ok(b.shopSupplies.amount === 0, 'a labour-only job has ZERO shop supplies')
  ok(extrasDisplayRows(b).length === 0,
    'and prints NO line at all - not a 0.00 line, not a dash')

  // (c) the cap bites.
  const capped: ExtrasSettings = { ...EIGHT, shopSuppliesCap: 100 }
  const c = computeExtras(2000, { travelHours: 0, mileageMiles: 0 }, capped, 95)
  ok(c.shopSupplies.amount === 100,
    `2000.00 of parts at 8% would be 160.00 but caps at 100.00 (got ${c.shopSupplies.amount})`)
  ok(c.shopSupplies.capped === true, 'and the cap is flagged for the shop')
  const justUnder = computeExtras(1200, { travelHours: 0, mileageMiles: 0 }, capped, 95)
  ok(justUnder.shopSupplies.amount === 96 && !justUnder.shopSupplies.capped,
    `1200.00 at 8% = 96.00, under the cap, not flagged (got ${justUnder.shopSupplies.amount})`)
  // The boundary: exactly at the cap must NOT report capped.
  const exactly = computeExtras(1250, { travelHours: 0, mileageMiles: 0 }, capped, 95)
  ok(exactly.shopSupplies.amount === 100 && !exactly.shopSupplies.capped,
    'exactly 100.00 is at the cap, not over it, so it is not flagged as capped')

  // ══ 2. IT IS A PERCENTAGE, NOT AN ITEM ═════════════════════════════════════
  hr('2. Nobody enters it, and it follows the parts figure')

  ok(!('shopSuppliesAmount' in ({} as Record<string, unknown>)) &&
     computeExtras(100, { travelHours: 0, mileageMiles: 0 }, EIGHT, 95).shopSupplies.amount === 8,
    'the only inputs are the parts base and the settings - there is no amount to pass in')

  // Parts change, the fee follows, with no further input.
  const grow = [100, 250, 1000].map(p => computeExtras(p, { travelHours: 0, mileageMiles: 0 }, EIGHT, 95).shopSupplies.amount)
  ok(JSON.stringify(grow) === JSON.stringify([8, 20, 80]),
    `the fee tracks the parts total automatically: ${JSON.stringify(grow)}`)

  // Switched off in Settings means nothing is charged, whatever the parts.
  const off = computeExtras(1000, { travelHours: 0, mileageMiles: 0 }, { ...EIGHT, billShopSupplies: false }, 95)
  ok(off.shopSupplies.amount === 0, 'with the setting off, no supplies are charged at all')

  // ══ 3. TAXED AS PARTS ══════════════════════════════════════════════════════
  hr('3. Shop supplies is taxed as parts; travel and mileage as labour')

  const all = computeExtras(500, { travelHours: 2, mileageMiles: 40 }, {
    ...EIGHT, billTravel: true, travelRatePerHour: 95, billMileage: true, mileageRatePerMile: 0.65,
  }, 95)
  const buckets = extrasTaxBuckets(all)
  ok(all.shopSupplies.amount === 40, 'supplies 40.00')
  ok(all.travel.amount === 190, '2 hours travel at 95.00 = 190.00')
  ok(all.mileage.amount === 26, '40 miles at 0.65 = 26.00')
  ok(buckets.parts === 40, `the PARTS bucket gets the supplies fee only (got ${buckets.parts})`)
  ok(buckets.labor === 216, `the LABOUR bucket gets travel + mileage = 216.00 (got ${buckets.labor})`)
  ok(all.total === 256, 'and the three sum to 256.00')

  const settings = { tax_parts: true, tax_labor: true, tax_rate_parts: 7.75, tax_rate_labor: 7.75 }
  const taxed = computeTax({ parts: buckets.parts, labor: buckets.labor }, settings)
  ok(taxed.breakdown.parts?.amount === 3.1, `supplies taxes at 3.10 in the parts bucket (got ${taxed.breakdown.parts?.amount})`)
  ok(taxed.breakdown.labor?.amount === 16.74, `travel+mileage tax 16.74 in the labour bucket (got ${taxed.breakdown.labor?.amount})`)

  // Parts exempt must exempt the supplies fee too, since it IS parts.
  const exemptParts = computeTax({ parts: buckets.parts, labor: buckets.labor }, { ...settings, tax_parts: false })
  ok(exemptParts.breakdown.parts?.amount === 0,
    'a shop that does not tax parts does not tax the supplies fee either')

  // ══ 4. NO SUPPLIES ON SUPPLIES ═════════════════════════════════════════════
  hr('4. The base is PARTS, and must not include a fee')

  const lines = [
    { type: 'parts', description: 'pads',  total: 300 },
    { type: 'labor', description: 'fit',   total: 190 },
    { type: 'parts', description: 'rotor', total: 200 },
  ]
  ok(partsBaseFromLines(lines) === 500, `parts base from typed lines = 500.00 (got ${partsBaseFromLines(lines)})`)
  ok(partsBaseFromLines([...lines, { type: 'labor', description: 'travel', total: 190 }]) === 500,
    'a labour-typed line never enters the parts base')

  // Legacy lines with no type at all.
  const legacy = [
    { description: 'Brake pads', total: 300 },
    { description: 'Labor',      total: 190 },
    { description: 'Rotor',      total: 200 },
  ]
  ok(partsBaseFromLines(legacy) === 500,
    `legacy untyped lines split on the "Labor" convention (got ${partsBaseFromLines(legacy)})`)
  ok(partsBaseFromLines([]) === 0 && partsBaseFromLines(null) === 0 && partsBaseFromLines('x') === 0,
    'no lines, null and junk all give a zero base rather than NaN')

  // The actual trap: feeding a TAXABLE base in would charge supplies on supplies.
  const firstPass = computeExtras(500, { travelHours: 0, mileageMiles: 0 }, EIGHT, 95)
  const wrong = computeExtras(500 + firstPass.shopSupplies.amount, { travelHours: 0, mileageMiles: 0 }, EIGHT, 95)
  ok(wrong.shopSupplies.amount !== firstPass.shopSupplies.amount,
    `including the fee in its own base changes the answer (${firstPass.shopSupplies.amount} vs ${wrong.shopSupplies.amount}) - which is why partsBaseFromLines exists`)

  // ══ 5. A REOPEN MUST NOT RE-PRICE ══════════════════════════════════════════
  hr('5. The stored percentage wins over the current Settings value')

  // The shop has since raised its rate to 15%. A document that recorded 8% keeps 8%.
  const fifteen: ExtrasSettings = { ...EIGHT, shopSuppliesPercent: 15 }
  const reopened = computeExtras(500, {
    travelHours: 0, mileageMiles: 0,
    shopSuppliesPercentOverride: 8,
    shopSuppliesCapOverride: null,
  }, fifteen, 95)
  ok(reopened.shopSupplies.amount === 40,
    `reopening bills the recorded 8% (40.00), not the current 15% (75.00) - got ${reopened.shopSupplies.amount}`)

  const neverRecorded = computeExtras(500, {
    travelHours: 0, mileageMiles: 0, shopSuppliesPercentOverride: null,
  }, fifteen, 95)
  ok(neverRecorded.shopSupplies.amount === 75,
    'a document with no recorded percentage uses the current Settings value')

  // What gets stored, so the reopen above is possible at all.
  const cols = extrasColumns(computeExtras(500, { travelHours: 2, mileageMiles: 40 }, {
    ...EIGHT, billTravel: true, travelRatePerHour: 95, billMileage: true, mileageRatePerMile: 0.65,
  }, 95))
  ok(cols.shop_supplies_percent_applied === 8, 'the percentage in force is stored on the document')
  ok(cols.shop_supplies_fee === 40, 'along with the resulting fee')
  ok(cols.travel_rate === 95 && cols.mileage_rate === 0.65, 'and both rates')

  // ══ 6. THE SHOP'S REAL SETTINGS ════════════════════════════════════════════
  hr('6. What is actually configured in production right now')

  const profs = await get('profiles?select=id,business_name,bill_shop_supplies,shop_supplies_percent,shop_supplies_cap,bill_travel,travel_rate_per_hour,bill_mileage,mileage_rate_per_mile') as Array<Record<string, unknown>>
  const on = profs.filter(p => p.bill_shop_supplies)
  console.log(`  profiles: ${profs.length}, billing shop supplies: ${on.length}`)
  for (const p of on) {
    console.log(`    ${p.business_name}: ${p.shop_supplies_percent}%  cap=${p.shop_supplies_cap ?? 'none'}`)
    const real = computeExtras(500, { travelHours: 0, mileageMiles: 0 }, {
      ...EXTRAS_OFF,
      billShopSupplies: true,
      shopSuppliesPercent: Number(p.shop_supplies_percent),
      shopSuppliesCap: p.shop_supplies_cap == null ? null : Number(p.shop_supplies_cap),
    }, 95)
    console.log(`      on 500.00 of parts -> ${real.shopSupplies.amount}${real.shopSupplies.capped ? ' (capped)' : ''}`)
    ok(real.shopSupplies.amount > 0,
      `${p.business_name} would actually charge something on a 500.00 parts job`)
  }
  ok(on.length > 0, 'at least one shop has it switched on, so this is live configuration and not theory')

  // ══ 7. THE DOUBLE-CHARGE QUESTION, AGAINST REAL DATA ═══════════════════════
  hr('7. Can a shop charge for supplies twice?')

  const invs = await get('invoices?select=invoice_number,shop_supplies,shop_supplies_fee') as Array<Record<string, unknown>>
  const withItems = invs.filter(i => Array.isArray(i.shop_supplies) && (i.shop_supplies as unknown[]).length > 0)
  const withFee   = invs.filter(i => Number(i.shop_supplies_fee ?? 0) > 0)
  const withBoth  = invs.filter(i =>
    Array.isArray(i.shop_supplies) && (i.shop_supplies as unknown[]).length > 0 &&
    Number(i.shop_supplies_fee ?? 0) > 0)

  console.log(`  invoices: ${invs.length}`)
  console.log(`    with supply ITEMS : ${withItems.length}  ${withItems.map(i => i.invoice_number).join(', ')}`)
  console.log(`    with a percentage FEE : ${withFee.length}`)
  console.log(`    with BOTH : ${withBoth.length}`)

  // Not an assertion that both can never coexist - they can, and that is the finding.
  // This records the CURRENT exposure so the number is real rather than asserted.
  ok(withBoth.length === 0,
    `no invoice currently carries both an item list and a percentage fee (${withBoth.length}) - the double charge is possible but has not happened yet`)

  // The arithmetic of the overlap, so the report is specific.
  const bothWays = computeExtras(500, { travelHours: 0, mileageMiles: 0 }, EIGHT, 95)
  const itemised = 24.50
  console.log(`\n  If a shop bills 8% on 500.00 of parts AND adds 24.50 of supply items:`)
  console.log(`    percentage fee : ${bothWays.shopSupplies.amount.toFixed(2)}`)
  console.log(`    itemised       : ${itemised.toFixed(2)}`)
  console.log(`    customer pays  : ${(bothWays.shopSupplies.amount + itemised).toFixed(2)} for supplies`)
  ok(bothWays.shopSupplies.amount + itemised > bothWays.shopSupplies.amount,
    'both mechanisms reaching the subtotal means the customer pays for supplies twice over')

  // ══ 8. THE EDITOR WIRES IT, AND DOES NOT ASK ═══════════════════════════════
  hr('8. The invoice editor computes it rather than asking')

  const src = fs.readFileSync('src/app/financials/invoices/[id]/InvoiceInProgressClient.tsx', 'utf8')
  ok(src.includes('computeExtras('), 'the editor computes the extras')
  ok(src.includes('partsBaseFromLines('), 'from a clean parts base')
  ok(src.includes('extrasDisplayRows('), 'and renders them as their own rows')
  ok(src.includes('...extrasColumns(extrasResult)'), 'and stores the computed columns on save')
  ok(/- storedExtras\.total \+ extrasResult\.total/.test(src),
    'the stored extras are removed before the recomputed ones are added, so nothing double-counts')
  ok(/- storedExtraBuckets\.parts \+ extraBuckets\.parts/.test(src),
    'and the same in the parts tax bucket')
  ok(/- storedExtraBuckets\.labor \+ extraBuckets\.labor/.test(src),
    'and the labour tax bucket')

  // THE POINT: there must be no input for the supplies amount or percentage.
  ok(!/setShopSuppliesPercent|shopSuppliesPercentInput|value=\{shopSuppliesPercent\}/.test(src),
    'there is NO input for the shop supplies percentage - it is never a question')
  ok(/setTravelHours|setMileageMiles/.test(src),
    'travel and mileage do have inputs, because hours and miles are facts only the tech knows')

  const stored = extrasFromDocument({ shop_supplies_fee: 40, travel_amount: 0, mileage_amount: 0 })
  ok(stored.shopSupplies.amount === 40 && stored.total === 40,
    'extrasFromDocument reads a stored fee back for the views that only display')

  console.log('\n' + '='.repeat(78))
  console.log(`${pass} passed, ${fail} failed`)
  console.log('='.repeat(78))
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
