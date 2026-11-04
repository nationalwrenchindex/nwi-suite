// npx tsx scripts/verify-service-call.ts
//
// LD's service call fee (migration 180) and the billing method picker. READS the
// database, writes nothing. Migration 180 may not be applied, so no real LD document
// can carry a fee yet: each fee case below is a REAL row with a fee added in memory -
// the shape the editors save - run through the same functions the screens, the
// converter and the routes use.
//
//   1. The picker: every combination of toggles, what each pick sets, and what every
//      real shop sees on first open (LD and HD) - which writes nothing.
//   2. A quote with a fee (lib/document-money): its own line, in the labor tax bucket
//      with the drive time unless untaxed, never in the labor subtotal; the no-op rule.
//   3. Money is frozen: a document keeps the fee and tax treatment it recorded whatever
//      Settings say now; a new one is seeded from Settings.
//   4. The converter's fold, on a real line-item and a real segment-priced work order.
//   5. Before 180: a write with a fee is refused, one without is retried without it.

import { loadEnv } from './lib/smoke-session'
import { fromLineItems, markupOnReopen } from '../src/components/shared/line-items'
import { documentMoney, documentExtras } from '../src/lib/document-money'
import { extrasFromDocument, extrasDelta, extrasAgree, computeExtras, EXTRAS_OFF } from '../src/lib/billable-extras'
import { taxSettingsFrom, TAX_SETTINGS_SELECT, documentTaxSettings, computeTax } from '../src/lib/tax'
import { parseDiscount, normalizeDiscount } from '../src/lib/document-discount'
import { invoiceFromSegments } from '../src/lib/segments/invoice'
import { shapeSegments } from '../src/lib/segments/select'
import { isBillable } from '../src/types/segments'
import {
  billingMethodFrom, togglesFor, methodShows, serviceCallOf, serviceCallSeed, serviceCallRow, ldServiceCallFrom,
  writeToleratingServiceCall, MIGRATION_180_MESSAGE, type ServiceCall,
} from '../src/lib/service-call'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
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
const r2 = (n: number) => Math.round(n * 100) / 100
const usd = (n: unknown) => `$${Number(n ?? 0).toFixed(2)}`

/** documentMoney exactly as the LD quote editor calls it, with a fee. */
function priceAsEditor(d: Record<string, any>, ts: ReturnType<typeof taxSettingsFrom>, serviceCall: ServiceCall | null, stored: boolean) {
  const markup = markupOnReopen(d.parts_markup_percent).percent
  const de = documentExtras(d)
  const taxPct = Number(d.tax_percent ?? 0)
  return documentMoney({
    items: fromLineItems(d.line_items, markup, undefined, { withLabor: true }), markupPct: markup,
    laborRate: Number(d.labor_rate ?? 0), taxPct,
    taxSettings: documentTaxSettings(d.tax_breakdown, ts, taxPct),
    extrasSettings: de.settings, extras: de.input,
    discount: normalizeDiscount(parseDiscount(d.discount)),
    serviceCall, stored: stored ? d : null,
  })
}

async function main() {
  // ── 1. the picker ──
  console.log('\n1. THE BILLING METHOD PICKER')
  const combos: Array<[boolean, boolean, boolean, string]> = [
    [false, false, false, 'drive_time'], [false, true, false, 'drive_time'], [false, false, true, 'drive_time'], [false, true, true, 'drive_time'],
    [true, false, false, 'service_call'], [true, true, false, 'both'], [true, false, true, 'both'], [true, true, true, 'both'],
  ]
  check('every combination of the three toggles opens on the matching option',
    combos.every(([c, t, m, want]) => billingMethodFrom({ billServiceCall: c, billTravel: t, billMileage: m }) === want))
  const f = togglesFor('service_call'), d = togglesFor('drive_time'), b = togglesFor('both')
  check('"Flat service call fee" turns the fee on and drive time and mileage off', f.billServiceCall && !f.billTravel && !f.billMileage)
  check('"Drive time and mileage" turns the fee off and both on', !d.billServiceCall && d.billTravel && d.billMileage)
  check('"Both" turns all three on', b.billServiceCall && b.billTravel && b.billMileage)
  check('the flat fee shows only the fee amount; "Both" shows all three; drive time shows no fee',
    JSON.stringify(methodShows('service_call')) === '{"serviceCall":true,"driveTime":false}' &&
    JSON.stringify(methodShows('both')) === '{"serviceCall":true,"driveTime":true}' &&
    JSON.stringify(methodShows('drive_time')) === '{"serviceCall":false,"driveTime":true}')
  check('every pick lands back on itself when Settings is reopened',
    (['service_call', 'drive_time', 'both'] as const).every(m => billingMethodFrom(togglesFor(m)) === m))
  check('shop supplies is not part of any pick', (['service_call', 'drive_time', 'both'] as const).every(m => !('billShopSupplies' in togglesFor(m))))

  let profiles: Record<string, any>[]
  let has180 = true
  try { profiles = await get('profiles?select=id,business_name,business_type,bill_travel,bill_mileage,bill_shop_supplies,bill_service_call,hd_bill_travel,hd_bill_mileage,hd_bill_service_call&order=id') }
  catch { has180 = false; profiles = await get('profiles?select=id,business_name,business_type,bill_travel,bill_mileage,bill_shop_supplies,hd_bill_travel,hd_bill_mileage,hd_bill_service_call&order=id') }
  console.log(`   migration 180 ${has180 ? 'IS' : 'is NOT'} applied on this database`)
  const opened = profiles.filter(p => p.bill_travel || p.bill_mileage || p.bill_service_call || p.hd_bill_travel || p.hd_bill_mileage || p.hd_bill_service_call)
  for (const p of opened) {
    const ld = billingMethodFrom({ billServiceCall: p.bill_service_call === true, billTravel: p.bill_travel === true, billMileage: p.bill_mileage === true })
    const hd = billingMethodFrom({ billServiceCall: p.hd_bill_service_call === true, billTravel: p.hd_bill_travel === true, billMileage: p.hd_bill_mileage === true })
    console.log(`   ${String(p.business_name ?? p.id).slice(0, 28).padEnd(28)} LD on: travel ${p.bill_travel ? 'Y' : 'n'} miles ${p.bill_mileage ? 'Y' : 'n'} fee ${p.bill_service_call ? 'Y' : 'n'} -> "${ld}"   HD on: travel ${p.hd_bill_travel ? 'Y' : 'n'} miles ${p.hd_bill_mileage ? 'Y' : 'n'} fee ${p.hd_bill_service_call ? 'Y' : 'n'} -> "${hd}"`)
  }
  const others = profiles.length - opened.length
  console.log(`   ${others} other shop(s) bill none of the three and open on "drive_time" with both switches off - their screen as before`)
  check(`no shop that bills drive time or mileage today opens on "Flat service call fee" (which would switch them off)`,
    profiles.every(p => !(p.bill_travel || p.bill_mileage) || billingMethodFrom({ billServiceCall: p.bill_service_call === true, billTravel: p.bill_travel === true, billMileage: p.bill_mileage === true }) !== 'service_call') &&
    profiles.every(p => !(p.hd_bill_travel || p.hd_bill_mileage) || billingMethodFrom({ billServiceCall: p.hd_bill_service_call === true, billTravel: p.hd_bill_travel === true, billMileage: p.hd_bill_mileage === true }) !== 'service_call'))

  // ── 2. a quote with a fee ──
  console.log('\n2. A REAL LD QUOTE WITH A $95.00 SERVICE CALL FEE ADDED (the shape the editor saves)')
  const FOUNDER = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
  const [prof] = await get(`profiles?select=${TAX_SETTINGS_SELECT}&id=eq.${FOUNDER}`)
  const ts = taxSettingsFrom(prof)
  const [q] = await get(`quotes?select=*&user_id=eq.${FOUNDER}&status=neq.declined&order=created_at.desc&limit=1`)
  const before = priceAsEditor(q, ts, null, false)
  const taxedFee: ServiceCall = { fee: 95, tax: 'labor' }, untaxedFee: ServiceCall = { fee: 95, tax: 'none' }
  const withFee = priceAsEditor(q, ts, taxedFee, false)
  const untaxed = priceAsEditor(q, ts, untaxedFee, false)
  const labRate = withFee.taxBreakdown?.labor?.rate ?? 0
  console.log(`   ${q.quote_number}: subtotal ${usd(before.subtotal)} -> ${usd(withFee.subtotal)}; tax ${usd(before.taxAmount)} -> ${usd(withFee.taxAmount)}; total ${usd(before.grandTotal)} -> ${usd(withFee.grandTotal)}  (fee not taxed: ${usd(untaxed.grandTotal)})`)
  check('the fee is its own line, $95.00', serviceCallRow(withFee.serviceCall)?.label === 'Service Call Fee' && serviceCallRow(withFee.serviceCall)?.amount === 95)
  check('the labor subtotal does not include it', withFee.laborSubtotal === before.laborSubtotal)
  check('the subtotal includes it exactly once', withFee.subtotal === r2(before.subtotal + 95))
  check('taxed as labor: it sits in the labor bucket, taxed in the same call as the drive time',
    withFee.taxBreakdown?.labor?.base === r2((before.taxBreakdown?.labor?.base ?? 0) + 95) &&
    withFee.taxBreakdown?.labor?.amount === r2(r2((before.taxBreakdown?.labor?.base ?? 0) + 95) * labRate / 100),
    `labor base ${usd(withFee.taxBreakdown?.labor?.base)} at ${labRate}%`)
  check('"not taxed": in the subtotal, in no tax bucket, tax unchanged',
    untaxed.subtotal === r2(before.subtotal + 95) && untaxed.taxAmount === before.taxAmount && untaxed.grandTotal === r2(before.grandTotal + 95))
  check('the quote records the fee and how it was taxed',
    withFee.columns.service_call_fee === 95 && withFee.columns.service_call_tax === 'labor' && untaxed.columns.service_call_tax === 'none')
  check('a quote without a fee writes no service call columns at all (saves before 180 unchanged)',
    !('service_call_fee' in before.columns) && !('service_call_tax' in before.columns))
  const savedWithFee = { ...q, ...withFee.columns }
  const reopened = priceAsEditor(savedWithFee, ts, serviceCallOf(savedWithFee), true)
  check('reopened and saved unchanged, it re-totals to exactly what it stored', reopened.grandTotal === withFee.grandTotal && reopened.taxAmount === withFee.taxAmount)
  const cleared = priceAsEditor(savedWithFee, ts, { fee: 0, tax: 'labor' }, true)
  check('clearing the fee on the quote writes NULL and returns the total to the quote without it',
    cleared.columns.service_call_fee === null && cleared.grandTotal === before.grandTotal)

  // ── 3. money is frozen ──
  console.log('\n3. MONEY IS FROZEN')
  const recorded = { ...q, service_call_fee: 75, service_call_tax: 'labor' }
  const settingsNow = ldServiceCallFrom({ bill_service_call: true, service_call_fee: 125, service_call_tax: 'none' })
  check('a document keeps the $75 taxed-as-labor fee it recorded after Settings change to $125 not taxed',
    JSON.stringify(serviceCallOf(recorded)) === '{"fee":75,"tax":"labor"}' && settingsNow.fee === 125)
  check('a NEW document is seeded from Settings: $125, not taxed', JSON.stringify(serviceCallSeed(settingsNow)) === '{"fee":125,"tax":"none"}')
  check('a shop that does not bill one seeds none', serviceCallSeed(ldServiceCallFrom({ bill_service_call: false, service_call_fee: 125 })).fee === 0)
  check('before 180 the setting reads as off', JSON.stringify(ldServiceCallFrom({ bill_travel: true })) === '{"bill":false,"fee":null,"tax":"labor"}')

  // ── 4. the converter ──
  console.log('\n4. WORK ORDER -> INVOICE: the fee folds in with the drive time')
  const segs = await get('work_order_segments?select=*,options:work_order_segment_options!segment_id(*)&ld_work_order_id=not.is.null')
  const wos = await get(`work_orders?select=*&status=eq.complete&order=created_at.desc`)
  const lineWo = wos.find(w => !segs.some(s => s.ld_work_order_id === w.id) && Array.isArray(w.line_items) && w.line_items.length > 0)
  const segWo = wos.find(w => segs.some(s => s.ld_work_order_id === w.id && isBillable(s.status)))
  for (const [label, wo] of [['line-item', lineWo], ['segment-priced', segWo]] as const) {
    if (!wo) { check(`a real ${label} work order to convert`, false, 'none found'); continue }
    const [p] = await get(`profiles?select=${TAX_SETTINGS_SELECT}&id=eq.${wo.user_id}`)
    const tset = documentTaxSettings(wo.tax_breakdown, taxSettingsFrom(p), Number(wo.tax_percent ?? 0)) ?? taxSettingsFrom(p)
    const parentExtras = extrasFromDocument(wo)
    const segments = shapeSegments(segs.filter(s => s.ld_work_order_id === wo.id).sort((a, b) => a.sequence - b.sequence))
    const base = segments.length > 0 ? invoiceFromSegments(segments.filter(s => isBillable(s.status))).subtotal : 0
    const without = extrasDelta(parentExtras, tset)
    const withCall = extrasDelta(parentExtras, tset, taxedFee)
    const travelAndFee = computeTax({ parts: parentExtras.shopSupplies.amount, labor: r2(parentExtras.travel.amount + 95) }, tset)
    console.log(`   ${wo.work_order_number} (${label}): extras ${usd(without.subtotalDelta)} -> ${usd(withCall.subtotalDelta)}, their tax ${usd(without.taxDelta)} -> ${usd(withCall.taxDelta)}`)
    check(`${wo.work_order_number}: the fee reaches the invoice subtotal once, $95.00`, withCall.subtotalDelta === r2(without.subtotalDelta + 95))
    check(`${wo.work_order_number}: taxed in the same call as the drive time (LD's rule, unchanged)`, withCall.taxDelta === travelAndFee.taxAmount)
    const sub = r2(Number(base) + withCall.subtotalDelta)
    check(`${wo.work_order_number}: the converter's guard passes with the fee inside the total`, extrasAgree(parentExtras, sub, Number(base), taxedFee) === null)
    check(`${wo.work_order_number}: and refuses an invoice whose total leaves the fee out`, extrasAgree(parentExtras, r2(sub - 95), Number(base), taxedFee) !== null)
  }

  // ── 5. before 180 ──
  console.log('\n5. BEFORE MIGRATION 180 IS APPLIED')
  const missing = { message: "Could not find the 'service_call_fee' column of 'quotes' in the schema cache", code: 'PGRST204' }
  let calls: Record<string, unknown>[] = []
  const write = async (r: Record<string, unknown>) => { calls.push(r); return calls.length === 1 ? { data: null, error: missing } : { data: { ok: true }, error: null } }
  const refused = await writeToleratingServiceCall({ grand_total: 100, service_call_fee: 95, service_call_tax: 'labor' }, write)
  check('a write WITH a fee is refused, said plainly, and not retried without it',
    (refused.error as { message?: string } | null)?.message === MIGRATION_180_MESSAGE && calls.length === 1)
  calls = []
  const retried = await writeToleratingServiceCall({ grand_total: 100, service_call_fee: null, service_call_tax: null }, write)
  check('a write without a fee is retried without the two columns and saves',
    retried.error === null && calls.length === 2 && !('service_call_fee' in calls[1]))
  // The forms decide whether to offer the fee from this: the column on the row.
  check(`a real quote row ${has180 ? 'carries' : 'does not carry'} the fee column, matching migration 180 ${has180 ? '' : 'not '}being applied`,
    ('service_call_fee' in q) === has180)

  console.log(`\n${passes} passed, ${failures} failed`)
  if (failures) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
