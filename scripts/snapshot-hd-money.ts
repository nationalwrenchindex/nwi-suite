// npx tsx scripts/snapshot-hd-money.ts <out.json> [before.json]
//
// READ ONLY. Every HD invoice, quote and work order-with-lines, priced through the
// product's own display and pricing functions exactly as the screens use them:
//
//   invoices    the stored money columns, every row the invoice page prints (labor,
//               parts, fees, extras, discount), the stored total, whether the stored
//               row adds up, and what an UNCHANGED edit-and-save would write
//   quotes      the stored total and every fee and extras row the quote page prints,
//               the work order its approval would open (terms and lines), and the
//               invoice "Bill Directly" would write (money keys and lines)
//   work orders the converter's whole invoice payload (money keys), with the shop
//               fallback the convert route builds
//
// Run it before a money change and after it; with a second argument it compares and
// prints every difference. Any difference is a failure.

import { writeFileSync, readFileSync } from 'node:fs'
import { loadEnv } from './lib/smoke-session'
import { feeRows } from '../src/lib/invoice-document'
import { extrasDisplayRows, extrasFromDocument } from '../src/lib/billable-extras'
import { buildInvoicePayload, type WorkOrderLineRow, type ShopFallback } from '../src/lib/hd/wo-to-invoice'
import { invoiceDoesNotAddUp, openInvoiceEdit, invoiceSaveBody } from '../src/lib/hd/invoice-edit-save'
import { taxSettingsFrom, TAX_SETTINGS_SELECT } from '../src/lib/tax'
import { termsFromQuote, workOrderLinesFromQuote } from '../src/lib/hd/quote-approval'
import { invoiceBodyFromQuote } from '../src/lib/hd/quote-to-invoice'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

async function all(q: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = []
  for (let f = 0; ; f += 1000) {
    const j = await (await fetch(`${S}/rest/v1/${q}`, { headers: { ...H, Range: `${f}-${f + 999}` } })).json()
    if (!Array.isArray(j)) throw new Error(`${q}: ${JSON.stringify(j)}`)
    out.push(...j); if (j.length < 1000) break
  }
  return out
}

const MONEY = ['total', 'subtotal_labor', 'subtotal_parts', 'tax_amount', 'tax_rate', 'diagnostic_fee', 'road_call_fee',
  'service_call_fee', 'travel_hours', 'travel_rate', 'travel_amount', 'mileage_miles', 'mileage_rate', 'mileage_amount',
  'shop_supplies_percent_applied', 'shop_supplies_cap_applied', 'shop_supplies_fee']
const pick = (r: Record<string, any>, keys: string[]) => Object.fromEntries(keys.filter(k => k in r).map(k => [k, r[k]]))
const printed = (d: Record<string, any>) => [
  ['Labor Subtotal', d.subtotal_labor], ['Parts Subtotal', d.subtotal_parts],
  ...feeRows(d).map(r => [r.label, r.amount]),
  ...extrasDisplayRows(extrasFromDocument(d)).map(r => [r.detail ? `${r.label} (${r.detail})` : r.label, r.amount]),
]

async function main() {
  const [outPath, beforePath] = process.argv.slice(2)
  if (!outPath) throw new Error('usage: snapshot-hd-money.ts <out.json> [before.json]')

  const invs = await all('hd_invoices?select=*&order=id')
  const quotes = await all('hd_quotes?select=*&order=id')
  const lines = await all('hd_work_order_line_items?select=*&order=id')
  const woIds = [...new Set(lines.map(l => l.work_order_id))]
  const wos = woIds.length ? await all(`hd_work_orders?select=*&id=in.(${woIds.join(',')})&order=id`) : []
  const users = new Set([...invs, ...wos].map(r => r.user_id))
  const fallbacks = new Map<string, ShopFallback>()
  for (const u of users) {
    const [p] = await all(`profiles?select=hd_labor_rate,default_labor_rate,${TAX_SETTINGS_SELECT}&id=eq.${u}`)
    const rate = p?.hd_labor_rate != null ? Number(p.hd_labor_rate) : p?.default_labor_rate != null ? Number(p.default_labor_rate) : null
    fallbacks.set(u, { laborRate: rate, taxSettings: taxSettingsFrom(p) })
  }

  const snap: Record<string, unknown> = {}
  for (const inv of invs) {
    const opened = openInvoiceEdit(inv, fallbacks.get(inv.user_id)?.laborRate ?? null)
    let unchangedSave: unknown
    try { unchangedSave = invoiceSaveBody(inv, opened, opened.state, new Date('2026-01-01T00:00:00Z')) } catch (e) { unchangedSave = `throws: ${(e as Error).message}` }
    snap[`invoice ${inv.invoice_number} ${inv.id}`] = {
      stored: pick(inv, MONEY), printed: printed(inv),
      doesNotAddUp: invoiceDoesNotAddUp(inv), unchangedSave,
    }
  }
  for (const q of quotes) {
    const bill = invoiceBodyFromQuote(q) as Record<string, any>
    snap[`quote ${q.quote_number} ${q.id}`] = {
      stored: pick(q, MONEY), printed: printed(q),
      toWorkOrder: { terms: termsFromQuote(q), lines: workOrderLinesFromQuote(q.line_items, q.labor_rate == null ? null : Number(q.labor_rate)) },
      billDirectly: { money: pick(bill, MONEY), line_items: bill.line_items, labor_rate: bill.labor_rate ?? null, printed: printed(bill) },
    }
  }
  for (const wo of wos) {
    const rows = lines.filter(l => l.work_order_id === wo.id) as WorkOrderLineRow[]
    const { payload } = buildInvoicePayload({ ...wo }, rows, fallbacks.get(wo.user_id)!)
    const p = payload as Record<string, any>
    snap[`work order ${wo.work_order_number} ${wo.id}`] = {
      payload: { ...pick(p, MONEY), discount: p.discount ?? null, tax_breakdown: p.tax_breakdown ?? null, line_items: p.line_items },
      printed: printed(p),
    }
  }
  writeFileSync(outPath, JSON.stringify(snap, null, 1))
  console.log(`${invs.length} invoices, ${quotes.length} quotes, ${wos.length} work orders with lines -> ${outPath}`)

  if (beforePath) {
    const before = JSON.parse(readFileSync(beforePath, 'utf8')) as Record<string, unknown>
    let diffs = 0
    for (const k of new Set([...Object.keys(before), ...Object.keys(snap)])) {
      // A new column that is NULL on every existing document is not a change to it.
      const norm = (v: unknown) => JSON.stringify(v, (key, val) => (key === 'service_call_fee' && val == null ? undefined : val))
      const a = norm(before[k]), b = norm(snap[k])
      if (a !== b) { diffs++; console.log(`DIFFERS  ${k}\n  before ${a}\n  after  ${b}`) }
    }
    console.log(diffs ? `\n${diffs} DOCUMENTS DIFFER - FAILURE` : `\nIDENTICAL: all ${Object.keys(snap).length} documents price and print exactly as before`)
    if (diffs) process.exit(1)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
