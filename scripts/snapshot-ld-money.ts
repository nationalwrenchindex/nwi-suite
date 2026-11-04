// npx tsx scripts/snapshot-ld-money.ts <out.json> [before.json]
//
// READ ONLY. Every LD quote, work order and invoice, priced through the product's own
// money functions exactly as the screens and the converter use them:
//
//   quotes, work orders  the stored money columns; the rows the documents print (the
//                        service call fee row and the extras rows); what the editor
//                        re-totals an UNCHANGED document to (lib/document-money, the
//                        no-op rule); and what it re-prices the same document to with
//                        nothing stored (the arithmetic itself)
//   work orders          the converter's money: lines or billable segments, plus the
//                        parent's extras and service call fee, the extras guard, and
//                        the tax-completeness check (api/work-orders/[id]/convert)
//   invoices             the stored money columns and every row the invoice prints
//
// Runs unchanged on old code and new code. On code without lib/service-call (before
// the LD service call fee) it passes no fee, which is what that code does.
//
// With a second argument it compares and prints every difference. Any difference is a
// failure.

import { writeFileSync, readFileSync } from 'node:fs'
import { loadEnv } from './lib/smoke-session'
import { fromLineItems, markupOnReopen } from '../src/components/shared/line-items'
import { documentMoney, documentExtras } from '../src/lib/document-money'
import {
  extrasDisplayRows, extrasFromDocument, extrasDelta, extrasAgree, partsBaseFromLines,
} from '../src/lib/billable-extras'
import {
  taxSettingsFrom, TAX_SETTINGS_SELECT, documentTaxSettings, computeTax, mergeBreakdowns, breakdownTaxTotal,
} from '../src/lib/tax'
import { parseDiscount, normalizeDiscount } from '../src/lib/document-discount'
import { invoiceFromSegments } from '../src/lib/segments/invoice'
import { shapeSegments } from '../src/lib/segments/select'
import { isBillable } from '../src/types/segments'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const r2 = (n: number) => Math.round(n * 100) / 100

async function all(q: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = []
  for (let f = 0; ; f += 1000) {
    const j = await (await fetch(`${S}/rest/v1/${q}`, { headers: { ...H, Range: `${f}-${f + 999}` } })).json()
    if (!Array.isArray(j)) throw new Error(`${q}: ${JSON.stringify(j)}`)
    out.push(...j); if (j.length < 1000) break
  }
  return out
}

const MONEY = ['line_items', 'labor_hours', 'labor_rate', 'parts_subtotal', 'parts_markup_percent', 'labor_subtotal',
  'tax_percent', 'tax_amount', 'grand_total', 'tax_breakdown', 'travel_hours', 'travel_rate', 'travel_amount',
  'mileage_miles', 'mileage_rate', 'mileage_amount', 'shop_supplies_percent_applied', 'shop_supplies_cap_applied',
  'shop_supplies_fee', 'discount', 'subtotal', 'total', 'tax_rate', 'discount_amount']
const pick = (r: Record<string, any>, keys: string[]) => Object.fromEntries(keys.filter(k => k in r).map(k => [k, r[k]]))

async function main() {
  const [outPath, beforePath] = process.argv.slice(2)
  if (!outPath) throw new Error('usage: snapshot-ld-money.ts <out.json> [before.json]')
  // The service call fee, when this code has it. Old code: none, exactly as it bills.
  const sc = await import('../src/lib/service-call').catch(() => null) as null | {
    serviceCallOf: (d: Record<string, unknown>) => { fee: number; tax: 'labor' | 'none' }
    serviceCallRow: (s: { fee: number; tax: 'labor' | 'none' }) => { label: string; amount: number } | null
    serviceCallBuckets: (s: { fee: number; tax: 'labor' | 'none' }) => { labor: number; untaxed: number }
  }
  const callOf = (d: Record<string, unknown>) => (sc ? sc.serviceCallOf(d) : null)

  const quotes = await all('quotes?select=*&order=id')
  const wos    = await all('work_orders?select=*&order=id')
  const invs   = await all('invoices?select=*&order=id')
  const segs   = await all('work_order_segments?select=*,options:work_order_segment_options!segment_id(*)&order=id')
  const users  = new Set([...quotes, ...wos, ...invs].map(r => r.user_id))
  const shop = new Map<string, { ts: ReturnType<typeof taxSettingsFrom>; detailer: boolean }>()
  for (const u of users) {
    const [p] = await all(`profiles?select=business_type,${TAX_SETTINGS_SELECT}&id=eq.${u}`)
    shop.set(u, { ts: taxSettingsFrom(p), detailer: p?.business_type === 'detailer' })
  }

  const printed = (d: Record<string, any>) => {
    const call = callOf(d)
    const row = call && sc ? sc.serviceCallRow(call) : null
    return [
      ...(row ? [[row.label, row.amount]] : []),
      ...extrasDisplayRows(extrasFromDocument(d)).map(r => [r.detail ? `${r.label} (${r.detail})` : r.label, r.amount]),
    ]
  }

  // What the quote editor and the work order form re-total this document to.
  const editor = (d: Record<string, any>, stored: boolean) => {
    const s = shop.get(d.user_id)!
    const markup = markupOnReopen(d.parts_markup_percent).percent
    const items = fromLineItems(d.line_items, markup, undefined, { withLabor: true })
    const de = documentExtras(d)
    const taxPct = Number(d.tax_percent ?? 0)
    const m = documentMoney({
      items, markupPct: markup, laborRate: Number(d.labor_rate ?? 0), taxPct,
      taxSettings: documentTaxSettings(d.tax_breakdown, s.ts, taxPct),
      extrasSettings: de.settings,
      extras: de.input,
      discount: normalizeDiscount(parseDiscount(d.discount)),
      ...(sc ? { serviceCall: callOf(d) } : {}),
      stored: stored ? d : null,
    } as Parameters<typeof documentMoney>[0])
    return { subtotal: m.subtotal, taxAmount: m.taxAmount, grandTotal: m.grandTotal, taxBreakdown: m.taxBreakdown, discount: m.discount, columns: m.columns }
  }

  // The converter's money, as api/work-orders/[id]/convert computes it.
  const converter = (wo: Record<string, any>) => {
    const s = shop.get(wo.user_id)!
    const taxSettings = documentTaxSettings(wo.tax_breakdown, s.ts, Number(wo.tax_percent ?? 0)) ?? s.ts
    const segments = shapeSegments(segs.filter(g => g.ld_work_order_id === wo.id).sort((a, b) => a.sequence - b.sequence))
    const billable = segments.filter(g => isBillable(g.status))
    const parentExtras = extrasFromDocument(wo)
    const call = callOf(wo)
    const extras = sc ? extrasDelta(parentExtras, taxSettings, call) : extrasDelta(parentExtras, taxSettings)
    const partsBase = partsBaseFromLines(wo.line_items)
    const lines = Array.isArray(wo.line_items) ? wo.line_items as Array<Record<string, any>> : []
    const ln = lines.filter(l => l.type === 'labor' || (l.type === undefined && typeof l.description === 'string' && /^labor/i.test(l.description.trim())))
      .reduce((t, l) => t + Number(l.total ?? 0), 0)
    const laborBase = ln > 0 ? r2(ln) : r2(Number(wo.labor_subtotal ?? 0))
    const baseTax = computeTax({ parts: partsBase, labor: laborBase }, taxSettings)
    const segmentMoney = segments.length > 0 ? invoiceFromSegments(billable) : {
      line_items: wo.line_items ?? [], subtotal: r2(partsBase + laborBase), tax_amount: baseTax.taxAmount,
      tax_rate: Number(wo.tax_percent ?? 0) / 100, total: r2(r2(partsBase + laborBase) + baseTax.taxAmount), tax_breakdown: baseTax.breakdown,
    }
    const money = {
      ...segmentMoney,
      subtotal: r2(Number(segmentMoney.subtotal) + extras.subtotalDelta),
      tax_amount: r2(Number(segmentMoney.tax_amount) + extras.taxDelta),
      total: r2(Number(segmentMoney.total) + extras.totalDelta),
      tax_breakdown: mergeBreakdowns([segmentMoney.tax_breakdown, extras.breakdown]),
    }
    const agree = sc ? extrasAgree(parentExtras, Number(money.subtotal), Number(segmentMoney.subtotal), call)
      : extrasAgree(parentExtras, Number(money.subtotal), Number(segmentMoney.subtotal))
    const untaxedCall = sc && call ? sc.serviceCallBuckets(call).untaxed : 0
    const taxable = r2(Number(money.subtotal) - parentExtras.mileage.amount - untaxedCall)
    return { segmented: segments.length > 0, money, agree, taxable, breakdownTax: breakdownTaxTotal(money.tax_breakdown) }
  }

  const snap: Record<string, unknown> = {}
  for (const q of quotes) {
    const det = shop.get(q.user_id)!.detailer
    snap[`quote ${q.quote_number} ${q.id}`] = {
      stored: pick(q, MONEY), printed: printed(q),
      ...(det ? {} : { editorUnchanged: editor(q, true), editorRepriced: editor(q, false) }),
    }
  }
  for (const wo of wos) {
    const owns = !segs.some(g => g.ld_work_order_id === wo.id)
    snap[`work order ${wo.work_order_number} ${wo.id}`] = {
      stored: pick(wo, MONEY), printed: printed(wo),
      ...(owns ? { editorUnchanged: editor(wo, true), editorRepriced: editor(wo, false) } : {}),
      converter: converter(wo),
    }
  }
  for (const inv of invs) snap[`invoice ${inv.invoice_number} ${inv.id}`] = { stored: pick(inv, MONEY), printed: printed(inv) }

  writeFileSync(outPath, JSON.stringify(snap, null, 1))
  console.log(`${quotes.length} quotes, ${wos.length} work orders (${segs.length} segments), ${invs.length} invoices -> ${outPath}` +
    `  [${sc ? 'service call fee code present' : 'no service call fee code'}]`)

  if (beforePath) {
    const before = JSON.parse(readFileSync(beforePath, 'utf8')) as Record<string, unknown>
    let diffs = 0
    for (const k of new Set([...Object.keys(before), ...Object.keys(snap)])) {
      const a = JSON.stringify(before[k]), b = JSON.stringify(snap[k])
      if (a !== b) { diffs++; console.log(`DIFFERS  ${k}\n  before ${a}\n  after  ${b}`) }
    }
    console.log(diffs ? `\n${diffs} DOCUMENTS DIFFER - FAILURE` : `\nIDENTICAL: all ${Object.keys(snap).length} LD documents price and print exactly as before`)
    if (diffs) process.exit(1)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
