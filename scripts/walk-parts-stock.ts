// PAGECHECK_BASE=http://localhost:3000 npx tsx scripts/walk-parts-stock.ts
//
// ONE PART, END TO END, ON BOTH SURFACES, WITH EVERY FIGURE PRINTED.
//
//   receive into inventory -> find it at the counter -> put it on a work order
//   (allocated, not deducted) -> convert to an invoice (deducted, allocation released)
//
// Driven through the same HTTP routes the screens call, as a real signed-in user:
//   HD      the smoke owner account (SMOKE_OWNER_ID), like every other smoke flow
//   Reefer  a throwaway reefer_standalone account, made here and removed here
//
// The expected money is computed with the SHIPPED pricing functions (sellPrice,
// lineAmount) from the cost and the markup the work-order form itself reads, and is
// compared to what the database stored - to the cent.
//
// EVERY ROW THIS CREATES IS DELETED IN `finally`, by id or by the throwaway account.
// The ledger is append-only for subscribers; these are the walk's own rows on a test
// account, removed with the service role so the next run and the shared-table
// comparison start from the same place.

import { loadEnv, openSession } from './lib/smoke-session'
import { sellPrice, lineAmount } from '../src/lib/shared/markup'
import { DEFAULT_HD_PARTS_MARKUP } from '../src/lib/hd/parts-pricing'
import { REEFER_STANDALONE_MODULES } from '../src/lib/reefer-standalone'

loadEnv()
const BASE  = (process.env.PAGECHECK_BASE ?? 'http://localhost:3000').replace(/\/$/, '')
const OWNER = process.env.SMOKE_OWNER_ID ?? '4a8c046f-7db3-42bb-8422-fd47efb7678c'
const SUPA  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SVC   = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SVC_H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }
const MARK  = 'SMOKE'

// The part: Carrier 30-60143-01, the Supra 660 oil filter from Brock's chart (verified),
// with the one supersession in the catalog pointing at it from 30-01121-00.
const PART_NUMBER = '30-60143-01'
const OLD_NUMBER  = '30-01121-00'
const RECEIVE_QTY = 3
const RECEIVE_COST = 12.34
const WO_QTY = 2

let failed = 0
function check(flow: string, step: string, ok: boolean, detail = ''): boolean {
  if (!ok) failed++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${flow}  ${step}${detail ? '  -- ' + detail : ''}`)
  return ok
}
const usd = (n: unknown) => `$${Number(n ?? 0).toFixed(2)}`

async function rest<T = Record<string, unknown>>(q: string): Promise<T[]> {
  const r = await fetch(`${SUPA}/rest/v1/${q}`, { headers: SVC_H })
  const j = await r.json()
  if (!Array.isArray(j)) throw new Error(`REST ${q}: ${JSON.stringify(j).slice(0, 160)}`)
  return j as T[]
}
async function del(q: string): Promise<void> {
  const r = await fetch(`${SUPA}/rest/v1/${q}`, { method: 'DELETE', headers: SVC_H })
  if (!r.ok) console.log(`  cleanup: DELETE ${q} -> ${r.status} ${(await r.text()).slice(0, 120)}`)
}

function client(cookie: string) {
  return {
    async api(method: string, path: string, body?: unknown) {
      const r = await fetch(`${BASE}${path}`, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      return { status: r.status, json: await r.json().catch(() => ({})) as Record<string, unknown> }
    },
    async page(path: string) {
      const r = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'follow' })
      return { ok: r.ok, path: new URL(r.url).pathname, html: r.ok ? await r.text() : '' }
    },
  }
}

interface Made { workOrders: string[]; invoices: string[]; customers: string[]; locationCreated: string | null; walkStart: string }

async function walk(F: string, userId: string, cookie: string, surface: '/hd' | '/reefer', made: Made): Promise<void> {
  const c = client(cookie)
  const scope = surface === '/reefer' ? 'reefer' : 'all'

  const part = (await rest<{ id: string; part_number: string }>(`parts?part_number=eq.${PART_NUMBER}&select=id,part_number`))[0]
  if (!check(F, `the catalog has ${PART_NUMBER}`, !!part)) return

  // Nothing of this part is stocked here before the walk, so every figure below is the walk's.
  const before = await rest(`inventory?user_id=eq.${userId}&part_id=eq.${part.id}&select=id`)
  if (!check(F, 'no stock of this part before the walk', before.length === 0, `${before.length} row(s)`)) return
  const locsBefore = await rest<{ id: string }>(`stock_location?user_id=eq.${userId}&select=id`)

  // ── the screens render ───────────────────────────────────────────────────
  const counterPage = await c.page(`${surface}/parts`)
  check(F, `${surface}/parts renders the counter`, counterPage.ok && counterPage.path === `${surface}/parts` &&
    counterPage.html.includes('PARTS COUNTER') && counterPage.html.includes('Find parts'), `-> ${counterPage.path}`)
  const invPage = await c.page(`${surface}/parts?tab=inventory`)
  check(F, `${surface}/parts?tab=inventory renders the inventory`, invPage.ok && invPage.html.includes('PARTS INVENTORY') && invPage.html.includes('Receive stock'))

  // ── 1. receive ───────────────────────────────────────────────────────────
  const rec = await c.api('POST', '/api/parts/stock', { action: 'receive', part_id: part.id, quantity: RECEIVE_QTY, unit_cost: RECEIVE_COST, reference: `${MARK}-WALK` })
  if (!check(F, `receive ${RECEIVE_QTY} @ ${usd(RECEIVE_COST)}`, rec.status === 201, `-> ${rec.status} ${JSON.stringify(rec.json).slice(0, 120)}`)) return
  const locationId = String(rec.json.location_id)
  if (!locsBefore.some(l => l.id === locationId)) made.locationCreated = locationId

  const inv1 = (await rest<Record<string, unknown>>(`inventory?user_id=eq.${userId}&part_id=eq.${part.id}&select=on_hand,last_cost,location_id`))[0]
  console.log(`         inventory after receipt: on_hand ${inv1?.on_hand}, last_cost ${usd(inv1?.last_cost)}`)
  check(F, 'inventory: on hand 3, last cost $12.34', Number(inv1?.on_hand) === RECEIVE_QTY && Number(inv1?.last_cost) === RECEIVE_COST)
  const mv1 = await rest<Record<string, unknown>>(`stock_movement?user_id=eq.${userId}&part_id=eq.${part.id}&select=delta,reason,unit_cost,source_ref&order=created_at`)
  console.log(`         ledger: ${mv1.map(m => `${m.reason} ${m.delta} @ ${usd(m.unit_cost)} ref ${m.source_ref}`).join('; ')}`)
  check(F, 'ledger: one received movement, +3 at $12.34', mv1.length === 1 && mv1[0].reason === 'received' && Number(mv1[0].delta) === 3 && Number(mv1[0].unit_cost) === RECEIVE_COST)

  // ── 2. the counter finds it, with the stock ──────────────────────────────
  const byUnit = await c.api('GET', `/api/parts/counter?scope=${scope}&maker=${encodeURIComponent('Carrier Transicold')}&model=${encodeURIComponent('Supra 660')}&part_type=${encodeURIComponent('Filter - oil (engine)')}`)
  const hit = ((byUnit.json.results ?? []) as Array<Record<string, unknown>>).find(r => r.part_number === PART_NUMBER)
  const hitStock = (hit?.stock ?? {}) as Record<string, number>
  console.log(`         counter (Supra 660, oil filter): ${((byUnit.json.results ?? []) as Array<Record<string, unknown>>).map(r => `${r.part_number} [${r.badge}]`).join(', ')}`)
  check(F, 'counter: Supra 660 oil filter returns 30-60143-01', !!hit, `-> ${byUnit.status}`)
  check(F, 'counter: it shows 3 on hand, 3 available', hitStock.on_hand === 3 && hitStock.available === 3, `${hitStock.on_hand} / ${hitStock.available}`)
  check(F, 'counter: no price and no source in the answer', !!hit && !('source' in hit) && !JSON.stringify(byUnit.json).match(/last_cost|sell_price|unit_cost|vendor/))
  const byOld = await c.api('GET', `/api/parts/counter?scope=${scope}&q=${OLD_NUMBER}`)
  const oldHit = ((byOld.json.results ?? []) as Array<Record<string, unknown>>)[0]
  check(F, `counter: the old number ${OLD_NUMBER} answers with ${PART_NUMBER}, was ${OLD_NUMBER}`,
    oldHit?.part_number === PART_NUMBER && (oldHit?.was as string[] | undefined)?.includes(OLD_NUMBER) === true, `${oldHit?.part_number} was ${(oldHit?.was as string[] | undefined)?.join(',')}`)

  // ── 3. a work order, with the part on it the way the form puts it there ───
  const prof = await c.api('GET', '/api/user/profile')
  const n = Number(prof.json.hd_parts_markup_percent)
  const markup = Number.isFinite(n) ? n : DEFAULT_HD_PARTS_MARKUP     // exactly WorkOrderLineItems' rule
  const wo = await c.api('POST', '/api/hd/work-orders', {
    customer_name: `${MARK} parts walk`, customer_phone: '+15555550188',
    unit_manufacturer: 'Carrier Transicold', unit_model: 'Supra 660',
    service_type: `${MARK} parts walk`, service_requests: `${MARK} - oil service`,
    scheduled_date: new Date().toISOString().slice(0, 10), scheduled_time: '09:00',
  })
  const woId = String(((wo.json.work_order ?? wo.json) as Record<string, unknown>).id ?? '')
  if (!check(F, 'a work order is created', (wo.status === 201 || wo.status === 200) && !!woId, `-> ${wo.status}`)) return
  made.workOrders.push(woId)

  // The catalog pick hands the line the COST (inventory last_cost) and the form's markup.
  const lines = [{ type: 'part', description: 'Oil filter', part_number: PART_NUMBER, quantity: WO_QTY, unit_cost: RECEIVE_COST, unit_price: null, markup_percent: markup }]
  const put = await c.api('PUT', `/api/hd/work-orders/${woId}/line-items`, { line_items: lines })
  if (!check(F, 'the part line saves on the work order', put.status === 200, `-> ${put.status} ${JSON.stringify(put.json).slice(0, 120)}`)) return
  const woLine = (await rest<Record<string, unknown>>(`hd_work_order_line_items?work_order_id=eq.${woId}&select=quantity,unit_cost,unit_price,markup_percent,total`))[0]
  const expSell = sellPrice(RECEIVE_COST, markup)
  const expTotal = lineAmount(WO_QTY, RECEIVE_COST, markup)
  console.log(`         work order line: qty ${woLine?.quantity}, unit_cost (COST) ${usd(woLine?.unit_cost)}, markup ${woLine?.markup_percent}%, unit_price (SELL) ${usd(woLine?.unit_price)}, total ${usd(woLine?.total)}`)
  console.log(`         expected:        qty ${WO_QTY}, cost ${usd(RECEIVE_COST)}, markup ${markup}%, sell ${usd(expSell)}, total ${usd(expTotal)}`)
  check(F, `work order line: cost $12.34, sell ${usd(expSell)}, total ${usd(expTotal)} (to the cent)`,
    Number(woLine?.unit_cost) === RECEIVE_COST && Number(woLine?.unit_price) === expSell && Number(woLine?.total) === expTotal)

  const alloc = await rest<Record<string, unknown>>(`stock_allocation?work_order_id=eq.${woId}&select=quantity,released_at`)
  const pos2 = (await rest<Record<string, unknown>>(`inventory?user_id=eq.${userId}&part_id=eq.${part.id}&select=on_hand`))[0]
  console.log(`         allocation: ${alloc.map(a => `${a.quantity} (released ${a.released_at ?? 'no'})`).join(', ')}; on_hand ${pos2?.on_hand}`)
  check(F, 'allocated 2 to the open job, on hand still 3', alloc.length === 1 && Number(alloc[0].quantity) === WO_QTY && !alloc[0].released_at && Number(pos2?.on_hand) === 3)
  const mid = await c.api('GET', `/api/parts/counter?scope=${scope}&q=${PART_NUMBER}`)
  const midStock = ((((mid.json.results ?? []) as Array<Record<string, unknown>>)[0]?.stock) ?? {}) as Record<string, number>
  check(F, 'counter: 3 on hand, 2 on jobs, 1 available', midStock.on_hand === 3 && midStock.allocated === 2 && midStock.available === 1,
    `${midStock.on_hand} / ${midStock.allocated} / ${midStock.available}`)

  // ── 4. convert to an invoice, the way the work order screen does ─────────
  const built = await c.api('GET', `/api/hd/work-orders/${woId}/convert`)
  if (!check(F, 'the converter builds a payload', built.status === 200, `-> ${built.status} ${JSON.stringify(built.json).slice(0, 140)}`)) return
  const payload = built.json.invoice_payload as Record<string, unknown>
  const pLine = ((payload.line_items ?? []) as Array<Record<string, unknown>>).find(l => l.part_number === PART_NUMBER)
  const created = await c.api('POST', '/api/hd/invoices', payload)
  const invId = String(((created.json.invoice ?? {}) as Record<string, unknown>).id ?? '')
  if (typeof created.json.customer_id === 'string') made.customers.push(created.json.customer_id)
  if (!check(F, 'the invoice is created', created.status === 201 && !!invId, `-> ${created.status} ${JSON.stringify(created.json).slice(0, 140)}`)) return
  made.invoices.push(invId)

  const inv = (await rest<Record<string, unknown>>(`hd_invoices?id=eq.${invId}&select=invoice_number,line_items,subtotal_parts,subtotal_labor,parts_cost,tax_rate,tax_amount,total`))[0]
  const iLine = ((inv?.line_items ?? []) as Array<Record<string, unknown>>).find(l => l.part_number === PART_NUMBER)
  console.log(`         payload line:  unit_cost (SELL) ${usd(pLine?.unit_cost)}, unit_cost_base (COST) ${usd(pLine?.unit_cost_base)}, qty ${pLine?.quantity}`)
  console.log(`         invoice ${inv?.invoice_number}: line unit_cost (SELL) ${usd(iLine?.unit_cost)}, unit_cost_base (COST) ${usd(iLine?.unit_cost_base)}, qty ${iLine?.quantity}, amount ${usd(iLine?.amount ?? iLine?.total)}`)
  console.log(`         invoice totals: parts ${usd(inv?.subtotal_parts)}, labor ${usd(inv?.subtotal_labor)}, parts_cost ${usd(inv?.parts_cost)}, tax ${inv?.tax_rate}% = ${usd(inv?.tax_amount)}, total ${usd(inv?.total)}`)
  check(F, `invoice line: sell ${usd(expSell)} in unit_cost, cost $12.34 in unit_cost_base`,
    Number(iLine?.unit_cost) === expSell && Number(iLine?.unit_cost_base) === RECEIVE_COST)
  check(F, `invoice parts subtotal ${usd(expTotal)}, parts cost ${usd(RECEIVE_COST * WO_QTY)}`,
    Number(inv?.subtotal_parts) === expTotal && Number(inv?.parts_cost) === Math.round(RECEIVE_COST * WO_QTY * 100) / 100)
  const expTax = Math.round(expTotal * Number(inv?.tax_rate ?? 0)) / 100
  check(F, `invoice total = parts + tax (${usd(expTotal)} + ${usd(inv?.tax_amount)})`,
    Math.round((Number(inv?.subtotal_parts) + Number(inv?.subtotal_labor ?? 0) + Number(inv?.tax_amount)) * 100) / 100 === Number(inv?.total),
    `tax at the recorded rate would be ${usd(expTax)}`)

  // ── 5. the shelf after the invoice ───────────────────────────────────────
  const inv3 = (await rest<Record<string, unknown>>(`inventory?user_id=eq.${userId}&part_id=eq.${part.id}&select=on_hand,last_cost`))[0]
  const alloc3 = await rest<Record<string, unknown>>(`stock_allocation?work_order_id=eq.${woId}&select=quantity,released_at,released_reason`)
  const mv3 = await rest<Record<string, unknown>>(`stock_movement?user_id=eq.${userId}&part_id=eq.${part.id}&select=delta,reason,unit_cost,source_ref&order=created_at`)
  console.log(`         after invoice: on_hand ${inv3?.on_hand}, last_cost ${usd(inv3?.last_cost)}; allocation released: ${alloc3.map(a => a.released_reason).join(',')}`)
  console.log(`         ledger: ${mv3.map(m => `${m.reason} ${m.delta} @ ${usd(m.unit_cost)} ref ${m.source_ref}`).join('; ')}`)
  check(F, 'deducted: on hand 1, last cost unchanged at $12.34', Number(inv3?.on_hand) === 1 && Number(inv3?.last_cost) === RECEIVE_COST)
  check(F, 'the allocation is released as invoiced', alloc3.length === 1 && !!alloc3[0].released_at && alloc3[0].released_reason === 'invoiced')
  const used = mv3.find(m => m.reason === 'used')
  check(F, 'ledger: one used movement, -2, against the invoice', !!used && Number(used.delta) === -WO_QTY && used.source_ref === inv?.invoice_number)
  // The movement records the COST the part was billed against (unit_cost_base), never the
  // sell price. Before Oct 28 it recorded the sell price here.
  check(F, `ledger: the used movement records the COST ${usd(RECEIVE_COST)}, not the sell ${usd(expSell)}`,
    Number(used?.unit_cost) === RECEIVE_COST, `recorded ${usd(used?.unit_cost)}`)
  const hist = await c.api('GET', `/api/parts/stock?part_id=${part.id}`)
  const histUsed = ((hist.json.movements ?? []) as Array<Record<string, unknown>>).find(m => m.reason === 'used')
  check(F, 'inventory history shows that cost on the used movement', Number(histUsed?.unit_cost) === RECEIVE_COST, `shown ${usd(histUsed?.unit_cost)}`)
  const after = await c.api('GET', `/api/parts/counter?scope=${scope}&q=${PART_NUMBER}`)
  const afterStock = ((((after.json.results ?? []) as Array<Record<string, unknown>>)[0]?.stock) ?? {}) as Record<string, number>
  check(F, 'counter: 1 on hand, 0 on jobs, 1 available', afterStock.on_hand === 1 && afterStock.allocated === 0 && afterStock.available === 1,
    `${afterStock.on_hand} / ${afterStock.allocated} / ${afterStock.available}`)
}

async function cleanup(userId: string, made: Made, partNumber: string): Promise<void> {
  const part = (await rest<{ id: string }>(`parts?part_number=eq.${partNumber}&select=id`))[0]
  for (const id of made.invoices) await del(`hd_invoices?id=eq.${id}&user_id=eq.${userId}`)
  for (const id of made.workOrders) {
    await del(`stock_allocation?work_order_id=eq.${id}&user_id=eq.${userId}`)
    await del(`hd_work_order_line_items?work_order_id=eq.${id}`)
    await del(`hd_work_orders?id=eq.${id}&user_id=eq.${userId}`)
  }
  // Any customer the walk logged (the work order or the invoice may each log one),
  // found by account + marker + time, so nothing older is ever touched.
  for (const cRow of await rest<{ id: string }>(`customers?user_id=eq.${userId}&created_at=gte.${encodeURIComponent(made.walkStart)}&first_name=like.${MARK}*&select=id`).catch(() => [])) {
    if (!made.customers.includes(cRow.id)) made.customers.push(cRow.id)
  }
  for (const id of made.customers) {
    const cRow = (await rest<Record<string, unknown>>(`customers?id=eq.${id}&select=first_name,company_name,created_at`))[0]
    // Only a customer this walk made: carries the marker and was created during the walk.
    if (cRow && [cRow.first_name, cRow.company_name].some(v => String(v ?? '').startsWith(MARK)) && String(cRow.created_at) >= made.walkStart) {
      await del(`customers?id=eq.${id}`)
    }
  }
  if (part) {
    // The walk's own ledger rows (this part, this account, since the walk began), then
    // the stock row they created - it did not exist before the walk (checked at the start).
    await del(`stock_movement?user_id=eq.${userId}&part_id=eq.${part.id}&created_at=gte.${encodeURIComponent(made.walkStart)}`)
    await del(`inventory?user_id=eq.${userId}&part_id=eq.${part.id}`)
  }
  if (made.locationCreated) await del(`stock_location?id=eq.${made.locationCreated}&user_id=eq.${userId}`)
}

async function main() {
  console.log(`\nPARTS WALK against ${BASE}\n`)

  // ── HD ──────────────────────────────────────────────────────────────────
  const hdMade: Made = { workOrders: [], invoices: [], customers: [], locationCreated: null, walkStart: new Date().toISOString() }
  try {
    const s = await openSession(OWNER)
    await walk('HD    ', OWNER, s.cookie, '/hd', hdMade)
  } finally {
    await cleanup(OWNER, hdMade, PART_NUMBER)
    const left = await rest(`stock_movement?user_id=eq.${OWNER}&select=id`)
    const leftInv = await rest(`inventory?user_id=eq.${OWNER}&select=id`)
    check('HD    ', 'cleanup: no ledger or stock row left on the account', left.length === 0 && leftInv.length === 0, `${left.length} movement(s), ${leftInv.length} stock row(s)`)
  }

  // ── Reefer Standalone ───────────────────────────────────────────────────
  console.log('')
  const email = `smoke-reefer-${Date.now()}@example.com`
  const mk = await fetch(`${SUPA}/auth/v1/admin/users`, {
    method: 'POST', headers: SVC_H,
    body: JSON.stringify({ email, password: `Smk-${Date.now()}-x9!`, email_confirm: true,
      user_metadata: { full_name: `${MARK} reefer walk`, business_name: `${MARK} Reefer Walk` } }),
  })
  const u = await mk.json() as { id?: string }
  if (!check('Reefer', 'a throwaway reefer_standalone account is created', mk.ok && !!u.id)) return finish()
  const uid = u.id!
  const rfMade: Made = { workOrders: [], invoices: [], customers: [], locationCreated: null, walkStart: new Date().toISOString() }
  try {
    const sub = await fetch(`${SUPA}/rest/v1/subscriptions`, {
      method: 'POST', headers: SVC_H,
      body: JSON.stringify({ user_id: uid, tier: 'reefer_standalone', status: 'active', is_comped: false,
        vertical: 'heavy_duty', modules: [...REEFER_STANDALONE_MODULES], cancel_at_period_end: false }),
    })
    if (check('Reefer', 'its reefer_standalone subscription is written', sub.ok)) {
      const s = await openSession(uid)
      await walk('Reefer', uid, s.cookie, '/reefer', rfMade)
    }
  } finally {
    await cleanup(uid, rfMade, PART_NUMBER)
    // Then everything else the account owns, and the account.
    for (const t of ['stock_allocation', 'stock_movement', 'inventory', 'stock_location', 'hd_invoices', 'hd_work_orders', 'customers', 'subscriptions']) {
      if (t === 'hd_work_orders') for (const w of await rest<{ id: string }>(`hd_work_orders?user_id=eq.${uid}&select=id`)) await del(`hd_work_order_line_items?work_order_id=eq.${w.id}`)
      await del(`${t}?user_id=eq.${uid}`)
    }
    const gone = await fetch(`${SUPA}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: SVC_H })
    const left: string[] = []
    for (const t of ['stock_movement', 'inventory', 'stock_location', 'hd_invoices', 'hd_work_orders', 'customers', 'subscriptions']) {
      const n = (await rest(`${t}?user_id=eq.${uid}&select=user_id`)).length
      if (n) left.push(`${t} ${n}`)
    }
    check('Reefer', 'cleanup: the throwaway account and every row it made are gone', gone.ok && left.length === 0, gone.ok ? left.join(', ') : `auth delete -> ${gone.status}`)
  }
  finish()
}

function finish() {
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS')
  if (failed) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
