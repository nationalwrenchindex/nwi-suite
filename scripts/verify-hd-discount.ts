// npx tsx scripts/verify-hd-discount.ts
//
// The HD discount (migration 168, src/lib/hd/hd-discount.ts) and the terms list.
// READ ONLY: real hd_invoices / hd_quotes rows are read through the service REST API
// and run through the real pure modules. Nothing is written anywhere.
//
//   1. Brock's worked $100 example, to the cent (confirmed Oct 25).
//   2. The printed label: flat states no amount twice; percent keeps the percentage.
//   3. A split-less invoice CARRIES its tax: stored tax - discount x recorded rate.
//   4. The missing-rate guard: never NaN, never a silent zero.
//   5. Round trip on real invoices: apply, store, reopen - nothing written, no double
//      discount, still adds up.
//   6. Quote -> work order -> invoice: the converter reproduces the discounted quote.
//   7. Work order discount set then removed restores every figure exactly.
//   8. D5: shop supplies taxed as PARTS at convert.
//   9. Payment terms: every stored spelling, and Net 3.

import { loadEnv } from './lib/smoke-session'
import { computeExtras, type ExtrasSettings } from '../src/lib/billable-extras'
import { computeTax, mergeBreakdowns, parseBreakdown, type TaxSettings } from '../src/lib/tax'
import { discountPrintLabel, normalizeDiscount, parseDiscount } from '../src/lib/document-discount'
import { hdApplyDiscount } from '../src/lib/hd/hd-discount'
import { openInvoiceEdit, priceInvoiceEdit, invoiceSaveBody, invoiceDoesNotAddUp } from '../src/lib/hd/invoice-edit-save'
import { termsFromQuote, workOrderLinesFromQuote } from '../src/lib/hd/quote-approval'
import { buildInvoicePayload, workOrderDiscountUpdate, type WorkOrderLineRow } from '../src/lib/hd/wo-to-invoice'
import { normalisePaymentTerms, PAYMENT_TERMS, termDays, termsDisplay } from '../src/lib/hd/payment-terms'

let passes = 0
let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++
  else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}
const hr = (t: string) => console.log(`\n${t}`)
const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

async function main() {
  loadEnv()
  const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const H = { apikey: K, Authorization: 'Bearer ' + K }
  const get = async (p: string) => (await fetch(`${S}/rest/v1/${p}`, { headers: H })).json() as Promise<Record<string, unknown>[]>

  // ── 1 ───────────────────────────────────────────────────────────────────────
  hr('1. The worked $100 example (Brock\'s settings: HD $145/hr, travel $135/hr, $2/mi, supplies 2.5% cap 100, tax 7.75% / 7.75%)')
  const tax: TaxSettings = { tax_parts: true, tax_labor: true, tax_rate_parts: 7.75, tax_rate_labor: 7.75 }
  const ex: ExtrasSettings = { billTravel: true, travelRatePerHour: 135, billMileage: true, mileageRatePerMile: 2,
    billShopSupplies: true, shopSuppliesPercent: 2.5, shopSuppliesCap: 100 }
  const labor = 435, parts = 600
  const extras = computeExtras(parts, { travelHours: 1, mileageMiles: 40 }, ex, 145)
  const subtotal = r2(labor + parts + extras.total)
  const t = computeTax({ parts: parts + extras.shopSupplies.amount, labor: labor + extras.travel.amount }, tax)
  check('before: subtotal 1265.00, tax 47.66 + 44.18 = 91.84', subtotal === 1265 && t.taxAmount === 91.84,
    `${subtotal} / ${t.taxAmount}`)
  const flat = hdApplyDiscount({ discount: normalizeDiscount({ type: 'flat', value: 100, scope: 'document', reason: 'Fleet customer' }),
    laborLines: labor, partsLines: parts, subtotal, breakdown: t.breakdown, taxAmount: t.taxAmount, taxRatePct: null })
  check('$100: labor 42.03 + parts 57.97, tax 43.17 + 40.92 = 84.09, total 1249.09',
    flat.ok && flat.discount!.labor_amount === 42.03 && flat.discount!.parts_amount === 57.97 &&
    flat.breakdown!.parts!.amount === 43.17 && flat.breakdown!.labor!.amount === 40.92 &&
    flat.taxAmount === 84.09 && flat.grandTotal === 1249.09,
    flat.ok ? `${flat.discount!.labor_amount}/${flat.discount!.parts_amount} ${flat.taxAmount} ${flat.grandTotal}` : flat.error)
  check('shop supplies stays 15.00 and mileage 80.00 - never discounted', extras.shopSupplies.amount === 15 && extras.mileage.amount === 80)
  const pct = hdApplyDiscount({ discount: normalizeDiscount({ type: 'percent', value: 10, scope: 'document', reason: null }),
    laborLines: labor, partsLines: parts, subtotal, breakdown: t.breakdown, taxAmount: t.taxAmount, taxRatePct: null })
  check('10%: 43.50 + 60.00 = 103.50 off, tax 83.81, total 1245.31',
    pct.ok && pct.discount!.amount === 103.5 && pct.taxAmount === 83.81 && pct.grandTotal === 1245.31,
    pct.ok ? `${pct.discount!.amount} ${pct.taxAmount} ${pct.grandTotal}` : pct.error)

  // ── 2 ───────────────────────────────────────────────────────────────────────
  hr('2. The printed label')
  const lab = (d: unknown) => discountPrintLabel(normalizeDiscount(d)!)
  check('flat with a reason: "Discount - Fleet customer"', lab({ type: 'flat', value: 100, scope: 'document', reason: 'Fleet customer' }) === 'Discount - Fleet customer')
  check('percent with a reason: "Discount (10%) - Fleet customer"', lab({ type: 'percent', value: 10, scope: 'document', reason: 'Fleet customer' }) === 'Discount (10%) - Fleet customer')
  check('no reason: just "Discount"', lab({ type: 'flat', value: 100, scope: 'document', reason: '' }) === 'Discount')
  check('a scope is stated: "Discount on labor", "Discount (15% on parts)"',
    lab({ type: 'flat', value: 20, scope: 'labor', reason: null }) === 'Discount on labor' &&
    lab({ type: 'percent', value: 15, scope: 'parts', reason: null }) === 'Discount (15% on parts)')
  check('plain ASCII - the hyphen is a hyphen', /^[\x20-\x7e]*$/.test(lab({ type: 'percent', value: 10, scope: 'document', reason: 'x' })))

  // Real rows from here on.
  const invoices = await get('hd_invoices?select=*&order=invoice_number.asc')
  const byNo = (n: string) => invoices.find(i => i.invoice_number === n && String(i.user_id).startsWith('4a8c046f'))!
  const shop = 145

  // ── 3 ───────────────────────────────────────────────────────────────────────
  hr('3. A split-less invoice carries its tax (INV-2026-0004: sent, 7.75%, tax 76.59, no tax_breakdown)')
  const i4 = byNo('INV-2026-0004')
  const o4 = openInvoiceEdit(i4, shop)
  const s4 = { ...o4.state, discount: normalizeDiscount({ type: 'flat', value: 100, scope: 'document', reason: 'Fleet customer' }) }
  const p4 = priceInvoiceEdit(i4, o4.state, s4)
  check('tax = 76.59 - round2(100 x 7.75%) = 68.84; no split is invented',
    p4.taxAmount === 68.84 && p4.breakdown === null, `${p4.taxAmount} ${JSON.stringify(p4.breakdown)}`)
  check(`total = ${num(i4.total)} - 100 - 7.75 = ${r2(num(i4.total) - 107.75)}`, p4.total === r2(num(i4.total) - 107.75), String(p4.total))
  check('mileage is not newly taxed: only the discount\'s share comes off', r2(num(i4.tax_amount) - p4.taxAmount) === 7.75)

  // ── 4 ───────────────────────────────────────────────────────────────────────
  hr('4. The missing-rate guard')
  const noRate = hdApplyDiscount({ discount: normalizeDiscount({ type: 'flat', value: 50, scope: 'document', reason: null }),
    laborLines: 300, partsLines: 200, subtotal: 600, breakdown: null, taxAmount: 40, taxRatePct: null })
  check('tax charged, no rate recorded: refused, and says why', !noRate.ok && /recorded no tax rate/.test(noRate.error), noRate.ok ? 'applied' : noRate.error)
  const zeroRate = hdApplyDiscount({ discount: normalizeDiscount({ type: 'flat', value: 50, scope: 'document', reason: null }),
    laborLines: 300, partsLines: 200, subtotal: 600, breakdown: null, taxAmount: 40, taxRatePct: 0 })
  check('tax charged at a recorded 0%: refused', !zeroRate.ok && /0%/.test(zeroRate.error))
  const noTax = hdApplyDiscount({ discount: normalizeDiscount({ type: 'flat', value: 50, scope: 'document', reason: null }),
    laborLines: 300, partsLines: 200, subtotal: 600, breakdown: null, taxAmount: 0, taxRatePct: null })
  check('no rate and no tax: applied, no tax comes off, and the screen is told',
    noTax.ok && noTax.taxAmount === 0 && noTax.grandTotal === 550 && !!noTax.notice, noTax.ok ? String(noTax.notice) : noTax.error)
  const i4n = { ...i4, tax_rate: null }
  const o4n = openInvoiceEdit(i4n, shop)
  const p4n = priceInvoiceEdit(i4n, o4n.state, { ...o4n.state, discount: s4.discount })
  check('the invoice editor on that row: the error shows and the figures are undiscounted', !!p4n.discountError && p4n.discount === null && p4n.total === r2(num(i4.total)))
  let threw = false
  try { invoiceSaveBody(i4n, o4n, { ...o4n.state, discount: s4.discount }) } catch { threw = true }
  check('and no save body can be built from it', threw)
  const p4r = priceInvoiceEdit(i4n, o4n.state, { ...o4n.state, tax_rate: 7.75, discount: s4.discount })
  check('entering the rate applies it', !p4r.discountError && p4r.taxAmount === 68.84, String(p4r.discountError ?? p4r.taxAmount))

  // ── 5 ───────────────────────────────────────────────────────────────────────
  hr('5. Round trip on real invoices: apply, store, reopen')
  for (const no of ['INV-2026-0004', 'INV-2026-0023', 'INV-2026-0005', 'INV-2026-0021']) {
    const inv = byNo(no)
    for (const d of [{ type: 'flat', value: 40, scope: 'document', reason: 'Fleet' }, { type: 'percent', value: 10, scope: 'labor', reason: null }]) {
      const o = openInvoiceEdit(inv, shop)
      const body = invoiceSaveBody(inv, o, { ...o.state, discount: normalizeDiscount(d) })
      const stored = { ...inv, ...body }
      const o2 = openInvoiceEdit(stored, shop)
      const again = invoiceSaveBody(stored, o2, o2.state)
      const rec = parseDiscount(stored.discount)
      const label = `${no} ${d.type} ${d.value} ${d.scope}`
      check(`${label}: writes discount, tax, total; stored total = subtotal - discount + tax`,
        !!rec && 'total' in body && r2(rec.subtotal_before - rec.amount + num(stored.tax_amount)) === r2(num(stored.total)),
        rec ? `${rec.subtotal_before} - ${rec.amount} + ${stored.tax_amount} vs ${stored.total}` : 'no record')
      check(`${label}: reopened and saved unchanged writes nothing (no double discount)`, Object.keys(again).length === 0, JSON.stringify(again))
      check(`${label}: still adds up`, invoiceDoesNotAddUp(stored) === null)
      const removed = invoiceSaveBody(stored, o2, { ...o2.state, discount: null })
      check(`${label}: removing it restores the stored total and tax exactly`,
        removed.discount === null && r2(num((removed.total ?? stored.total))) === r2(num(inv.total)) &&
        r2(num(removed.tax_amount ?? stored.tax_amount)) === r2(num(inv.tax_amount)),
        `${removed.total} ${removed.tax_amount}`)
    }
  }

  // ── 6 ───────────────────────────────────────────────────────────────────────
  hr('6. Quote -> work order -> invoice')
  const quotes = await get('hd_quotes?select=*&status=eq.approved&order=quote_number.asc')
  const q = quotes.find(x => parseBreakdown(x.tax_breakdown) && Array.isArray(x.line_items) && (x.line_items as unknown[]).length > 0)!
  const ql = (q.line_items as Array<Record<string, unknown>>)
  const qLabor = r2(ql.filter(l => l.type === 'labor').reduce((s, l) => s + num(l.amount), 0))
  const qParts = r2(ql.filter(l => l.type === 'parts').reduce((s, l) => s + num(l.amount), 0))
  const qSub = r2(qLabor + qParts + num(q.diagnostic_fee) + num(q.road_call_fee) +
    num(q.travel_amount) + num(q.mileage_amount) + num(q.shop_supplies_fee))
  const qd = hdApplyDiscount({ discount: normalizeDiscount({ type: 'flat', value: 25, scope: 'document', reason: 'Fleet' }),
    laborLines: qLabor, partsLines: qParts, subtotal: qSub, breakdown: parseBreakdown(q.tax_breakdown),
    taxAmount: num(q.tax_amount), taxRatePct: null })
  if (!qd.ok) { check(`${q.quote_number}: discount applies`, false, qd.error) } else {
    const dq: Record<string, unknown> = { ...q, discount: qd.discount, tax_amount: qd.taxAmount, tax_breakdown: qd.breakdown, total: qd.grandTotal }
    const wo = { id: 'wo', work_order_number: 'WO-TEST', ...termsFromQuote(dq), total_amount: dq.total }
    const rows = workOrderLinesFromQuote(dq.line_items, num(dq.labor_rate)) as unknown as WorkOrderLineRow[]
    const built = buildInvoicePayload(wo, rows, { laborRate: shop, taxSettings: tax })
    const pd = parseDiscount(built.payload.discount)
    check(`${q.quote_number} (+$25 off): invoice total = discounted quote total ${dq.total}`,
      !built.discountError && r2(num(built.payload.total)) === r2(num(dq.total)), `${built.payload.total} ${built.discountError ?? ''}`)
    check('invoice tax = discounted quote tax, split identical', r2(num(built.payload.tax_amount)) === qd.taxAmount &&
      JSON.stringify(parseBreakdown(built.payload.tax_breakdown)) === JSON.stringify(parseBreakdown(qd.breakdown)))
    check('the discount record carries, same amounts', !!pd && pd.amount === 25 && pd.labor_amount === qd.discount!.labor_amount)
    check('the terms snapshot travels quote -> work order -> invoice', JSON.stringify(built.payload.terms_snapshot) === JSON.stringify(dq.terms_snapshot ?? null))
    const undisc = buildInvoicePayload({ id: 'wo', ...termsFromQuote(q), total_amount: q.total },
      workOrderLinesFromQuote(q.line_items, num(q.labor_rate)) as unknown as WorkOrderLineRow[], { laborRate: shop, taxSettings: tax })
    check('the same quote with no discount converts exactly as before (discount null)',
      undisc.payload.discount === null && r2(num(undisc.payload.total)) === r2(num(q.total)), String(undisc.payload.total))

    // ── 7 ─────────────────────────────────────────────────────────────────────
    hr('7. Work order discount: set, then removed')
    const plain = { id: 'wo', ...termsFromQuote(q), total_amount: q.total, status: 'scheduled' }
    const qrows = workOrderLinesFromQuote(q.line_items, num(q.labor_rate)) as unknown as WorkOrderLineRow[]
    const set = workOrderDiscountUpdate(plain, qrows, normalizeDiscount({ type: 'flat', value: 25, scope: 'document', reason: 'Fleet' }), shop)
    if ('error' in set) { check('set applies', false, set.error) } else {
      check('set on the work order = the same figures the quote would have had',
        set.update.tax_amount === qd.taxAmount && r2(num(set.update.total_amount)) === r2(num(dq.total)), `${set.update.tax_amount} ${set.update.total_amount}`)
      const after = { ...plain, ...set.update }
      const removed = workOrderDiscountUpdate(after, qrows, null, shop)
      check('removed: tax, split and quoted total restored exactly',
        !('error' in removed) && removed.update.discount === null && removed.update.tax_amount === r2(num(q.tax_amount)) &&
        r2(num(removed.update.total_amount)) === r2(num(q.total)) &&
        JSON.stringify(parseBreakdown(removed.update.tax_breakdown)) === JSON.stringify(parseBreakdown(q.tax_breakdown)),
        'error' in removed ? removed.error : `${removed.update.tax_amount} ${removed.update.total_amount}`)
      const conv = buildInvoicePayload(after, qrows, { laborRate: shop, taxSettings: tax })
      check('converting the work-order-discounted job bills the same total', r2(num(conv.payload.total)) === r2(num(dq.total)), String(conv.payload.total))
    }
    const big = workOrderDiscountUpdate(plain, qrows, normalizeDiscount({ type: 'flat', value: 999999, scope: 'document', reason: null }), shop)
    check('a discount bigger than the lines is refused with the reason', 'error' in big && /larger than/.test(big.error))
  }

  // ── 8 ───────────────────────────────────────────────────────────────────────
  hr('8. D5: shop supplies taxed as PARTS at convert (work order with no tax recorded)')
  const split: TaxSettings = { tax_parts: true, tax_labor: false, tax_rate_parts: 7, tax_rate_labor: 0 }
  const woNoTax = { id: 'wo', labor_rate: 145, shop_supplies_fee: 2.5, shop_supplies_percent_applied: 2.5 }
  const rowsNoTax: WorkOrderLineRow[] = [
    { type: 'part', description: 'Filter', quantity: 1, unit_cost: 80, unit_price: 100, total: 100, sort_order: 0 },
    { type: 'labor', description: 'Labor', quantity: 1, unit_price: 145, total: 145, sort_order: 1 },
  ]
  const d5 = buildInvoicePayload(woNoTax, rowsNoTax, { laborRate: 145, taxSettings: split })
  const bd5 = parseBreakdown(d5.payload.tax_breakdown)
  check('parts bucket = 100 + 2.50 supplies, taxed 7% = 7.18 (labor untaxed)',
    bd5?.parts?.base === 102.5 && bd5?.parts?.amount === 7.18 && num(d5.payload.tax_amount) === 7.18,
    JSON.stringify(bd5))
  check('supplies no longer sits in the labor bucket', bd5?.labor?.base === 145)

  // ── 9 ───────────────────────────────────────────────────────────────────────
  hr('9. Payment terms')
  check('offered: Due on receipt, Net 3, Net 7, Net 15, Net 30', PAYMENT_TERMS.join(',') === 'due_on_receipt,net_3,net_7,net_15,net_30')
  const stored = new Map<string, number>()
  for (const i of invoices) stored.set(String(i.payment_terms), (stored.get(String(i.payment_terms)) ?? 0) + 1)
  for (const x of await get('hd_quotes?select=payment_terms')) stored.set(String(x.payment_terms), (stored.get(String(x.payment_terms)) ?? 0) + 1)
  for (const [v, n] of stored) {
    const c = v === 'null' ? null : v
    console.log(`        stored ${JSON.stringify(c).padEnd(18)} x${String(n).padEnd(3)} -> ${String(normalisePaymentTerms(c)).padEnd(15)} "${termsDisplay(c)}", ${termDays(c)} days`)
    check(`stored ${JSON.stringify(c)} is still read`, c === null || normalisePaymentTerms(c) !== null)
  }
  check('Net 3: net_3 / net3 / "Net 3" -> 3 days, "Net 3"',
    ['net_3', 'net3', 'Net 3'].every(v => termDays(v) === 3 && termsDisplay(v) === 'Net 3'))

  console.log(`\n${passes} passed, ${failures} failed`)
  process.exit(failures ? 1 : 0)
}
main()
