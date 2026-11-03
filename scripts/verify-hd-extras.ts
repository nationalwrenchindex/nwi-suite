// npx tsx scripts/verify-hd-extras.ts [old-snapshot.json new-snapshot.json]
//
// HD billable extras: drive time, mileage, shop supplies and the service call fee.
// READS the database, writes nothing. Prints real figures, line by line, not only
// pass/fail. Every work order below is built in memory on your real settings and run
// through the same functions the routes use:
//
//   workOrderDefaultColumns   what a new work order records at creation
//   workOrderExtrasUpdate     PUT /api/hd/work-orders/[id]/extras
//   buildInvoicePayload       GET /api/hd/work-orders/[id]/convert
//   feeRows/extrasDisplayRows the invoice page, the PDF and the customer's pay page
//   priceInvoiceEdit          the invoice editor
//
// Before migration 178 your HD defaults read from LD's Travel, Mileage & Supplies
// settings (what HD bills today), and the service call fee is SIMULATED at $95 - the
// columns it needs do not exist yet. Both are said where they are used.
//
// With two snapshot files from scripts/snapshot-hd-money.ts (old code, new code, same
// data), it also prints three existing invoices' totals before and after.

import { readFileSync } from 'node:fs'
import { loadEnv } from './lib/smoke-session'
import { normalizeLine, type WorkOrderLineInput } from '../src/lib/shared/work-order-lines'
import { buildInvoicePayload, workOrderDiscountUpdate, type WorkOrderLineRow, type ShopFallback } from '../src/lib/hd/wo-to-invoice'
import { invoiceJobGroups, type WorkOrderJob } from '../src/lib/hd/work-order-jobs'
import { taxSettingsFrom, TAX_SETTINGS_SELECT, parseBreakdown } from '../src/lib/tax'
import { feeRows } from '../src/lib/invoice-document'
import { extrasDisplayRows, extrasFromDocument, EXTRAS_SETTINGS_SELECT } from '../src/lib/billable-extras'
import { hdExtrasSettingsFrom, hdServiceCallFrom, hasHdExtrasColumns, HD_EXTRAS_SELECT } from '../src/lib/hd/hd-extras'
import { workOrderDefaultColumns, workOrderExtrasUpdate, type ShopExtras } from '../src/lib/hd/work-order-extras'
import { openInvoiceEdit, priceInvoiceEdit, invoiceSaveBody } from '../src/lib/hd/invoice-edit-save'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const FOUNDER = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

async function get(q: string): Promise<Record<string, any>[]> {
  const r = await fetch(`${S}/rest/v1/${q}`, { headers: H })
  const j = await r.json()
  if (!Array.isArray(j)) throw Object.assign(new Error(`${q}: ${JSON.stringify(j)}`), { body: j })
  return j
}

let failures = 0, passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++; else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}
const usd = (n: unknown) => `$${(Number(n) || 0).toFixed(2)}`
const r2 = (n: number) => Math.round(n * 100) / 100
const row = (label: string, v: unknown) => console.log(`   ${label.padEnd(64)}${usd(v).padStart(12)}`)

/** Every row the invoice page prints, in its order, and the total. */
function printInvoice(inv: Record<string, any>): Array<[string, number]> {
  const rows: Array<[string, number]> = [
    ['Labor Subtotal', Number(inv.subtotal_labor)], ['Parts Subtotal', Number(inv.subtotal_parts)],
    ...feeRows(inv).map(r => [r.label, r.amount] as [string, number]),
    ...extrasDisplayRows(extrasFromDocument(inv)).map(r => [r.detail ? `${r.label} (${r.detail})` : r.label, r.amount] as [string, number]),
  ]
  for (const [l, v] of rows) row(l, v)
  const d = inv.discount as { amount: number; subtotal_before: number } | null
  if (d) { row('Subtotal', d.subtotal_before); row('Discount', -d.amount) }
  const bd = parseBreakdown(inv.tax_breakdown)
  for (const k of ['parts', 'labor'] as const) {
    const b = bd?.[k]
    if (b) row(`Tax on ${k}: ${b.rate}% of ${usd(b.base)}${b.taxed ? '' : ' (not taxed)'}`, b.amount)
  }
  console.log(`   ${'TOTAL'.padEnd(64)}${usd(inv.total).padStart(12)}`)
  return rows
}

async function main() {
  // ── your real settings ──────────────────────────────────────────────────────────
  let profile: Record<string, any>
  try {
    ;[profile] = await get(`profiles?select=hd_labor_rate,default_labor_rate,${TAX_SETTINGS_SELECT},${EXTRAS_SETTINGS_SELECT},${HD_EXTRAS_SELECT}&id=eq.${FOUNDER}`)
  } catch {
    ;[profile] = await get(`profiles?select=hd_labor_rate,default_labor_rate,${TAX_SETTINGS_SELECT},${EXTRAS_SETTINGS_SELECT}&id=eq.${FOUNDER}`)
  }
  const has178 = hasHdExtrasColumns(profile)
  const laborRate = Number(profile.hd_labor_rate ?? profile.default_labor_rate)
  const fb: ShopFallback = { laborRate, taxSettings: taxSettingsFrom(profile) }
  const extras = hdExtrasSettingsFrom(profile)
  const realCall = hdServiceCallFrom(profile)
  const call = has178 && realCall.bill && realCall.fee ? realCall : { bill: true, fee: 95, tax: 'labor' as const }
  const shop: ShopExtras = { extras, serviceCall: call, laborRate, taxSettings: fb.taxSettings }
  const ts = fb.taxSettings

  console.log(`\nYOUR SETTINGS (${has178 ? 'HD columns, migration 178' : 'migration 178 NOT applied - HD reads your LD Travel, Mileage & Supplies settings, as it does today'})`)
  console.log(`   HD labor rate ${usd(laborRate)}/hr; tax parts ${ts.tax_parts ? ts.tax_rate_parts + '%' : 'off'}, labor ${ts.tax_labor ? ts.tax_rate_labor + '%' : 'off'}`)
  console.log(`   drive time ${extras.billTravel ? `ON at ${usd(extras.travelRatePerHour ?? laborRate)}/hr` : 'off'}; mileage ${extras.billMileage ? `ON at ${usd(extras.mileageRatePerMile)}/mi` : 'off'}; shop supplies ${extras.billShopSupplies ? `ON at ${extras.shopSuppliesPercent}% of parts, cap ${extras.shopSuppliesCap == null ? 'none' : usd(extras.shopSuppliesCap)}` : 'off'}`)
  console.log(`   service call fee ${usd(call.fee)}, ${call.tax === 'none' ? 'not taxed' : 'taxed as labor'}${has178 && realCall.bill ? '' : '  <- SIMULATED (not set or 178 not applied)'}`)

  // ── 1. a new three-job work order with all four ────────────────────────────────
  const sent: Array<WorkOrderLineInput & { job: number }> = [
    { job: 1, type: 'part',  description: 'Compressor X430P', part_number: '102-1100', quantity: 1, unit_cost: 812.40, markup_percent: 30 },
    { job: 1, type: 'part',  description: 'Receiver drier', part_number: '66-8712', quantity: 1, unit_cost: 46.15, markup_percent: 30 },
    { job: 1, type: 'labor', description: 'R&R compressor, evacuate and charge', quantity: 4.5, unit_price: laborRate },
    { job: 2, type: 'labor', description: 'Diagnose high head pressure', quantity: 1.25, unit_price: laborRate },
    { job: 3, type: 'part',  description: 'Fuel filter', part_number: '11-9098', quantity: 2, unit_cost: 18.37, markup_percent: 30 },
    { job: 3, type: 'part',  description: 'Air filter', part_number: '11-9300', quantity: 1, unit_cost: 41.09, markup_percent: 30 },
  ]
  const jobs: WorkOrderJob[] = [
    { id: 'j1', job_number: 1, description: 'Replace compressor', status: 'complete' },
    { id: 'j2', job_number: 2, description: 'Diagnose high head pressure', status: 'complete' },
    { id: 'j3', job_number: 3, description: 'PM filters', status: 'complete' },
  ]
  const lines = sent.map((l, i) => ({ ...normalizeLine(l, i)!, id: `l${i}`, job_id: `j${l.job}` })) as WorkOrderLineRow[]
  const blank = {
    id: 'extras-test', user_id: FOUNDER, work_order_number: 'WO-TEST-EXTRAS', status: 'open',
    labor_rate: null, tax_percent: null, tax_amount: null, tax_breakdown: null, discount: null,
    diagnostic_fee: null, road_call_fee: null, service_call_fee: null, service_call_tax: null,
    travel_hours: 0, travel_rate: null, travel_amount: 0, mileage_miles: 0, mileage_rate: null, mileage_amount: 0,
    shop_supplies_percent_applied: null, shop_supplies_cap_applied: null, shop_supplies_fee: 0,
  }
  const created = { ...blank, ...workOrderDefaultColumns(shop, true) }
  console.log('\n1. A NEW THREE-JOB WORK ORDER: what it records at creation, from your settings')
  console.log(`   travel_rate ${created.travel_rate}, mileage_rate ${created.mileage_rate}, shop_supplies ${created.shop_supplies_percent_applied}% cap ${created.shop_supplies_cap_applied}, service_call_fee ${created.service_call_fee} (${created.service_call_tax})`)

  const saved = workOrderExtrasUpdate(created, lines, { travelHours: 1.5, mileageMiles: 42, serviceCallFee: call.fee }, shop, true)
  if ('error' in saved) throw new Error(saved.error)
  const wo = { ...created, ...saved.update }
  console.log('   The tech enters 1.5 hours drive time, 42 miles, and keeps the service call fee. The work order, job by job:')
  for (const j of jobs) {
    const js = lines.filter(p => p.job_id === j.id)
    for (const p of js) console.log(`        Job ${j.job_number}  ${p.type === 'labor' ? 'LAB' : 'PRT'} ${String(p.description).padEnd(38)} ${usd(p.total).padStart(10)}`)
    console.log(`        Job ${j.job_number} - ${j.description} subtotal`.padEnd(56) + usd(r2(js.reduce((t, p) => t + Number(p.total), 0))).padStart(10))
  }

  const { payload: inv } = buildInvoicePayload(wo, lines, fb, jobs)
  console.log('\n   CONVERTED. The invoice, grouped by job:')
  const groups = invoiceJobGroups(inv.line_items as Array<Record<string, unknown>>)
  for (const g of groups ?? []) {
    console.log(`   ${g.label}`)
    for (const l of g.lines) console.log(`        ${String(l.type).padEnd(5)} ${String(l.description).padEnd(40)}${usd(l.amount).padStart(12)}`)
    console.log(`        ${(g.label + ' subtotal').padEnd(46)}${usd(g.subtotal).padStart(12)}`)
  }
  console.log('   Totals block:')
  const printed = printInvoice(inv)

  const labor = Number(inv.subtotal_labor), parts = Number(inv.subtotal_parts)
  const travel = r2(1.5 * (extras.travelRatePerHour ?? laborRate)), miles = r2(42 * (extras.mileageRatePerMile ?? 0))
  const supplies = (() => { const s = r2(parts * (Number(extras.shopSuppliesPercent) / 100)); return extras.shopSuppliesCap != null && s > extras.shopSuppliesCap ? extras.shopSuppliesCap : s })()
  const fee = Number(call.fee)
  const labels = printed.map(p => p[0].split(' (')[0])
  check('the four each print on their own named line', ['Service Call Fee', 'Travel Time', 'Mileage', 'Shop Supplies'].every(l => labels.includes(l)), labels.join(' | '))
  check(`drive time ${usd(inv.travel_amount)} = 1.5 h x ${usd(extras.travelRatePerHour ?? laborRate)}`, Number(inv.travel_amount) === travel)
  check(`mileage ${usd(inv.mileage_amount)} = 42 mi x ${usd(extras.mileageRatePerMile)}`, Number(inv.mileage_amount) === miles)
  check(`shop supplies ${usd(inv.shop_supplies_fee)} = ${extras.shopSuppliesPercent}% of PARTS ${usd(parts)} (cap ${usd(extras.shopSuppliesCap)}) - nothing else feeds it`, Number(inv.shop_supplies_fee) === supplies, `expected ${usd(supplies)}`)
  check(`service call fee ${usd(inv.service_call_fee)} carried from the work order`, Number(inv.service_call_fee) === fee)
  const bd = parseBreakdown(inv.tax_breakdown)
  check(`labor tax bucket ${usd(bd?.labor?.base)} = labor ${usd(labor)} + drive time ${usd(travel)} + service call ${usd(fee)} (mileage untaxed)`, bd?.labor?.base === r2(labor + travel + fee))
  check(`parts tax bucket ${usd(bd?.parts?.base)} = parts ${usd(parts)} + shop supplies ${usd(supplies)}`, bd?.parts?.base === r2(parts + supplies))
  const expectTax = r2(r2((ts.tax_labor ? ts.tax_rate_labor : 0) / 100 * (labor + travel + fee)) + r2((ts.tax_parts ? ts.tax_rate_parts : 0) / 100 * (parts + supplies)))
  check(`tax ${usd(inv.tax_amount)}, rounded per bucket`, Number(inv.tax_amount) === expectTax, `expected ${usd(expectTax)}`)
  check(`total ${usd(inv.total)} = labor + parts + service call + drive time + mileage + supplies + tax, to the cent`,
    Number(inv.total) === r2(labor + parts + fee + travel + miles + supplies + expectTax))
  check('job subtotals add to labor + parts exactly', r2((groups ?? []).reduce((t, g) => t + g.subtotal, 0)) === r2(labor + parts))

  // ── 1b. the discount stays off the four ────────────────────────────────────────
  const discounted = workOrderDiscountUpdate(wo, lines, { type: 'percent', value: 10, scope: 'document', reason: 'test' }, laborRate)
  if ('error' in discounted) throw new Error(discounted.error)
  const { payload: dInv } = buildInvoicePayload({ ...wo, ...discounted.update }, lines, fb, jobs)
  const dAmt = Number((dInv.discount as { amount: number }).amount)
  console.log(`\n1b. 10% DISCOUNT on the same work order: ${usd(dAmt)} off, total ${usd(dInv.total)}`)
  check(`the discount is 10% of the labor and parts lines only (${usd(labor + parts)}), never the four`, dAmt === r2(0.1 * (labor + parts)))

  // ── 2. the service call fee set to "not taxed" ─────────────────────────────────
  const untaxed = workOrderExtrasUpdate({ ...created, service_call_tax: 'none' }, lines, { travelHours: 1.5, mileageMiles: 42, serviceCallFee: fee }, shop, true)
  if ('error' in untaxed) throw new Error(untaxed.error)
  const { payload: uInv } = buildInvoicePayload({ ...created, ...untaxed.update }, lines, fb, jobs)
  console.log(`\n2. SAME WORK ORDER, service call fee recorded "not taxed": tax ${usd(uInv.tax_amount)}, total ${usd(uInv.total)}`)
  check(`the labor bucket drops the fee: ${usd(parseBreakdown(uInv.tax_breakdown)?.labor?.base)}`, parseBreakdown(uInv.tax_breakdown)?.labor?.base === r2(labor + travel))
  const lr = (ts.tax_labor ? ts.tax_rate_labor : 0) / 100
  const taxOnFee = r2(r2(lr * (labor + travel + fee)) - r2(lr * (labor + travel)))
  check(`the total falls by exactly the labor-rate tax on ${usd(fee)} (${usd(taxOnFee)})`, r2(Number(inv.total) - Number(uInv.total)) === taxOnFee, usd(r2(Number(inv.total) - Number(uInv.total))))

  // ── 3. labor only ──────────────────────────────────────────────────────────────
  const laborOnly = lines.filter(l => l.type === 'labor')
  const lo = workOrderExtrasUpdate(created, laborOnly, { travelHours: 1.5, mileageMiles: 42, serviceCallFee: fee }, shop, true)
  if ('error' in lo) throw new Error(lo.error)
  const { payload: loInv } = buildInvoicePayload({ ...created, ...lo.update }, laborOnly, fb, jobs)
  console.log('\n3. LABOR-ONLY WORK ORDER with drive time, mileage and the service call fee:')
  const loRows = printInvoice(loInv)
  check('a labor-only job is charged no shop supplies, and prints no supplies line', Number(loInv.shop_supplies_fee) === 0 && !loRows.some(r => r[0].startsWith('Shop Supplies')))

  // ── 4. none of them ────────────────────────────────────────────────────────────
  const none = { ...blank }
  const { payload: nInv } = buildInvoicePayload(none, lines, fb, jobs)
  console.log('\n4. NONE OF THE FOUR (a work order that records none, as every existing one does):')
  const nRows = printInvoice(nInv)
  check('only Labor and Parts subtotals print - exactly as invoices look today', nRows.map(r => r[0]).join('|') === 'Labor Subtotal|Parts Subtotal')
  const noKeys = { ...none } as Record<string, unknown>
  delete noKeys.service_call_fee; delete noKeys.service_call_tax
  const { payload: legacy } = buildInvoicePayload(noKeys, lines, fb, jobs)
  check('and its invoice is identical to one from a work order without the 178 columns at all', JSON.stringify({ ...nInv, service_call_fee: undefined, service_call_tax: undefined }) === JSON.stringify(legacy))

  // ── 5. a work order carrying its quote's tax ───────────────────────────────────
  const [carried] = await get(`hd_work_orders?select=*&user_id=eq.${FOUNDER}&tax_amount=not.is.null&quote_id=not.is.null&order=created_at.desc&limit=1`)
  if (carried) {
    const cl = await get(`hd_work_order_line_items?select=*&work_order_id=eq.${carried.id}&order=sort_order`) as WorkOrderLineRow[]
    const before = buildInvoicePayload({ ...carried }, cl, fb).payload
    const up = workOrderExtrasUpdate(carried, cl, { travelHours: 1, mileageMiles: 0, serviceCallFee: null }, shop, true)
    if ('error' in up) throw new Error(up.error)
    const after = buildInvoicePayload({ ...carried, ...up.update }, cl, fb).payload
    const tRate = parseBreakdown(carried.tax_breakdown)?.labor
    const added = Number(after.travel_amount)
    const taxAdded = r2((tRate ? (tRate.taxed ? tRate.rate : 0) : (ts.tax_labor ? ts.tax_rate_labor : 0)) / 100 * added)
    console.log(`\n5. ${carried.work_order_number} CARRIES ITS QUOTE'S TAX (${usd(carried.tax_amount)}). One hour of drive time added (${usd(added)}):`)
    console.log(`   tax ${usd(before.tax_amount)} -> ${usd(after.tax_amount)}; invoice total ${usd(before.total)} -> ${usd(after.total)}; quoted total ${usd(carried.total_amount)} -> ${usd(up.update.total_amount ?? carried.total_amount)}`)
    check(`the carried tax moves by exactly the tax on the drive time (${usd(taxAdded)}), never re-derived`, r2(Number(after.tax_amount) - Number(before.tax_amount)) === taxAdded)
    check('the invoice total moves by exactly drive time + its tax', r2(Number(after.total) - Number(before.total)) === r2(added + taxAdded))
    const back = workOrderExtrasUpdate({ ...carried, ...up.update }, cl, { travelHours: 0, mileageMiles: 0, serviceCallFee: null }, shop, true)
    if ('error' in back) throw new Error(back.error)
    check('taking the hour back off restores the carried tax to the cent', Number(back.update.tax_amount) === Number(carried.tax_amount))
    check('a work order whose quote had no shop supplies is given none when drive time is saved', Number(after.shop_supplies_fee) === Number(carried.shop_supplies_fee ?? 0))
  }

  // ── 6. the invoice editor, on your newest real invoice ─────────────────────────
  const [real] = await get(`hd_invoices?select=*&user_id=eq.${FOUNDER}&order=created_at.desc&limit=1`)
  const opened = openInvoiceEdit(real, laborRate, { extras, serviceCallTax: call.tax })
  check(`${real.invoice_number} opened and saved unchanged writes nothing`, JSON.stringify(invoiceSaveBody(real, opened, opened.state)) === '{}')
  const edited = { ...opened.state, travelHours: 1.5, mileageMiles: 42, service_call_fee: fee }
  const p = priceInvoiceEdit(real, opened.state, edited)
  const eTravel = r2(1.5 * (extras.travelRatePerHour ?? laborRate)), eMiles = r2(42 * (extras.mileageRatePerMile ?? 0))
  const rl = parseBreakdown(real.tax_breakdown)?.labor
  const eTax = r2((rl ? (rl.taxed ? rl.rate : 0) : Number(real.tax_rate)) / 100 * (eTravel + fee))
  console.log(`\n6. ${real.invoice_number} (stored total ${usd(real.total)}) - the tech adds 1.5 h drive time, 42 miles and a ${usd(fee)} service call on the invoice:`)
  console.log(`   drive time ${usd(p.extras.travel.amount)}, mileage ${usd(p.extras.mileage.amount)}, shop supplies ${usd(p.extras.shopSupplies.amount)} (not recorded on this invoice, so none), tax ${usd(real.tax_amount)} -> ${usd(p.taxAmount)}, total ${usd(p.total)}`)
  check('drive time and mileage price at your rates now', p.extras.travel.amount === eTravel && p.extras.mileage.amount === eMiles)
  check('a supplies percentage the invoice never recorded is NOT added to it', p.extras.shopSupplies.amount === Number(real.shop_supplies_fee ?? 0))
  check(`the total = stored + drive time + mileage + fee + only their tax (${usd(eTax)}, mileage untaxed)`, p.total === r2(Number(real.total) + eTravel + eMiles + fee + eTax), `expected ${usd(r2(Number(real.total) + eTravel + eMiles + fee + eTax))}`)

  // ── 7. three existing invoices, before and after ───────────────────────────────
  const [oldPath, newPath] = process.argv.slice(2)
  if (oldPath && newPath) {
    const a = JSON.parse(readFileSync(oldPath, 'utf8')), b = JSON.parse(readFileSync(newPath, 'utf8'))
    const keys = Object.keys(a).filter(k => k.startsWith('invoice ')).sort().slice(-3)
    console.log('\n7. THREE EXISTING INVOICES - old code vs this code, same data:')
    for (const k of keys) {
      const ta = a[k].stored.total, tb = b[k].stored.total
      const pa = JSON.stringify(a[k].printed), pb = JSON.stringify(b[k].printed)
      console.log(`   ${k.split(' ')[1]}  total ${usd(ta)} -> ${usd(tb)}  printed rows ${pa === pb ? 'identical' : 'DIFFER'}`)
      check(`${k.split(' ')[1]} totals and prints exactly as before`, ta === tb && pa === pb)
    }
  }

  console.log(`\n${passes} passed, ${failures} failed`)
  if (failures) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
