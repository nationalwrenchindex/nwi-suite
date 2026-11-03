// PAGECHECK_BASE=http://localhost:3000 npx tsx scripts/walk-hd-extras.ts
//
// The live walk for HD billable extras, through the real routes as the smoke owner:
// creates an HD work order (which records the shop's drive time, mileage and supplies
// rates from Settings), saves labor and parts, enters drive time and mileage on the
// extras panel's route, and builds the invoice through the converter. Prints the
// totals block the panel shows and the invoice payload's named lines; they must match
// to the cent. Stops at the converter's payload - no invoice is created, so no stock
// moves. The work order (and its lines) is deleted in finally.
//
// Before migration 178 a service call fee cannot be stored: the walk asserts the route
// REFUSES one (422) rather than dropping it.

import { loadEnv, openSession } from './lib/smoke-session'
import { feeRows } from '../src/lib/invoice-document'
import { extrasDisplayRows, extrasFromDocument } from '../src/lib/billable-extras'

// Part lines carry NO part number on purpose: a numbered part that is in stock is
// reserved by the line save (stock_allocation), and deleting the test work order does
// not release it. On Nov 3 the extras walk left 2 of 11-9098 reserved that way.
loadEnv()
const BASE = process.env.PAGECHECK_BASE ?? 'http://localhost:3000'
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const OWNER = process.env.SMOKE_OWNER_ID ?? '4a8c046f-7db3-42bb-8422-fd47efb7678c'
const usd = (n: unknown) => `$${(Number(n) || 0).toFixed(2)}`
const r2 = (n: number) => Math.round(n * 100) / 100

let failures = 0, passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++; else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}
const named = (inv: Record<string, unknown>) => [
  ...feeRows(inv).map(r => [r.label, r.amount] as [string, number]),
  ...extrasDisplayRows(extrasFromDocument(inv)).map(r => [r.label, r.amount] as [string, number]),
]

async function main() {
  const session = await openSession(OWNER)
  const api = (path: string, init: RequestInit = {}) => fetch(`${BASE}${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', cookie: session.cookie, ...(init.headers ?? {}) },
  })
  let woId: string | null = null
  try {
    const created = await api('/api/hd/work-orders', { method: 'POST', body: JSON.stringify({
      scheduled_date: new Date().toISOString().slice(0, 10), customer_name: 'ZZ WALK extras test', unit_manufacturer: 'Thermo King', unit_model: 'SB-310',
    }) })
    const cj = await created.json()
    woId = cj.work_order?.id ?? null
    check('an HD work order is created', created.status === 201 && !!woId, `${created.status} ${cj.work_order?.work_order_number ?? JSON.stringify(cj).slice(0, 120)}`)
    if (!woId) return

    const line_items = [
      { type: 'part', description: 'Compressor X430P', quantity: 1, unit_cost: 812.40, markup_percent: 30 },
      { type: 'labor', description: 'R&R compressor, evacuate and charge', quantity: 4.5, unit_price: 145 },
      { type: 'part', description: 'Fuel filter', quantity: 2, unit_cost: 18.37, markup_percent: 30 },
    ]
    const saved = await api(`/api/hd/work-orders/${woId}/line-items`, { method: 'PUT', body: JSON.stringify({ line_items }) })
    check('labor and parts save', saved.status === 200, String(saved.status))

    const first = await (await api(`/api/hd/work-orders/${woId}/extras`)).json()
    console.log(`\n   Recorded at creation: drive time ${first.settings?.extras?.billTravel ? usd(first.settings.extras.travelRatePerHour) + '/hr' : 'off'}, mileage ${first.settings?.extras?.billMileage ? usd(first.settings.extras.mileageRatePerMile) + '/mi' : 'off'}, supplies ${first.settings?.extras?.billShopSupplies ? first.settings.extras.shopSuppliesPercent + '%' : 'none'}; service call ${first.settings?.service_call?.available ? 'available' : 'needs 178'}`)

    if (!first.settings?.service_call?.available) {
      const refused = await api(`/api/hd/work-orders/${woId}/extras`, { method: 'PUT', body: JSON.stringify({ travel_hours: 1.5, mileage_miles: 42, service_call_fee: 95 }) })
      check('before 178, a service call fee is refused, not dropped', refused.status === 422, `${refused.status} ${(await refused.json()).error ?? ''}`)
    }
    const fee = first.settings?.service_call?.available ? 95 : null
    const put = await api(`/api/hd/work-orders/${woId}/extras`, { method: 'PUT', body: JSON.stringify({ travel_hours: 1.5, mileage_miles: 42, service_call_fee: fee }) })
    const pj = await put.json()
    check('drive time and mileage save on the work order', put.status === 200, String(put.status))
    const panel = pj.invoice as Record<string, unknown>
    console.log('\n   The work order panel totals block:')
    for (const [l, v] of [['Labor Subtotal', panel.subtotal_labor], ['Parts Subtotal', panel.subtotal_parts], ...named(panel)] as Array<[string, unknown]>) console.log(`   ${String(l).padEnd(40)}${usd(v).padStart(12)}`)
    console.log(`   ${'Tax'.padEnd(40)}${usd(panel.tax_amount).padStart(12)}\n   ${'Invoice total'.padEnd(40)}${usd(panel.total).padStart(12)}`)

    const conv = await api(`/api/hd/work-orders/${woId}/convert`)
    const vj = await conv.json()
    check('the converter builds the invoice', conv.status === 200, String(conv.status))
    const inv = vj.invoice_payload as Record<string, unknown>
    console.log('\n   The invoice, as converted:')
    for (const [l, v] of [['Labor Subtotal', inv.subtotal_labor], ['Parts Subtotal', inv.subtotal_parts], ...named(inv)] as Array<[string, unknown]>) console.log(`   ${String(l).padEnd(40)}${usd(v).padStart(12)}`)
    console.log(`   ${'Tax'.padEnd(40)}${usd(inv.tax_amount).padStart(12)}\n   ${'TOTAL'.padEnd(40)}${usd(inv.total).padStart(12)}`)

    const labels = named(inv).map(n => n[0])
    check('drive time, mileage and shop supplies each carry to the invoice on their own line', ['Travel Time', 'Mileage', 'Shop Supplies'].every(l => labels.includes(l)), labels.join(' | '))
    check('the panel and the invoice agree on every named line and the total, to the cent',
      JSON.stringify(named(panel)) === JSON.stringify(named(inv)) && panel.total === inv.total, `${usd(panel.total)} vs ${usd(inv.total)}`)
    const parts = Number(inv.subtotal_parts), labor = Number(inv.subtotal_labor)
    const sum = r2(labor + parts + named(inv).reduce((t, n) => t + n[1], 0) + Number(inv.tax_amount))
    check(`total ${usd(inv.total)} = labor + parts + every named line + tax`, sum === Number(inv.total), usd(sum))
    check(`shop supplies ${usd(inv.shop_supplies_fee)} is ${inv.shop_supplies_percent_applied}% of parts ${usd(parts)} (cap ${usd(inv.shop_supplies_cap_applied)})`,
      Number(inv.shop_supplies_fee) === Math.min(r2(parts * Number(inv.shop_supplies_percent_applied) / 100), Number(inv.shop_supplies_cap_applied ?? Infinity)))

    const page = await api(`/hd/work-orders/${woId}`)
    const html = await page.text()
    check('the work order page renders the extras panel', page.status === 200 && html.includes('DRIVE TIME, MILEAGE'), String(page.status))
  } finally {
    if (woId) {
      const del = await fetch(`${S}/rest/v1/hd_work_orders?id=eq.${woId}`, { method: 'DELETE', headers: { apikey: K, Authorization: `Bearer ${K}` } })
      console.log(`\n  cleanup: test work order deleted (${del.status}); its lines go with it`)
    }
  }
}

main().then(() => {
  console.log(`\n${passes} passed, ${failures} failed`)
  if (failures) process.exit(1)
}).catch(e => { console.error(e); process.exit(1) })
