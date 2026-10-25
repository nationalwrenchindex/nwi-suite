// npx tsx scripts/verify-document-discount.ts
//
// The LD discount (src/lib/document-discount.ts, migration 165). Pure: no database.
// The four worked examples are the brief's, to the cent, on INV-2026-0023's figures.

import {
  applyDiscount, discountSplit, normalizeDiscount, parseDiscount, discountLabel, discountForWrite, laborFromLines,
} from '../src/lib/document-discount'
import { computeTax, documentTaxSettings, type TaxSettings } from '../src/lib/tax'
import { documentMoney, storedDiscount } from '../src/lib/document-money'
import { fromLineItems, type EditItem } from '../src/components/shared/line-items'
import { EXTRAS_OFF } from '../src/lib/billable-extras'

let failures = 0
let passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++
  else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}

const TAX: TaxSettings = { tax_parts: true, tax_labor: true, tax_rate_parts: 7.75, tax_rate_labor: 7.75 }
const L = 870.00
const P = 822.39
const base = computeTax({ parts: P, labor: L }, TAX)

console.log('\nBaseline (undiscounted)')
check('labor tax 67.43, parts tax 63.74, total 1823.56',
  base.breakdown.labor!.amount === 67.43 && base.breakdown.parts!.amount === 63.74 &&
  Math.round((base.subtotal + base.taxAmount) * 100) / 100 === 1823.56,
  `${base.breakdown.labor!.amount} / ${base.breakdown.parts!.amount} / ${base.subtotal + base.taxAmount}`)

function run(d: unknown) {
  return applyDiscount({
    discount: normalizeDiscount(d), laborLines: L, partsLines: P, subtotal: base.subtotal,
    breakdown: base.breakdown, taxAmount: base.taxAmount, taxPct: 0,
  })
}
function expect(name: string, d: unknown, want: { labor: number; parts: number; laborTax: number; partsTax: number; total: number }) {
  const r = run(d)
  if (!r.ok) { check(name, false, r.error); return }
  const got = {
    labor: r.breakdown!.labor!.base, parts: r.breakdown!.parts!.base,
    laborTax: r.breakdown!.labor!.amount, partsTax: r.breakdown!.parts!.amount, total: r.grandTotal,
  }
  const ok = (Object.keys(want) as Array<keyof typeof want>).every(k => got[k] === want[k])
  check(name, ok, `labor ${got.labor}, parts ${got.parts}, labor tax ${got.laborTax}, parts tax ${got.partsTax}, total ${got.total}`)
  return r
}

console.log('\nThe four worked examples')
const flatDoc = expect('$100 flat, whole document', { type: 'flat', value: 100, scope: 'document' },
  { labor: 818.59, parts: 773.80, laborTax: 63.44, partsTax: 59.97, total: 1715.80 })
expect('10 percent, whole document', { type: 'percent', value: 10, scope: 'document' },
  { labor: 783.00, parts: 740.15, laborTax: 60.68, partsTax: 57.36, total: 1641.19 })
expect('$100 flat, labor only', { type: 'flat', value: 100, scope: 'labor' },
  { labor: 770.00, parts: 822.39, laborTax: 59.68, partsTax: 63.74, total: 1715.81 })
expect('$100 flat, parts only', { type: 'flat', value: 100, scope: 'parts' },
  { labor: 870.00, parts: 722.39, laborTax: 67.43, partsTax: 55.99, total: 1715.81 })

console.log('\nThe split')
if (flatDoc?.ok) {
  check('the flat split sums to exactly the amount entered (51.41 + 48.59)',
    flatDoc.discount!.labor_amount === 51.41 && flatDoc.discount!.parts_amount === 48.59 && flatDoc.discount!.amount === 100)
  check('the record keeps the pre-discount subtotal, tax and split',
    flatDoc.discount!.subtotal_before === 1692.39 && flatDoc.discount!.tax_before === 131.17 &&
    flatDoc.discount!.pre_tax_breakdown?.labor?.amount === 67.43)
}
// The remainder cent: $0.01 across two equal sides rounds 0.01 + 0.01 = 0.02 -> labour takes -0.01.
const tiny = discountSplit({ type: 'flat', value: 0.01, scope: 'document', reason: null }, 50, 50)
check('a remaining cent goes to labor and the two still sum exactly',
  !('error' in tiny) && Math.round((tiny.labor + tiny.parts) * 100) === 1 && tiny.parts === 0.01 && tiny.labor === 0,
  JSON.stringify(tiny))
let allExact = true
for (let cents = 1; cents <= 5000; cents += 7) {
  const s = discountSplit({ type: 'flat', value: cents / 100, scope: 'document', reason: null }, 333.33, 666.67)
  if ('error' in s || Math.round((s.labor + s.parts) * 100) !== cents) { allExact = false; break }
}
check('every flat amount from $0.01 to $50 splits to exactly what was entered', allExact)

console.log('\nRefused, never negative')
const tooBig = run({ type: 'flat', value: 2000, scope: 'document' })
check('a flat discount larger than the document is refused readably',
  !tooBig.ok && /larger than the labor and parts/.test(tooBig.error), !tooBig.ok ? tooBig.error : 'accepted')
const tooBigLabor = run({ type: 'flat', value: 870.01, scope: 'labor' })
check('a labor discount larger than the labor is refused', !tooBigLabor.ok && /\$870\.00/.test(tooBigLabor.error))
const pct = run({ type: 'percent', value: 101, scope: 'document' })
check('more than 100% is refused', !pct.ok)
const neg = run({ type: 'flat', value: -5, scope: 'document' })
check('a negative discount is refused', !neg.ok)
const noLabor = applyDiscount({
  discount: normalizeDiscount({ type: 'flat', value: 10, scope: 'labor' }), laborLines: 0, partsLines: 50,
  subtotal: 50, breakdown: computeTax({ parts: 50 }, TAX).breakdown, taxAmount: 3.88, taxPct: 0,
})
check('a labor discount on a parts-only document is refused', !noLabor.ok && /no labor/.test(noLabor.error))
const whole = run({ type: 'flat', value: 1692.39, scope: 'document' })
check('exactly the whole amount is allowed and lands at $0.00', whole.ok && whole.grandTotal === 0, whole.ok ? String(whole.grandTotal) : whole.error)

console.log('\nZero or empty is no discount')
for (const d of [null, undefined, {}, { type: 'flat', value: 0 }, { type: 'percent', value: '' }, { type: 'flat', value: 'abc' }]) {
  const r = run(d)
  check(`${JSON.stringify(d)} -> no discount, nothing moves`,
    r.ok && r.discount === null && r.grandTotal === 1823.56 && r.breakdown === base.breakdown)
}

console.log('\nUntouched buckets keep their carried tax')
// A carried tax amount that would NOT re-derive from its base (as on a work-order
// invoice) survives a labour-only discount: only the labour bucket is re-taxed.
const carried = { ...base.breakdown, parts: { ...base.breakdown.parts!, amount: 63.75 } }
const lab = applyDiscount({
  discount: normalizeDiscount({ type: 'flat', value: 100, scope: 'labor' }), laborLines: L, partsLines: P,
  subtotal: base.subtotal, breakdown: carried, taxAmount: 131.18, taxPct: 0,
})
check('a labor discount leaves the parts tax exactly as carried', lab.ok && lab.breakdown!.parts!.amount === 63.75)
const untaxedLabor = applyDiscount({
  discount: normalizeDiscount({ type: 'percent', value: 10, scope: 'document' }), laborLines: L, partsLines: P,
  subtotal: base.subtotal, breakdown: computeTax({ parts: P, labor: L }, { ...TAX, tax_labor: false }).breakdown,
  taxAmount: 63.74, taxPct: 0,
})
check('labor that is not taxed stays at $0.00 tax after a discount',
  untaxedLabor.ok && untaxedLabor.breakdown!.labor!.amount === 0 && untaxedLabor.breakdown!.parts!.amount === 57.36)

console.log('\nSingle-rate documents (no split recorded)')
const single = applyDiscount({
  discount: normalizeDiscount({ type: 'flat', value: 100, scope: 'document' }), laborLines: L, partsLines: P,
  subtotal: 1692.39, breakdown: null, taxAmount: 131.16, taxPct: 7.75,
})
check('tax is the document rate on the post-discount subtotal', single.ok && single.taxAmount === 123.41 && single.grandTotal === 1715.80,
  single.ok ? `${single.taxAmount} / ${single.grandTotal}` : single.error)

console.log('\nRead back and labels')
if (flatDoc?.ok) {
  const back = parseDiscount(JSON.parse(JSON.stringify(flatDoc.discount)))
  check('a stored discount round-trips', JSON.stringify(back) === JSON.stringify(flatDoc.discount))
}
check('garbage reads as no discount', parseDiscount('x') === null && parseDiscount({ version: 1, value: 0 }) === null && parseDiscount([]) === null)
const reason = normalizeDiscount({ type: 'flat', value: 25, scope: 'parts', reason: '  fleet customer ' })
check('the reason is trimmed and kept', reason?.reason === 'fleet customer')
// The amount is in the amount column, so a flat label does not repeat it (Brock, Oct 25).
check('labels say what was given, each fact once', discountLabel(normalizeDiscount({ type: 'percent', value: 10, scope: 'labor' })!) === 'Discount (10% on labor)' &&
  discountLabel(normalizeDiscount({ type: 'flat', value: 100, scope: 'document' })!) === 'Discount' &&
  discountLabel(normalizeDiscount({ type: 'flat', value: 20, scope: 'parts' })!) === 'Discount on parts')

console.log('\nThrough the money layer (lib/document-money) - what the editors save')
{
  const items: EditItem[] = [
    { _id: 'l', kind: 'labor', description: 'Labor', part_number: '', quantity: 8.7, unit_price: 100 },
    { _id: 'p', description: 'Parts', part_number: '', quantity: 1, unit_price: 822.39 },
  ]
  const common = {
    items, markupPct: 0, laborRate: 100, taxPct: 7.75, taxSettings: TAX,
    extrasSettings: EXTRAS_OFF, extras: { travelHours: 0, mileageMiles: 0 },
  }
  const none = documentMoney(common)
  check('no discount: the baseline document totals 1823.56 and writes no discount column',
    none.grandTotal === 1823.56 && !('discount' in none.columns) && none.discount === null)
  const flat = documentMoney({ ...common, discount: normalizeDiscount({ type: 'flat', value: 100, scope: 'document', reason: 'fleet customer' }) })
  check('$100 off the whole document saves 1715.80 with the record and the post-discount split',
    flat.columns.grand_total === 1715.8 && flat.columns.tax_amount === 123.41 &&
    (flat.columns.discount as { amount?: number })?.amount === 100 &&
    (flat.columns.tax_breakdown as { labor?: { base: number } })?.labor?.base === 818.59,
    `grand ${flat.columns.grand_total}, tax ${flat.columns.tax_amount}`)
  check('the subtotal before the discount is kept for printing', flat.subtotal === 1692.39 && flat.discount?.subtotal_before === 1692.39)

  // Stored as the editor would store it, then reopened exactly as loaded.
  const stored = JSON.parse(JSON.stringify(flat.columns)) as Record<string, unknown>
  const reopened = fromLineItems(stored.line_items as never, 0, undefined, { withLabor: true })
  const reload = { ...common, items: reopened, taxSettings: documentTaxSettings(stored.tax_breakdown, null, 7.75), stored }
  const noop = documentMoney({ ...reload, discount: storedDiscount(stored) })
  check('a no-op save of a discounted document returns its stored figures exactly',
    Object.keys(stored).every(k => JSON.stringify(noop.columns[k]) === JSON.stringify(stored[k])) &&
    Object.keys(noop.columns).length === Object.keys(stored).length &&
    noop.grandTotal === 1715.8 && noop.subtotal === 1692.39 && noop.discount?.amount === 100)
  const changed = documentMoney({ ...reload, discount: normalizeDiscount({ type: 'percent', value: 10, scope: 'document' }) })
  check('changing the discount re-totals from the lines under its recorded tax (10% -> 1641.19)',
    changed.columns.grand_total === 1641.19, String(changed.columns.grand_total))
  const cleared = documentMoney({ ...reload, discount: null })
  check('removing it writes discount null and returns to 1823.56',
    cleared.columns.discount === null && cleared.columns.grand_total === 1823.56, String(cleared.columns.grand_total))
  const tooBigDoc = documentMoney({ ...common, discount: normalizeDiscount({ type: 'flat', value: 5000, scope: 'labor' }) })
  check('a discount too large reports why, writes no discount and keeps the undiscounted total',
    !!tooBigDoc.discountError && !('discount' in tooBigDoc.columns) && tooBigDoc.columns.grand_total === 1823.56)
}

console.log('\nWhat a route will store')
{
  const ok = run({ type: 'flat', value: 100, scope: 'document' })
  const rec = ok.ok ? JSON.parse(JSON.stringify(ok.discount)) : null
  const w = discountForWrite(rec)
  check('a well-formed record is accepted', !('error' in w) && !w.skip && w.value?.amount === 100)
  check('absent leaves the column alone, null clears it',
    (discountForWrite(undefined) as { skip: boolean }).skip === true &&
    (() => { const n = discountForWrite(null); return !('error' in n) && !n.skip && n.value === null })())
  const lie = discountForWrite({ ...rec, labor_amount: 90 })
  check('a record whose sides do not add up is refused', 'error' in lie)
  const huge = discountForWrite({ ...rec, amount: 5000, labor_amount: 2500, parts_amount: 2500 })
  check('a record bigger than its subtotal is refused, never stored', 'error' in huge && /larger than/.test(huge.error))
  check('unreadable is refused', 'error' in discountForWrite({ version: 1, value: 'x' }))
}

console.log('\nLabour lines on a stored document')
check('typed labour and legacy "Labor..." lines count; parts do not',
  laborFromLines([{ type: 'labor', total: 199.98 }, { type: 'parts', total: 10 }, { description: 'Labor - diag', total: 50 }, { description: 'Filter', total: 5 }]) === 249.98)

console.log(`\n${passes} passed, ${failures} failed`)
if (failures) process.exit(1)
