// npx tsx scripts/probe-wo1576-stock.ts [WO-2026-1576]
// READ-ONLY. For one HD work order: its invoice(s), every stock movement on its parts
// from any source (including invoices since deleted - the ledger outlives them), and
// on-hand now for every part on the work order. Writes nothing.
import { loadEnv } from './lib/smoke-session'
import { normalizePartNumber } from '../src/lib/parts/search'
loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
async function get(q: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = []
  for (let f = 0; ; f += 1000) {
    const j = await (await fetch(`${S}/rest/v1/${q}`, { headers: { ...H, Range: `${f}-${f + 999}` } })).json()
    if (!Array.isArray(j)) throw new Error(`${q}: ${JSON.stringify(j)}`)
    out.push(...j); if (j.length < 1000) return out
  }
}
async function main() {
  const woNum = process.argv[2] ?? 'WO-2026-1576'
  const [wo] = await get(`hd_work_orders?select=id,user_id,work_order_number,status&work_order_number=eq.${woNum}`)
  if (!wo) throw new Error(`no ${woNum}`)
  console.log('WO', wo.work_order_number, wo.status, wo.user_id)
  const lines = await get(`hd_work_order_line_items?select=type,part_number,quantity&work_order_id=eq.${wo.id}`)
  const parts = lines.filter(l => String(l.type).toLowerCase() === 'part' && l.part_number)
  const catalog = await get(`parts?select=id,part_number,part_number_normalized&order=id`)
  console.log('catalog rows read', catalog.length)
  const byNorm = new Map(catalog.map(p => [String(p.part_number_normalized), p]))
  const byId = new Map(catalog.map(p => [p.id, p.part_number]))
  console.log('PART LINES -> catalog')
  for (const p of parts) console.log(' ', p.part_number, 'x', p.quantity, '->', byNorm.get(normalizePartNumber(p.part_number))?.part_number ?? 'NOT IN CATALOG')
  const invs = await get(`hd_invoices?select=*&work_order_id=eq.${wo.id}`)
  for (const i of invs) console.log('INVOICE', i.invoice_number, i.status, i.total, 'sent_at', i.sent_at, 'last_sent_at', i.last_sent_at, 'token', !!i.public_token)
  if (invs[0]) console.log('INVOICE COLUMNS', Object.keys(invs[0]).sort().join(' '))
  const woPartIds = new Set(parts.map(p => byNorm.get(normalizePartNumber(p.part_number))?.id).filter(Boolean))
  const mv = await get(`stock_movement?select=part_id,location_id,delta,reason,source_type,source_id,source_ref,created_at&user_id=eq.${wo.user_id}&order=created_at,id`)
  const liveIds = new Set(invs.map(i => i.id))
  console.log("EVERY MOVEMENT ON THIS WO'S PARTS, ANY SOURCE:")
  for (const m of mv) if (woPartIds.has(m.part_id)) console.log(' ', m.created_at.slice(0, 16), byId.get(m.part_id), m.delta, m.reason, m.source_type, m.source_ref, m.source_type === 'hd_invoice' ? (liveIds.has(m.source_id) ? '(live)' : '(invoice gone)') : '')
  const inv = await get(`inventory?select=part_id,location_id,on_hand&user_id=eq.${wo.user_id}`)
  console.log('ON HAND NOW:')
  for (const r of inv) if (woPartIds.has(r.part_id)) console.log(' ', byId.get(r.part_id), r.on_hand, r.location_id)
  const alloc = await get(`stock_allocation?select=part_id,quantity,released_reason&work_order_id=eq.${wo.id}`)
  console.log('ALLOCATIONS', alloc.map(a => `${byId.get(a.part_id)} x${a.quantity} ${a.released_reason}`).join('; '))
}
main().catch(e => { console.error(e); process.exit(1) })
