// npx tsx scripts/verify-invoice-return-stock.ts
//
// READ-ONLY. Fixtures are REAL ROWS, never an assumed shape:
//   - INV-2026-0057's real stock movements, for the by-part summary, the customer
//     return planner and the deleted-draft reversal
//   - every stored HD invoice, for which are deletable drafts and which take a return
//   - every HD work order carrying a tax split, with its real lines and jobs, for the
//     work order's own tax moving on a line save (item 20)
// Writes nothing.
import { loadEnv } from './lib/smoke-session'
import {
  summarizeInvoiceStock, planCustomerReturn, planInvoiceReversal, hasCustomerReturn, negativeStockWarning,
  type DocMovement,
} from '../src/lib/inventory/ledger'
import { isDeletableDraft, canCustomerReturn, deleteRefusedMessage, isInvoiceLocked } from '../src/lib/hd/invoice-lock'
import { workOrderLinesTaxUpdate } from '../src/lib/hd/work-order-tax-refresh'
import { buildInvoicePayload, type WorkOrderLineRow } from '../src/lib/hd/wo-to-invoice'
import { taxSettingsFrom, TAX_SETTINGS_SELECT } from '../src/lib/tax'
import { hdLaborRateFrom } from '../src/lib/hd/labor-rate'
import type { WorkOrderJob } from '../src/lib/hd/work-order-jobs'
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
let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++; else fail++
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}
const OWNER = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

async function main() {
  // ── 1. The ledger's view of a real invoice ────────────────────────────────
  const inv57 = (await get(`hd_invoices?select=*&user_id=eq.${OWNER}&invoice_number=eq.INV-2026-0057`))[0]
  check('INV-2026-0057 is a real row', !!inv57, inv57 ? inv57.status : 'missing')
  if (!inv57) return
  const rows = await get(`stock_movement?select=part_id,location_id,delta,reason,unit_cost&source_type=eq.hd_invoice&source_id=eq.${inv57.id}`)
  const parts = new Map((await get(`parts?select=id,part_number&id=in.(${[...new Set(rows.map(r => r.part_id))].join(',')})`)).map(p => [p.id, p.part_number]))
  const mv: DocMovement[] = rows.map(r => ({ partId: r.part_id, locationId: r.location_id, delta: Number(r.delta), reason: r.reason, unitCost: r.unit_cost == null ? null : Number(r.unit_cost) }))
  const stock = summarizeInvoiceStock(mv, id => parts.get(id) ?? id)
  check('by part: one row per part the invoice moved', stock.length === new Set(rows.map(r => r.part_id)).size, `${stock.length} parts`)
  const p2805 = stock.find(s => s.partNumber === '33-2805')
  check('33-2805: the ledger holds 3 taken for this invoice', p2805?.taken === 3, String(p2805?.taken))
  check('no customer return on it yet', !hasCustomerReturn(mv) && stock.every(s => s.customerReturned === 0))

  // ── 2. Customer return: capped at the ledger, per part ─────────────────────
  const ok1 = planCustomerReturn(stock, [{ partId: p2805!.partId, quantity: 2 }])
  check('return 2 of 3 of 33-2805 plans one +2 customer_returned row', ok1.ok && ok1.movements.length === 1 && ok1.movements[0].delta === 2 && ok1.movements[0].reason === 'customer_returned',
    ok1.ok ? JSON.stringify(ok1.movements.map(m => [m.partNumber, m.delta, m.reason])) : ok1.errors.join(' '))
  check('the return carries the cost it was taken at', ok1.ok && ok1.movements[0].unitCost === p2805!.unitCost, String(p2805!.unitCost))
  const over = planCustomerReturn(stock, [{ partId: p2805!.partId, quantity: 4 }])
  check('return 4 of 3 is refused, with the ledger figure in the message', !over.ok && /only 3 off the shelf/.test(over.errors.join(' ')), !over.ok ? over.errors[0] : '')
  // After the 2 come back, the ledger holds 1: a second return of 2 is refused.
  const after2 = summarizeInvoiceStock([...mv, { partId: p2805!.partId, locationId: p2805!.byLocation[0].locationId, delta: 2, reason: 'customer_returned', unitCost: p2805!.unitCost }], id => parts.get(id) ?? id)
  const again = planCustomerReturn(after2, [{ partId: p2805!.partId, quantity: 2 }])
  check('a second return cannot exceed what is left: 2 of 1 refused', !again.ok && /only 1 off the shelf/.test(again.errors.join(' ')), !again.ok ? again.errors[0] : '')
  check('...and the summary counts the earlier return', after2.find(s => s.partId === p2805!.partId)?.customerReturned === 2)
  const mixed = planCustomerReturn(stock, [{ partId: p2805!.partId, quantity: 1 }, { partId: stock[0].partId === p2805!.partId ? stock[1].partId : stock[0].partId, quantity: 99 }])
  check('one part over the cap refuses the whole request (nothing half-returned)', !mixed.ok)
  check('zero of everything is refused', !planCustomerReturn(stock, [{ partId: p2805!.partId, quantity: 0 }]).ok)
  check('a part the invoice never took is refused', !planCustomerReturn(stock, [{ partId: '00000000-0000-0000-0000-000000000000', quantity: 1 }]).ok)
  check('a fractional quantity is refused', !planCustomerReturn(stock, [{ partId: p2805!.partId, quantity: 1.5 }]).ok)

  // ── 3. Deleted draft: back to exactly zero net, after refreshes ─────────────
  // A refresh history on top of the real rows: +1 returned, then -2 adjusted.
  const refreshed: DocMovement[] = [...mv,
    { partId: p2805!.partId, locationId: p2805!.byLocation[0].locationId, delta: 1, reason: 'returned', unitCost: p2805!.unitCost },
    { partId: p2805!.partId, locationId: p2805!.byLocation[0].locationId, delta: -2, reason: 'adjusted', unitCost: p2805!.unitCost }]
  const rev = planInvoiceReversal(summarizeInvoiceStock(refreshed, id => parts.get(id) ?? id))
  const net = new Map<string, number>()
  for (const m of [...refreshed, ...rev]) net.set(`${m.partId}|${m.locationId}`, (net.get(`${m.partId}|${m.locationId}`) ?? 0) + m.delta)
  check('reversal after refreshes: every part and location nets to exactly zero', [...net.values()].every(v => v === 0), `${rev.length} reversal rows`)
  check('reversal puts back what the LEDGER holds (33-2805: 4 after the refreshes), not the original 3', rev.find(r => r.partId === p2805!.partId)?.delta === 4, String(rev.find(r => r.partId === p2805!.partId)?.delta))

  // ── 4. Which real invoices are deletable, and which take a return ───────────
  const all = await get('hd_invoices?select=*&order=id')
  const del = all.filter(i => isDeletableDraft(i))
  check('every deletable invoice is unpaid with no send stamp and no payment', del.every(i => i.status === 'unpaid' && !i.sent_at && !i.last_sent_at && !i.paid_at), `${del.length} of ${all.length}`)
  check('no paid, partial, void, sent or overdue invoice is deletable', all.filter(i => ['paid', 'partial', 'void', 'sent', 'overdue'].includes(i.status)).every(i => !isDeletableDraft(i)))
  check('deletable and customer-return never overlap', all.every(i => !(isDeletableDraft(i) && canCustomerReturn(i))))
  check('every invoice is one or the other', all.every(i => isDeletableDraft(i) || canCustomerReturn(i)),
    all.filter(i => !isDeletableDraft(i) && !canCustomerReturn(i)).map(i => `${i.invoice_number} ${i.status}`).join(', '))
  const sent = all.find(i => i.status === 'sent')
  check('a sent invoice\'s refusal names Refresh and Return parts to stock', !!sent && /Refresh/.test(deleteRefusedMessage(sent)) && /Return parts to stock/.test(deleteRefusedMessage(sent)), sent ? deleteRefusedMessage(sent) : 'no sent invoice')
  const paid = all.find(i => i.status === 'paid')
  check('a paid invoice: refused, and locked against refresh', !!paid && !isDeletableDraft(paid) && isInvoiceLocked(paid.status) && /is paid/.test(deleteRefusedMessage(paid)))
  check('the warning names the part and the count', negativeStockWarning([{ partId: 'x', partNumber: '33-2805', onHand: -9, locationName: 'Shop' }]) === 'Stock below zero: 33-2805 is now at -9 on hand (Shop). The invoice went through - count or receive these parts.')

  // ── 5. Item 20: a work order's own tax follows its lines ──────────────────
  const wos = (await get('hd_work_orders?select=*&tax_amount=not.is.null&tax_breakdown=not.is.null')).slice(0, 40)
  const profiles = new Map<string, Record<string, any>>()
  let tried = 0, idem = 0, matchesConvert = 0, chain = 0, unchangedNull = 0, moved = 0
  const misses: string[] = []
  for (const wo of wos) {
    const lines = (await get(`hd_work_order_line_items?select=*&work_order_id=eq.${wo.id}&order=sort_order`)) as unknown as WorkOrderLineRow[]
    if (lines.length < 2) continue
    let jobs: WorkOrderJob[] = []
    try { jobs = (await get(`hd_work_order_jobs?select=*&work_order_id=eq.${wo.id}&order=job_number`)) as unknown as WorkOrderJob[] } catch { jobs = [] }
    if (!profiles.has(wo.user_id)) profiles.set(wo.user_id, (await get(`profiles?select=hd_labor_rate,${TAX_SETTINGS_SELECT}&id=eq.${wo.user_id}`))[0] ?? {})
    const prof = profiles.get(wo.user_id)!
    const shop = { laborRate: hdLaborRateFrom(prof), taxSettings: taxSettingsFrom(prof) }
    tried++
    const dropOne = lines.slice(0, -1), dropTwo = lines.slice(0, -2)
    const u1 = workOrderLinesTaxUpdate(wo, { rows: lines, jobs }, { rows: dropOne, jobs }, shop)
    if (u1 && u1.tax_amount !== undefined) moved++
    const wo1 = { ...wo, ...(u1 ?? {}) }
    // The converter bills the same after the write as before it.
    const conv0 = buildInvoicePayload({ ...wo }, dropOne, shop, jobs).payload
    const conv1 = buildInvoicePayload({ ...wo1 }, dropOne, shop, jobs).payload
    if (Number(conv0.tax_amount) === Number(conv1.tax_amount) && Number(conv0.total) === Number(conv1.total)) matchesConvert++
    else misses.push(`${wo.work_order_number}: convert ${conv0.tax_amount} -> ${conv1.tax_amount}`)
    // Saving again with nothing changed writes nothing.
    if (workOrderLinesTaxUpdate(wo1, { rows: dropOne, jobs }, { rows: dropOne, jobs }, shop) === null) idem++
    else misses.push(`${wo.work_order_number}: second save wrote again`)
    // Two saves land where one would: telescoping.
    const u2 = workOrderLinesTaxUpdate(wo1, { rows: dropOne, jobs }, { rows: dropTwo, jobs }, shop)
    const direct = workOrderLinesTaxUpdate(wo, { rows: lines, jobs }, { rows: dropTwo, jobs }, shop)
    const viaTwo = { ...wo1, ...(u2 ?? {}) }, viaOne = { ...wo, ...(direct ?? {}) }
    if (Number(viaTwo.tax_amount) === Number(viaOne.tax_amount) && Number(viaTwo.total_amount) === Number(viaOne.total_amount)) chain++
    else misses.push(`${wo.work_order_number}: two saves ${viaTwo.tax_amount}/${viaTwo.total_amount} vs one ${viaOne.tax_amount}/${viaOne.total_amount}`)
    // The stored figure written is the converter's figure for those lines.
    if (u1 && Number(u1.tax_amount ?? wo.tax_amount) !== Number(conv0.tax_amount)) misses.push(`${wo.work_order_number}: wrote ${u1.tax_amount}, converter ${conv0.tax_amount}`)
    if (workOrderLinesTaxUpdate({ ...wo, ...(workOrderLinesTaxUpdate(wo, { rows: lines, jobs }, { rows: lines, jobs }, shop) ?? {}) }, { rows: lines, jobs }, { rows: lines, jobs }, shop) === null) unchangedNull++
  }
  check('item 20: real work orders carrying a tax split were tried', tried > 0, `${tried} work orders`)
  check('dropping a line really moves the stored tax (the checks below are not vacuous)', moved === tried, `${moved}/${tried}`)
  check('after the write, convert bills exactly what it billed before it', matchesConvert === tried, `${matchesConvert}/${tried}`)
  check('a second save with the same lines writes nothing', idem === tried, `${idem}/${tried}`)
  check('two saves land where one save would (the shift telescopes)', chain === tried, `${chain}/${tried}`)
  check('an unchanged save, once caught up, writes nothing', unchangedNull === tried, `${unchangedNull}/${tried}`)
  if (misses.length) console.log('  misses:', misses.slice(0, 10).join(' | '))

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}
main().catch(e => { console.error(e); process.exitCode = 1 })
