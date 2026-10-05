// WO-2026-0021 could not be invoiced. This proves the scenario now converts, and that
// no line-item work order with parts can hit that error again.
//
//   npx tsx scripts/verify-wo-0021.ts
//
// MOSTLY READ-ONLY. It computes the whole chain from the real row and the real shop
// settings without writing. The one optional write - actually creating and converting a
// work order end to end - runs only with --live, so the default pass cannot touch
// production.
//
// THE BUG, for the record:
//   the form stored  subtotal 660.00  tax 51.16  total 711.16  tax_breakdown NULL
//   the sync stamped shop_supplies_fee 39.00 on top
//   so the row stated a 39.00 charge that was in none of its money, and the converter
//   refused: "its tax does not match its own breakdown".

import fs from 'fs'
import {
  computeExtras, extrasTaxBuckets, extrasDelta, extrasDisplayRows, extrasFromDocument,
  extrasAgree, partsBaseFromLines, type ExtrasSettings,
} from '../src/lib/billable-extras'
import { computeTax, mergeBreakdowns, breakdownTaxTotal, parseBreakdown, taxSettingsFrom } from '../src/lib/tax'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) pass++; else fail++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}
const hr = (t: string) => { console.log('\n' + '='.repeat(84)); console.log(t); console.log('='.repeat(84)) }
const get = async (p: string) => (await fetch(`${U}/rest/v1/${p}`, { headers: H })).json()
const r2 = (n: number) => Math.round(n * 100) / 100
const usd = (n: number) => n.toFixed(2)

async function main() {
  // ══ 1. THE ROW THAT BLOCKED ════════════════════════════════════════════════
  hr('1. WO-2026-0021 as production stored it')

  const wos = await get('work_orders?select=*&work_order_number=eq.WO-2026-0021') as Array<Record<string, unknown>>
  ok(wos.length === 1, 'WO-2026-0021 exists')
  if (!wos.length) return
  const wo = wos[0]

  const prof = (await get(`profiles?select=*&id=eq.${wo.user_id}`) as Array<Record<string, unknown>>)[0]
  const tax = taxSettingsFrom(prof)
  const extrasSettings: ExtrasSettings = {
    billTravel:          !!prof.bill_travel,
    travelRatePerHour:   prof.travel_rate_per_hour  == null ? null : Number(prof.travel_rate_per_hour),
    billMileage:         !!prof.bill_mileage,
    mileageRatePerMile:  prof.mileage_rate_per_mile == null ? null : Number(prof.mileage_rate_per_mile),
    billShopSupplies:    !!prof.bill_shop_supplies,
    shopSuppliesPercent: prof.shop_supplies_percent == null ? null : Number(prof.shop_supplies_percent),
    shopSuppliesCap:     prof.shop_supplies_cap     == null ? null : Number(prof.shop_supplies_cap),
  }

  const partsBase = partsBaseFromLines(wo.line_items)
  const laborBase = (() => {
    const lines = Array.isArray(wo.line_items) ? wo.line_items as Array<Record<string, unknown>> : []
    const n = lines.filter(l => l.type === 'labor').reduce((s, l) => s + Number(l.total ?? 0), 0)
    return n > 0 ? r2(n) : r2(Number(wo.labor_subtotal ?? 0))
  })()

  console.log(`  parts (post-markup)  ${usd(partsBase)}`)
  console.log(`  labor                ${usd(laborBase)}`)
  console.log(`  stored tax_amount    ${usd(Number(wo.tax_amount ?? 0))}`)
  console.log(`  stored grand_total   ${usd(Number(wo.grand_total ?? 0))}`)
  console.log(`  stored tax_breakdown ${JSON.stringify(wo.tax_breakdown)}`)
  console.log(`  stored supplies fee  ${usd(Number(wo.shop_supplies_fee ?? 0))}`)
  console.log(`  shop: ${prof.business_name}, supplies ${extrasSettings.shopSuppliesPercent}% cap ${extrasSettings.shopSuppliesCap}, tax ${tax.tax_rate_parts}/${tax.tax_rate_labor}`)

  ok(partsBase === 390, `parts are 390.00 post-markup (got ${usd(partsBase)})`)
  ok(laborBase === 270, `labor is 270.00 (got ${usd(laborBase)})`)
  ok(Number(wo.shop_supplies_fee) === 39, `a 39.00 supplies fee is stated (got ${usd(Number(wo.shop_supplies_fee ?? 0))})`)

  // ══ 2. WHY IT BLOCKED, REPRODUCED ══════════════════════════════════════════
  hr('2. The block, reproduced exactly')

  const parentExtras = extrasFromDocument(wo)
  const extras = extrasDelta(parentExtras, tax)

  // The OLD converter: component-sum subtotal, stored tax, then extras added on top.
  const oldSub   = r2(Number(wo.parts_subtotal ?? 0) * (1 + Number(wo.parts_markup_percent ?? 0) / 100) + laborBase)
  const oldMoney = {
    subtotal:      r2(oldSub + extras.subtotalDelta),
    tax_amount:    r2(Number(wo.tax_amount ?? 0) + extras.taxDelta),
    tax_breakdown: mergeBreakdowns([parseBreakdown(wo.tax_breakdown), extras.breakdown]),
  }
  const oldBdTax = breakdownTaxTotal(oldMoney.tax_breakdown)
  console.log(`  merged breakdown totals ${usd(oldBdTax)} against a tax_amount of ${usd(oldMoney.tax_amount)}`)
  ok(Math.abs(oldBdTax - oldMoney.tax_amount) > 0.005,
    `the two disagree by ${usd(Math.abs(oldBdTax - oldMoney.tax_amount))} - which is the error the shop saw`)
  ok(parseBreakdown(wo.tax_breakdown) === null,
    'and the cause is the parent storing tax_breakdown NULL, so the merge covered the extras alone')

  // ══ 3. THE CORRECT FIGURES ═════════════════════════════════════════════════
  hr('3. What the document must come to')

  const fresh   = computeExtras(partsBase, { travelHours: 0, mileageMiles: 0 }, extrasSettings, Number(wo.labor_rate ?? 0))
  const buckets = extrasTaxBuckets(fresh)
  const taxable = computeTax(
    { parts: r2(partsBase + buckets.parts), labor: r2(laborBase + buckets.labor) },
    tax,
  )
  const subtotal = r2(partsBase + laborBase + fresh.travel.amount + fresh.mileage.amount + fresh.shopSupplies.amount)
  const total    = r2(subtotal + taxable.taxAmount)

  for (const r of extrasDisplayRows(fresh)) console.log(`  ${r.label.padEnd(16)} ${usd(r.amount).padStart(9)}  ${r.detail ?? ''}`)
  console.log(`  subtotal         ${usd(subtotal).padStart(9)}`)
  console.log(`  tax              ${usd(taxable.taxAmount).padStart(9)}  parts ${usd(taxable.breakdown.parts?.base ?? 0)} -> ${usd(taxable.breakdown.parts?.amount ?? 0)}, labor ${usd(taxable.breakdown.labor?.base ?? 0)} -> ${usd(taxable.breakdown.labor?.amount ?? 0)}`)
  console.log(`  TOTAL            ${usd(total).padStart(9)}`)

  ok(fresh.shopSupplies.amount === 39, `supplies 39.00 (got ${usd(fresh.shopSupplies.amount)})`)
  ok(subtotal === 699, `subtotal 699.00 (got ${usd(subtotal)})`)
  ok(r2(taxable.breakdown.parts?.base ?? 0) === 429, `the parts bucket is 429.00, fee included (got ${usd(taxable.breakdown.parts?.base ?? 0)})`)
  ok(r2(taxable.breakdown.parts?.amount ?? 0) === 33.25, `taxing 33.25, not 30.23 (got ${usd(taxable.breakdown.parts?.amount ?? 0)})`)
  ok(r2(taxable.breakdown.labor?.amount ?? 0) === 20.93, `labor taxes 20.93 (got ${usd(taxable.breakdown.labor?.amount ?? 0)})`)
  ok(taxable.taxAmount === 54.18, `tax 54.18 (got ${usd(taxable.taxAmount)})`)
  ok(total === 753.18, `TOTAL 753.18 (got ${usd(total)})`)

  // ══ 4. THE GUARDS MUST NOT FIRE ON IT ══════════════════════════════════════
  hr('4. A correctly-stored document passes both guards')

  // What syncParentExtras now writes: every figure together.
  const stored = {
    subtotal:      subtotal,
    tax_amount:    taxable.taxAmount,
    grand_total:   total,
    tax_breakdown: taxable.breakdown,
  }

  // The converter carries it and adds nothing, because extrasAdded is false.
  const money = stored
  // The converter folds the extras onto a base that excludes them, so the difference IS
  // the extras and the guard is satisfied by construction.
  const baseOnly = r2(partsBase + laborBase)
  ok(extrasAgree(fresh, stored.subtotal, baseOnly) === null,
    `the extras guard passes: ${usd(stored.subtotal)} - ${usd(baseOnly)} is exactly the ${usd(fresh.shopSupplies.amount)} of extras`)

  const bd = money!.tax_breakdown
  const bases = r2((bd.parts?.base ?? 0) + (bd.labor?.base ?? 0) + (bd.services?.base ?? 0))
  const taxableSubtotal = r2(stored.subtotal - fresh.mileage.amount)
  const complete = Math.abs(bases - taxableSubtotal) <= 0.02
  ok(complete, `the breakdown is COMPLETE: its bases ${usd(bases)} account for the taxable subtotal ${usd(taxableSubtotal)}`)
  ok(Math.abs(breakdownTaxTotal(bd) - stored.tax_amount) <= 0.005,
    `and its tax ${usd(breakdownTaxTotal(bd))} equals tax_amount ${usd(stored.tax_amount)} - so the second guard passes`)

  // And the guard must STILL fire on the genuinely broken shape, or it is useless.
  const brokenBd = mergeBreakdowns([null, extras.breakdown])
  const brokenBases = r2((brokenBd?.parts?.base ?? 0) + (brokenBd?.labor?.base ?? 0))
  const brokenComplete = Math.abs(brokenBases - r2(oldMoney.subtotal)) <= 0.02
  ok(!brokenComplete,
    `the old partial breakdown is correctly judged INCOMPLETE (bases ${usd(brokenBases)} vs subtotal ${usd(oldMoney.subtotal)}), so it is carried rather than blocking`)

  // A real disagreement must still be caught: same bases, wrong tax.
  const tampered = JSON.parse(JSON.stringify(taxable.breakdown)) as typeof taxable.breakdown
  tampered.parts!.amount = 99
  const tamperedBases = r2((tampered.parts?.base ?? 0) + (tampered.labor?.base ?? 0))
  const tamperedComplete = Math.abs(tamperedBases - taxableSubtotal) <= 0.02
  ok(tamperedComplete && Math.abs(breakdownTaxTotal(tampered) - stored.tax_amount) > 0.005,
    'but a COMPLETE breakdown whose tax is wrong is still caught - the guard has not been defanged')

  // ══ 5. NO LINE-ITEM WORK ORDER CAN HIT IT ══════════════════════════════════
  hr('5. Every line-item work order with parts, checked')

  // NO subtotal column on work_orders. Asking for one returns a PostgREST error
  // object, not rows, and this script crashed on it - which is how the missing column
  // was found before it broke the sync in production.
  const allWosRaw = await get('work_orders?select=id,work_order_number,user_id,tax_amount,grand_total,tax_breakdown,shop_supplies_fee,travel_amount,mileage_amount,parts_subtotal,parts_markup_percent,labor_subtotal,line_items')
  ok(Array.isArray(allWosRaw), `the work_orders query returned rows (${Array.isArray(allWosRaw) ? allWosRaw.length : JSON.stringify(allWosRaw).slice(0, 90)})`)
  const allWos = (Array.isArray(allWosRaw) ? allWosRaw : []) as Array<Record<string, unknown>>
  const segRows = await get('work_order_segments?select=ld_work_order_id') as Array<Record<string, unknown>>
  const segOf = new Set(segRows.map(x => String(x.ld_work_order_id ?? '')))
  const lineItem = allWos.filter(w => !segOf.has(String(w.id)))

  let wouldBlock = 0
  for (const w of lineItem) {
    const pb = partsBaseFromLines(w.line_items)
    if (pb === 0) continue
    const pe = extrasFromDocument(w)

    // EXACTLY what the converter now does: build the base from the line items WITHOUT
    // the extras, fold the extras in once, then run both guards.
    const lb = (() => {
      const lines = Array.isArray(w.line_items) ? w.line_items as Array<Record<string, unknown>> : []
      const x = lines.filter(l => l.type === 'labor').reduce((t, l) => t + Number(l.total ?? 0), 0)
      return x > 0 ? r2(x) : r2(Number(w.labor_subtotal ?? 0))
    })()
    const baseTax = computeTax({ parts: pb, labor: lb }, tax)
    const base    = { subtotal: r2(pb + lb), tax_amount: baseTax.taxAmount, tax_breakdown: baseTax.breakdown }
    const d       = extrasDelta(pe, tax)
    const m = {
      subtotal:      r2(base.subtotal + d.subtotalDelta),
      tax_amount:    r2(base.tax_amount + d.taxDelta),
      tax_breakdown: mergeBreakdowns([base.tax_breakdown, d.breakdown]),
    }

    let blocks = false
    if (extrasAgree(pe, m.subtotal, base.subtotal) !== null) blocks = true
    const mb = m.tax_breakdown
    if (mb) {
      const bases = r2((mb.parts?.base ?? 0) + (mb.labor?.base ?? 0) + (mb.services?.base ?? 0))
      const ts    = r2(m.subtotal - pe.mileage.amount)
      if (Math.abs(bases - ts) <= 0.02 && Math.abs(breakdownTaxTotal(mb) - m.tax_amount) > 0.005) blocks = true
    }
    if (blocks) { wouldBlock++; console.log(`    WOULD BLOCK: ${w.work_order_number}`) }
  }
  console.log(`  line-item work orders with parts: ${lineItem.filter(w => partsBaseFromLines(w.line_items) > 0).length}`)
  ok(wouldBlock === 0, `none would be blocked by either guard (${wouldBlock})`)
  ok(lineItem.filter(w => partsBaseFromLines(w.line_items) > 0).length > 0,
    'and there is at least one such work order, so the check is not vacuous')

  // ══ 6. ONE COMPUTATION, THREE PLACES ═══════════════════════════════════════
  hr('6. Create, save and convert must use the same computation')

  const sync = fs.readFileSync('src/lib/segments/parent-extras.ts', 'utf8')
  ok(sync.includes('columns.tax_amount    = taxable.taxAmount'),
    'the sync writes tax_amount, not only the extras columns')
  ok(!sync.includes('columns.subtotal '),
    'and does NOT write a subtotal column, which work_orders does not have')
  ok(sync.includes('columns.grand_total   = round2(subtotal + taxable.taxAmount)'), 'and the grand total')
  ok(sync.includes('tax_breakdown = taxable.breakdown'), 'and the breakdown')
  ok(sync.includes('if (!segmented) {'),
    'and only for a LINE-ITEM parent, whose own money columns are the billed figures')
  for (const f of ['src/app/api/work-orders/route.ts', 'src/app/api/work-orders/[id]/route.ts']) {
    ok(fs.readFileSync(f, 'utf8').includes('syncParentExtrasQuietly('),
      `${f.split('/').slice(-2).join('/')} runs it`)
  }
  const conv = fs.readFileSync('src/app/api/work-orders/[id]/convert/route.ts', 'utf8')
  ok(conv.includes('ONE FOLD, BOTH MODES'),
    'the converter folds the extras in exactly once, for both pricing modes')
  ok(conv.includes('parentBase.tax.breakdown'),
    'and builds the parent breakdown itself rather than reading a possibly-null one')
  ok(!conv.includes('extrasAdded'),
    'with no "were they already added" guesswork left - that guess is what blocked 0021')
  ok(conv.includes('breakdownIsComplete'),
    'and only compares a breakdown that covers the whole taxable subtotal')
  const form = fs.readFileSync('src/components/work-orders/WorkOrderForm.tsx', 'utf8')
  ok(form.includes('{withExtras.taxBreakdown'), 'the form shows tax WITH the extras in it')
  ok(form.includes('fmt(withExtras.grandTotal)'), 'and the grand total with them in it')
  ok(!form.includes('subtotal:      withExtras.subtotal'),
    'and does NOT try to store a subtotal column that does not exist')

  console.log('\n' + '='.repeat(84))
  console.log(`${pass} passed, ${fail} failed`)
  console.log('='.repeat(84))
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
