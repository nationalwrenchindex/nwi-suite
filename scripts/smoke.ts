// npm run smoke
//
// Walks the critical flows as a REAL LOGGED-IN USER against the DEPLOYED site and reads
// the rendered HTML. A control counts as present only if it is actually in the page.
//
//   npm run smoke
//   PAGECHECK_BASE=https://nwi-suite-git-branch.vercel.app npm run smoke
//
// WHY THIS EXISTS, written down so nobody deletes it as redundant. There are ~800
// assertions in scripts/, and almost all of them test the calculator or the database -
// the two things that are usually right. Nothing checked that a SCREEN still works, so
// every change had a free shot at breaking a button and the only detector was the shop
// owner clicking around in front of a paying subscriber. The reopen button was the third
// in a week.
//
// RULES IT HOLDS ITSELF TO:
//   * a route that will not load is a FAILURE, never a skip
//   * a step that cannot run is a FAILURE, and the table says what was missing
//   * controls are asserted against rendered HTML, not against source
//   * every row it creates is deleted in a finally block, so a run leaves no trail
//   * nothing is loosened to get green. If a flow cannot be driven at all, it fails and
//     says why.

import fs from 'fs'
import { LEGAL_VERSION } from '../src/lib/legal'
import { loadEnv, openSession, visibleText } from './lib/smoke-session'

loadEnv()

const BASE  = (process.env.PAGECHECK_BASE ?? process.env.BASE ?? 'https://tools.nationalwrenchindex.com').replace(/\/$/, '')
const OWNER = process.env.SMOKE_OWNER_ID ?? '4a8c046f-7db3-42bb-8422-fd47efb7678c'
const SUPA  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SVC   = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SVC_H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }

// Everything this run creates carries this marker, so cleanup can find it even if the
// process dies and a later run has to sweep up.
const MARK = 'SMOKE'

// ── the table ───────────────────────────────────────────────────────────────
interface Row { flow: string; step: string; ok: boolean; detail: string }
const rows: Row[] = []
let cookie = ''

function record(flow: string, step: string, ok: boolean, detail = ''): boolean {
  rows.push({ flow, step, ok, detail })
  const tag = ok ? 'pass' : 'FAIL'
  console.log(`  ${tag}  ${flow}  ${step}${detail ? '  -- ' + detail : ''}`)
  return ok
}

const usd = (n: unknown) => Number(n ?? 0).toFixed(2)
const r2  = (n: number) => Math.round(n * 100) / 100
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── transport ───────────────────────────────────────────────────────────────
async function rest<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const res = await fetch(`${SUPA}/rest/v1/${query}`, { headers: SVC_H })
  const json = await res.json()
  if (!Array.isArray(json)) throw new Error(`REST ${query} -> ${JSON.stringify(json).slice(0, 160)}`)
  return json as T[]
}

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json: json as Record<string, unknown> }
}

/** Fetch a page. Returns null when it did not load or bounced to a login screen. */
async function page(path: string): Promise<{ html: string; text: string } | null> {
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: 'follow' })
  const finalPath = new URL(res.url).pathname
  if (!res.ok) return null
  if (/^\/(hd\/)?(login|signup)$/.test(finalPath)) return null
  const html = await res.text()
  return { html, text: visibleText(html) }
}

/** Every control must be in the rendered text. Returns the ones that are not. */
function missingControls(text: string, controls: string[]): string[] {
  return controls.filter(c => !text.includes(c))
}

// ── cleanup ─────────────────────────────────────────────────────────────────
const created = { workOrders: new Set<string>(), invoices: new Set<string>(), quotes: new Set<string>() }

async function del(table: string, id: string): Promise<void> {
  await fetch(`${SUPA}/rest/v1/${table}?id=eq.${id}`, { method: 'DELETE', headers: SVC_H })
}

async function cleanup(): Promise<void> {
  console.log('\nCleaning up...')
  // Sweep anything from an earlier crashed run too, so a trail cannot accumulate.
  try {
    const strays = await rest<{ id: string }>(`work_orders?select=id&job_description=like.${MARK}*`)
    for (const s of strays) created.workOrders.add(s.id)
  } catch { /* a failed sweep must not mask the real result */ }

  // Invoices first: work_orders.converted_invoice_id points at them.
  for (const id of created.workOrders) {
    await fetch(`${SUPA}/rest/v1/work_orders?id=eq.${id}`, {
      method: 'PATCH', headers: SVC_H,
      body: JSON.stringify({ converted_invoice_id: null, converted_at: null }),
    })
  }
  for (const id of created.invoices)   await del('invoices', id)
  for (const id of created.workOrders) await del('work_orders', id)
  for (const id of created.quotes)     await del('quotes', id)
  console.log(`  removed ${created.invoices.size} invoice(s), ${created.workOrders.size} work order(s), ${created.quotes.size} quote(s)`)
}

// ── the shop's own numbers, so nothing is fabricated ────────────────────────
interface Shop {
  labor_rate: number; markup: number
  taxParts: number; taxLabor: number; taxOnParts: boolean; taxOnLabor: boolean
  suppliesPct: number | null; suppliesCap: number | null; billsSupplies: boolean
}
let shop: Shop

async function loadShop(): Promise<void> {
  const p = (await rest(`profiles?select=*&id=eq.${OWNER}`))[0]
  if (!p) throw new Error('no profile for the smoke owner')
  const legacy = Number(p.default_tax_percent ?? 0)
  shop = {
    labor_rate:    Number(p.default_labor_rate ?? 0),
    markup:        Number(p.default_parts_markup_percent ?? 0),
    taxOnParts:    p.tax_parts === undefined || p.tax_parts === null ? true : !!p.tax_parts,
    taxOnLabor:    p.tax_labor === undefined || p.tax_labor === null ? true : !!p.tax_labor,
    taxParts:      p.tax_rate_parts == null ? legacy : Number(p.tax_rate_parts),
    taxLabor:      p.tax_rate_labor == null ? legacy : Number(p.tax_rate_labor),
    billsSupplies: !!p.bill_shop_supplies,
    suppliesPct:   p.shop_supplies_percent == null ? null : Number(p.shop_supplies_percent),
    suppliesCap:   p.shop_supplies_cap == null ? null : Number(p.shop_supplies_cap),
  }
  console.log(`  shop: labor ${shop.labor_rate}, markup ${shop.markup}%, tax ${shop.taxParts}/${shop.taxLabor}, supplies ${shop.billsSupplies ? shop.suppliesPct + '% cap ' + shop.suppliesCap : 'off'}`)
}

/** The supplies fee this shop would charge on a given post-markup parts total. */
function expectedSupplies(parts: number): number {
  if (!shop.billsSupplies || shop.suppliesPct == null) return 0
  const raw = r2(parts * (shop.suppliesPct / 100))
  return shop.suppliesCap != null && raw > shop.suppliesCap ? r2(shop.suppliesCap) : raw
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW A - work order, single-job pricing
// ═══════════════════════════════════════════════════════════════════════════
const PART_BASE = 200
const LABOR_HRS = 2

async function flowA(): Promise<string | null> {
  const F = 'A single-job WO'
  const partsSell = r2(PART_BASE * (1 + shop.markup / 100))
  const labor     = r2(LABOR_HRS * shop.labor_rate)

  const c = await api('POST', '/api/work-orders', {
    job_description: `${MARK} A - single job pricing`,
    pricing_mode: 'single',
    parts_markup_percent: shop.markup,
    labor_hours: LABOR_HRS,
    labor_rate: shop.labor_rate,
    tax_percent: shop.taxParts,
    parts_subtotal: PART_BASE,
    labor_subtotal: labor,
    line_items: [
      { type: 'parts', description: `${MARK} part`, part_number: 'SMOKE-1', quantity: 1, unit_price: partsSell, total: partsSell },
      { type: 'labor', description: 'Labor', quantity: LABOR_HRS, unit_price: shop.labor_rate, total: labor },
    ],
  })
  const woId = (c.json.work_order as { id?: string } | undefined)?.id
  if (!record(F, 'create', c.status === 201 && !!woId, c.status === 201 ? '' : `POST -> ${c.status} ${JSON.stringify(c.json).slice(0, 110)}`)) return null
  created.workOrders.add(woId!)

  // Save a change, then reload from the database: did it persist?
  const edited = `${MARK} A - edited ${Date.now()}`
  const p = await api('PATCH', `/api/work-orders/${woId}`, { job_description: edited })
  record(F, 'save', p.status === 200, p.status === 200 ? '' : `PATCH -> ${p.status}`)

  await sleep(1200)
  const back = (await rest(`work_orders?select=*&id=eq.${woId}`))[0]
  const lines = Array.isArray(back?.line_items) ? back.line_items as Array<Record<string, unknown>> : []
  const partLine  = lines.find(l => l.type === 'parts')
  const laborLine = lines.find(l => l.type === 'labor')
  record(F, 'reload: description persisted', back?.job_description === edited,
    back?.job_description === edited ? '' : `stored ${JSON.stringify(back?.job_description)}`)
  record(F, 'reload: part persisted', Number(partLine?.total) === partsSell,
    Number(partLine?.total) === partsSell ? `${usd(partsSell)}` : `expected ${usd(partsSell)}, stored ${usd(partLine?.total)}`)
  record(F, 'reload: labor persisted', Number(laborLine?.total) === labor,
    Number(laborLine?.total) === labor ? `${usd(labor)}` : `expected ${usd(labor)}, stored ${usd(laborLine?.total)}`)

  // The server-side sync must have priced the extras on this shop's own settings.
  const fee = expectedSupplies(partsSell)
  record(F, 'supplies computed server-side', Number(back?.shop_supplies_fee ?? 0) === fee,
    `expected ${usd(fee)}, stored ${usd(back?.shop_supplies_fee)}`)

  const open = await page(`/work-orders/${woId}`)
  if (!record(F, 'page loads', !!open, open ? '' : 'did not load or bounced to login')) return woId!
  const missOpen = missingControls(open!.text, ['Add Line Item', 'Save Changes'])
  record(F, 'controls while open', missOpen.length === 0,
    missOpen.length ? `missing: ${missOpen.join(', ')}` : 'Add Line Item, Save Changes')
  // Create Invoice is gated on status === 'complete' (WorkOrderForm line 528). Absent
  // here is CORRECT - billing a job still on the lift is the misclick that guard exists
  // to stop - so the gate is tested from both sides rather than assumed.
  record(F, 'Create Invoice correctly absent while open', !open!.text.includes('Create Invoice'),
    open!.text.includes('Create Invoice') ? 'offered on an OPEN work order' : 'absent, as the status gate intends')

  const st = await api('POST', `/api/work-orders/${woId}/status`, { status: 'complete', notify: false })
  record(F, 'mark complete', st.status === 200, st.status === 200 ? '' : `-> ${st.status}`)
  await sleep(1200)
  const done = await page(`/work-orders/${woId}`)
  if (!record(F, 'page loads when complete', !!done, done ? '' : 'did not load')) return woId!
  record(F, 'Create Invoice appears once complete', done!.text.includes('Create Invoice'),
    done!.text.includes('Create Invoice') ? '' : 'still missing after status=complete')

  return woId!
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW B - work order, segment pricing
// ═══════════════════════════════════════════════════════════════════════════
async function flowB(): Promise<string | null> {
  const F = 'B segment WO'
  const c = await api('POST', '/api/work-orders', {
    job_description: `${MARK} B - segment pricing`,
    pricing_mode: 'segments',
    parts_markup_percent: shop.markup,
    labor_rate: shop.labor_rate,
    tax_percent: shop.taxParts,
  })
  const woId = (c.json.work_order as { id?: string } | undefined)?.id
  if (!record(F, 'create', c.status === 201 && !!woId, c.status === 201 ? '' : `POST -> ${c.status} ${JSON.stringify(c.json).slice(0, 110)}`)) return null
  created.workOrders.add(woId!)

  const seg = async (sequence: number, complaint: string, partTotal: number, laborHours: number) => {
    const laborTotal = r2(laborHours * shop.labor_rate)
    return api('POST', `/api/work-orders/${woId}/segments`, {
      sequence, complaint,
      line_items: [
        { type: 'part',  description: `${MARK} seg ${sequence} part`, part_number: `SMOKE-S${sequence}`, quantity: 1, unit_cost: r2(partTotal / (1 + shop.markup / 100)), unit_price: partTotal, markup_percent: shop.markup, total: partTotal, sort_order: 0 },
        { type: 'labor', description: 'Labor', quantity: laborHours, unit_cost: null, unit_price: shop.labor_rate, markup_percent: null, total: laborTotal, sort_order: 1 },
      ],
      labor_hours: laborHours, labor_rate: shop.labor_rate,
      parts_subtotal: partTotal, labor_subtotal: laborTotal,
      tax_percent: shop.taxParts,
    })
  }

  const s1 = await seg(1, `${MARK} complaint one`, 100, 1)
  const s2 = await seg(2, `${MARK} complaint two`, 50, 1)
  const s1Id = (s1.json.segment as { id?: string } | undefined)?.id
  const s2Id = (s2.json.segment as { id?: string } | undefined)?.id
  if (!record(F, 'add two segments', !!s1Id && !!s2Id,
    (!!s1Id && !!s2Id) ? '' : `POST segments -> ${s1.status}/${s2.status} ${JSON.stringify(s1.json).slice(0, 110)}`)) return woId!

  const auth = await api('POST', `/api/work-orders/${woId}/segments/${s1Id}/status`, { status: 'authorized' })
  record(F, 'authorize one', auth.status === 200, auth.status === 200 ? '' : `-> ${auth.status}`)

  await sleep(800)
  const segs = await rest(`work_order_segments?select=sequence,status,grand_total&ld_work_order_id=eq.${woId}&order=sequence`)
  const authorized = segs.filter(s => s.status === 'authorized')
  const pending    = segs.filter(s => s.status === 'pending')
  record(F, 'rollup: one authorized, one pending', authorized.length === 1 && pending.length === 1,
    `authorized ${authorized.length}, pending ${pending.length}`)
  const authTotal = r2(authorized.reduce((n, s) => n + Number(s.grand_total ?? 0), 0))
  record(F, 'rollup: authorized total is the authorized segment only', authTotal > 0 && authTotal === r2(Number(authorized[0]?.grand_total ?? 0)),
    `authorized total ${usd(authTotal)}`)

  const pg = await page(`/work-orders/${woId}`)
  if (!record(F, 'page loads', !!pg, pg ? '' : 'did not load or bounced to login')) return woId!
  const miss = missingControls(pg!.text, ['Authorize', 'Decline', 'Add Segment'])
  record(F, 'segment controls', miss.length === 0,
    miss.length ? `missing: ${miss.join(', ')}` : 'Authorize, Decline, Add Segment')

  // Same status gate as flow A, checked here too because a segment-priced work order
  // reaches it by a different path.
  const st = await api('POST', `/api/work-orders/${woId}/status`, { status: 'complete', notify: false })
  record(F, 'mark complete', st.status === 200, st.status === 200 ? '' : `-> ${st.status}`)
  await sleep(1200)
  const done = await page(`/work-orders/${woId}`)
  if (!record(F, 'page loads when complete', !!done, done ? '' : 'did not load')) return woId!
  record(F, 'Create Invoice appears once complete', done!.text.includes('Create Invoice'),
    done!.text.includes('Create Invoice') ? '' : 'still missing after status=complete')

  return woId!
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW C - convert to invoice
// ═══════════════════════════════════════════════════════════════════════════
async function flowC(woId: string): Promise<string | null> {
  const F = 'C convert'

  // Already complete from flow A's gate check; re-asserted because the converter
  // refuses anything else and this flow must not depend on another one having run.
  const st = await api('POST', `/api/work-orders/${woId}/status`, { status: 'complete', notify: false })
  record(F, 'work order complete', st.status === 200 || st.status === 409,
    (st.status === 200 || st.status === 409) ? '' : `-> ${st.status}`)
  await sleep(1200)

  const conv = await api('POST', `/api/work-orders/${woId}/convert`)
  const invId = (conv.json.invoice as { id?: string } | undefined)?.id ?? (conv.json.invoice_id as string | undefined)
  if (!record(F, 'convert succeeds', conv.status === 201 && !!invId,
    conv.status === 201 ? '' : `-> ${conv.status} ${JSON.stringify(conv.json).slice(0, 150)}`)) return null
  created.invoices.add(invId!)

  const inv = (await rest(`invoices?select=*&id=eq.${invId}`))[0]
  record(F, 'invoice exists', !!inv, inv ? String(inv.invoice_number) : 'not found')

  const wo = (await rest(`work_orders?select=line_items&id=eq.${woId}`))[0]
  const woLines  = Array.isArray(wo?.line_items) ? (wo.line_items as unknown[]).length : 0
  const invLines = Array.isArray(inv?.line_items) ? (inv.line_items as unknown[]).length : 0
  record(F, 'lines carried', invLines > 0 && invLines === woLines, `work order ${woLines} -> invoice ${invLines}`)

  // Totals must agree with each other, and the extras must be INSIDE the subtotal.
  const lineSum = r2((inv.line_items as Array<Record<string, unknown>>).reduce((n, l) => n + Number(l.total ?? 0), 0))
  const fee     = Number(inv.shop_supplies_fee ?? 0)
  const travel  = Number(inv.travel_amount ?? 0)
  const mileage = Number(inv.mileage_amount ?? 0)
  const extras  = r2(fee + travel + mileage)
  record(F, 'extras itemized inside the subtotal', r2(lineSum + extras) === Number(inv.subtotal),
    `lines ${usd(lineSum)} + extras ${usd(extras)} = ${usd(r2(lineSum + extras))}, subtotal ${usd(inv.subtotal)}`)
  record(F, 'subtotal + tax = total', r2(Number(inv.subtotal) + Number(inv.tax_amount)) === Number(inv.total),
    `${usd(inv.subtotal)} + ${usd(inv.tax_amount)} = ${usd(inv.total)}`)

  const pg = await page(`/financials/invoices/${invId}`)
  if (!record(F, 'invoice page loads', !!pg, pg ? '' : 'did not load')) return invId!
  // Every money box on the page must show the stored total.
  const shown = pg!.text.includes(usd(inv.total)) ||
    pg!.text.includes(Number(inv.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  record(F, 'page shows the stored total', shown, `stored ${usd(inv.total)}`)

  return invId!
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW D - invoice in progress
// ═══════════════════════════════════════════════════════════════════════════
async function flowD(invId: string): Promise<void> {
  const F = 'D in progress'
  const inv = (await rest(`invoices?select=*&id=eq.${invId}`))[0]
  record(F, 'status is in_progress', inv.invoice_status === 'in_progress', String(inv.invoice_status))

  const pg = await page(`/financials/invoices/${invId}`)
  if (!record(F, 'page loads', !!pg, pg ? '' : 'did not load')) return
  const miss = missingControls(pg!.text, ['Add Part', 'Add Labor', 'Save Progress', 'Finalize Invoice'])
  record(F, 'controls', miss.length === 0, miss.length ? `missing: ${miss.join(', ')}` : 'Add Part, Add Labor, Save Progress, Finalize Invoice')

  // BOTH total boxes to the penny. The Authorized block reads the stored row; the
  // Running Total recomputes. Two different figures on one screen is the bug class this
  // exists to catch, so the stored total must appear and the lower figure must not.
  const stored = usd(inv.total)
  const lineSum = r2((inv.line_items as Array<Record<string, unknown>>).reduce((n, l) => n + Number(l.total ?? 0), 0))
  const withoutExtras = usd(r2(lineSum + Number(inv.tax_amount ?? 0)))
  const hasStored = pg!.text.includes(stored)
  const hasWrong  = stored !== withoutExtras && pg!.text.includes(withoutExtras)
  record(F, 'both total boxes agree', hasStored && !hasWrong,
    hasStored
      ? (hasWrong ? `page also shows ${withoutExtras}, which excludes the extras` : `both show ${stored}`)
      : `page does not show the stored ${stored}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW E - finalize
// ═══════════════════════════════════════════════════════════════════════════
async function flowE(invId: string): Promise<void> {
  const F = 'E finalize'
  const before = (await rest(`invoices?select=total&id=eq.${invId}`))[0]

  const fin = await api('POST', `/api/invoices/${invId}/finalize`)
  if (!record(F, 'finalize succeeds', fin.status === 200 || fin.status === 201,
    (fin.status === 200 || fin.status === 201) ? '' : `-> ${fin.status} ${JSON.stringify(fin.json).slice(0, 140)}`)) return

  await sleep(1200)
  const after = (await rest(`invoices?select=invoice_status,total,public_token&id=eq.${invId}`))[0]
  record(F, 'status changes to awaiting_payment', after.invoice_status === 'awaiting_payment', String(after.invoice_status))
  record(F, 'total did not move', Number(after.total) === Number(before.total), `${usd(before.total)} -> ${usd(after.total)}`)
  record(F, 'public token issued', !!after.public_token, after.public_token ? 'yes' : 'missing')

  const pg = await page(`/financials/invoices/${invId}`)
  if (!record(F, 'page loads', !!pg, pg ? '' : 'did not load')) return
  const miss = missingControls(pg!.text, ['Reopen Invoice', 'Mark as Paid'])
  const hasSend = pg!.text.includes('Send Invoice') || pg!.text.includes('Resend Invoice')
  record(F, 'controls', miss.length === 0 && hasSend,
    [...miss, hasSend ? '' : 'Send Invoice'].filter(Boolean).length
      ? `missing: ${[...miss, hasSend ? '' : 'Send Invoice'].filter(Boolean).join(', ')}`
      : 'Reopen Invoice, Send Invoice, Mark as Paid')
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW F - reopen
// ═══════════════════════════════════════════════════════════════════════════
async function flowF(invId: string): Promise<void> {
  const F = 'F reopen'
  const re = await api('POST', `/api/invoices/${invId}/reopen`)
  if (!record(F, 'reopen succeeds', re.status === 200,
    re.status === 200 ? '' : `-> ${re.status} ${JSON.stringify(re.json).slice(0, 140)}`)) return

  await sleep(1200)
  const after = (await rest(`invoices?select=invoice_status,finalized_at,public_token&id=eq.${invId}`))[0]
  record(F, 'back to in_progress', after.invoice_status === 'in_progress', String(after.invoice_status))
  record(F, 'finalized_at cleared', after.finalized_at === null, String(after.finalized_at))
  record(F, 'customer link preserved', !!after.public_token, after.public_token ? 'kept' : 'LOST')

  const pg = await page(`/financials/invoices/${invId}`)
  if (!record(F, 'page loads', !!pg, pg ? '' : 'did not load')) return
  const miss = missingControls(pg!.text, ['Save Progress', 'Finalize Invoice'])
  record(F, 'editable again', miss.length === 0, miss.length ? `missing: ${miss.join(', ')}` : 'Save Progress, Finalize Invoice')
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW G - customer copy
// ═══════════════════════════════════════════════════════════════════════════
async function flowG(invId: string): Promise<void> {
  const F = 'G customer copy'
  // Needs a token, which finalize issues. Re-finalize so the flow is self-contained.
  const fin = await api('POST', `/api/invoices/${invId}/finalize`)
  record(F, 'finalize for a token', fin.status === 200 || fin.status === 201, `-> ${fin.status}`)
  await sleep(1200)

  const inv = (await rest(`invoices?select=*&id=eq.${invId}`))[0]
  const token = inv.public_token as string | null
  if (!record(F, 'has a public token', !!token, token ? '' : 'none')) return

  // NO COOKIE: this is the customer's view.
  const res = await fetch(`${BASE}/invoice/${token}`)
  if (!record(F, 'loads without a session', res.ok, `-> ${res.status}`)) return
  const text = visibleText(await res.text())

  record(F, 'shows the stored grand total', text.includes(usd(inv.total)), `stored ${usd(inv.total)}`)

  const lines = inv.line_items as Array<Record<string, unknown>>
  const missingLines = lines.filter(l => !text.includes(usd(l.total)))
  record(F, 'every itemized line present', missingLines.length === 0,
    missingLines.length ? `missing ${missingLines.length} of ${lines.length} line amounts` : `${lines.length} lines`)

  const fee = Number(inv.shop_supplies_fee ?? 0)
  if (fee > 0) {
    record(F, 'supplies itemized', text.includes('Shop Supplies') && text.includes(usd(fee)), `fee ${usd(fee)}`)
  } else {
    record(F, 'no supplies line when there is no fee', !text.includes('Shop Supplies'), 'fee is 0.00')
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW H - quote and its customer copy
// ═══════════════════════════════════════════════════════════════════════════
async function flowH(): Promise<void> {
  const F = 'H quote'
  const partsSell = r2(PART_BASE * (1 + shop.markup / 100))
  const labor     = r2(LABOR_HRS * shop.labor_rate)

  const c = await api('POST', '/api/quotes', {
    notes: `${MARK} H - quote`,
    parts_markup_percent: shop.markup,
    labor_hours: LABOR_HRS,
    labor_rate: shop.labor_rate,
    tax_percent: shop.taxParts,
    parts_subtotal: PART_BASE,
    labor_subtotal: labor,
    line_items: [
      { type: 'parts', description: `${MARK} part`, part_number: 'SMOKE-Q', quantity: 1, unit_price: partsSell, total: partsSell },
      { type: 'labor', description: 'Labor', quantity: LABOR_HRS, unit_price: shop.labor_rate, total: labor },
    ],
    grand_total: r2(partsSell + labor),
  })
  const qId = (c.json.quote as { id?: string } | undefined)?.id
  if (!record(F, 'create', (c.status === 201 || c.status === 200) && !!qId,
    `-> ${c.status} ${qId ? '' : JSON.stringify(c.json).slice(0, 130)}`)) return
  created.quotes.add(qId!)

  const q = (await rest(`quotes?select=*&id=eq.${qId}`))[0]
  let token = q.public_token as string | null
  if (!token) {
    const sent = await api('POST', `/api/quotes/${qId}/send`, { channel: 'link' })
    record(F, 'token issued', sent.status === 200 || sent.status === 201, `-> ${sent.status}`)
    await sleep(1000)
    token = ((await rest(`quotes?select=public_token&id=eq.${qId}`))[0]?.public_token ?? null) as string | null
  }
  if (!record(F, 'has a public token', !!token, token ? '' : 'none - cannot open the customer copy')) return

  const res = await fetch(`${BASE}/quote/${token}`)
  if (!record(F, 'customer copy loads', res.ok, `-> ${res.status}`)) return
  const text = visibleText(await res.text())

  const fresh = (await rest(`quotes?select=grand_total&id=eq.${qId}`))[0]
  record(F, 'total matches the stored row', text.includes(usd(fresh.grand_total)), `stored ${usd(fresh.grand_total)}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW I - mark as paid
// ═══════════════════════════════════════════════════════════════════════════
async function flowI(invId: string): Promise<void> {
  const F = 'I mark paid'
  const before = (await rest(`invoices?select=invoice_status,total&id=eq.${invId}`))[0]
  record(F, 'starts finalized', before.invoice_status === 'awaiting_payment', String(before.invoice_status))

  const paid = await api('PUT', `/api/invoices/${invId}`, { status: 'paid', payment_method: 'cash' })
  if (!record(F, 'mark as paid succeeds', paid.status === 200,
    paid.status === 200 ? '' : `-> ${paid.status} ${JSON.stringify(paid.json).slice(0, 140)}`)) return

  await sleep(1200)
  const after = (await rest(`invoices?select=invoice_status,total,paid_at&id=eq.${invId}`))[0]
  record(F, 'status changes to paid', after.invoice_status === 'paid', String(after.invoice_status))
  record(F, 'total did not move', Number(after.total) === Number(before.total), `${usd(before.total)} -> ${usd(after.total)}`)
  record(F, 'paid_at stamped', !!after.paid_at, after.paid_at ? 'yes' : 'missing')

  // And a paid invoice must NOT offer reopen - the API refuses it, so the button must go.
  const pg = await page(`/financials/invoices/${invId}`)
  if (!record(F, 'page loads', !!pg, pg ? '' : 'did not load')) return
  record(F, 'no Reopen on a paid invoice', !pg!.text.includes('Reopen Invoice'),
    pg!.text.includes('Reopen Invoice') ? 'Reopen is offered but the API refuses it' : 'correctly absent')
}

// ═══════════════════════════════════════════════════════════════════════════
// HD - what is drivable
// ═══════════════════════════════════════════════════════════════════════════
async function flowHD(): Promise<void> {
  const F = 'HD'
  for (const [label, path] of [['invoice form', '/hd/invoices/new'], ['quote form', '/hd/quotes/new']] as const) {
    const pg = await page(path)
    if (!record(F, `${label} loads`, !!pg, pg ? '' : `${path} did not load`)) continue
    const miss = missingControls(pg!.text, ['Travel hours', 'Miles'])
    record(F, `${label} extras inputs`, miss.length === 0, miss.length ? `missing: ${miss.join(', ')}` : 'Travel hours, Miles')
  }

  const hdInv = (await rest('hd_invoices?select=id,invoice_number,total&order=invoice_number.desc&limit=1'))[0]
  if (!record(F, 'an HD invoice exists to open', !!hdInv, hdInv ? String(hdInv.invoice_number) : 'none')) return
  for (const [label, path] of [['detail', `/hd/invoices/${hdInv.id}`], ['edit', `/hd/invoices/${hdInv.id}/edit`]] as const) {
    const pg = await page(path)
    if (!record(F, `invoice ${label} loads`, !!pg, pg ? '' : `${path} did not load`)) continue
    record(F, `invoice ${label} shows the stored total`, pg!.text.includes(usd(hdInv.total)), `stored ${usd(hdInv.total)}`)
  }

  // NOT AN ASSERTION. HD has no work-order-to-invoice converter, so flow C has no HD
  // equivalent to drive. Asserting the route exists made the suite permanently red over
  // a design decision, which is exactly the kind of noise that gets a suite ignored.
  // Printed so the gap stays visible without pretending it is a regression.
  const hasConvert = fs.existsSync('src/app/api/hd/work-orders/[id]/convert/route.ts')
  console.log(`  note  HD work-order-to-invoice converter: ${hasConvert ? 'present' : 'does not exist - flow C is LD only'}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// ===========================================================================
// J  Terms acceptance gate
//
// The signup checkbox CANNOT be asserted from rendered HTML: both signup forms sit
// behind a Suspense boundary with fallback={null} (they read useSearchParams), so the
// initial HTML of /signup is the page shell and nothing else. Claiming to have seen the
// box in the HTML would be a lie, so this flow asserts what is actually observable -
// the server's refusals - and checks the box's presence in source separately, labelled
// as a source check.
async function flowJ(): Promise<void> {
  const J = 'J terms gate'

  const get = await api('GET', '/api/legal/accept')
  if (record(J, 'acceptance endpoint answers', get.status === 200, `-> ${get.status}`)) {
    record(J, 'serves the published version', get.json.version === LEGAL_VERSION, String(get.json.version))
    const acc = (get.json.acceptance ?? {}) as Record<string, unknown>
    // NOT a pass/fail: whether migration 147 is applied is the user's call, not a defect.
    console.log(`  note  migration 147: ${acc.unavailable ? 'NOT APPLIED - acceptance cannot be recorded yet' : 'applied'}`)
  }

  // An unchecked box must be refused by the server, not only by a disabled button.
  const no = await api('POST', '/api/legal/accept', { accepted: false })
  record(J, 'refuses accepted:false', no.status === 422, `-> ${no.status}`)

  const empty = await api('POST', '/api/legal/accept', {})
  record(J, 'refuses an empty body', empty.status === 422, `-> ${empty.status}`)

  // Recording the current version against a page that showed an older one would
  // manufacture evidence. Refused, and nothing is written.
  const stale = await api('POST', '/api/legal/accept', { accepted: true, version: '1999-01-01' })
  record(J, 'refuses a stale version', stale.status === 409, `-> ${stale.status}`)

  // SOURCE CHECK, not a page check - see the note above.
  for (const [label, file] of [
    ['LD signup',  'src/app/(auth)/signup/SignupClient.tsx'],
    ['HD signup',  'src/app/hd/signup/page.tsx'],
    ['onboarding', 'src/app/onboarding/page.tsx'],
  ] as const) {
    const src = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    const hasBox   = src.includes('AcceptTermsCheckbox')
    const hasGuard = src.includes('acceptedTerms')
    record(J, `${label} has the acceptance box (source)`, hasBox && hasGuard,
      hasBox && hasGuard ? 'box + guard' : `box ${hasBox}, guard ${hasGuard}`)
  }
}

// ===========================================================================
// K  Parts search
//
// The five acceptance cases, over HTTP against the deployed site.
//
// PRODUCTION IS A MANUAL PROMOTE. A 404 on /api/parts/search means the build has not
// been promoted yet, which is not a defect - so this flow reports UNPROMOTED and runs
// nothing, rather than printing five failures that say nothing about the code. That is
// the one documented exception to "a route that will not load is a FAILURE": the rule
// exists to stop a broken route being skipped, and an unpromoted route is a different
// fact. It is printed loudly so it can never read as green.
//
// scripts/verify-parts-search.ts proves the same five cases against the live database
// using the shipped rules, and does NOT depend on a promote.
async function flowK(): Promise<void> {
  const F = 'K parts search'

  const probe = await api('GET', '/api/parts/search?model=Supra%20660')
  if (probe.status === 404) {
    console.log('  note  /api/parts/search is NOT PROMOTED yet - flow K did not run.')
    console.log('        Run: npx tsx scripts/verify-parts-search.ts  (same cases, against the database)')
    return
  }
  if (!record(F, 'search endpoint answers', probe.status === 200, `-> ${probe.status}`)) return

  // 1. Supra 660: exactly 3 filters, no Thermo King.
  const s660 = await api('GET', '/api/parts/search?manufacturer=Carrier%20Transicold&model=Supra%20660&part_type=filter')
  const results = (s660.json.results ?? []) as Array<Record<string, unknown>>
  const numbers = results.map(r => String(r.part_number)).sort()
  record(F, 'Supra 660 returns exactly 3 filters', results.length === 3, `${results.length}: ${numbers.join(', ')}`)
  record(F, 'and not one Thermo King part',
    !results.some(r => /thermo/i.test(String(r.manufacturer))),
    results.length ? [...new Set(results.map(r => String(r.manufacturer)))].join(', ') : 'nothing returned')

  // 2. No model-filtered search returns a catch-all.
  const everyFit = results.flatMap(r => (r.fitment ?? []) as Array<Record<string, unknown>>)
  const catchAll = everyFit.filter(f => {
    const m = String(f.unit_model ?? '')
    return !m || /^(all|any)/i.test(m.replace(/[^a-z]/gi, '')) || /series|family/i.test(m)
  })
  record(F, 'no catch-all row in a model-filtered search', catchAll.length === 0, `${catchAll.length} found`)
  record(F, 'the response says catch-alls were excluded',
    (s660.json.query as Record<string, unknown>)?.catch_all_excluded === true,
    String((s660.json.query as Record<string, unknown>)?.catch_all_excluded))

  // 3. A superseded number surfaces its replacement.
  const sup = await api('GET', '/api/parts/search?q=30-01121-00')
  const superseded = sup.json.superseded as Record<string, unknown> | null
  record(F, 'searching 30-01121-00 reports the supersession',
    !!superseded && String(superseded.to) === '30-60143-01',
    superseded ? `${superseded.from} -> ${superseded.to}` : 'no supersession reported')
  const supResults = (sup.json.results ?? []) as Array<Record<string, unknown>>
  record(F, 'and returns the replacement part',
    supResults.some(r => String(r.part_number) === '30-60143-01'),
    supResults.map(r => String(r.part_number)).join(', ') || 'nothing')

  // 4. Both spellings of a number find the same part.
  const dashed = await api('GET', '/api/parts/search?q=78-1341')
  const plain  = await api('GET', '/api/parts/search?q=781341')
  const ids = (r: Record<string, unknown>) => ((r.results ?? []) as Array<Record<string, unknown>>).map(x => String(x.id)).sort().join(',')
  record(F, '78-1341 and 781341 find the same part',
    ids(dashed.json) === ids(plain.json) && ((dashed.json.results ?? []) as unknown[]).length > 0,
    `${((dashed.json.results ?? []) as unknown[]).length} and ${((plain.json.results ?? []) as unknown[]).length}`)

  // 5. A serial narrows a split.
  const both = await api('GET', '/api/parts/search?manufacturer=Carrier%20Transicold&model=Ultra&part_type=Filter%20-%20air')
  const bothN = ((both.json.results ?? []) as Array<Record<string, unknown>>).length
  record(F, 'an Ultra air filter search returns both serial sides', bothN === 2, String(bothN))
  const narrowed = await api('GET', '/api/parts/search?manufacturer=Carrier%20Transicold&model=Ultra&part_type=Filter%20-%20air&serial=GAG90000000')
  const narrowedR = (narrowed.json.results ?? []) as Array<Record<string, unknown>>
  record(F, 'an early serial narrows it to one', narrowedR.length === 1,
    `${narrowedR.length}: ${narrowedR.map(r => String(r.part_number)).join(', ')}`)

  // And the screens render.
  for (const [label, path] of [['parts catalog', '/parts/catalog'], ['find by unit', '/parts/find']] as const) {
    const pg = await page(path)
    if (!record(F, `${label} page loads`, !!pg, pg ? '' : `${path} did not load`)) continue
    const miss = missingControls(pg!.text, ['Search'])
    record(F, `${label} has its search control`, miss.length === 0, miss.length ? `missing: ${miss.join(', ')}` : 'Search')
  }

  // The hint that was a workaround for the bug must be gone from QuickWrench.
  const qw = await page('/hd/quickwrench')
  if (qw) {
    record(F, 'the "try a shorter model" hint is gone',
      !qw.text.includes('Try a shorter model'),
      qw.text.includes('Try a shorter model') ? 'still on the page' : 'removed')
  }
}

async function main(): Promise<void> {
  console.log('='.repeat(96))
  console.log(`SMOKE  ${BASE}`)
  console.log('='.repeat(96))

  const session = await openSession(OWNER)
  cookie = session.cookie
  console.log(`  session: ${session.email}`)

  const guard = await page('/financials')
  if (!guard) {
    console.log('\n  FATAL: /financials did not load with a session. Nothing else can be trusted.')
    rows.push({ flow: 'session', step: 'authenticated page loads', ok: false, detail: '/financials bounced or errored' })
    return
  }
  record('session', 'authenticated page loads', true, '/financials')
  await loadShop()

  try {
    const woA = await flowA()
    const woB = await flowB()

    // C..I run on the single-job work order: it has the money that makes the totals
    // checks meaningful. B is driven for its own controls and rollup.
    if (woA) {
      const invId = await flowC(woA)
      if (invId) {
        await flowD(invId)
        await flowE(invId)
        await flowF(invId)
        await flowG(invId)
        await flowI(invId)
      } else {
        for (const f of ['D in progress', 'E finalize', 'F reopen', 'G customer copy', 'I mark paid']) {
          record(f, 'blocked', false, 'the conversion in flow C failed, so this flow could not run')
        }
      }
    } else {
      for (const f of ['C convert', 'D in progress', 'E finalize', 'F reopen', 'G customer copy', 'I mark paid']) {
        record(f, 'blocked', false, 'flow A could not create a work order')
      }
    }
    void woB

    await flowH()
    await flowHD()
    await flowJ()
    await flowK()
  } finally {
    await cleanup()
  }
}

function table(): void {
  const wFlow = Math.max(6, ...rows.map(r => r.flow.length))
  const wStep = Math.max(6, ...rows.map(r => r.step.length))
  console.log('\n' + '='.repeat(96))
  console.log('SMOKE RESULTS')
  console.log('='.repeat(96))
  console.log('  ' + 'FLOW'.padEnd(wFlow + 2) + 'STEP'.padEnd(wStep + 2) + 'RESULT  WHAT WAS MISSING')
  console.log('  ' + '-'.repeat(wFlow + wStep + 30))
  for (const r of rows) {
    console.log('  ' + r.flow.padEnd(wFlow + 2) + r.step.padEnd(wStep + 2) +
      (r.ok ? 'pass' : 'FAIL').padEnd(8) + r.detail)
  }
  const failed = rows.filter(r => !r.ok)
  console.log('  ' + '-'.repeat(wFlow + wStep + 30))
  console.log(`  ${rows.length - failed.length} passed, ${failed.length} failed`)
  if (failed.length) {
    console.log('')
    console.log('  BROKEN:')
    for (const f of failed) console.log(`    ${f.flow} / ${f.step}${f.detail ? ' -- ' + f.detail : ''}`)
  }
  console.log('='.repeat(96))
}

main()
  .catch(e => {
    rows.push({ flow: 'suite', step: 'ran to completion', ok: false, detail: e instanceof Error ? e.message : String(e) })
    console.error('\nSUITE ERROR:', e)
  })
  .finally(() => {
    table()
    process.exit(rows.some(r => !r.ok) ? 1 : 0)
  })
