// npx tsx scripts/verify-bucket-rounding.ts
//
// HD tax: each bucket's SUMMED taxable base taxed once and rounded once. READS the
// database, writes nothing. Every case is built from a real row.
//
//   1. A new quote or invoice (lib/hd/document-tax): lines, fees, drive time and shop
//      supplies summed into their bucket before the one rounding - labor and parts both.
//   2. A carried tax moved by an addition (lib/hd/carried-tax): the bucket re-taxed on
//      its stored base + the addition, never the addition rounded on its own - the
//      labor bucket (drive time, service call) and the parts bucket (shop supplies).
//   3. Existing documents do not move: every saved quote reopens in the quote form at
//      its stored tax and split, and every work order carrying a tax saves its extras
//      unchanged at its stored tax.

import { loadEnv } from './lib/smoke-session'
import { computeTax, parseBreakdown, taxSettingsFrom, TAX_SETTINGS_SELECT, mergeBreakdowns, type TaxSettings } from '../src/lib/tax'
import { computeExtras, extrasDelta, EXTRAS_SETTINGS_SELECT } from '../src/lib/billable-extras'
import { documentExtras } from '../src/lib/document-money'
import { hdTaxableFees, hdExtrasSettingsFrom, hdServiceCallFrom, HD_EXTRAS_SELECT, isServiceCallTax } from '../src/lib/hd/hd-extras'
import { hdDocumentTax, hdTaxableBase, savedDocumentTax } from '../src/lib/hd/document-tax'
import { shiftCarriedTax, recordedTaxSettings } from '../src/lib/hd/carried-tax'
import { workOrderExtrasState, workOrderExtrasUpdate, type ShopExtras } from '../src/lib/hd/work-order-extras'
import type { WorkOrderLineRow } from '../src/lib/hd/wo-to-invoice'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const FOUNDER = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
const get = async (q: string) => {
  const j = await (await fetch(`${S}/rest/v1/${q}`, { headers: H })).json()
  if (!Array.isArray(j)) throw new Error(`${q}: ${JSON.stringify(j)}`)
  return j as Record<string, any>[]
}

let failures = 0, passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++; else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const usd = (n: unknown) => `$${Number(n ?? 0).toFixed(2)}`
const taxOn = (ratePct: number, base: number) => r2(ratePct / 100 * r2(base))
const sum = (items: any[], type: string) => r2(items.filter(i => i.type === type).reduce((s, i) => s + Number(i.amount ?? 0), 0))

async function main() {
  const [profile] = await get(`profiles?select=hd_labor_rate,${TAX_SETTINGS_SELECT},${EXTRAS_SETTINGS_SELECT},${HD_EXTRAS_SELECT}&id=eq.${FOUNDER}`)
  const ts = taxSettingsFrom(profile)
  const rate = Number(profile.hd_labor_rate)
  console.log(`\nTAX: parts ${ts.tax_parts ? ts.tax_rate_parts + '%' : 'off'}, labor ${ts.tax_labor ? ts.tax_rate_labor + '%' : 'off'}; HD labor rate ${usd(rate)}`)

  // ── 1. a new document: one rounding per bucket ──
  // The lines of INV-2026-0026 and a $95 service call, with drive time and shop supplies
  // priced through computeExtras as a NEW invoice would. The first hours and percentage
  // at which the old two-call way lands off one rounding are the ones shown.
  console.log('\n1. A NEW DOCUMENT - lines, fees and extras summed into the bucket, rounded once')
  const [inv] = await get('hd_invoices?invoice_number=eq.INV-2026-0026&select=*')
  const partsLines = sum(inv.line_items, 'parts'), laborLines = sum(inv.line_items, 'labor')
  const fee = 95
  const priced = (hours: number, pct: number) => computeExtras(partsLines, { travelHours: hours, mileageMiles: 0 },
    { billTravel: true, travelRatePerHour: 135, billMileage: false, mileageRatePerMile: null, billShopSupplies: true, shopSuppliesPercent: pct, shopSuppliesCap: null }, rate)
  const baseOf = (ex: ReturnType<typeof priced>) =>
    hdTaxableBase({ partsLines, laborLines, taxedFees: fee, travel: ex.travel.amount, supplies: ex.shopSupplies.amount })
  // What the forms did before: lines + fees in one call, the extras in another, summed.
  const twoCalls = (ex: ReturnType<typeof priced>) => ({
    labor: r2((computeTax({ labor: laborLines + fee }, ts).breakdown.labor?.amount ?? 0) + (extrasDelta(ex, ts).breakdown?.labor?.amount ?? 0)),
    parts: r2((computeTax({ parts: partsLines }, ts).breakdown.parts?.amount ?? 0) + (extrasDelta(ex, ts).breakdown?.parts?.amount ?? 0)),
  })
  const hoursOff = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].find(h => twoCalls(priced(h, 8)).labor !== taxOn(ts.tax_rate_labor, baseOf(priced(h, 8)).labor))
  const pctOff = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15].find(p => twoCalls(priced(1.5, p)).parts !== taxOn(ts.tax_rate_parts, baseOf(priced(1.5, p)).parts))
  const cases: Array<['labor' | 'parts', number, number]> = [['labor', hoursOff ?? 1.5, 8], ['parts', 1.5, pctOff ?? 8]]
  for (const [k, hours, pct] of cases) {
    const ex = priced(hours, pct)
    const base = baseOf(ex)
    const now = hdDocumentTax(base, ts)
    const r = k === 'labor' ? ts.tax_rate_labor : ts.tax_rate_parts
    const once = taxOn(r, base[k]), old = twoCalls(ex)[k]
    const what = k === 'labor'
      ? `labor ${usd(laborLines)} + service call ${usd(fee)} + drive time ${hours} h ${usd(ex.travel.amount)}`
      : `parts ${usd(partsLines)} + shop supplies ${pct}% ${usd(ex.shopSupplies.amount)}`
    console.log(`   ${what} = ${usd(base[k])}: tax ${usd(now.breakdown?.[k]?.amount)} (the old two-call way: ${usd(old)})`)
    check(`${k} bucket: taxed once on the summed ${usd(base[k])}`, now.breakdown?.[k]?.amount === once && now.breakdown?.[k]?.base === base[k])
    check(`${k}: the tax is the sum of the rounded buckets, and the split adds up to it`,
      now.taxAmount === r2((now.breakdown?.parts?.amount ?? 0) + (now.breakdown?.labor?.amount ?? 0)))
  }
  console.log(`   ${hoursOff == null ? 'no drive time from 0.25 to 3 h put the old way off' : `${hoursOff} h of drive time put the old way off`}; ` +
    `${pctOff == null ? 'no supplies percentage from 1 to 15 put it off' : `supplies at ${pctOff}% put it off`}`)
  {
    const ex = priced(1.5, 8), t = hdDocumentTax(baseOf(ex), ts)
    check('drive time and supplies are inside the buckets the form prints, not only in the total',
      t.breakdown?.labor?.base === r2(laborLines + fee + ex.travel.amount) && t.breakdown?.parts?.base === r2(partsLines + ex.shopSupplies.amount) &&
      JSON.stringify(mergeBreakdowns([t.breakdown])) === JSON.stringify(t.breakdown))
  }

  // ── 2. a carried tax: the bucket re-taxed on stored base + the addition ──
  console.log('\n2. A CARRIED TAX MOVED BY AN ADDITION - each bucket rounded once on its summed base')
  const bd = parseBreakdown(inv.tax_breakdown)!
  const settings = recordedTaxSettings(inv.tax_breakdown, ts)
  const carried = { taxAmount: Number(inv.tax_amount), breakdown: bd }
  // A labor addition and a parts addition, each picked from real amounts so that taxing
  // the addition alone lands a cent off: drive time + service call, and shop supplies.
  const additions: Array<[string, 'labor' | 'parts', number]> = [['drive time 1.5 h + service call $95', 'labor', r2(1.5 * 135 + fee)]]
  for (let pct = 1; pct <= 20; pct++) {
    const add = r2(bd.parts!.base * pct / 100)
    if (r2(taxOn(settings.tax_rate_parts, bd.parts!.base + add) - bd.parts!.amount) !== taxOn(settings.tax_rate_parts, add)) { additions.push([`shop supplies at ${pct}% (${usd(add)})`, 'parts', add]); break }
  }
  for (const [label, k, add] of additions) {
    const moved = shiftCarriedTax(carried, { parts: 0, labor: 0 }, { parts: 0, labor: 0, [k]: add }, settings)
    const b = bd[k]!, r = k === 'labor' ? settings.tax_rate_labor : settings.tax_rate_parts
    const expect = r2(taxOn(r, b.base + add) - taxOn(r, b.base))
    const other = k === 'labor' ? 'parts' : 'labor'
    console.log(`   ${inv.invoice_number} ${k} ${usd(b.base)} + ${label}: bucket tax ${usd(b.amount)} -> ${usd(moved.breakdown?.[k]?.amount)} ` +
      `(+${usd(r2(moved.taxAmount - carried.taxAmount))}; the addition taxed alone: +${usd(taxOn(r, add))})`)
    check(`${k}: the bucket is taxed once on ${usd(r2(b.base + add))}`, moved.breakdown?.[k]?.amount === taxOn(r, b.base + add) && moved.breakdown?.[k]?.base === r2(b.base + add))
    check(`${k}: the tax moves by ${usd(expect)}, and the ${other} bucket does not move`,
      r2(moved.taxAmount - carried.taxAmount) === expect && JSON.stringify(moved.breakdown?.[other]) === JSON.stringify(bd[other]))
  }
  check('nothing changed -> the stored tax and split, exactly',
    JSON.stringify(shiftCarriedTax(carried, { parts: 5, labor: 7 }, { parts: 5, labor: 7 }, settings)) === JSON.stringify(carried))

  // ── 3. existing documents ──
  console.log('\n3. EXISTING DOCUMENTS DO NOT MOVE')
  const quotes = await get('hd_quotes?select=*&order=quote_number')
  let same = 0, legacy = 0
  for (const q of quotes) {
    const items = Array.isArray(q.line_items) ? q.line_items : []
    const pl = sum(items, 'parts'), ll = sum(items, 'labor')
    const stored = parseBreakdown(q.tax_breakdown)
    // The rates and flags exactly as the quote form opens a saved quote.
    const formSettings: TaxSettings = {
      tax_parts: stored?.parts ? stored.parts.taxed : ts.tax_parts, tax_labor: stored?.labor ? stored.labor.taxed : ts.tax_labor,
      tax_rate_parts: Number(q.tax_rate ?? 0), tax_rate_labor: stored?.labor?.rate ?? Number(q.tax_rate ?? 0),
    }
    // The extras as the form prices them: the quote's hours and its recorded rates.
    const de = documentExtras(q)
    const ex = computeExtras(pl, {
      travelHours: Number(q.travel_hours ?? 0) || 0, mileageMiles: Number(q.mileage_miles ?? 0) || 0,
      travelRateOverride: de.input.travelRateOverride, mileageRateOverride: de.input.mileageRateOverride,
      shopSuppliesPercentOverride: de.input.shopSuppliesPercentOverride, shopSuppliesCapOverride: de.input.shopSuppliesCapOverride,
    }, de.settings, Number(q.labor_rate ?? 0))
    const call = isServiceCallTax(q.service_call_tax) ? q.service_call_tax : hdServiceCallFrom(profile).tax
    const fees = r2(Number(q.diagnostic_fee ?? 0) + Number(q.road_call_fee ?? 0) + (call === 'none' ? 0 : Number(q.service_call_fee ?? 0)))
    const saved = savedDocumentTax(q)
    const opened = hdDocumentTax(hdTaxableBase({ partsLines: pl, laborLines: ll, taxedFees: fees, travel: ex.travel.amount, supplies: ex.shopSupplies.amount }), formSettings, saved)
    const disc = q.discount && typeof q.discount === 'object' ? q.discount : null
    const want = r2(disc ? Number(disc.tax_before) : Number(q.tax_amount))
    const wantSplit = disc ? parseBreakdown(disc.pre_tax_breakdown) : stored
    // The old form: lines + fees taxed, then the extras taxed, and the two summed.
    const old = r2(computeTax({ parts: pl, labor: ll + fees }, formSettings).taxAmount + extrasDelta(ex, formSettings).taxDelta)
    const ok = saved
      ? opened.taxAmount === want && JSON.stringify(parseBreakdown(opened.breakdown)) === JSON.stringify(wantSplit)
      : opened.taxAmount === old
    if (!saved) legacy++
    if (ok) same++
    else console.log(`   MOVES ${q.quote_number}: stored ${usd(want)}, reopens at ${usd(opened.taxAmount)}${saved ? '' : ` (no stored split; old form ${usd(old)})`}`)
  }
  check('every saved quote reopens in the quote form at its stored tax and split', same === quotes.length,
    `${same}/${quotes.length}; ${legacy} with no stored split re-price from their lines as before, to the same figure`)

  const wos = await get('hd_work_orders?select=*&tax_amount=not.is.null&order=work_order_number')
  const shop: ShopExtras = { extras: hdExtrasSettingsFrom(profile), serviceCall: hdServiceCallFrom(profile), laborRate: rate, taxSettings: ts }
  let woSame = 0
  for (const wo of wos) {
    const lines = await get(`hd_work_order_line_items?work_order_id=eq.${wo.id}&select=*`) as WorkOrderLineRow[]
    const up = workOrderExtrasUpdate(wo, lines, workOrderExtrasState(wo), shop, 'service_call_fee' in wo)
    if ('error' in up) { console.log(`   ${wo.work_order_number}: ${up.error}`); continue }
    const t = up.update
    if (Number(t.tax_amount) === Number(wo.tax_amount) && JSON.stringify(parseBreakdown(t.tax_breakdown)) === JSON.stringify(parseBreakdown(wo.tax_breakdown))) woSame++
    else console.log(`   MOVES ${wo.work_order_number}: ${usd(wo.tax_amount)} -> ${usd(t.tax_amount)}`)
  }
  check('every work order carrying a tax saves its extras unchanged at its stored tax and split', woSame === wos.length, `${woSame}/${wos.length}`)
  check('a service call recorded untaxed stays out of the labor bucket', hdTaxableFees({ diagnostic_fee: 10, service_call_fee: 95, service_call_tax: 'none' }) === 10)

  console.log(`\n${passes} passed, ${failures} failed`)
  if (failures) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
