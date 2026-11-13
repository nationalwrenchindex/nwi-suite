// npx tsx scripts/verify-carried-tax-lines.ts [old-module]
// READ-ONLY. Every HD work order with lines, through the converter. With an old module
// path given, prints every work order whose invoice payload differs, old vs new.
// Always prints WO-2026-1576 in full.
import { loadEnv } from './lib/smoke-session'
import { buildInvoicePayload, type ShopFallback } from '../src/lib/hd/wo-to-invoice'
import { taxSettingsFrom, TAX_SETTINGS_SELECT } from '../src/lib/tax'
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
async function main() {
  const oldMod = process.argv[2] ? await import(process.argv[2]) : null
  const lines = await all('hd_work_order_line_items?select=*&order=id')
  const jobs = await all('hd_work_order_jobs?select=*&order=id')
  const woIds = [...new Set(lines.map(l => l.work_order_id))]
  const wos: Record<string, any>[] = []
  for (let i = 0; i < woIds.length; i += 100) wos.push(...await all(`hd_work_orders?select=*&id=in.(${woIds.slice(i, i + 100).join(',')})`))
  const fb = new Map<string, ShopFallback>()
  for (const u of new Set(wos.map(w => w.user_id))) {
    const [p] = await all(`profiles?select=hd_labor_rate,default_labor_rate,${TAX_SETTINGS_SELECT}&id=eq.${u}`)
    fb.set(u, { laborRate: p?.hd_labor_rate != null ? Number(p.hd_labor_rate) : p?.default_labor_rate != null ? Number(p.default_labor_rate) : null, taxSettings: taxSettingsFrom(p) })
  }
  // The convert route fills a pre-159 work order's fees off its quote; do the same.
  const qIds = [...new Set(wos.map(w => w.quote_id).filter(Boolean))]
  const quotes = qIds.length ? await all(`hd_quotes?select=id,diagnostic_fee,road_call_fee&id=in.(${qIds.join(',')})`) : []
  for (const w of wos) {
    const q = quotes.find(x => x.id === w.quote_id)
    if (!q) continue
    if (w.diagnostic_fee == null && q.diagnostic_fee != null) w.diagnostic_fee = q.diagnostic_fee
    if (w.road_call_fee == null && q.road_call_fee != null) w.road_call_fee = q.road_call_fee
  }
  let same = 0, diff = 0
  for (const wo of wos.sort((a, b) => String(a.work_order_number).localeCompare(String(b.work_order_number)))) {
    const L = lines.filter(l => l.work_order_id === wo.id), J = jobs.filter(j => j.work_order_id === wo.id)
    const n = buildInvoicePayload(wo, L, fb.get(wo.user_id)!, J as never[]).payload as any
    if (wo.work_order_number === 'WO-2026-1576') {
      console.log(`\nWO-2026-1576 NEW: labor lines ${n.subtotal_labor} parts lines ${n.subtotal_parts} travel ${n.travel_amount} mileage ${n.mileage_amount} supplies ${n.shop_supplies_fee}`)
      console.log(`  tax ${n.tax_amount}  breakdown ${JSON.stringify(n.tax_breakdown)}  TOTAL ${n.total}`)
    }
    if (!oldMod) continue
    const o = oldMod.buildInvoicePayload(wo, L, fb.get(wo.user_id)!, J as never[]).payload as any
    const strip = (p: any) => JSON.stringify({ ...p, internal_notes: undefined, line_items: p.line_items.map((x: any) => ({ ...x, id: x.id })) })
    if (strip(o) === strip(n)) { same++; continue }
    diff++
    console.log(`DIFF ${wo.work_order_number} (${wo.user_id.slice(0, 8)}, ${wo.status}, jobs ${new Set(L.map(l => l.job_id)).size}): tax ${o.tax_amount} -> ${n.tax_amount}, total ${o.total} -> ${n.total}`)
  }
  if (oldMod) console.log(`\n${wos.length} work orders with lines: ${same} identical, ${diff} differ`)
}
main()
