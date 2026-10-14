// Would the new smoke case have CAUGHT the doubled markup? Run both mappings on the
// same quote line and look at the numbers.
//
// A check that passes after a fix proves nothing on its own - it has to be shown to
// fail on the broken input. The new mapping is imported from the real module; the old
// one is reproduced here from the diff, and labelled, so this is a comparison and not
// a second implementation anybody is meant to use.
//
// No database. No network. Pure arithmetic on one fabricated-but-faithful line - the
// shape addPartsItem in src/app/hd/quotes/new/page.tsx actually writes.

import { workOrderLinesFromQuote } from '../src/lib/hd/quote-approval'
import { sellPrice } from '../src/lib/hd/parts-pricing'

const COST = 3.0
const MARKUP = 30
const SELL = sellPrice(COST, MARKUP)

// Exactly what the quote form stores: the SELL in unit_cost, the cost in
// unit_cost_base, type 'parts'.
const quoteLine = {
  id: 'proof-1',
  type: 'parts',
  description: 'o-ring',
  part_number: 'ZZ-ORING-3',
  quantity: 1,
  unit_cost: SELL,
  unit_cost_base: COST,
  markup_percent: MARKUP,
  amount: SELL,
}

/** THE OLD MAPPING, reproduced from the diff. Do not use this for anything. */
function oldMapping(li: typeof quoteLine) {
  const quantity = li.quantity ?? 1
  const unitCost = li.unit_cost          // <- read the SELL price as a cost
  const unitPrice = (li as { unit_price?: number }).unit_price ?? null
  const markup = li.markup_percent
  return {
    unit_cost: unitCost,
    unit_price: unitPrice,
    markup_percent: markup,
    total: li.amount ?? null,
    quantity,
  }
}

/** What the work order's own editor then shows for a row. */
function workOrderSell(row: { unit_cost: number | null; markup_percent: number | null; unit_price: number | null }): number {
  return row.unit_cost != null && row.markup_percent != null
    ? sellPrice(row.unit_cost, row.markup_percent)
    : (row.unit_price ?? 0)
}

function main() {
  console.log('')
  console.log(`quoted: cost ${COST.toFixed(2)}, markup ${MARKUP}%, sell ${SELL.toFixed(2)}`)
  console.log('')

  const before = oldMapping(quoteLine)
  const sellBefore = workOrderSell(before)
  console.log('OLD mapping (the bug)')
  console.log(`  work order cost column : ${Number(before.unit_cost).toFixed(2)}`)
  console.log(`  markup column          : ${before.markup_percent}`)
  console.log(`  sell the screen shows  : ${sellBefore.toFixed(2)}`)
  console.log(`  -> the smoke assertion "cost is the COST" would have FAILED: ` +
    `${Number(before.unit_cost).toFixed(2)} !== ${COST.toFixed(2)}`)
  console.log('')

  const after = workOrderLinesFromQuote([quoteLine], 135)[0] as Record<string, unknown>
  const afterRow = {
    unit_cost: after.unit_cost as number | null,
    markup_percent: after.markup_percent as number | null,
    unit_price: after.unit_price as number | null,
  }
  const sellAfter = workOrderSell(afterRow)
  console.log('NEW mapping (current code)')
  console.log(`  work order cost column : ${Number(after.unit_cost).toFixed(2)}`)
  console.log(`  sell price column      : ${Number(after.unit_price).toFixed(2)}`)
  console.log(`  markup column          : ${after.markup_percent}`)
  console.log(`  line total             : ${Number(after.total).toFixed(2)}`)
  console.log(`  sell the screen shows  : ${sellAfter.toFixed(2)}`)
  console.log('')

  const ok =
    Number(after.unit_cost) === COST &&
    Number(after.unit_price) === SELL &&
    Number(after.total) === SELL &&
    Math.abs(sellAfter - SELL) < 0.005 &&
    Math.abs(sellBefore - 5.07) < 0.005 &&
    Number(before.unit_cost) !== COST

  console.log(ok
    ? 'PROVED: the old mapping put 3.90 in the cost column and the screen showed 5.07.\n' +
      '        The new mapping carries 3.00 / 3.90 / 30 and the screen shows 3.90.\n' +
      '        The new smoke assertions fail on the old mapping and pass on this one.'
    : 'NOT PROVED - the numbers above did not come out as expected.')
  process.exit(ok ? 0 : 1)
}

main()
