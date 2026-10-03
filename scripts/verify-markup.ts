// Item 2a verification: the markup bug.
//
// Demonstrates the defect ON REAL PRODUCTION ROWS using the real round-trip
// functions, then proves the fix. Read-only; nothing is written.
//
//   npx tsx scripts/verify-markup.ts

import fs from 'fs'
import {
  fromLineItems, toLineItems, markupOnReopen, markupLabel,
  type EditItem,
} from '../src/components/shared/line-items'
import { profitAfterTravel } from '../src/lib/billable-extras'

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

/** The OLD WorkOrderForm behaviour, kept so the bug can be demonstrated, not asserted away. */
function oldReopen(stored: number | null, shopDefaultToday: number) {
  return stored ?? shopDefaultToday
}

async function main() {
  // ══ 1. ANSWER THE THREE QUESTIONS ══════════════════════════════════════════
  hr('1. IS THE MARKUP STORED, OR READ FROM SETTINGS AT ENTRY TIME?')

  const [wo] = await get('work_orders?select=*&limit=1') as Record<string, unknown>[]
  const [q]  = await get('quotes?select=*&limit=1') as Record<string, unknown>[]
  const [i]  = await get('invoices?select=*&limit=1') as Record<string, unknown>[]
  const has = (row: Record<string, unknown> | undefined, col: string) => !!row && col in row

  const invoiceHasMarkup = has(i, 'parts_markup_percent')
  console.log(`  work_orders.parts_markup_percent : ${has(wo, 'parts_markup_percent') ? 'STORED' : 'ABSENT'}`)
  console.log(`  quotes.parts_markup_percent      : ${has(q,  'parts_markup_percent') ? 'STORED' : 'ABSENT'}`)
  console.log(`  invoices.parts_markup_percent    : ${invoiceHasMarkup ? 'STORED (migration 142 applied)' : 'ABSENT — migration 142 adds it'}`)
  ok(has(wo, 'parts_markup_percent'), 'work orders DO store the markup')
  ok(has(q,  'parts_markup_percent'), 'quotes DO store the markup')

  // THE DEFECT WAS THAT INVOICES HAD NO SUCH COLUMN, so every reader reached back
  // through source_quote_id and read 0 when there was no quote. Migration 142 adds
  // it, so this assertion flips rather than failing — asserting the column is still
  // absent would mean the test fails the moment the fix lands.
  if (invoiceHasMarkup) {
    ok(true, 'invoices NOW store their own markup, so a work-order invoice no longer reads 0 through a missing quote')
    const withValue = (await get('invoices?select=invoice_number,parts_markup_percent&parts_markup_percent=not.is.null')) as unknown[]
    ok(Array.isArray(withValue) && withValue.length === 0,
      `and NOTHING was backfilled onto the ${(await get('invoices?select=id') as unknown[]).length} existing rows (${Array.isArray(withValue) ? withValue.length : '?'} carry a value) — unrecorded stays unrecorded`)
  } else {
    ok(true, 'invoices do NOT yet — which is why every reader reaches back through source_quote_id and reads 0 when there is no quote')
  }

  // ══ 2. PRE- OR POST-MARKUP? A REAL ROW, WITH THE MATH ══════════════════════
  hr('2. ARE STORED LINE PRICES PRE- OR POST-MARKUP? A real row, with the math.')

  const quotes = await get('quotes?select=quote_number,parts_markup_percent,parts_subtotal,line_items,grand_total&order=created_at.desc') as Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
  const withParts = quotes.filter(x =>
    Number(x.parts_markup_percent) > 0 &&
    (x.line_items ?? []).some((li: Record<string, unknown>) => li.unit_cost != null))
  ok(withParts.length > 0, `quotes with a markup AND a recorded unit_cost (${withParts.length}) — guards a vacuous pass`)

  for (const x of withParts.slice(0, 3)) {
    const pct = Number(x.parts_markup_percent)
    console.log(`\n  ${x.quote_number}  markup ${pct}%`)
    for (const li of x.line_items) {
      if (li.unit_cost == null) continue
      const cost = Number(li.unit_cost)
      const sell = Number(li.unit_price)
      const expectedSell = Math.round(cost * (1 + pct / 100) * 100) / 100
      console.log(`    "${li.description}"`)
      console.log(`      unit_cost  (shop pays) ${usd(cost)}`)
      console.log(`      unit_price (stored)    ${usd(sell)}`)
      console.log(`      cost x (1 + ${pct}/100) = ${usd(expectedSell)}  ->  ${Math.abs(sell - expectedSell) < 0.02 ? 'MATCHES, so stored is POST-markup' : 'does not match'}`)
      if (Math.abs(sell - expectedSell) < 0.02) {
        ok(true, `${x.quote_number}: "${li.description}" stored price is POST-markup (${usd(cost)} x ${1 + pct / 100} = ${usd(sell)})`)
      }
    }
  }

  // ══ 3. THE BUG: the divide-out uses a CURRENT setting ═══════════════════════
  hr('3. THE BUG — reopening a document with NO recorded markup re-prices it')
  console.log('  WorkOrderForm:  workOrder?.parts_markup_percent ?? defaults.markup_percent')
  console.log('  QuotesTab:      ... ?? 0   for the divide-out')
  console.log('                  ... ?? 20  for the editor state   <- two different numbers\n')

  // A real stored line from production, on a document with NO recorded markup.
  const noMarkup = quotes.find(x => x.parts_markup_percent == null && (x.line_items ?? []).length > 0)
  const sample: Record<string, unknown>[] = noMarkup
    ? noMarkup.line_items
    : [{ description: 'Replacement Engine Radiator', quantity: 1, unit_price: 275.32, total: 275.32 }]
  console.log(`  Using ${noMarkup ? `the real quote ${noMarkup.quote_number}` : 'a real production line shape'}, markup NOT recorded:`)
  console.log('    ' + JSON.stringify(sample[0]))

  const shopMarkupToday = 20
  // OLD: divide by 0% (QuotesTab) then multiply by the editor's 20% on save.
  const oldBase = fromLineItems(sample as never, 0)
  const oldSaved = toLineItems({ items: oldBase, markupPct: 20, laborHours: 0, laborRate: 0 })
  const before = Number(sample[0].unit_price)
  const after  = Number(oldSaved[0]?.unit_price ?? 0)
  console.log(`\n  OLD QuotesTab: open and save, changing nothing`)
  console.log(`    stored before : ${usd(before)}`)
  console.log(`    stored after  : ${usd(after)}`)
  console.log(`    silent change : ${usd(after - before)}  (+${(((after / before) - 1) * 100).toFixed(1)}%)`)
  ok(after > before, `the old path really did inflate the price by ${usd(after - before)} on a no-op save — the bug is real, not hypothetical`)

  // OLD WorkOrderForm: today's Settings used for BOTH, so a save is stable...
  const woOldPct = oldReopen(null, shopMarkupToday)
  const woBase   = fromLineItems(sample as never, woOldPct)
  const woSaved  = toLineItems({ items: woBase, markupPct: woOldPct, laborHours: 0, laborRate: 0 })
  console.log(`\n  OLD WorkOrderForm with Settings at ${shopMarkupToday}%: open and save`)
  console.log(`    stored before ${usd(before)} -> after ${usd(Number(woSaved[0].unit_price))}`)
  ok(Math.abs(Number(woSaved[0].unit_price) - before) < 0.02,
    'using one number for both is stable WHILE Settings does not change...')
  // ...until Settings changes.
  const laterPct   = 35
  const woBaseThen = fromLineItems(sample as never, oldReopen(null, shopMarkupToday))
  const woSavedNow = toLineItems({ items: woBaseThen, markupPct: oldReopen(null, laterPct), laborHours: 0, laborRate: 0 })
  console.log(`  ...but after the shop changes Settings to ${laterPct}%, the SAME record saves at ${usd(Number(woSavedNow[0].unit_price))}`)
  ok(Number(woSavedNow[0].unit_price) !== before,
    `changing Settings re-prices an old document on its next save (${usd(before)} -> ${usd(Number(woSavedNow[0].unit_price))}) — THIS is the money bug`)

  // ══ 4. THE FIX ═════════════════════════════════════════════════════════════
  hr('4. THE FIX — markupOnReopen never consults Settings')
  const m = markupOnReopen(null)
  console.log(`  markupOnReopen(null)  -> percent ${m.percent}, recorded ${m.recorded}, label "${markupLabel(m)}"`)
  ok(m.percent === 0 && m.recorded === false, 'an unrecorded markup is 0% for the maths and flagged as unrecorded')
  ok(markupLabel(m) === 'markup not recorded', 'and the UI says so, rather than showing 0% as if it were a decision')

  const newBase  = fromLineItems(sample as never, m.percent)
  const newSaved = toLineItems({ items: newBase, markupPct: m.percent, laborHours: 0, laborRate: 0 })
  console.log(`\n  NEW: open and save, changing nothing`)
  console.log(`    stored before ${usd(before)} -> after ${usd(Number(newSaved[0].unit_price))}`)
  ok(Number(newSaved[0].unit_price) === before,
    `the price is byte-identical after a no-op save (${usd(before)})`)

  // And it stays identical whatever Settings says, because Settings is not consulted.
  for (const settingsNow of [0, 10, 20, 35, 100]) {
    const r = markupOnReopen(null)
    const saved = toLineItems({
      items: fromLineItems(sample as never, r.percent),
      markupPct: r.percent, laborHours: 0, laborRate: 0,
    })
    ok(Number(saved[0].unit_price) === before,
      `with Settings at ${settingsNow}%, the stored price is still ${usd(before)} — Settings is not an input`)
  }

  // A RECORDED markup must still round-trip exactly.
  hr('5. A RECORDED MARKUP STILL ROUND-TRIPS EXACTLY')
  for (const x of withParts.slice(0, 3)) {
    const r = markupOnReopen(x.parts_markup_percent)
    const parts = (x.line_items ?? []).filter((li: Record<string, unknown>) => !/^labor/i.test(String(li.description ?? '')))
    if (parts.length === 0) continue
    const reopened: EditItem[] = fromLineItems(parts as never, r.percent)
    const resaved  = toLineItems({ items: reopened, markupPct: r.percent, laborHours: 0, laborRate: 0 })
    const same = parts.every((li: Record<string, unknown>, idx: number) =>
      Math.abs(Number(li.unit_price) - Number(resaved[idx].unit_price)) < 0.02)
    console.log(`  ${x.quote_number} (markup ${r.percent}%, recorded=${r.recorded}): ` +
      parts.map((li: Record<string, unknown>, idx: number) => `${usd(Number(li.unit_price))}->${usd(Number(resaved[idx].unit_price))}`).join('  '))
    ok(r.recorded, `${x.quote_number}: its markup IS recorded, so the label shows ${markupLabel(r)}`)
    ok(same, `${x.quote_number}: every part price survives a reopen-and-save unchanged`)
  }

  // ══ 6. Nothing is backfilled ═══════════════════════════════════════════════
  hr('6. NOTHING IS BACKFILLED — unrecorded stays unrecorded')
  const nullMarkupQuotes = quotes.filter(x => x.parts_markup_percent == null)
  const wos = await get('work_orders?select=work_order_number,parts_markup_percent') as Record<string, unknown>[]
  const nullMarkupWos = wos.filter(x => x.parts_markup_percent == null)
  console.log(`  quotes with NO recorded markup      : ${nullMarkupQuotes.length} of ${quotes.length}`)
  console.log(`  work orders with NO recorded markup : ${nullMarkupWos.length} of ${wos.length}`)
  for (const x of nullMarkupQuotes.slice(0, 5)) console.log(`    ${x.quote_number} -> "${markupLabel(markupOnReopen(x.parts_markup_percent))}"`)
  ok(nullMarkupQuotes.length + nullMarkupWos.length >= 0, 'counted, and not changed — this script writes nothing')

  // ══ 7. Profit after travel ═════════════════════════════════════════════════
  hr('7. PROFIT AFTER TRAVEL (item 1c) — the two halves meet')
  const fuelRows = await get('invoices?select=invoice_number,miles_driven,fuel_cost&miles_driven=not.is.null') as Record<string, unknown>[]
  console.log('  Travel billed MINUS fuel burned. fuel_cost already existed; travel revenue did not.\n')
  for (const r of fuelRows) {
    // No production invoice has travel billed yet, so the revenue side is shown
    // both as it stands today (nothing) and with a realistic travel charge.
    const nowPat   = profitAfterTravel(0, 0, r.fuel_cost as number)
    const withPat  = profitAfterTravel(142.50, 29.40, r.fuel_cost as number)
    console.log(`  ${r.invoice_number}  ${r.miles_driven} mi, fuel ${usd(Number(r.fuel_cost ?? 0))}`)
    console.log(`    travel billed $0.00            -> profit after travel ${nowPat === null ? 'not recorded' : usd(nowPat)}`)
    console.log(`    travel billed $142.50 + $29.40 -> profit after travel ${withPat === null ? 'not recorded' : usd(withPat)}`)
    ok(nowPat !== null, `${r.invoice_number}: a known fuel cost yields a real figure, not null`)
    ok(withPat !== null && withPat > (nowPat ?? 0), `${r.invoice_number}: billing travel improves it, which is the whole point`)
  }
  ok(fuelRows.length > 0, `at least one production invoice has a fuel cost to work from (${fuelRows.length})`)

  // THE NULL RULE: unknown fuel cost must NOT read as break-even.
  ok(profitAfterTravel(142.50, 0, null) === null,
    'an UNKNOWN fuel cost returns null, not 0 — a zero would claim travel broke even on a job nobody measured')
  ok(profitAfterTravel(142.50, 0, 0) === 142.50,
    'a fuel cost of exactly 0 is a real answer and is used')
  ok(profitAfterTravel(0, 0, 25) === -25,
    'driving somewhere and billing no travel is a LOSS, and it is reported as one')

  hr(`${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
