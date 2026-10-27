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
import { invoiceBodyFromQuote } from '../src/lib/hd/quote-to-invoice'
import { billedHoursFromLibrary } from '../src/lib/hd/labor-library'
import { editableLines } from '../src/lib/hd/invoice-edit-lines'
import { stripLeadingZeros, parseFee } from '../src/components/hd/FeeInput'
import { fmtShopDate, shopTimeZone } from '../src/lib/shop-time'
import { fromLineItems, markupOnReopen, type EditItem } from '../src/components/shared/line-items'
import { documentMoney, documentExtras } from '../src/lib/document-money'
import { openInvoiceEdit, invoiceSaveBody, invoiceDoesNotAddUp, correctionBody } from '../src/lib/hd/invoice-edit-save'
import { documentTaxSettings, parseBreakdown, breakdownTaxTotal } from '../src/lib/tax'
import { EXTRAS_OFF, partsBaseFromLines, computeExtras } from '../src/lib/billable-extras'
import { applyDiscount, laborFromLines, normalizeDiscount, parseDiscount, discountPrintLabel } from '../src/lib/document-discount'
import { hdApplyDiscount } from '../src/lib/hd/hd-discount'
import { termsSnapshotFrom, parseTermsSnapshot } from '../src/lib/document-terms'
import { createClient as createSupabase } from '@supabase/supabase-js'
import { REEFER_STANDALONE_MODULES } from '../src/lib/reefer-standalone'
import { loadRollupInput } from '../src/lib/hd/equipment-rollup-load'
import { jobsFor, rollupByCategory, rollupByUnit } from '../src/lib/hd/equipment-rollup'
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
let accessToken = ''

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
  if (/^\/((hd|reefer)\/)?(login|signup)$/.test(finalPath)) return null
  const html = await res.text()
  return { html, text: visibleText(html) }
}

/** Every control must be in the rendered text. Returns the ones that are not. */
function missingControls(text: string, controls: string[]): string[] {
  return controls.filter(c => !text.includes(c))
}

// ── cleanup ─────────────────────────────────────────────────────────────────
const created = {
  workOrders: new Set<string>(), invoices: new Set<string>(), quotes: new Set<string>(),
  // HD approval flow. Separate buckets because they are different tables, and the
  // work order must be deleted BEFORE the quote it points at.
  hdQuotes: new Set<string>(), hdWorkOrders: new Set<string>(),
  hdInvoices: new Set<string>(),
  // HD's own Intel Hub: fleet accounts and the units hanging off them. The units go
  // FIRST, before the account they point at.
  fleetAccounts: new Set<string>(), fleetUnits: new Set<string>(),
  // LD customers this run creates on purpose. Note the suite does NOT sweep
  // customers by marker: logHDCustomer creates one for every HD document, and a
  // blanket delete would reach rows other flows rely on.
  customers: new Set<string>(),
  // HD labor library entries (hd_repair_items).
  libraryItems: new Set<string>(),
  // Equipment categories this run adds (migration 161). Deleted AFTER the units, which
  // are set null by the FK anyway.
  equipmentCategories: new Set<string>(),
  // Flow Rf's throwaway Reefer Standalone accounts (auth user + everything it made).
  // Removed LAST, after every document above, so no foreign key still points at them.
  reeferUsers: new Set<string>(),
}

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
  // A converted quote points at its invoice (flow Dc converts quotes).
  for (const id of created.quotes) {
    await fetch(`${SUPA}/rest/v1/quotes?id=eq.${id}`, {
      method: 'PATCH', headers: SVC_H,
      body: JSON.stringify({ converted_invoice_id: null }),
    })
  }
  for (const id of created.invoices)   await del('invoices', id)
  for (const id of created.workOrders) await del('work_orders', id)
  for (const id of created.quotes)     await del('quotes', id)

  // Flow Tm restores the owner's terms in its own finally. A run killed mid-flow
  // leaves the marker text instead - cleared here, and only fields holding it.
  try {
    const p = (await rest<Record<string, string | null>>(
      `profiles?select=warranty_terms,customer_supplied_parts_clause,pay_link_url&id=eq.${OWNER}`))[0]
    const fix: Record<string, null> = {}
    if (p?.warranty_terms?.startsWith(MARK)) fix.warranty_terms = null
    if (p?.customer_supplied_parts_clause?.startsWith(MARK)) fix.customer_supplied_parts_clause = null
    if (p?.pay_link_url === 'https://pay.example.com/smoke-shop') fix.pay_link_url = null
    if (Object.keys(fix).length) {
      await fetch(`${SUPA}/rest/v1/profiles?id=eq.${OWNER}`, { method: 'PATCH', headers: SVC_H, body: JSON.stringify(fix) })
    }
  } catch { /* a failed sweep must not mask the real result */ }

  // HD approval flow. Sweep strays from a crashed run first, by the marker name.
  try {
    const strays = await rest<{ id: string }>(`hd_quotes?select=id&customer_name=like.${MARK}*`)
    for (const s of strays) created.hdQuotes.add(s.id)
    for (const q of created.hdQuotes) {
      const wos = await rest<{ id: string }>(`hd_work_orders?select=id&quote_id=eq.${q}`)
      for (const w of wos) created.hdWorkOrders.add(w.id)
    }
    // ANY invoice raised against a work order this run created, not just the ids the
    // flows happened to keep. Flow O deliberately tries to bill the same work order
    // twice; while migration 154's unique index is unapplied that second insert
    // SUCCEEDS, and its id was never recorded - so a duplicate invoice was left in
    // production on every run, pointing at a work order that then got deleted.
    for (const w of created.hdWorkOrders) {
      const invs = await rest<{ id: string }>(`hd_invoices?select=id&work_order_id=eq.${w}`)
      for (const i of invs) created.hdInvoices.add(i.id)
    }
    const strayInvoices = await rest<{ id: string }>(`hd_invoices?select=id&customer_name=like.${MARK}*`)
    for (const i of strayInvoices) created.hdInvoices.add(i.id)
  } catch { /* a failed sweep must not mask the real result */ }

  // ORDER MATTERS. Line items reference the work order; the work order references the
  // quote. Deleting the quote first would hit the foreign key - or, worse, succeed via
  // ON DELETE SET NULL and orphan a work order nobody is looking for.
  for (const id of created.hdWorkOrders) {
    await fetch(`${SUPA}/rest/v1/hd_work_order_line_items?work_order_id=eq.${id}`, {
      method: 'DELETE', headers: SVC_H,
    })
  }
  // Invoices BEFORE work orders: hd_invoices.work_order_id points at them, and the
  // migration-154 unique index means a stray would block the next run's insert.
  for (const id of created.hdInvoices)   await del('hd_invoices', id)
  for (const id of created.hdWorkOrders) await del('hd_work_orders', id)
  for (const id of created.hdQuotes)     await del('hd_quotes', id)

  // Labor library entries, swept by marker too.
  try {
    const strays = await rest<{ id: string }>(`hd_repair_items?select=id&user_id=eq.${OWNER}&description=like.${MARK}*`)
    for (const s of strays) created.libraryItems.add(s.id)
  } catch { /* a failed sweep must not mask the real result */ }
  for (const id of created.libraryItems) await del('hd_repair_items', id)

  // Units a crashed run left behind, by the smoke serial prefix. Since migration 161 a
  // stray ACTIVE unit holding a fixed smoke serial would make the next run's insert of
  // that serial fail on the unique index - so they are swept, owner-scoped.
  try {
    const strays = await rest<{ id: string }>(`hd_units?select=id&user_id=eq.${OWNER}&serial_number=like.ZZSERIAL*`)
    for (const s of strays) created.fleetUnits.add(s.id)
    const cats = await rest<{ id: string }>(`hd_equipment_categories?select=id&user_id=eq.${OWNER}&name=like.${MARK}*`)
    for (const c of cats) created.equipmentCategories.add(c.id)
  } catch { /* a failed sweep must not mask the real result */ }

  // HD Intel Hub. Units before accounts: hd_units.fleet_account_id points at them.
  for (const id of created.fleetUnits)    await del('hd_units', id)
  for (const id of created.fleetAccounts) await del('hd_fleet_accounts', id)
  for (const id of created.equipmentCategories) await del('hd_equipment_categories', id)
  // Customers last: an HD document may still have been pointing at one.
  for (const id of created.customers)     await del('customers', id)

  // Flow Rf: the throwaway reefer account(s), and any a crashed run left (by the
  // smoke-reefer- email the flow gives them - nothing else uses it). Every row below
  // belongs to an account this suite created and nobody else can sign in to.
  try {
    const usersRes = await fetch(`${SUPA}/auth/v1/admin/users?per_page=200`, { headers: SVC_H })
    const usersJson = await usersRes.json()
    const users = (Array.isArray(usersJson) ? usersJson : usersJson.users ?? []) as Array<{ id: string; email?: string }>
    for (const u of users) if (/^smoke-reefer-\d+@example\.com$/.test(u.email ?? '')) created.reeferUsers.add(u.id)
  } catch { /* a failed sweep must not mask the real result */ }
  const OWNED = ['hd_invoices', 'hd_work_orders', 'hd_quotes', 'hd_repair_items', 'reefer_unit_details', 'hd_units',
    'hd_fleet_accounts', 'hd_equipment_categories', 'customers', 'subscriptions']
  for (const uid of created.reeferUsers) {
    for (const w of await rest<{ id: string }>(`hd_work_orders?select=id&user_id=eq.${uid}`).catch(() => [])) {
      await fetch(`${SUPA}/rest/v1/hd_work_order_line_items?work_order_id=eq.${w.id}`, { method: 'DELETE', headers: SVC_H })
    }
    for (const t of OWNED) {
      await fetch(`${SUPA}/rest/v1/${t}?user_id=eq.${uid}`, { method: 'DELETE', headers: SVC_H })
    }
    const gone = await fetch(`${SUPA}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: SVC_H })
    // Proved, not assumed: nothing of the account is left in any table it touched.
    const left: string[] = []
    for (const t of [...OWNED, 'profiles']) {
      const col = t === 'profiles' ? 'id' : 'user_id'
      const res = await fetch(`${SUPA}/rest/v1/${t}?select=${col}&${col}=eq.${uid}`, { headers: { ...SVC_H, Prefer: 'count=exact' } })
      const n = Number((res.headers.get('content-range') ?? '/0').split('/')[1] ?? 0)
      if (res.ok && n > 0) left.push(`${t} ${n}`)
    }
    record('Rf reefer standalone', 'cleanup: the throwaway account and every row it made are gone',
      gone.ok && left.length === 0, gone.ok ? left.join(', ') : `auth delete -> ${gone.status}`)
  }

  console.log(`  removed ${created.invoices.size} invoice(s), ${created.workOrders.size} work order(s), ${created.quotes.size} quote(s)`)
  console.log(`  removed ${created.hdInvoices.size} HD invoice(s), ${created.hdWorkOrders.size} HD work order(s), ${created.hdQuotes.size} HD quote(s)`)
  console.log(`  removed ${created.fleetAccounts.size} fleet account(s), ${created.fleetUnits.size} fleet unit(s), ${created.customers.size} customer(s)`)
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
  // The line editor offers labour and part lines separately since the multi-line pass
  // (Oct 22): "Add Labor Line" and "Add Part Line" replaced the single "Add Line Item".
  const missOpen = missingControls(open!.text, ['Add Labor Line', 'Add Part Line', 'Save Changes'])
  record(F, 'controls while open', missOpen.length === 0,
    missOpen.length ? `missing: ${missOpen.join(', ')}` : 'Add Labor Line, Add Part Line, Save Changes')
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

    // ONE TAX BLOCK, NOT TWO.
    //
    // Both forms printed every tax figure twice - once as "Parts Tax %  $0.30" and
    // again as "Tax on parts (7.75%)  $0.30" - because the two-rate editor was added
    // alongside the taxDisplayRows summary instead of replacing it. "Parts Tax %" was
    // also a percent label above a column of dollars.
    //
    // Asserted against the RENDERED page, both ways round: the kept wording has to be
    // there and the retired wording has to be gone. Checking only for the absence
    // would also pass on a form that printed no tax at all.
    // "Tax on parts" OR "not taxable", because a shop that taxes nothing is a
    // legitimate configuration and the row states itself either way. Matching only
    // the taxed wording would make this fail on a correct form belonging to a shop
    // with tax switched off - the check would be measuring the shop, not the code.
    // Matched on 'not taxable' rather than the full phrase so an em dash cannot
    // decide whether the suite is green.
    const hasKept    = pg!.text.includes('Tax on parts') || pg!.text.includes('not taxable')
    const hasRetired = pg!.text.includes('Parts Tax %') || pg!.text.includes('Labor Tax %')
    record(F, `${label} prints the tax block once`,
      hasKept && !hasRetired,
      hasRetired ? 'the retired "Parts Tax %" block is still rendering'
        : hasKept ? 'one block, worded as the customer copy words it'
        : 'no tax row rendered - this target predates the one-block change')
  }

  const hdInv = (await rest('hd_invoices?select=id,invoice_number,total&order=invoice_number.desc&limit=1'))[0]
  if (!record(F, 'an HD invoice exists to open', !!hdInv, hdInv ? String(hdInv.invoice_number) : 'none')) return
  for (const [label, path] of [['detail', `/hd/invoices/${hdInv.id}`], ['edit', `/hd/invoices/${hdInv.id}/edit`]] as const) {
    const pg = await page(path)
    if (!record(F, `invoice ${label} loads`, !!pg, pg ? '' : `${path} did not load`)) continue
    // The page prints money with thousands separators (lib/format money()), so a total
    // of 1000 or more reads "1,823.56". Matched both ways, as the LD invoice check does;
    // this was wrong about the app until the first HD invoice over $1,000 (Oct 21).
    const shownHd = pg!.text.includes(usd(hdInv.total)) ||
      pg!.text.includes(Number(hdInv.total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
    record(F, `invoice ${label} shows the stored total`, shownHd, `stored ${usd(hdInv.total)}`)
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

// ===========================================================================
// N  HD quote approval -> work order
//
// Kurt's chain: build a quote, send it, the customer approves it from a link with no
// login, and it becomes an HD work order with nothing retyped.
//
// Needs migration 153. Until it is applied the quote saves with no public_token, and
// this flow says so and stops rather than printing six failures about a column.
async function flowN(): Promise<void> {
  const F = 'N hd approval'

  // A rate that is deliberately NOT the shop's current setting, so case 6 can tell the
  // difference between "the work order carried the quote's terms" and "the work order
  // re-read Settings and happened to agree".
  const QUOTE_RATE = 193.5
  const QUOTE_TAX = 7.25

  const quoteBody = {
    customer_name: `${MARK} hd approval`,
    customer_phone: '+15555550199',
    unit_manufacturer: 'Carrier Transicold',
    unit_model: 'Supra 660',
    unit_serial: 'ZZ-APPROVAL-TEST',
    complaint: `${MARK} - no cooling`,
    diagnosis: `${MARK} - failed oil filter`,
    status: 'sent',
    labor_rate: QUOTE_RATE,
    labor_hours: 2,
    tax_rate: QUOTE_TAX,
    tax_amount: 10,
    subtotal_labor: 387,
    subtotal_parts: 52,
    total: 449,
    parts_markup_percent: 30,
    travel_hours: 1, travel_rate: 95, travel_amount: 95,
    mileage_miles: 20, mileage_rate: 2, mileage_amount: 40,
    shop_supplies_percent_applied: 8, shop_supplies_fee: 4.16,
    line_items: [
      { id: 'zz-1', type: 'labor', description: `${MARK} labor`, mobile_hours: 2, amount: 387 },
      // THE SHAPE THE QUOTE FORM WRITES, corrected. This said
      // `type: 'part', unit_cost: 40, unit_price: 52` - singular type, and the cost
      // in unit_cost. The form writes `type: 'parts'` with the SELL in unit_cost and
      // the cost in unit_cost_base (addPartsItem, src/app/hd/quotes/new/page.tsx), so
      // this fixture described a document the product cannot produce. That is how a
      // doubled markup got past a flow that converts a part line on every run.
      { id: 'zz-2', type: 'parts', description: `${MARK} filter`, part_number: '30-60143-01',
        quantity: 1, unit_cost: 52, unit_cost_base: 40, markup_percent: 30, amount: 52 },
    ],
  }

  const made = await api('POST', '/api/hd/quotes', quoteBody)
  await adoptSmokeCustomer(made.json.customer_id)
  if (made.status === 404) {
    console.log('  note  /api/hd/quotes answered 404 - HD quote routes are NOT PROMOTED yet; flow N did not run.')
    return
  }
  if (!record(F, 'an HD quote can be created as sent', made.status === 201, `-> ${made.status}`)) return

  const quote = (made.json.quote ?? {}) as Record<string, unknown>
  const quoteId = String(quote.id ?? '')
  created.hdQuotes.add(quoteId)

  // CASE 1: the quote gets a public token.
  const token = quote.public_token as string | null
  if (!record(F, 'a sent quote gets a public token', !!token && String(token).length >= 16,
    token ? `${String(token).slice(0, 8)}...` : 'NO TOKEN - see the note below')) {
    // THIS WAS DIAGNOSED WRONG THE FIRST TIME. It said "migration 153 not applied",
    // which sends the reader to the database - and 153 was already applied. The token
    // is issued by CODE in the POST route, which lives on an unpromoted branch, so a
    // missing token means THE DEPLOY IS BEHIND, not the migration.
    //
    // Both causes are now checked and named separately, because they need different
    // actions in different places.
    let columnExists = true
    try { await rest('hd_quotes?select=public_token&limit=1') } catch { columnExists = false }

    if (!columnExists) {
      console.log('  note  hd_quotes.public_token is ABSENT - apply migration 153.')
    } else {
      console.log('  note  hd_quotes.public_token EXISTS, so migration 153 IS applied.')
      console.log('        The token-issuing code is not deployed to this target. Promote it, or')
      console.log('        point smoke at the preview: PAGECHECK_BASE=<url> npm run smoke')
    }
    return
  }

  // CASE 1b: the page renders with NO login. A bare fetch, no cookie.
  const pub = await fetch(`${BASE}/hd/quote/${token}`, { redirect: 'follow' })
  const pubText = pub.ok ? visibleText(await pub.text()) : ''
  const finalPath = new URL(pub.url).pathname
  record(F, 'the approval page renders without a login',
    pub.ok && finalPath.startsWith('/hd/quote/'),
    pub.ok ? `-> 200 at ${finalPath}` : `-> ${pub.status} at ${finalPath}`)
  record(F, 'and it shows the quote number and total',
    pubText.includes(String(quote.quote_number)) && pubText.includes('449.00'),
    `${quote.quote_number}, 449.00`)

  // CASE 2: approving writes status, approved_at, method and PO.
  const PO = 'ZZ-PO-7788'
  const approve = await fetch(`${BASE}/api/hd/quotes/public/${token}/respond`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approve', po_number: PO, note: `${MARK} note` }),
  })
  const approveJson = await approve.json().catch(() => ({})) as Record<string, unknown>
  record(F, 'approving succeeds with no session', approve.ok, `-> ${approve.status}`)

  const stamped = (await rest<Record<string, unknown>>(
    `hd_quotes?id=eq.${quoteId}&select=status,approved_at,approval_method,customer_po_number,customer_response_note`))[0]
  record(F, 'status is approved', stamped?.status === 'approved', String(stamped?.status))
  record(F, 'approved_at is stamped', !!stamped?.approved_at, String(stamped?.approved_at))
  record(F, 'approval_method is customer_link',
    stamped?.approval_method === 'customer_link', String(stamped?.approval_method))
  record(F, 'the customer PO is recorded', stamped?.customer_po_number === PO, String(stamped?.customer_po_number))

  // CASE 3: exactly one work order, with the lines intact.
  const wos = await rest<Record<string, unknown>>(
    `hd_work_orders?quote_id=eq.${quoteId}&select=id,work_order_number,labor_rate,tax_percent,authorized_at,authorization_method,customer_po_number,parts_markup_percent,travel_amount,shop_supplies_fee`)
  wos.forEach(w => created.hdWorkOrders.add(String(w.id)))
  record(F, 'approval created exactly ONE work order', wos.length === 1,
    `${wos.length}${wos.length ? ': ' + wos.map(w => w.work_order_number).join(', ') : ''}`)
  if (wos.length !== 1) return
  const wo = wos[0]

  const lines = await rest<Record<string, unknown>>(
    `hd_work_order_line_items?work_order_id=eq.${wo.id}&select=type,description,part_number,quantity,unit_price,total&order=sort_order`)
  record(F, 'both quote lines landed in hd_work_order_line_items', lines.length === 2,
    `${lines.length}: ${lines.map(l => l.type).join(', ')}`)
  const partLine = lines.find(l => l.type === 'part')
  record(F, 'the PART line carried its number', partLine?.part_number === '30-60143-01',
    String(partLine?.part_number))
  const laborLine = lines.find(l => l.type === 'labor')
  record(F, 'the LABOR line carried hours in quantity', Number(laborLine?.quantity) === 2,
    `quantity ${laborLine?.quantity}`)

  // CASE 6: the work order carries the QUOTE's recorded terms, not the shop's current
  // settings. QUOTE_RATE is deliberately not a value any Settings page would hold.
  record(F, "the work order carries the QUOTE's labor rate, not the setting",
    Number(wo.labor_rate) === QUOTE_RATE, `${wo.labor_rate} (quote had ${QUOTE_RATE})`)
  record(F, "and the QUOTE's tax rate", Number(wo.tax_percent) === QUOTE_TAX,
    `${wo.tax_percent} (quote had ${QUOTE_TAX})`)
  record(F, 'and the markup, travel and supplies',
    Number(wo.parts_markup_percent) === 30 && Number(wo.travel_amount) === 95 && Number(wo.shop_supplies_fee) === 4.16,
    `markup ${wo.parts_markup_percent}, travel ${wo.travel_amount}, supplies ${wo.shop_supplies_fee}`)

  // CASE 5: the approval IS the authorization, stamped onto the work order.
  record(F, 'the authorization is stamped on the work order',
    !!wo.authorized_at && wo.authorization_method === 'customer_link' && wo.customer_po_number === PO,
    `${wo.authorized_at} / ${wo.authorization_method} / ${wo.customer_po_number}`)
  record(F, 'and authorized_at equals the quote approval time',
    String(wo.authorized_at) === String(stamped?.approved_at),
    `${wo.authorized_at} vs ${stamped?.approved_at}`)

  // CASE 4: opening the link twice still yields ONE work order. This is the index.
  const second = await fetch(`${BASE}/api/hd/quotes/public/${token}/respond`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approve', po_number: 'ZZ-PO-SECOND' }),
  })
  record(F, 'a second approval does not error', second.ok, `-> ${second.status}`)
  const after = await rest<Record<string, unknown>>(`hd_work_orders?quote_id=eq.${quoteId}&select=id,work_order_number`)
  record(F, 'STILL exactly one work order after clicking twice', after.length === 1,
    `${after.length}: ${after.map(w => w.work_order_number).join(', ')}`)
  const linesAfter = await rest(`hd_work_order_line_items?work_order_id=eq.${wo.id}&select=id`)
  record(F, 'and the lines were not duplicated', linesAfter.length === 2, `${linesAfter.length}`)

  // CASE 7: declining writes declined_at and creates NO work order.
  const dMade = await api('POST', '/api/hd/quotes', { ...quoteBody, customer_name: `${MARK} hd decline` })
  await adoptSmokeCustomer(dMade.json.customer_id)
  if (dMade.status !== 201) { record(F, 'a second quote for the decline case', false, `-> ${dMade.status}`); return }
  const dQuote = (dMade.json.quote ?? {}) as Record<string, unknown>
  const dId = String(dQuote.id ?? '')
  created.hdQuotes.add(dId)
  const dToken = dQuote.public_token as string | null
  if (!dToken) { record(F, 'the decline-case quote got a token', false, 'no token'); return }

  const decline = await fetch(`${BASE}/api/hd/quotes/public/${dToken}/respond`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'decline', note: `${MARK} too expensive` }),
  })
  record(F, 'declining succeeds', decline.ok, `-> ${decline.status}`)
  const dRow = (await rest<Record<string, unknown>>(
    `hd_quotes?id=eq.${dId}&select=status,declined_at,approved_at,customer_response_note`))[0]
  record(F, 'status is declined', dRow?.status === 'declined', String(dRow?.status))
  record(F, 'declined_at is stamped', !!dRow?.declined_at, String(dRow?.declined_at))
  record(F, 'approved_at stays null', !dRow?.approved_at, String(dRow?.approved_at))
  const dWos = await rest(`hd_work_orders?quote_id=eq.${dId}&select=id`)
  record(F, 'declining created NO work order', dWos.length === 0, `${dWos.length} work orders`)
}

// ===========================================================================
// O  HD work order -> invoice
//
// The hop that used to lose every part line. The old path was a query string carrying
// labor_hours and labor_rate, from which the invoice form rebuilt ONE labor line;
// hd_work_order_line_items was never read.
//
// Needs migrations 153 (the work order terms columns) and 154 (the one-invoice guard).
async function flowO(): Promise<void> {
  const F = 'O hd wo->invoice'

  // Terms no Settings page holds, so "the invoice carried the work order's terms"
  // cannot be confused with "it re-read Settings and happened to agree".
  const WO_RATE = 167.25
  const WO_TAX = 6.125

  const woBody = {
    customer_name: `${MARK} wo-to-invoice`,
    customer_phone: '+15555550177',
    unit_manufacturer: 'Thermo King',
    unit_model: 'SB-230',
    service_type: `${MARK} convert test`,
    service_requests: `${MARK} - unit will not hold setpoint`,
    comments: `${MARK} - low charge, leaking schrader`,
    // POST /api/hd/work-orders REQUIRES scheduled_date and hardcodes status 'open'.
    scheduled_date: new Date().toISOString().slice(0, 10),
    scheduled_time: '09:00',
  }

  // THE TERMS ARE SEEDED DIRECTLY, and that is not a shortcut hiding a missing test -
  // there is NO product route that puts labor_rate or tax_percent on an HD work order.
  // The only path that does is quote approval (flow N), and this flow has to run even
  // when migration 153 is unapplied and flow N cannot. What is under test here is the
  // CONVERTER, so the work order's terms are arranged state, not the thing being
  // proven.
  const TERMS = {
    status: 'completed',
    labor_rate: WO_RATE,
    labor_hours: 3,
    parts_markup_percent: 35,
    tax_percent: WO_TAX,
    tax_amount: 21.4,
    travel_hours: 1, travel_rate: 110, travel_amount: 110,
    mileage_miles: 15, mileage_rate: 2, mileage_amount: 30,
    shop_supplies_percent_applied: 8, shop_supplies_fee: 9.2,
  }

  const made = await api('POST', '/api/hd/work-orders', woBody)
  if (made.status === 404) {
    console.log('  note  /api/hd/work-orders answered 404 - not promoted; flow O did not run.')
    return
  }
  if (!record(F, 'an HD work order can be created', made.status === 201 || made.status === 200,
    `-> ${made.status}`)) return

  // ANOTHER SHOP'S UNIT OR FLEET ACCOUNT CANNOT BE ATTACHED. The create route inserted
  // unit_id and fleet_account_id as sent; an FK applies no RLS. A random uuid stands in
  // for another account's id. Both must be refused and create nothing.
  const FOREIGN = '00000000-0000-4000-8000-000000000000'
  const badUnit  = await api('POST', '/api/hd/work-orders', { ...woBody, unit_id: FOREIGN })
  const badFleet = await api('POST', '/api/hd/work-orders', { ...woBody, fleet_account_id: FOREIGN })
  for (const r of [badUnit, badFleet]) {
    const stray = (r.json.work_order ?? {}) as Record<string, unknown>
    if (stray.id) created.hdWorkOrders.add(String(stray.id))
  }
  record(F, 'creating a work order refuses a unit or fleet that is not the shop\'s',
    badUnit.status === 400 && badFleet.status === 400, `unit -> ${badUnit.status}, fleet -> ${badFleet.status}`)

  const wo = (made.json.work_order ?? made.json) as Record<string, unknown>
  const woId = String(wo.id ?? '')
  if (!woId) { record(F, 'the work order has an id', false, JSON.stringify(made.json).slice(0, 120)); return }
  created.hdWorkOrders.add(woId)

  // Seed the terms. tax_percent needs migration 153, so a failure here is reported as
  // the migration being absent rather than as a converter fault.
  const seeded = await fetch(`${SUPA}/rest/v1/hd_work_orders?id=eq.${woId}`, {
    method: 'PATCH', headers: SVC_H, body: JSON.stringify(TERMS),
  })
  if (!seeded.ok) {
    const why = (await seeded.text()).slice(0, 120)
    console.log(`  note  could not seed the work order terms (${seeded.status}) - migration 153 is probably not applied; flow O stopped.`)
    console.log(`        ${why}`)
    return
  }
  record(F, 'the work order carries terms to convert from', true, `rate ${WO_RATE}, tax ${WO_TAX}`)

  // THE LINES. One labor, two parts - the part lines are the ones that used to vanish.
  const lines = [
    { type: 'labor', description: `${MARK} diagnose and recharge`, quantity: 3, unit_price: WO_RATE, total: 501.75 },
    { type: 'part', description: `${MARK} schrader valve`, part_number: 'ZZ-SCHRADER',
      quantity: 2, unit_cost: 4, unit_price: 5.4, markup_percent: 35, total: 10.8 },
    { type: 'part', description: `${MARK} R404a`, part_number: 'ZZ-R404A',
      quantity: 10, unit_cost: 12, unit_price: 16.2, markup_percent: 35, total: 162 },
  ]
  const put = await api('PUT', `/api/hd/work-orders/${woId}/line-items`, { line_items: lines })
  record(F, 'three line items save on the work order', put.status === 200,
    `-> ${put.status}, ${((put.json.line_items ?? []) as unknown[]).length} lines`)

  const savedLines = await rest(`hd_work_order_line_items?work_order_id=eq.${woId}&select=id,type`)
  if (!record(F, 'two PART lines are on the work order',
    savedLines.filter(l => (l as Record<string, unknown>).type === 'part').length === 2,
    `${savedLines.length} total`)) return

  // ── the converter ────────────────────────────────────────────────────────
  const built = await api('GET', `/api/hd/work-orders/${woId}/convert`)
  if (built.status === 404) {
    console.log('  note  the HD converter is NOT PROMOTED yet; flow O stopped here.')
    return
  }
  if (!record(F, 'the converter assembles a payload', built.status === 200, `-> ${built.status}`)) return

  const payload = (built.json.invoice_payload ?? {}) as Record<string, unknown>
  const src = (built.json.source ?? {}) as Record<string, unknown>
  record(F, 'it reports the work order has lines', src.has_lines === true, `${src.line_count} lines`)
  record(F, 'it counted BOTH part lines', Number(src.part_lines) === 2, `${src.part_lines}`)

  const payloadLines = (payload.line_items ?? []) as Array<Record<string, unknown>>
  record(F, 'ALL THREE lines are in the payload - the parts no longer vanish',
    payloadLines.length === 3, `${payloadLines.length}`)
  record(F, "part lines are typed 'parts', not 'part'",
    payloadLines.filter(l => l.type === 'parts').length === 2,
    payloadLines.map(l => String(l.type)).join(', '))
  const r404 = payloadLines.find(l => l.part_number === 'ZZ-R404A')
  record(F, 'the customer price is the MARKED-UP price, not the cost',
    Number(r404?.unit_cost) === 16.2 && Number(r404?.unit_cost_base) === 12,
    `unit_cost ${r404?.unit_cost}, base ${r404?.unit_cost_base}`)
  const laborLine = payloadLines.find(l => l.type === 'labor')
  record(F, 'labor hours moved to mobile_hours with quantity 0',
    Number(laborLine?.mobile_hours) === 3 && Number(laborLine?.quantity) === 0,
    `mobile_hours ${laborLine?.mobile_hours}, quantity ${laborLine?.quantity}`)
  record(F, "the payload carries the WORK ORDER's rate and tax, not a setting",
    Number(payload.labor_rate) === WO_RATE && Number(payload.tax_rate) === WO_TAX,
    `rate ${payload.labor_rate}, tax ${payload.tax_rate}`)

  // ── the insert ───────────────────────────────────────────────────────────
  const inv = await api('POST', '/api/hd/invoices', payload)
  await adoptSmokeCustomer(inv.json.customer_id)
  if (!record(F, 'the invoice is created', inv.status === 201, `-> ${inv.status}`)) return
  const invoice = (inv.json.invoice ?? {}) as Record<string, unknown>
  const invId = String(invoice.id ?? '')
  created.hdInvoices.add(invId)

  const invRow = (await rest<Record<string, unknown>>(
    `hd_invoices?id=eq.${invId}&select=invoice_number,line_items,labor_rate,tax_rate,subtotal_labor,subtotal_parts,parts_cost,work_order_id`))[0]

  // THE PO IS ASKED FOR SEPARATELY, and that is not squeamishness.
  // hd_invoices.customer_po_number arrives with migration 157, and selecting a column
  // that does not exist fails the WHOLE request - which, when it was part of the select
  // above, threw and took the rest of the suite with it. Flows P and Q never ran.
  // A missing migration must cost one row in the table, not the run.
  let poColumn = true
  try { await rest('hd_invoices?select=customer_po_number&limit=1') } catch { poColumn = false }
  record(F, 'hd_invoices can store the customer PO', poColumn,
    poColumn ? 'customer_po_number present' : 'ABSENT - apply migration 157')
  const invLines = (invRow?.line_items ?? []) as Array<Record<string, unknown>>
  record(F, 'the stored invoice has all three lines', invLines.length === 3, `${invLines.length}`)
  record(F, 'parts subtotal is 172.80, not 0', Number(invRow?.subtotal_parts) === 172.8,
    String(invRow?.subtotal_parts))
  record(F, 'labor subtotal is 501.75', Number(invRow?.subtotal_labor) === 501.75,
    String(invRow?.subtotal_labor))
  record(F, 'parts_cost sums the BASE cost, not the sell price',
    Number(invRow?.parts_cost) === 128, `${invRow?.parts_cost} (2x4 + 10x12 = 128)`)
  record(F, 'the invoice is linked to the work order', invRow?.work_order_id === woId,
    String(invRow?.work_order_id))

  // The work order should now be invoiced.
  const after = (await rest<Record<string, unknown>>(`hd_work_orders?id=eq.${woId}&select=status`))[0]
  record(F, 'the work order flipped to invoiced', after?.status === 'invoiced', String(after?.status))

  // ── the convert-once guard (migration 154) ───────────────────────────────
  const second = await api('POST', '/api/hd/invoices', payload)
  await adoptSmokeCustomer(second.json.customer_id)
  // Track it before asserting. If the guard is missing this call CREATED a real
  // invoice, and an untracked one is a duplicate left in production - which is how
  // WO-2026-1538 got billed twice in the first place.
  const dupId = String(((second.json.invoice ?? {}) as Record<string, unknown>).id ?? '')
  if (dupId) created.hdInvoices.add(dupId)
  record(F, 'a SECOND invoice for the same work order is REFUSED',
    second.status === 409,
    second.status === 201
      // Named, because the guard is the INDEX and not an if-statement. A 201 here does
      // not mean the route lost its check; it means the index is not in the database.
      ? '-> 201: hd_invoices_one_per_work_order is ABSENT - apply migration 154'
      : `-> ${second.status}`)
  record(F, 'and the refusal names the invoice that already exists',
    typeof second.json.error === 'string' && String(second.json.error).includes('already billed'),
    String(second.json.error ?? '').slice(0, 70) || 'no refusal to name - see the row above')
  const count = await rest(`hd_invoices?work_order_id=eq.${woId}&select=id`)
  record(F, 'STILL exactly one invoice for that work order', count.length === 1, `${count.length}`)

  // And the converter itself refuses to re-assemble.
  const rebuilt = await api('GET', `/api/hd/work-orders/${woId}/convert`)
  record(F, 'the converter also reports it as already invoiced',
    rebuilt.status === 409 && rebuilt.json.already_invoiced === true, `-> ${rebuilt.status}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// P  HD QUOTE SEND
// ─────────────────────────────────────────────────────────────────────────────
//
// The approval page existed and nothing could reach it. This drives the door:
// the preview mints a link WITHOUT claiming a send, the real send records one, and
// the link a customer would tap actually renders.
//
// The preview assertion is the one that matters most. The LD routes bumped
// times_sent for merely opening a Copy Link tab, which is how quotes nobody
// received came to read "sent 3x", and the fix is only real if "asked for a link"
// and "sent it" stay different states.
async function flowP(): Promise<void> {
  const F = 'P hd quote send'

  const made = await api('POST', '/api/hd/quotes', {
    customer_name: `${MARK} hd send`,
    customer_phone: '+15555550155',
    unit_manufacturer: 'Thermo King',
    unit_model: 'Precedent S-600',
    complaint: `${MARK} - send path`,
    status: 'draft',
    labor_rate: 142,
    subtotal_labor: 284,
    subtotal_parts: 0,
    total: 284,
    line_items: [
      { id: 'zz-p1', type: 'labor', description: `${MARK} labor`, mobile_hours: 2, amount: 284 },
    ],
  })
  await adoptSmokeCustomer(made.json.customer_id)
  if (made.status === 404) {
    console.log('  note  /api/hd/quotes answered 404 - HD quote routes are NOT PROMOTED; flow P did not run.')
    return
  }
  if (!record(F, 'a draft HD quote can be created', made.status === 201, `-> ${made.status}`)) return

  const quote = (made.json.quote ?? {}) as Record<string, unknown>
  const quoteId = String(quote.id ?? '')
  created.hdQuotes.add(quoteId)

  // A DRAFT must start with no token. If it already had one the preview assertion
  // below would pass without the preview having done anything.
  record(F, 'a draft starts with no public link', !quote.public_token,
    quote.public_token ? 'already had one' : 'none, as expected')

  // ── the preview: a link, and no claim that anything was sent ─────────────
  const prev = await api('POST', `/api/hd/quotes/${quoteId}/send`, { method: 'link', preview: true })
  if (prev.status === 404) {
    console.log('  note  the HD quote send route is NOT PROMOTED yet; flow P stopped here.')
    record(F, 'the send route answers', false, '404 - not deployed to this target')
    return
  }
  const prevUrl = String(prev.json.url ?? '')
  if (!record(F, 'the preview returns an approval link',
    prev.status === 200 && prevUrl.includes('/hd/quote/'), prevUrl || `-> ${prev.status}`)) return

  const afterPreview = (await rest<Record<string, unknown>>(
    `hd_quotes?id=eq.${quoteId}&select=status,public_token`))[0]
  const token = String(afterPreview?.public_token ?? '')
  record(F, 'the preview PERSISTED the token, so the link is not dead',
    token.length >= 16 && prevUrl.endsWith(token), token ? `${token.slice(0, 8)}...` : 'NOT SAVED')
  record(F, 'and the preview did NOT mark the quote sent',
    afterPreview?.status === 'draft', String(afterPreview?.status))

  // Migration 155 holds the send history. Checked on its own so a missing column is
  // reported as the migration it is, not as a broken send.
  let historyColumns = true
  try { await rest('hd_quotes?select=sent_count,sent_at,last_sent_at&limit=1') } catch { historyColumns = false }
  record(F, 'hd_quotes has its send-history columns', historyColumns,
    historyColumns ? 'sent_at, last_sent_at, sent_count' : 'ABSENT - apply migration 155')

  if (historyColumns) {
    const counted = (await rest<Record<string, unknown>>(
      `hd_quotes?id=eq.${quoteId}&select=sent_count,sent_at`))[0]
    record(F, 'the preview did not move the counter',
      Number(counted?.sent_count ?? 0) === 0 && !counted?.sent_at,
      `sent_count ${counted?.sent_count}, sent_at ${counted?.sent_at}`)
  }

  // ── the real send ────────────────────────────────────────────────────────
  // 'link' deliberately: the tech asked for the link to hand over, which IS a
  // delivery, and it needs no Twilio or Resend credentials to be a true test.
  const sent = await api('POST', `/api/hd/quotes/${quoteId}/send`, { method: 'link' })
  if (!record(F, 'sending the link succeeds', sent.status === 200 && sent.json.sent === true,
    `-> ${sent.status}, sent ${String(sent.json.sent)}`)) return

  const afterSend = (await rest<Record<string, unknown>>(
    `hd_quotes?id=eq.${quoteId}&select=status,public_token`))[0]
  record(F, 'the quote is now sent', afterSend?.status === 'sent', String(afterSend?.status))
  record(F, 'and the token did NOT rotate', afterSend?.public_token === token,
    afterSend?.public_token === token ? 'same link' : 'ROTATED - a link already texted would be dead')

  if (historyColumns) {
    const hist = (await rest<Record<string, unknown>>(
      `hd_quotes?id=eq.${quoteId}&select=sent_count,sent_at,last_sent_at`))[0]
    record(F, 'the send recorded itself once',
      Number(hist?.sent_count) === 1 && !!hist?.sent_at && !!hist?.last_sent_at,
      `sent_count ${hist?.sent_count}, sent_at ${hist?.sent_at ? 'set' : 'null'}`)
  }

  // ── the link a customer would tap ────────────────────────────────────────
  const pub = await fetch(`${BASE}/hd/quote/${token}`, { redirect: 'follow' })
  const finalPath = new URL(pub.url).pathname
  record(F, 'the approval page renders from the sent link',
    pub.ok && finalPath.startsWith('/hd/quote/'),
    pub.ok ? `-> 200 at ${finalPath}` : `-> ${pub.status} at ${finalPath}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Q  HD QUOTE -> WORK ORDER, FROM THE SHOP SIDE
// ─────────────────────────────────────────────────────────────────────────────
//
// The customer's own route is flow N. This is the one the tech uses when the
// customer said yes on the phone, and the thing under test is that it REFUSES to
// open a job nobody authorized, then records the verbal approval truthfully when
// told to.
async function flowQ(): Promise<void> {
  const F = 'Q hd quote->wo'

  // Terms no Settings page holds, so "the work order carried the quote's terms"
  // cannot be confused with "it re-read Settings and happened to agree".
  //
  // TWO DECIMALS ON THE TAX, deliberately. The first version of this used 5.375 and
  // the check failed reading back 5.38 - hd_work_orders.tax_percent stores two
  // decimal places, so the column cannot hold a third. That was the TEST being wrong
  // about the app, not the app being wrong: nothing in the product offers a tax rate
  // with three decimals. Corrected rather than loosened - the value is still one no
  // Settings page holds, so it still proves the terms travelled.
  const RATE = 151.75
  const TAX = 6.37

  const made = await api('POST', '/api/hd/quotes', {
    customer_name: `${MARK} verbal approval`,
    customer_phone: '+15555550166',
    unit_manufacturer: 'Carrier Transicold',
    unit_model: 'Vector 8600',
    complaint: `${MARK} - verbal path`,
    status: 'draft',
    labor_rate: RATE,
    labor_hours: 2,
    tax_rate: TAX,
    tax_amount: 12.5,
    subtotal_labor: 303.5,
    subtotal_parts: 80,
    total: 396,
    parts_markup_percent: 30,
    travel_hours: 1, travel_rate: 105, travel_amount: 105,
    line_items: [
      { id: 'zz-q1', type: 'labor', description: `${MARK} labor`, mobile_hours: 2, amount: 303.5 },
      { id: 'zz-q2', type: 'part', description: `${MARK} belt`, part_number: 'ZZ-BELT',
        quantity: 1, unit_cost: 61.54, unit_price: 80, amount: 80 },
    ],
  })
  await adoptSmokeCustomer(made.json.customer_id)
  if (made.status === 404) {
    console.log('  note  /api/hd/quotes answered 404 - not promoted; flow Q did not run.')
    return
  }
  if (!record(F, 'a draft HD quote can be created', made.status === 201, `-> ${made.status}`)) return

  const quote = (made.json.quote ?? {}) as Record<string, unknown>
  const quoteId = String(quote.id ?? '')
  created.hdQuotes.add(quoteId)

  // ── it must REFUSE an unapproved quote ──────────────────────────────────
  const refused = await api('POST', `/api/hd/quotes/${quoteId}/work-order`, {})
  if (refused.status === 404) {
    console.log('  note  the HD quote->work order route is NOT PROMOTED yet; flow Q stopped here.')
    record(F, 'the convert route answers', false, '404 - not deployed to this target')
    return
  }
  record(F, 'converting an UNAPPROVED quote is refused',
    refused.status === 422 && refused.json.reason === 'not_approved',
    `-> ${refused.status}, reason ${String(refused.json.reason)}`)

  const none = await rest(`hd_work_orders?quote_id=eq.${quoteId}&select=id`)
  none.forEach(w => created.hdWorkOrders.add(String((w as Record<string, unknown>).id)))
  record(F, 'and it created NO work order', none.length === 0, `${none.length}`)

  // ── the verbal approval, then the conversion ─────────────────────────────
  const PO = 'ZZ-PO-VERBAL-41'
  const conv = await api('POST', `/api/hd/quotes/${quoteId}/work-order`, {
    record_verbal_approval: true, po_number: PO, note: `${MARK} dispatcher authorized by phone`,
  })
  const woNumber = String((conv.json.work_order as Record<string, unknown> | undefined)?.number ?? '')
  if (!record(F, 'a recorded verbal approval converts it',
    conv.status === 200 && !!woNumber, `-> ${conv.status} ${woNumber}`)) return

  const stamped = (await rest<Record<string, unknown>>(
    `hd_quotes?id=eq.${quoteId}&select=status,approved_at,approval_method,customer_po_number`))[0]
  record(F, 'the quote is approved', stamped?.status === 'approved', String(stamped?.status))
  record(F, "the method is recorded as 'verbal', not as a customer tap",
    stamped?.approval_method === 'verbal', String(stamped?.approval_method))
  record(F, 'approved_at is stamped', !!stamped?.approved_at, String(stamped?.approved_at))
  record(F, 'the PO given on the phone is recorded',
    stamped?.customer_po_number === PO, String(stamped?.customer_po_number))

  const wos = await rest<Record<string, unknown>>(
    `hd_work_orders?quote_id=eq.${quoteId}&select=id,work_order_number,labor_rate,tax_percent,authorized_at,authorization_method,customer_po_number,travel_amount`)
  wos.forEach(w => created.hdWorkOrders.add(String(w.id)))
  if (!record(F, 'exactly ONE work order exists for the quote', wos.length === 1,
    `${wos.length}${wos.length ? ': ' + wos.map(w => w.work_order_number).join(', ') : ''}`)) return
  const wo = wos[0]

  record(F, "the work order carries the QUOTE's rate and tax, not a setting",
    Number(wo.labor_rate) === RATE && Number(wo.tax_percent) === TAX,
    `rate ${wo.labor_rate}, tax ${wo.tax_percent}`)
  record(F, 'the travel the customer agreed to travelled with it',
    Number(wo.travel_amount) === 105, String(wo.travel_amount))
  record(F, 'the authorization record is the verbal one, with the PO',
    !!wo.authorized_at && wo.authorization_method === 'verbal' && wo.customer_po_number === PO,
    `${wo.authorization_method} / ${wo.customer_po_number}`)

  const lines = await rest(`hd_work_order_line_items?work_order_id=eq.${wo.id}&select=id,type`)
  record(F, 'both quote lines landed on the work order',
    lines.length === 2 &&
    lines.filter(l => (l as Record<string, unknown>).type === 'part').length === 1,
    `${lines.length} lines`)

  // ── convert once, enforced by the index and not by an if-statement ───────
  const again = await api('POST', `/api/hd/quotes/${quoteId}/work-order`, {})
  const againNumber = String((again.json.work_order as Record<string, unknown> | undefined)?.number ?? '')
  record(F, 'converting a second time returns the SAME work order',
    again.status === 200 && againNumber === woNumber, `${againNumber} vs ${woNumber}`)
  const still = await rest(`hd_work_orders?quote_id=eq.${quoteId}&select=id`)
  record(F, 'and there is STILL exactly one', still.length === 1, `${still.length}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// R  THE MARKUP IS APPLIED ONCE
// ─────────────────────────────────────────────────────────────────────────────
//
// A part quoted at cost 3.00 with 30% markup, sell 3.90, arrived on the work order
// as cost 3.90 / markup 30 / sell 5.07 - the markup applied twice, because the two
// tables name the same thing differently:
//
//   hd_quotes line_items        unit_cost = the SELL price, unit_cost_base = cost
//   hd_work_order_line_items    unit_cost = cost,           unit_price     = sell
//
// The converter read unit_cost as a cost and wrote it to unit_cost, so the sell
// price went into the cost column and the work order marked it up again. $5.07 is
// what the invoice would have billed for a part approved at $3.90.
//
// THE FIXTURE IS THE SHAPE THE QUOTE FORM ACTUALLY WRITES - type 'parts', the sell
// in unit_cost, the cost in unit_cost_base - copied from addPartsItem in
// src/app/hd/quotes/new/page.tsx. Flow N's older part fixture used type 'part' with
// unit_cost as a cost, which is not a shape the product produces; a test built on
// an invented shape cannot catch a bug about the real one.
async function flowR(): Promise<void> {
  const F = 'R markup once'

  // The numbers from the report, unchanged, because they are the ones that showed
  // the bug: 3.00 at 30% is 3.90, and 3.90 at 30% is 5.07.
  const COST = 3.00
  const MARKUP = 30
  const SELL = 3.90
  const DOUBLED = 5.07

  const made = await api('POST', '/api/hd/quotes', {
    customer_name: `${MARK} markup once`,
    customer_phone: '+15555550144',
    unit_manufacturer: 'Thermo King',
    unit_model: 'Precedent C-600',
    unit_serial: 'ZZ-MARKUP-TEST',
    complaint: `${MARK} - markup applied twice`,
    status: 'draft',
    labor_rate: 135,
    subtotal_labor: 0,
    subtotal_parts: SELL,
    parts_markup_percent: MARKUP,
    tax_rate: 0,
    tax_amount: 0,
    total: SELL,
    line_items: [{
      id: 'zz-r1',
      type: 'parts',
      description: `${MARK} o-ring`,
      part_number: 'ZZ-ORING-3',
      quantity: 1,
      unit_cost: SELL,        // the quote form puts the SELL here
      unit_cost_base: COST,   // ...and the cost here
      markup_percent: MARKUP,
      amount: SELL,
      amount_max: SELL,
    }],
  })
  await adoptSmokeCustomer(made.json.customer_id)
  if (made.status === 404) {
    console.log('  note  /api/hd/quotes answered 404 - not promoted; flow R did not run.')
    return
  }
  if (!record(F, 'a quote with a 3.00 part at 30% can be created', made.status === 201, `-> ${made.status}`)) return

  const quote = (made.json.quote ?? {}) as Record<string, unknown>
  const quoteId = String(quote.id ?? '')
  created.hdQuotes.add(quoteId)
  record(F, 'the quote records the sell price it quoted',
    Number(quote.subtotal_parts) === SELL, `subtotal_parts ${quote.subtotal_parts}`)

  const conv = await api('POST', `/api/hd/quotes/${quoteId}/work-order`, {
    record_verbal_approval: true, note: `${MARK} markup check`,
  })
  if (conv.status === 404) {
    console.log('  note  the HD quote->work order route is NOT PROMOTED yet; flow R stopped here.')
    record(F, 'the convert route answers', false, '404 - not deployed to this target')
    return
  }
  const woId = String((conv.json.work_order as Record<string, unknown> | undefined)?.id ?? '')
  if (!record(F, 'it converts to a work order', conv.status === 200 && !!woId, `-> ${conv.status}`)) return
  created.hdWorkOrders.add(woId)

  const lines = await rest<Record<string, unknown>>(
    `hd_work_order_line_items?work_order_id=eq.${woId}&select=type,part_number,quantity,unit_cost,unit_price,markup_percent,total`)
  const part = lines.find(l => String(l.type) === 'part')
  if (!record(F, 'the part landed on the work order', !!part, `${lines.length} line(s)`)) return

  // THE FOUR THAT MATTER.
  record(F, 'the work order cost is the COST, not the sell price',
    Number(part!.unit_cost) === COST,
    `unit_cost ${part!.unit_cost}${Number(part!.unit_cost) === SELL ? ' - THE SELL PRICE IS IN THE COST COLUMN' : ''}`)
  record(F, 'the sell price is the one the customer approved',
    Number(part!.unit_price) === SELL, `unit_price ${part!.unit_price}`)
  record(F, 'the markup travelled once',
    Number(part!.markup_percent) === MARKUP, `markup ${part!.markup_percent}`)
  record(F, `the line total is ${SELL.toFixed(2)} and NOT ${DOUBLED.toFixed(2)}`,
    Number(part!.total) === SELL,
    `total ${part!.total}${Number(part!.total) === DOUBLED ? ' - the markup was applied twice' : ''}`)

  // And the sum has to equal what the customer agreed to, to the cent.
  const partsTotal = lines
    .filter(l => String(l.type) === 'part')
    .reduce((sum, l) => sum + Number(l.total ?? 0), 0)
  record(F, "the work order's parts total equals the QUOTE's parts subtotal exactly",
    Math.abs(partsTotal - Number(quote.subtotal_parts)) < 0.005,
    `${partsTotal.toFixed(2)} vs quote ${Number(quote.subtotal_parts).toFixed(2)}`)

  // The margin figure the job sheet shows is computed off unit_cost, so it was
  // wrong by exactly the same mistake: 5.07 - 3.90 = 1.17 instead of 0.90.
  const margin = Number(part!.unit_price) * Number(part!.quantity) - Number(part!.unit_cost) * Number(part!.quantity)
  record(F, 'the margin the job sheet would show is sell minus cost',
    Math.abs(margin - (SELL - COST)) < 0.005,
    `${margin.toFixed(2)} (expected ${(SELL - COST).toFixed(2)})`)

  // The unit identity travels. The report asked for this confirmed; the quote
  // records the machine as free text and the work order keeps those same columns.
  const wo = (await rest<Record<string, unknown>>(
    `hd_work_orders?id=eq.${woId}&select=unit_manufacturer,unit_model,unit_serial`))[0]
  record(F, 'the unit model and serial carry from the quote',
    wo?.unit_manufacturer === 'Thermo King' && wo?.unit_model === 'Precedent C-600' && wo?.unit_serial === 'ZZ-MARKUP-TEST',
    `${wo?.unit_manufacturer} / ${wo?.unit_model} / ${wo?.unit_serial}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// S  THE HD QUOTE PICKER SEES HD'S OWN INTEL HUB
// ─────────────────────────────────────────────────────────────────────────────
//
// There are two Intel Hubs and the HD quote form only asked one of them:
//
//   /intel      (LD nav)  customers + vehicles
//   /hd/intel   (HD nav)  hd_fleet_accounts + hd_units
//
// The picker is labelled "Link Intel Hub Customer" and called GET /api/customers,
// the LD table, so a fleet account entered in HD's own Intel Hub could not be
// selected on an HD quote at all. Live proof at the time: "brock fleeman test" with
// unit test001 / Thermo King / s-600 existed as an hd_fleet_account and was
// unreachable from the quote form.
//
// Drives the two endpoints the picker now calls, including the unit it carries.
async function flowS(): Promise<void> {
  const F = 'S hd intel picker'

  // THE ROWS ARE ARRANGED DIRECTLY, and that is not a shortcut hiding a missing
  // test. There is NO API route that creates a fleet account or a unit: both are
  // server actions inside the page files (src/app/hd/fleet-accounts/page.tsx and
  // fleet-units/page.tsx), which a suite driving HTTP cannot post a form to. What is
  // under test here is the PICKER'S READ PATH - the two search endpoints the quote
  // form now calls - so the account and its unit are arranged state, with the same
  // columns those server actions write. Same reasoning as flow O's seeded terms.
  const name = `${MARK} fleet picker`
  const madeAccount = await fetch(`${SUPA}/rest/v1/hd_fleet_accounts`, {
    method: 'POST',
    headers: { ...SVC_H, Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id:       OWNER,
      fleet_name:    name,
      contact_name:  `${MARK} dispatcher`,
      contact_phone: '+15555550133',
      address:       '123 Sesame St, Winston-Salem, NC 27103',
    }),
  })
  if (!record(F, 'a fleet account exists to find', madeAccount.ok, `-> ${madeAccount.status}`)) {
    console.log(`        ${(await madeAccount.text()).slice(0, 140)}`)
    return
  }
  const accountId = String(((await madeAccount.json()) as Record<string, unknown>[])[0]?.id ?? '')
  if (!record(F, 'the fleet account has an id', !!accountId, accountId || 'none')) return
  created.fleetAccounts.add(accountId)

  // A unit on it, which is what the picker is supposed to carry onto the quote.
  const madeUnit = await fetch(`${SUPA}/rest/v1/hd_units`, {
    method: 'POST',
    headers: { ...SVC_H, Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id:          OWNER,
      fleet_account_id: accountId,
      unit_number:      'ZZ-UNIT-1',
      manufacturer:     'Thermo King',
      model:            'S-600',
      serial_number:    'ZZSERIAL0001',
      status:           'active',
    }),
  })
  const unitId = madeUnit.ok
    ? String(((await madeUnit.json()) as Record<string, unknown>[])[0]?.id ?? '')
    : ''
  if (unitId) created.fleetUnits.add(unitId)
  record(F, 'a unit exists on that account', madeUnit.ok && !!unitId, `-> ${madeUnit.status}`)

  // ── THE SEARCH THE PICKER RUNS ───────────────────────────────────────────
  const found = await api('GET', `/api/hd/fleet-accounts?search=${encodeURIComponent('fleet picker')}&limit=8`)
  if (found.status === 404) {
    console.log('  note  the fleet-accounts search is NOT PROMOTED yet; flow S stopped here.')
    record(F, 'the fleet account search answers', false, '404 - not deployed to this target')
    return
  }
  const accounts = (found.json.fleet_accounts ?? []) as Array<Record<string, unknown>>
  if (!record(F, 'searching by fleet name finds it',
    found.status === 200 && accounts.some(a => String(a.fleet_name) === name),
    found.status === 200
      ? `${accounts.length} hit(s)${accounts.some(a => String(a.fleet_name) === name) ? '' : ' - NOT including it; the search param may be ignored'}`
      : `-> ${found.status}`)) return

  // Its contact details have to come back, or the picker has nothing to fill with.
  const hit = accounts.find(a => String(a.fleet_name) === name)!
  record(F, 'the hit carries the contact and address to fill from',
    String(hit.contact_phone ?? '') === '+15555550133' && String(hit.address ?? '').includes('Sesame'),
    `${hit.contact_phone} / ${String(hit.address ?? '').slice(0, 30)}`)

  // ── THE UNIT IT CARRIES ──────────────────────────────────────────────────
  const units = await api('GET', `/api/hd/fleet-units?fleet_account_id=${accountId}&limit=50`)
  const unitRows = (units.json.units ?? []) as Array<Record<string, unknown>>
  record(F, "the account's units load for the quote form",
    units.status === 200 && unitRows.length === 1,
    `${unitRows.length} unit(s)`)
  if (unitRows.length === 1) {
    const u = unitRows[0]
    record(F, 'the unit carries manufacturer, model and serial',
      u.manufacturer === 'Thermo King' && u.model === 'S-600' && u.serial_number === 'ZZSERIAL0001',
      `${u.manufacturer} / ${u.model} / ${u.serial_number}`)
  }

  // ── AND THE LD SIDE STILL SEARCHES BY COMPANY ────────────────────────────
  //
  // The same picker queries /api/customers too, and company_name was missing from
  // that search - so a customer known only by the name on the truck could not be
  // found. Driven through a real customer because this is the field HD documents
  // populate via logHDCustomer.
  const company = `${MARK} Hauling Co`
  const cust = await api('POST', '/api/customers', {
    first_name: `${MARK}`,
    last_name:  'picker-company',
    company_name: company,
    phone: '+15555550134',
  })
  const custId = String(((cust.json.customer ?? {}) as Record<string, unknown>).id ?? '')
  if (custId) created.customers.add(custId)
  if (record(F, 'a customer with a company name can be created',
    (cust.status === 201 || cust.status === 200) && !!custId, `-> ${cust.status}`)) {
    const byCompany = await api('GET', `/api/customers?search=${encodeURIComponent('Hauling')}&limit=8`)
    const rows = (byCompany.json.customers ?? []) as Array<Record<string, unknown>>
    record(F, 'searching the COMPANY name finds the customer',
      rows.some(r => String(r.id) === custId),
      rows.some(r => String(r.id) === custId)
        ? `${rows.length} hit(s)`
        : 'not found - company_name is not in the search')
    record(F, 'and the hit returns company_name to display',
      rows.some(r => String(r.id) === custId && String(r.company_name ?? '') === company),
      String(rows.find(r => String(r.id) === custId)?.company_name ?? '(absent)'))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// T  THE FLEET LINK, UNIT NUMBER AND PAYMENT TERMS CARRY quote -> wo -> invoice
// ─────────────────────────────────────────────────────────────────────────────
//
// Picking a fleet account filled the quote's fields and threw the link away, the
// quote had no box for the fleet's unit number, the work order's Inspections block
// said "No unit" under a Unit that named one, and a Net 30 quote became a "Due on
// receipt" invoice because the convert payload carried no terms and hd_invoices'
// column DEFAULT stepped in. Migration 158.
//
// THE QUOTE BODY IS THE SHAPE THE FORM SENDS (handleSave in
// src/app/hd/quotes/new/page.tsx), and the labor line is copied key for key from a
// real row, Q-2026-0008 - not an assumed shape.
//
// The fleet account and unit are arranged directly for the reason flow S gives:
// there is no API route that creates either.
/**
 * Saving an HD quote runs logHDCustomer, which creates (or matches, by phone) a
 * `customers` row - a row this run made and must delete. Taken into the cleanup ONLY
 * when it carries the marker, so a match against a real customer is never deleted.
 */
async function adoptSmokeCustomer(id: unknown): Promise<void> {
  if (typeof id !== 'string' || !id) return
  const c = (await rest<Record<string, unknown>>(
    `customers?id=eq.${id}&select=first_name,company_name`))[0]
  if (c && (String(c.first_name ?? '').startsWith(MARK) || String(c.company_name ?? '').startsWith(MARK))) {
    created.customers.add(id)
  }
}

async function flowT(): Promise<void> {
  const F = 'T carry links'

  const fleetName = `${MARK} carry fleet`
  const acct = await fetch(`${SUPA}/rest/v1/hd_fleet_accounts`, {
    method: 'POST',
    headers: { ...SVC_H, Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: OWNER, fleet_name: fleetName, contact_phone: '+15555550188', address: '9 Yard Rd' }),
  })
  const accountId = acct.ok ? String(((await acct.json()) as Record<string, unknown>[])[0]?.id ?? '') : ''
  if (accountId) created.fleetAccounts.add(accountId)
  if (!record(F, 'a fleet account is arranged', !!accountId, `-> ${acct.status}`)) return

  const UNIT_NO = 'ZZ-UNIT-T7'
  const SERIAL  = 'ZZSERIALT007'
  const unit = await fetch(`${SUPA}/rest/v1/hd_units`, {
    method: 'POST',
    headers: { ...SVC_H, Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: OWNER, fleet_account_id: accountId, unit_number: UNIT_NO,
      // year 2017 on the RECORD, 2018 on the quote below: the work order must show the
      // quote's (WO-2026-1563 printed the record's year over the document's).
      manufacturer: 'Thermo King', model: 'S-600', year: 2017, serial_number: SERIAL, status: 'active',
    }),
  })
  const unitId = unit.ok ? String(((await unit.json()) as Record<string, unknown>[])[0]?.id ?? '') : ''
  if (unitId) created.fleetUnits.add(unitId)
  if (!record(F, 'a unit is arranged on it', !!unitId, `-> ${unit.status}`)) return

  // The quote form renders the new box. Rendered HTML, not source.
  const form = await page('/hd/quotes/new')
  record(F, 'the quote form renders a Unit Number field',
    !!form && form.text.includes('Unit Number'), !form ? 'page did not load' : form.text.includes('Unit Number') ? 'label renders' : 'label absent')

  // Real labor line, Q-2026-0008, at 1.0 h x $135.
  const laborLine = {
    id: 'zz-t1', type: 'labor', amount: 135, quantity: 0, unit_cost: 0, amount_max: 135,
    book_hours: 0, description: `${MARK} carry labor`, part_number: '', mobile_hours: 1,
    book_hours_max: 0, recharge_added: false, mobile_hours_max: 1, requires_refrigeration: false,
  }
  const quoteBody = (name: string, extra: Record<string, unknown>) => ({
    company_name: name, customer_name: name, customer_phone: '+15555550188', customer_email: null,
    customer_id: null, address_line1: '9 Yard Rd', address_line2: null, city: null, state: null, zip: null,
    has_corp_address: false, payment_terms: 'net30',
    unit_manufacturer: 'Thermo King', unit_model: 'S-600', unit_year: null,
    complaint: `${MARK} carry`, diagnosis: `${MARK} carry`,
    line_items: [laborLine], labor_rate: 135, subtotal_labor: 135, subtotal_parts: 0,
    diagnostic_fee: 0, road_call_fee: 0, tax_rate: 0, tax_amount: 0, total: 135,
    notes: null, valid_until: null, customer_po_number: null, status: 'draft',
    ...extra,
  })

  // ── LINKED: a fleet account and its unit were picked ─────────────────────
  // The CUSTOMER name differs from the fleet name on purpose: if they matched, "the
  // page shows the fleet name" would pass off the customer line with Fleet still "—".
  const made = await api('POST', '/api/hd/quotes', quoteBody(`${MARK} carry customer`, {
    fleet_account_id: accountId, unit_id: unitId, unit_number: UNIT_NO, unit_serial: SERIAL,
    unit_year: '2018',
  }))
  const quoteId = String(((made.json.quote ?? {}) as Record<string, unknown>).id ?? '')
  if (quoteId) created.hdQuotes.add(quoteId)
  await adoptSmokeCustomer(made.json.customer_id)
  if (!record(F, 'a linked quote saves', made.status === 201 && !!quoteId, `-> ${made.status} ${String(made.json.error ?? '')}`)) return

  const q = (await rest<Record<string, unknown>>(
    `hd_quotes?id=eq.${quoteId}&select=fleet_account_id,unit_id,unit_number,payment_terms`))[0] ?? {}
  record(F, 'the quote STORES the fleet link and unit (158)',
    q.fleet_account_id === accountId && q.unit_id === unitId,
    `fleet ${q.fleet_account_id ?? 'null'}, unit ${q.unit_id ?? 'null'}`)
  record(F, 'the quote stores the unit number', q.unit_number === UNIT_NO, String(q.unit_number))

  const conv = await api('POST', `/api/hd/quotes/${quoteId}/work-order`, {
    record_verbal_approval: true, note: `${MARK} carry`,
  })
  const wos = await rest<Record<string, unknown>>(
    `hd_work_orders?quote_id=eq.${quoteId}&select=id,fleet_account_id,unit_id,unit_number,payment_terms`)
  wos.forEach(w => created.hdWorkOrders.add(String(w.id)))
  if (!record(F, 'the quote converts to one work order', conv.status === 200 && wos.length === 1,
    `-> ${conv.status}, ${wos.length} wo`)) return
  const wo = wos[0]
  record(F, 'the work order carries the fleet link', wo.fleet_account_id === accountId, String(wo.fleet_account_id))
  record(F, 'the work order carries the unit link', wo.unit_id === unitId, String(wo.unit_id))
  record(F, 'the work order carries the unit number', wo.unit_number === UNIT_NO, String(wo.unit_number))
  record(F, 'the work order carries the payment terms', wo.payment_terms === 'net30', String(wo.payment_terms))

  const woPage = await page(`/hd/work-orders/${wo.id}`)
  if (record(F, 'the linked work order renders', !!woPage, woPage ? 'loaded' : 'did not load')) {
    record(F, 'Fleet shows the fleet name, not a dash', woPage!.text.includes(fleetName), woPage!.text.includes(fleetName) ? fleetName : 'fleet name absent')
    record(F, 'the unit number shows beside the unit', woPage!.text.includes(UNIT_NO), woPage!.text.includes(UNIT_NO) ? UNIT_NO : 'unit number absent')
    record(F, "the unit year is the QUOTE's (2018), not the unit record's (2017)",
      woPage!.text.includes('(2018)') && !woPage!.text.includes('(2017)'),
      woPage!.text.includes('(2017)') ? 'the record year 2017 renders' : woPage!.text.includes('(2018)') ? '2018' : 'no year renders')
    record(F, 'no "No unit on this work order" under a linked unit',
      !woPage!.text.includes('No unit on this work order'),
      woPage!.text.includes('No unit on this work order') ? 'the note still renders' : 'absent')
  }

  // ── TO THE INVOICE, the way WorkOrderDetail does it ──────────────────────
  const built = await api('GET', `/api/hd/work-orders/${wo.id}/convert`)
  const payload = (built.json.invoice_payload ?? {}) as Record<string, unknown>
  if (record(F, 'the work order builds an invoice payload', built.status === 200 && !!payload.customer_name,
    `-> ${built.status} ${String(built.json.error ?? '')}`)) {
    const inv = await api('POST', '/api/hd/invoices', payload)
    await adoptSmokeCustomer(inv.json.customer_id)
    const invId = String(((inv.json.invoice ?? {}) as Record<string, unknown>).id ?? '')
    if (invId) created.hdInvoices.add(invId)
    if (record(F, 'the invoice is created', !!invId, `-> ${inv.status} ${String(inv.json.error ?? '')}`)) {
      const i = (await rest<Record<string, unknown>>(
        `hd_invoices?id=eq.${invId}&select=fleet_account_id,unit_id,unit_number,payment_terms,unit_year`))[0] ?? {}
      record(F, 'the invoice terms are the QUOTE\'s, not "Due on receipt"', i.payment_terms === 'net30', String(i.payment_terms))
      record(F, 'the invoice carries the fleet link', i.fleet_account_id === accountId, String(i.fleet_account_id))
      record(F, 'the invoice carries the unit number', i.unit_number === UNIT_NO, String(i.unit_number))
      record(F, "the invoice carries the quote's unit year", i.unit_year === '2018', String(i.unit_year))
      const invPage = await page(`/hd/invoices/${invId}`)
      record(F, 'the invoice page reads Net 30',
        !!invPage && invPage.text.includes('Net 30') && !invPage.text.includes('Due on receipt'),
        !invPage ? 'did not load' : invPage.text.includes('Net 30') && !invPage.text.includes('Due on receipt') ? 'Net 30' : 'terms text wrong')
    }
  }

  // ── UNLINKED: the unit typed as text, serial matching no shop unit ───────
  const typed = await api('POST', '/api/hd/quotes', quoteBody(`${MARK} carry typed`, {
    unit_serial: 'ZZ-NOMATCH-T7', unit_number: 'ZZ-TYPED-7',
  }))
  const typedId = String(((typed.json.quote ?? {}) as Record<string, unknown>).id ?? '')
  if (typedId) created.hdQuotes.add(typedId)
  await adoptSmokeCustomer(typed.json.customer_id)
  if (!record(F, 'a typed-unit quote saves', typed.status === 201 && !!typedId, `-> ${typed.status}`)) return
  await api('POST', `/api/hd/quotes/${typedId}/work-order`, { record_verbal_approval: true, note: `${MARK} typed` })
  const tWos = await rest<Record<string, unknown>>(`hd_work_orders?quote_id=eq.${typedId}&select=id,unit_id,fleet_account_id`)
  tWos.forEach(w => created.hdWorkOrders.add(String(w.id)))
  if (!record(F, 'the typed quote converts', tWos.length === 1, `${tWos.length} wo`)) return
  record(F, 'a serial matching no unit links nothing (no guess)',
    tWos[0].unit_id == null && tWos[0].fleet_account_id == null, `unit ${tWos[0].unit_id}, fleet ${tWos[0].fleet_account_id}`)
  const tPage = await page(`/hd/work-orders/${tWos[0].id}`)
  if (record(F, 'the typed work order renders', !!tPage, tPage ? 'loaded' : 'did not load')) {
    record(F, 'Inspections names the typed unit instead of "No unit"',
      !tPage!.text.includes('No unit on this work order') && tPage!.text.includes('is not linked to a fleet unit record'),
      tPage!.text.includes('No unit on this work order') ? '"No unit" still renders under a named unit'
        : tPage!.text.includes('is not linked to a fleet unit record') ? 'names the unit' : 'new note absent')
  }
}

// ── U: both flat fees survive quote -> work order -> invoice, to the cent ───
//
// Q-2026-0010 ($260.11) became INV-2026-0020 ($225.11): the $35.00 road call fee was
// dropped at the work order while the quote's tax, which had taxed it, was copied. So
// the bill taxed a fee it did not charge. This drives a quote carrying BOTH fees and
// travel through the chain the tech uses, and through Bill Directly, and asserts the
// invoice total equals the quote total exactly with each fee printed as its own line.
//
// The lines are Q-2026-0010's own line_items, read from the live row - not an assumed
// shape - with the descriptions marked. Tax is per bucket as the quote form stores it:
//   labor bucket 202.50 + 35.00 road + 125.00 diag + 135.00 travel = 497.50 x 7.75% = 38.56
//   parts bucket 3.90 x 7.75% = 0.30
//   total 202.50 + 3.90 + 35.00 + 125.00 + 135.00 + 38.86 = 540.26
async function flowU(): Promise<void> {
  const F = 'U fees carry'
  const NAME = `${MARK} fees customer`
  // Fix 5 rides on this chain: the assigned tech travels quote -> wo -> invoice.
  const TECH = `${MARK} Tech U`

  const form = await page('/hd/quotes/new')
  record(F, 'the quote form renders an Assigned Tech field',
    !!form && form.text.includes('Assigned Tech'), !form ? 'page did not load' : form.text.includes('Assigned Tech') ? 'renders' : 'label absent')
  const TOTAL = 540.26

  const lines = [
    {
      id: 'zz-u1', type: 'labor', amount: 202.5, quantity: 0, unit_cost: 0, amount_max: 202.5,
      book_hours: 1.5, description: `${MARK} fees labor`, part_number: '', mobile_hours: 1.5,
      book_hours_max: 1.5, recharge_added: false, mobile_hours_max: 1.5, requires_refrigeration: false,
    },
    {
      id: 'zz-u2', type: 'parts', amount: 3.9, quantity: 1, unit_cost: 3.9, amount_max: 3.9,
      book_hours: 0, description: `${MARK} fees part`, part_number: 'ZZ-U-09', mobile_hours: 0,
      book_hours_max: 0, markup_percent: 30, recharge_added: false, unit_cost_base: 3,
      mobile_hours_max: 0, requires_refrigeration: false,
    },
  ]
  const taxBreakdown = {
    labor: { base: 497.5, rate: 7.75, taxed: true, amount: 38.56 },
    parts: { base: 3.9,   rate: 7.75, taxed: true, amount: 0.3 },
    version: 1,
  }

  const made = await api('POST', '/api/hd/quotes', {
    company_name: NAME, customer_name: NAME, customer_phone: '+15555550189', customer_email: null,
    customer_id: null, address_line1: '9 Yard Rd', address_line2: null, city: null, state: null, zip: null,
    has_corp_address: false, payment_terms: 'net30',
    unit_manufacturer: 'Thermo King', unit_model: 'S-600', unit_year: null, unit_serial: 'ZZ-NOMATCH-U',
    complaint: `${MARK} fees`, diagnosis: `${MARK} fees`,
    line_items: lines, labor_rate: 135, subtotal_labor: 202.5, subtotal_parts: 3.9,
    diagnostic_fee: 125, road_call_fee: 35,
    travel_hours: 1, travel_rate: 135, travel_amount: 135,
    mileage_miles: 0, mileage_rate: null, mileage_amount: 0,
    shop_supplies_percent_applied: null, shop_supplies_cap_applied: null, shop_supplies_fee: 0,
    tax_rate: 7.75, tax_amount: 38.86, tax_breakdown: taxBreakdown, total: TOTAL,
    notes: null, valid_until: null, customer_po_number: null, status: 'draft',
    tech_name: TECH,
  })
  const quoteId = String(((made.json.quote ?? {}) as Record<string, unknown>).id ?? '')
  if (quoteId) created.hdQuotes.add(quoteId)
  await adoptSmokeCustomer(made.json.customer_id)
  if (!record(F, 'a quote with both fees and travel saves', made.status === 201 && !!quoteId,
    `-> ${made.status} ${String(made.json.error ?? '')}`)) return

  const quote = (await rest<Record<string, unknown>>(`hd_quotes?id=eq.${quoteId}&select=*`))[0] ?? {}
  if (!record(F, 'the quote stores the total and both fees',
    usd(quote.total) === usd(TOTAL) && usd(quote.road_call_fee) === '35.00' && usd(quote.diagnostic_fee) === '125.00',
    `total ${usd(quote.total)}, road ${usd(quote.road_call_fee)}, diag ${usd(quote.diagnostic_fee)}`)) return

  // ── through the work order, as WorkOrderDetail does it ───────────────────
  const conv = await api('POST', `/api/hd/quotes/${quoteId}/work-order`, {
    record_verbal_approval: true, note: `${MARK} fees`,
  })
  const wos = await rest<Record<string, unknown>>(`hd_work_orders?quote_id=eq.${quoteId}&select=*`)
  wos.forEach(w => created.hdWorkOrders.add(String(w.id)))
  if (!record(F, 'the quote converts to one work order', conv.status === 200 && wos.length === 1,
    `-> ${conv.status}, ${wos.length} wo`)) return
  const wo = wos[0]

  // Migration 159 gives the work order its own fee columns. Before it is applied the
  // columns are absent from the row and the convert route reads the fees off the quote;
  // after, the work order must hold the quote's figures.
  // Migration 160 gives hd_quotes its tech_name column; before it, the quote saves
  // without it and there is nothing to carry. After, the name must reach the work order.
  const techOnQuote = 'tech_name' in quote
  if (techOnQuote) {
    record(F, 'the assigned tech carries quote -> work order (160)',
      quote.tech_name === TECH && wo.tech_name === TECH, `quote ${quote.tech_name ?? 'null'}, wo ${wo.tech_name ?? 'null'}`)
  } else {
    console.log('  note  U  migration 160 not applied - hd_quotes has no tech_name yet')
  }

  if ('road_call_fee' in wo) {
    record(F, 'the work order records both fees (159)',
      usd(wo.road_call_fee) === '35.00' && usd(wo.diagnostic_fee) === '125.00',
      `road ${usd(wo.road_call_fee)}, diag ${usd(wo.diagnostic_fee)}`)
  } else {
    // Not a row: a pass here could not fail. The invoice assertions below are what
    // prove the fees arrive in this window.
    console.log('  note  U  migration 159 not applied - the invoice reads the fees off the quote')
  }

  const built = await api('GET', `/api/hd/work-orders/${wo.id}/convert`)
  const payload = (built.json.invoice_payload ?? {}) as Record<string, unknown>
  if (!record(F, 'the work order builds an invoice payload', built.status === 200 && !!payload.customer_name,
    `-> ${built.status} ${String(built.json.error ?? '')}`)) return
  record(F, 'the payload carries both fees',
    usd(payload.road_call_fee) === '35.00' && usd(payload.diagnostic_fee) === '125.00',
    `road ${usd(payload.road_call_fee)}, diag ${usd(payload.diagnostic_fee)}`)
  record(F, 'the payload total equals the quote total', usd(payload.total) === usd(TOTAL),
    `payload ${usd(payload.total)} vs quote ${usd(TOTAL)}`)

  const inv = await api('POST', '/api/hd/invoices', payload)
  await adoptSmokeCustomer(inv.json.customer_id)
  const invId = String(((inv.json.invoice ?? {}) as Record<string, unknown>).id ?? '')
  if (invId) created.hdInvoices.add(invId)
  if (record(F, 'the invoice is created', !!invId, `-> ${inv.status} ${String(inv.json.error ?? '')}`)) {
    const i = (await rest<Record<string, unknown>>(
      `hd_invoices?id=eq.${invId}&select=*`))[0] ?? {}
    if (techOnQuote && 'tech_name' in i) {
      record(F, 'the assigned tech reaches the invoice (160)', i.tech_name === TECH, String(i.tech_name))
    }
    record(F, 'the invoice total equals the quote total to the cent', usd(i.total) === usd(TOTAL),
      `invoice ${usd(i.total)} vs quote ${usd(TOTAL)}`)
    record(F, 'the invoice stores both fees',
      usd(i.road_call_fee) === '35.00' && usd(i.diagnostic_fee) === '125.00',
      `road ${usd(i.road_call_fee)}, diag ${usd(i.diagnostic_fee)}`)
    const invPage = await page(`/hd/invoices/${invId}`)
    if (record(F, 'the invoice page renders', !!invPage, invPage ? 'loaded' : 'did not load')) {
      const missing = missingControls(invPage!.text, ['Road Call Fee', 'Diagnostic Fee', '$540.26'])
      record(F, 'the invoice shows each fee as its own line, and the quote total',
        missing.length === 0, missing.length ? `absent: ${missing.join(', ')}` : 'both fee lines and $540.26 render')
    }

    // THE INVOICE DATE IS THE SHOP'S DATE. INV-2026-0020 was created at 03:00:45 UTC
    // on Oct 18 - 11 pm Oct 17 in this NC shop - and printed "October 18". This smoke
    // invoice is given that exact created_at and the RENDERED page is read, so the
    // server's UTC clock cannot pass for the shop's.
    const owner = (await rest<Record<string, unknown>>(`profiles?id=eq.${OWNER}&select=state`))[0] ?? {}
    const expected = fmtShopDate('2026-10-18T03:00:45.91718+00:00', shopTimeZone(owner.state as string | null))
    const backdate = await fetch(`${SUPA}/rest/v1/hd_invoices?id=eq.${invId}`, {
      method: 'PATCH', headers: SVC_H, body: JSON.stringify({ created_at: '2026-10-18T03:00:45.91718+00:00' }),
    })
    const datedPage = backdate.ok ? await page(`/hd/invoices/${invId}`) : null
    record(F, `the invoice date is the shop's (${String(owner.state ?? 'no state')}), not UTC's`,
      // 03:00 UTC is still Oct 17 in every US zone, so the shop's date is Oct 17.
      !!datedPage && expected === 'October 17, 2026' && datedPage.text.includes(`Date: ${expected}`),
      !backdate.ok ? `could not back-date -> ${backdate.status}` : !datedPage ? 'page did not load'
        : datedPage.text.includes(`Date: ${expected}`) ? `Date: ${expected}` : `"Date: ${expected}" absent`)

    // THE EDIT FORM KEEPS THE COST BASIS. It rebuilt each line from the fields it
    // edits, so one save dropped unit_cost_base and markup_percent and the PUT then
    // derived parts_cost from nothing. Round-tripped through the form's own mapping and
    // the real PUT, on this invoice's real part line (cost 3.00, 30%).
    const stored = (await rest<Record<string, unknown>>(`hd_invoices?id=eq.${invId}&select=line_items`))[0] ?? {}
    const lines = editableLines(stored.line_items)
    const part = lines.find(l => l.type === 'parts')
    record(F, 'the invoice edit form keeps the part cost and markup',
      part?.unit_cost_base === 3 && part?.markup_percent === 30,
      `cost ${part?.unit_cost_base ?? 'dropped'}, markup ${part?.markup_percent ?? 'dropped'}`)
    const put = await api('PUT', `/api/hd/invoices/${invId}`, { line_items: lines })
    const after = (await rest<Record<string, unknown>>(`hd_invoices?id=eq.${invId}&select=parts_cost,line_items`))[0] ?? {}
    const afterPart = (Array.isArray(after.line_items) ? after.line_items as Record<string, unknown>[] : []).find(l => l.type === 'parts')
    record(F, 'saving the edit keeps the cost basis and parts_cost',
      put.status === 200 && Number(afterPart?.unit_cost_base) === 3 && usd(after.parts_cost) === '3.00',
      `-> ${put.status}, line cost ${afterPart?.unit_cost_base ?? 'dropped'}, parts_cost ${usd(after.parts_cost)}`)
  }

  // ── BILL DIRECTLY, the body both quote screens now send ──────────────────
  const direct = await api('POST', '/api/hd/invoices', invoiceBodyFromQuote(quote))
  const dId = String(((direct.json.invoice ?? {}) as Record<string, unknown>).id ?? '')
  if (dId) created.hdInvoices.add(dId)
  if (record(F, 'Bill Directly creates an invoice', !!dId, `-> ${direct.status} ${String(direct.json.error ?? '')}`)) {
    const d = (await rest<Record<string, unknown>>(
      `hd_invoices?id=eq.${dId}&select=total,road_call_fee,diagnostic_fee,travel_amount,tax_breakdown`))[0] ?? {}
    const tb = (d.tax_breakdown ?? {}) as Record<string, Record<string, unknown>>
    record(F, 'Bill Directly carries the fees, the travel and the tax breakdown',
      usd(d.total) === usd(TOTAL) && usd(d.road_call_fee) === '35.00' && usd(d.diagnostic_fee) === '125.00'
        && usd(d.travel_amount) === '135.00' && usd(tb.labor?.amount) === '38.56',
      `total ${usd(d.total)}, road ${usd(d.road_call_fee)}, diag ${usd(d.diagnostic_fee)}, travel ${usd(d.travel_amount)}, labor tax ${usd(tb.labor?.amount)}`)
    const dPage = await page(`/hd/invoices/${dId}`)
    if (record(F, 'the direct invoice page renders', !!dPage, dPage ? 'loaded' : 'did not load')) {
      const missing = missingControls(dPage!.text, ['Road Call Fee', 'Diagnostic Fee', 'Travel Time', '$540.26'])
      record(F, 'the direct invoice displays every charge inside its total',
        missing.length === 0, missing.length ? `absent: ${missing.join(', ')}` : 'fees, travel and $540.26 render')
    }
  }
}

// ── V: the labor library never hands over 0 billed hours ─────────────────
//
// "test labor" (book 1.5, mobile 0) pre-filled Hours (billed) with 0, and the footer
// read 0 hrs x $135.00/hr = $0.00. A new entry with 0 billable hours is refused.
//
// Oct 24: the pre-fill is FIELD time only, else blank - it no longer falls back to
// shop (book) time, which underbilled a field job. And the POST always INSERTS: it
// used to fold a save into the tech's existing card of the same name and take the new
// hours, which overwrote hand-written cards. Use is counted by id at .../[id]/used.
async function flowV(): Promise<void> {
  const F = 'V labor library'

  // The pre-fill rule: [mobile, shop, want]. The first case is the live "test labor"
  // row's own shape, and the shop figure is there to prove it is ignored.
  const cases: Array<[number | null, number | null, string]> = [
    [0, 1.5, ''], [null, 1.5, ''], [2.6, 1.5, '2.6'], [null, null, ''], [0, 0, ''],
  ]
  const wrong = cases.filter(([m, , want]) => billedHoursFromLibrary(m) !== want)

  // Fix 6 rides here too: the fee inputs. "035.00" stayed on screen after 35 was typed
  // over a 0. The field's own text handling, on the exact keystrokes that produced it.
  const feeCases: Array<[string, string, number]> = [
    ['035', '35', 35], ['035.00', '35.00', 35], ['0.50', '0.50', 0.5], ['35.', '35.', 35], ['0', '0', 0],
  ]
  const feeWrong = feeCases.filter(([raw, text, n]) => stripLeadingZeros(raw) !== text || parseFee(stripLeadingZeros(raw)) !== n)
  // Fix 7: a DATE-only value is never shifted into a zone, and a state name resolves.
  record('W shop date', 'a due date is printed as its own calendar day',
    fmtShopDate('2026-11-16', 'America/Los_Angeles') === 'November 16, 2026'
      && shopTimeZone('North Carolina') === shopTimeZone('NC'),
    `${fmtShopDate('2026-11-16', 'America/Los_Angeles')}, NC -> ${shopTimeZone('NC')}`)
  record('W fee inputs', 'typed fees lose leading zeros, keep decimals',
    feeWrong.length === 0,
    feeWrong.length ? feeWrong.map(([r]) => `"${r}" -> "${stripLeadingZeros(r)}"`).join('; ') : '035 -> 35, 035.00 -> 35.00, 0.50 kept, 35. kept')
  record(F, 'pre-fill: field time, else blank - never shop time, never 0',
    wrong.length === 0,
    wrong.length ? wrong.map(([m, b, w]) => `(${m}, ${b}) -> "${billedHoursFromLibrary(m)}" want "${w}"`).join('; ') : 'all five shapes')

  const zero = await api('POST', '/api/hd/repair-items', { description: `${MARK} lib zero`, shop_hours: 1.5, mobile_hours: 0, source: 'manual' })
  const zeroRows = await rest<{ id: string }>(`hd_repair_items?select=id&user_id=eq.${OWNER}&description=eq.${encodeURIComponent(`${MARK} lib zero`)}`)
  zeroRows.forEach(r => created.libraryItems.add(r.id))
  record(F, 'a NEW entry with 0 billable hours is refused',
    zero.status === 400 && zeroRows.length === 0, `-> ${zero.status}, ${zeroRows.length} row(s)`)

  const desc = `${MARK} lib fix`
  const first = await api('POST', '/api/hd/repair-items', { description: desc, shop_hours: 1.5, mobile_hours: 1, source: 'manual' })
  const firstId = String(((first.json.item ?? {}) as Record<string, unknown>).id ?? '')
  if (firstId) created.libraryItems.add(firstId)
  if (!record(F, 'a new entry with real hours saves', first.status === 201 && !!firstId, `-> ${first.status}`)) return

  const firstRow = async () => (await rest<Record<string, unknown>>(
    `hd_repair_items?id=eq.${firstId}&select=mobile_hours,shop_hours,use_count,last_used_at,description,labor_code`))[0] ?? {}
  const sameName = async () => (await rest<{ id: string }>(
    `hd_repair_items?select=id&user_id=eq.${OWNER}&description=eq.${encodeURIComponent(desc)}`))
  const firstBefore = await firstRow()

  // CORRECTED Oct 24 (the rule changed, the check is not loosened). It was "re-saving
  // the description takes the new hours": 200, the first row's mobile 2.25, uses 2.
  // Now a save of an existing name is a NEW card and the first is not touched.
  const again = await api('POST', '/api/hd/repair-items', { description: desc, shop_hours: 1.5, mobile_hours: 2.25, source: 'manual' })
  const againId = String(((again.json.item ?? {}) as Record<string, unknown>).id ?? '')
  if (againId) created.libraryItems.add(againId)
  const firstAfter = await firstRow()
  record(F, 'saving a name that already exists makes a second card; the first is untouched',
    again.status === 201 && !!againId && againId !== firstId && (await sameName()).length === 2
      && JSON.stringify(firstAfter) === JSON.stringify(firstBefore) && Number(firstAfter.mobile_hours) === 1,
    `-> ${again.status}, new id ${againId ? 'yes' : 'none'}, first row mobile ${firstAfter.mobile_hours}, uses ${firstAfter.use_count}`)

  // CORRECTED Oct 24. It was "a 0-hour re-save cannot wipe good hours": 200, mobile
  // still 2.25. Now nothing merges, so a 0-hour save of an existing name is refused
  // like any other new entry and changes nothing.
  const blank = await api('POST', '/api/hd/repair-items', { description: desc, mobile_hours: 0, source: 'manual' })
  record(F, 'a 0-hour save of an existing name is refused and changes nothing',
    blank.status === 400 && (await sameName()).length === 2 && JSON.stringify(await firstRow()) === JSON.stringify(firstBefore),
    `-> ${blank.status}`)

  // Blank book (shop) time is stored NULL, not 0 (the quote modal used to send 0).
  const noBook = await api('POST', '/api/hd/repair-items', { description: `${MARK} lib no book`, mobile_hours: 1.25, shop_hours: null, source: 'manual' })
  const noBookId = String(((noBook.json.item ?? {}) as Record<string, unknown>).id ?? '')
  if (noBookId) created.libraryItems.add(noBookId)
  const nb = noBookId ? (await rest<Record<string, unknown>>(`hd_repair_items?id=eq.${noBookId}&select=shop_hours,labor_code`))[0] : undefined
  record(F, 'a blank book figure is stored NULL, not 0',
    noBook.status === 201 && !!nb && nb.shop_hours === null, `-> ${noBook.status}, shop_hours ${nb ? JSON.stringify(nb.shop_hours) : 'no row'}`)
  record(F, 'a modal save with no equipment type gets a GN code from the database',
    !!nb && /^GN-[0-9]{4,}$/.test(String(nb.labor_code)), `code ${nb?.labor_code}`)

  // Use is counted by id, never the hours.
  const used = await api('POST', `/api/hd/repair-items/${firstId}/used`)
  const u = await firstRow()
  record(F, 'a picked card is counted by id: use_count + 1, hours untouched',
    used.status === 200 && Number(u.use_count) === Number(firstBefore.use_count) + 1
      && String(u.last_used_at) > String(firstBefore.last_used_at)
      && u.mobile_hours === firstBefore.mobile_hours && u.shop_hours === firstBefore.shop_hours && u.description === firstBefore.description,
    `-> ${used.status}, uses ${firstBefore.use_count} -> ${u.use_count}`)
  const master = (await rest<Record<string, unknown>>('hd_repair_items?select=id,use_count,last_used_at&is_master=eq.true&order=id&limit=1'))[0]
  const theirs = (await rest<Record<string, unknown>>(`hd_repair_items?select=id,use_count,last_used_at&user_id=neq.${OWNER}&is_master=eq.false&order=id&limit=1`))[0]
  if (master && theirs) {
    const m = await api('POST', `/api/hd/repair-items/${master.id}/used`)
    const t = await api('POST', `/api/hd/repair-items/${theirs.id}/used`)
    const m2 = (await rest<Record<string, unknown>>(`hd_repair_items?select=id,use_count,last_used_at&id=eq.${master.id}`))[0]
    const t2 = (await rest<Record<string, unknown>>(`hd_repair_items?select=id,use_count,last_used_at&id=eq.${theirs.id}`))[0]
    record(F, "the use count is own rows only: a catalog row and another shop's row are 404, unchanged",
      m.status === 404 && t.status === 404 && JSON.stringify(m2) === JSON.stringify(master) && JSON.stringify(t2) === JSON.stringify(theirs),
      `-> ${m.status}, ${t.status}`)
  } else {
    record(F, "the use count is own rows only: a catalog row and another shop's row are 404, unchanged", false, 'no such rows to test with')
  }
}

// ── Lc: labor cards - the hand-authoring screen (migration 166) ────────────
//
// Its own route INSERTS and never merges by description; either hour pair may be empty;
// an edit is by id and touches only that row; a delete is soft (active = false). Every
// result is read back out of the database with the service key and compared - not the
// route's answer. Then the quote modal's existing "Save to my labor library" path, and
// the 166 policies driven as the signed-in user.
async function flowLaborCards(): Promise<void> {
  const F = 'Lc labor cards'
  const COLS = 'id,user_id,labor_code,oem_labor_code,description,mobile_hours,mobile_hours_high,shop_hours,shop_hours_high,detail,suggested_related,equipment_type,equipment_category_id,scope,origin,is_master,active,source,updated_at'
  const readRow = async (id: string) => (await rest<Record<string, unknown>>(`hd_repair_items?id=eq.${id}&select=${COLS}`))[0]
  const num = (v: unknown) => (v == null ? null : Number(v))
  const activeCount = async () => (await rest<{ id: string }>(`hd_repair_items?select=id&user_id=eq.${OWNER}&active=eq.true`)).length

  const before = await activeCount()
  const written = (n: number) => `${n} operation${n !== 1 ? 's' : ''} written`
  const pg = await page('/hd/labor-cards')
  if (!record(F, 'the labor cards page renders', !!pg, pg ? 'loaded' : 'did not load')) return
  const missing = missingControls(pg!.text, ['LABOR CARDS', 'Field time', 'Shop time', 'Detail', 'Suggested related operation',
    'Equipment type', 'My category', 'Save and next', 'Recently edited', written(before)])
  record(F, 'every field, the sort and the count render', missing.length === 0 && pg!.html.includes('data-testid="labor-card-form"'),
    missing.length ? `absent: ${missing.join(', ')}` : `count reads ${before}, the database's active rows`)
  const nav = await page('/hd/dashboard')
  record(F, 'reachable from the HD navigation', !!nav && nav.html.includes('href="/hd/labor-cards"'), nav ? '' : '/hd/dashboard did not load')

  const myCat = (await rest<{ id: string }>(`hd_equipment_categories?select=id&user_id=eq.${OWNER}&is_active=eq.true&limit=1`))[0]?.id ?? null
  const theirCat = (await rest<{ id: string }>(`hd_equipment_categories?select=id&user_id=neq.${OWNER}&limit=1`))[0]?.id ?? null

  // Two DIFFERENT jobs with the SAME name - the case the repair-items POST would fold.
  const NAME = `${MARK} lc Replace engine mounts`
  const a = await api('POST', '/api/hd/labor-cards', {
    description: NAME, mobile_low: '1.5', mobile_high: '2.5', shop_low: '', shop_high: '',
    detail: 'SB-310, in the lot', suggested_related: 'Add refrigeration recovery & recharge',
    equipment_type: 'reefer', equipment_category_id: myCat ?? '',
  })
  const aId = String(((a.json.card ?? {}) as Record<string, unknown>).id ?? '')
  if (aId) created.libraryItems.add(aId)
  const b = await api('POST', '/api/hd/labor-cards', {
    description: NAME.toUpperCase(), mobile_low: '', shop_low: '3', shop_high: '',
    detail: 'Precedent, in a bay', equipment_type: 'trailer',
  })
  const bId = String(((b.json.card ?? {}) as Record<string, unknown>).id ?? '')
  if (bId) created.libraryItems.add(bId)
  if (!record(F, 'two cards with the same name both insert', a.status === 201 && b.status === 201 && !!aId && !!bId && aId !== bId,
    `-> ${a.status} ${a.json.error ?? ''}, ${b.status} ${b.json.error ?? ''}`)) return

  const ra = await readRow(aId)
  const rb = await readRow(bId)
  record(F, 'card 1 reads back field-only, every field as typed',
    !!ra && ra.user_id === OWNER && ra.description === NAME && num(ra.mobile_hours) === 1.5 && num(ra.mobile_hours_high) === 2.5
      && ra.shop_hours == null && ra.shop_hours_high == null && ra.detail === 'SB-310, in the lot'
      && ra.suggested_related === 'Add refrigeration recovery & recharge' && ra.equipment_type === 'reefer'
      && ra.equipment_category_id === myCat && ra.scope === 'private' && ra.origin === 'shop'
      && ra.is_master === false && ra.active === true,
    JSON.stringify(ra))
  record(F, 'card 2 reads back shop-only, a separate row',
    !!rb && rb.mobile_hours == null && num(rb.shop_hours) === 3 && rb.shop_hours_high == null && rb.equipment_type === 'trailer'
      && rb.detail === 'Precedent, in a bay',
    JSON.stringify(rb))
  record(F, 'a card with no hours at all is refused, nothing written',
    (await api('POST', '/api/hd/labor-cards', { description: `${MARK} lc none`, equipment_type: 'reefer' })).status === 400
      && (await rest(`hd_repair_items?select=id&description=eq.${encodeURIComponent(`${MARK} lc none`)}`)).length === 0)
  record(F, 'a high below the low is refused',
    (await api('POST', '/api/hd/labor-cards', { description: `${MARK} lc bad`, mobile_low: '3', mobile_high: '2', equipment_type: 'reefer' })).status === 400)
  const untyped = await api('POST', '/api/hd/labor-cards', { description: `${MARK} lc untyped`, mobile_low: '1' })
  record(F, 'a card with no equipment type is refused, nothing written (167: the type sets the code)',
    untyped.status === 400 && (await rest(`hd_repair_items?select=id&description=eq.${encodeURIComponent(`${MARK} lc untyped`)}`)).length === 0,
    `-> ${untyped.status} ${untyped.json.error ?? ''}`)

  // Labor codes (167): the database gives each card one, from its equipment type.
  const codeA = String(ra?.labor_code ?? '')
  const codeB = String(rb?.labor_code ?? '')
  record(F, 'each card gets a code from its type: reefer RF-, trailer TR-, never the same',
    /^RF-[0-9]{4,}$/.test(codeA) && /^TR-[0-9]{4,}$/.test(codeB) && codeA !== codeB, `${codeA}, ${codeB}`)
  const sent = await api('POST', '/api/hd/labor-cards', {
    description: `${MARK} lc sends a code`, mobile_low: '1', equipment_type: 'reefer', labor_code: 'RF-0001',
    oem_labor_code: '  SMOKE-OEM 40-112  ',
  })
  const sentId = String(((sent.json.card ?? {}) as Record<string, unknown>).id ?? '')
  if (sentId) created.libraryItems.add(sentId)
  const rs = sentId ? await readRow(sentId) : undefined
  record(F, 'a code sent by the caller is ignored; the OEM code is kept, trimmed',
    sent.status === 201 && !!rs && rs.labor_code !== 'RF-0001' && /^RF-[0-9]{4,}$/.test(String(rs.labor_code))
      && rs.oem_labor_code === 'SMOKE-OEM 40-112',
    `-> ${sent.status} ${sent.json.error ?? ''}, code ${rs?.labor_code}, oem ${JSON.stringify(rs?.oem_labor_code)}`)

  const listed = await page('/hd/labor-cards')
  record(F, 'all three render, and the count moved by exactly 3',
    !!listed && listed.html.includes(`data-card-id="${aId}"`) && listed.html.includes(`data-card-id="${bId}"`)
      && listed.html.includes(`data-card-id="${sentId}"`) && listed.text.includes(written(before + 3)),
    listed ? `want "${written(before + 3)}"` : 'did not load')
  record(F, 'each row shows its code, and the OEM code shows on this screen',
    !!listed && listed.text.includes(codeA) && listed.text.includes(codeB) && listed.text.includes(String(rs?.labor_code ?? '-'))
      && listed.text.includes('OEM SMOKE-OEM 40-112'),
    listed ? `${codeA}, ${codeB}, ${rs?.labor_code}` : 'did not load')

  // Edit card 1 by id. Card 2, same name, must not move.
  const bBefore = await readRow(bId)
  const e = await api('PATCH', `/api/hd/labor-cards/${aId}`, {
    description: NAME, mobile_low: '2', mobile_high: '', shop_low: '1.25', shop_high: '1.75',
    detail: 'SB-310, edited', suggested_related: '', equipment_type: 'reefer', equipment_category_id: '',
  })
  const ea = await readRow(aId)
  record(F, 'an edit reads back exactly as sent',
    e.status === 200 && num(ea.mobile_hours) === 2 && ea.mobile_hours_high == null && num(ea.shop_hours) === 1.25
      && num(ea.shop_hours_high) === 1.75 && ea.detail === 'SB-310, edited' && ea.suggested_related == null
      && ea.equipment_category_id == null && String(ea.updated_at) > String(ra.updated_at) && ea.labor_code === codeA,
    `-> ${e.status}, ${JSON.stringify(ea)}`)
  // A code never changes - not on a new type, not when the caller sends one.
  const retype = await api('PATCH', `/api/hd/labor-cards/${aId}`, {
    description: NAME, mobile_low: '2', shop_low: '1.25', shop_high: '1.75', detail: 'SB-310, edited',
    equipment_type: 'truck', labor_code: 'TC-0001',
  })
  const rt = await readRow(aId)
  record(F, 'a new equipment type keeps the old code, and a sent code is ignored',
    retype.status === 200 && rt.equipment_type === 'truck' && rt.labor_code === codeA,
    `-> ${retype.status} ${retype.json.error ?? ''}, type ${rt.equipment_type}, code ${rt.labor_code}`)
  record(F, 'the edit touched no other row, not even the one with the same name',
    JSON.stringify(await readRow(bId)) === JSON.stringify(bBefore))

  if (theirCat) {
    const t = await api('PATCH', `/api/hd/labor-cards/${bId}`, { description: NAME, shop_low: '3', equipment_type: 'trailer', equipment_category_id: theirCat })
    record(F, "another shop's category is refused", t.status === 400 && (await readRow(bId)).equipment_category_id == null, `-> ${t.status}`)
  } else {
    record(F, "another shop's category is refused", false, 'no other account has a category to test with')
  }
  const kurtRow = (await rest<{ id: string }>(`hd_repair_items?select=id&user_id=neq.${OWNER}&is_master=eq.false&limit=1`))[0]?.id
  const master  = (await rest<{ id: string }>('hd_repair_items?select=id&is_master=eq.true&limit=1'))[0]?.id
  if (kurtRow && master) {
    const k = await api('PATCH', `/api/hd/labor-cards/${kurtRow}`, { description: 'x', mobile_low: '1', equipment_type: 'other' })
    const m = await api('DELETE', `/api/hd/labor-cards/${master}`)
    record(F, "another shop's card and an NWI catalog row are 404 here",
      k.status === 404 && m.status === 404 && (await readRow(master)).active === true, `-> ${k.status}, ${m.status}`)
  } else {
    record(F, "another shop's card and an NWI catalog row are 404 here", false, 'no such rows to test with')
  }

  // Soft delete card 2.
  const d = await api('DELETE', `/api/hd/labor-cards/${bId}`)
  const db = await readRow(bId)
  const after = await api('GET', '/api/hd/labor-cards')
  const ids = ((after.json.cards ?? []) as Array<{ id: string }>).map(c => c.id)
  record(F, 'a delete is soft: the row stays, active false, gone from the list',
    d.status === 200 && !!db && db.active === false && !ids.includes(bId) && ids.includes(aId),
    `-> ${d.status}, active ${db?.active}, listed ${ids.includes(bId)}`)
  const gone = await page('/hd/labor-cards')
  record(F, 'the deleted card no longer renders', !!gone && !gone.html.includes(`data-card-id="${bId}"`) && gone.text.includes(written(before + 2)))
  record(F, 'a soft-deleted card keeps its code', db?.labor_code === codeB, `code ${db?.labor_code}`)

  // The picker's search runs on the server: description or code, matched as typed, and
  // a trimmed answer says it was trimmed. oem_labor_code never leaves the screen.
  const s1 = await api('GET', `/api/hd/repair-items?q=${encodeURIComponent(`${MARK} lc`)}&limit=1`)
  const s1Items = (s1.json.items ?? []) as Array<Record<string, unknown>>
  record(F, 'a trimmed search says so: total and truncated',
    s1.status === 200 && s1Items.length === 1 && Number(s1.json.total) >= 2 && s1.json.truncated === true,
    `-> ${s1.status}, ${s1Items.length} shown of ${s1.json.total}, truncated ${s1.json.truncated}`)
  const s2 = await api('GET', `/api/hd/repair-items?q=${encodeURIComponent(codeA)}&limit=8`)
  const s2Items = (s2.json.items ?? []) as Array<Record<string, unknown>>
  record(F, 'search finds a card by its labor code, and the answer carries the code',
    s2.status === 200 && s2Items.some(i => i.id === aId && i.labor_code === codeA) && s2.json.truncated === false,
    `-> ${s2.status}, ${s2Items.length} item(s)`)
  const s3 = await api('GET', `/api/hd/repair-items?q=${encodeURIComponent(`${MARK} lc%mounts`)}&limit=8`)
  record(F, 'a typed % is a percent sign, not a wildcard',
    s3.status === 200 && ((s3.json.items ?? []) as unknown[]).length === 0 && Number(s3.json.total) === 0,
    `-> ${s3.status}, ${s3.json.total} match(es)`)
  const s4 = await api('GET', `/api/hd/repair-items?q=${encodeURIComponent(NAME.toLowerCase())}&limit=8`)
  const ex = (s4.json.exact ?? null) as Record<string, unknown> | null
  record(F, 'the same-name hint finds the shop\'s own card by exact name, ignoring case',
    s4.status === 200 && !!ex && ex.id === aId && ex.labor_code === codeA, `exact ${JSON.stringify(ex)}`)
  const everything = await api('GET', '/api/hd/repair-items')
  const all = (everything.json.items ?? []) as Array<Record<string, unknown>>
  record(F, 'the OEM code is never in the picker\'s answer',
    everything.status === 200 && all.length > 0 && all.every(i => !('oem_labor_code' in i))
      && !JSON.stringify(everything.json).includes('SMOKE-OEM'),
    `${all.length} rows`)
  const svcOnly = (await rest<{ id: string }>('hd_repair_items?select=id&active=eq.true&or=(user_id.eq.' + OWNER + ',is_master.eq.true)')).length
  record(F, 'with no limit, the picker gets every row it can see - no silent cap',
    all.length === svcOnly && everything.json.truncated === false, `${all.length} returned, ${svcOnly} in the database`)

  // The database refuses an OEM code on a global row (167), checked on this smoke row.
  const glob = await fetch(`${SUPA}/rest/v1/hd_repair_items?id=eq.${sentId}`, {
    method: 'PATCH', headers: SVC_H, body: JSON.stringify({ scope: 'global' }),
  })
  record(F, 'the database refuses an OEM code on a global row',
    glob.status === 400 && (await readRow(sentId)).scope === 'private', `-> ${glob.status}`)

  // The quote modal's checkbox: the same body QuoteForm.saveLaborToLibrary sends.
  const QM = `${MARK} lc quote modal`
  const q = await api('POST', '/api/hd/repair-items', { description: QM, shop_hours: 1, mobile_hours: 1.5, requires_refrigeration: false, source: 'manual' })
  const qId = String(((q.json.item ?? {}) as Record<string, unknown>).id ?? '')
  if (qId) created.libraryItems.add(qId)
  const rq = qId ? await readRow(qId) : undefined
  const pick = await api('GET', '/api/hd/repair-items')
  record(F, '"Save to my labor library" still writes a readable row',
    q.status === 201 && !!rq && num(rq.mobile_hours) === 1.5 && num(rq.shop_hours) === 1 && rq.scope === 'private'
      && rq.origin === 'shop' && rq.source === 'manual'
      && ((pick.json.items ?? []) as Array<{ id: string }>).some(i => i.id === qId),
    `-> ${q.status} ${q.json.error ?? ''}, ${JSON.stringify(rq)}`)

  // The 166 policies, as the signed-in user with the anon key - no route in between.
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!record(F, 'the anon key is configured', !!anon && !!accessToken)) return
  const asOwner = createSupabase(SUPA, anon!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const seen = await asOwner.from('hd_repair_items').select('user_id, is_master').limit(1000)
  const rowsSeen = seen.data ?? []
  record(F, 'RLS: reads only its own rows and the NWI catalog',
    !seen.error && rowsSeen.length > 0 && rowsSeen.every(r => r.user_id === OWNER || (r.user_id == null && r.is_master === true))
      && rowsSeen.some(r => r.is_master === true),
    `${rowsSeen.length} rows, ${rowsSeen.filter(r => r.is_master).length} catalog`)
  const tries: Array<[string, Record<string, unknown>]> = [
    ['is_master true', { is_master: true }], ['scope global', { scope: 'global' }],
    ['origin nwi', { origin: 'nwi' }], ['another user', { user_id: '00000000-0000-0000-0000-000000000001' }],
    ...(theirCat ? [["another shop's category", { equipment_category_id: theirCat }] as [string, Record<string, unknown>]] : []),
  ]
  const leaked: string[] = []
  for (const [label, extra] of tries) {
    const ins = await asOwner.from('hd_repair_items')
      .insert({ user_id: OWNER, description: `${MARK} lc rls ${label}`, mobile_hours: 1, ...extra }).select('id')
    for (const r of ins.data ?? []) { created.libraryItems.add(r.id as string); leaked.push(`insert ${label}`) }
    const up = await asOwner.from('hd_repair_items').update(extra).eq('id', aId).select('id')
    if ((up.data ?? []).length) leaked.push(`update ${label}`)
  }
  const stillPrivate = await readRow(aId)
  record(F, 'RLS: a shop cannot make a row catalog, global, NWI, someone else\'s, or point it at another shop\'s category',
    leaked.length === 0 && stillPrivate.scope === 'private' && stillPrivate.is_master === false && stillPrivate.user_id === OWNER,
    leaked.length ? `ALLOWED: ${leaked.join(', ')}` : `${tries.length} inserts and ${tries.length} updates refused`)
  const masterEdit = master ? await asOwner.from('hd_repair_items').update({ description: 'x' }).eq('id', master).select('id') : null
  record(F, 'RLS: the NWI catalog cannot be edited by a shop', !!masterEdit && (masterEdit.data ?? []).length === 0)

  // 167, with no route in between: the code cannot be changed or chosen, and a shop
  // can no longer hard-delete a row (its code would be gone with it).
  const recode = await asOwner.from('hd_repair_items').update({ labor_code: 'RF-0001' }).eq('id', aId).select('id')
  record(F, 'RLS + trigger: a shop cannot change a code',
    !!recode.error && (await readRow(aId)).labor_code === codeA,
    recode.error ? `refused: ${recode.error.message}` : `ALLOWED (${(recode.data ?? []).length} row)`)
  const chosen = await asOwner.from('hd_repair_items')
    .insert({ user_id: OWNER, description: `${MARK} lc rls chosen code`, mobile_hours: 1, labor_code: 'RF-0001' })
    .select('id, labor_code')
  for (const r of chosen.data ?? []) created.libraryItems.add(r.id as string)
  const chosenRow = (chosen.data ?? [])[0] as Record<string, unknown> | undefined
  record(F, 'trigger: a code chosen on insert is replaced by the next one',
    !chosen.error && !!chosenRow && chosenRow.labor_code !== 'RF-0001' && /^GN-[0-9]{4,}$/.test(String(chosenRow.labor_code)),
    chosen.error ? `insert refused: ${chosen.error.message}` : `got ${chosenRow?.labor_code}`)
  const hard = await asOwner.from('hd_repair_items').delete().eq('id', aId).select('id')
  record(F, 'RLS: a shop cannot hard-delete a row',
    (hard.data ?? []).length === 0 && !!(await readRow(aId)), hard.error ? `refused: ${hard.error.message}` : `${(hard.data ?? []).length} row(s) deleted`)
}

// ── X: quotes and work orders can be corrected after they are made ─────────
//
// Kurt built five work orders, made mistakes, and deleted and rebuilt all five because
// nothing could be edited. A draft or sent quote now edits in the new-quote form (PUT,
// allow-listed, the customer's link never rotated); an approved one stays locked; a
// work order's header edits through its allow-listed PATCH, never money, and locks
// once invoiced.
async function flowX(): Promise<void> {
  const F = 'X edit paths'
  const NAME  = `${MARK} edit customer`
  const NAME2 = `${MARK} edit customer fixed`
  // Q-2026-0008's real labor line shape, 1.0 h x $135.
  const line = {
    id: 'zz-x1', type: 'labor', amount: 135, quantity: 0, unit_cost: 0, amount_max: 135,
    book_hours: 0, description: `${MARK} edit labor`, part_number: '', mobile_hours: 1,
    book_hours_max: 0, recharge_added: false, mobile_hours_max: 1, requires_refrigeration: false,
  }
  const made = await api('POST', '/api/hd/quotes', {
    company_name: NAME, customer_name: NAME, customer_phone: '+15555550190', customer_email: null,
    customer_id: null, address_line1: '9 Yard Rd', address_line2: null, city: null, state: null, zip: null,
    has_corp_address: false, payment_terms: 'net30',
    unit_manufacturer: 'Thermo King', unit_model: 'S-600', unit_year: null, unit_serial: 'ZZ-NOMATCH-X',
    complaint: `${MARK} edit`, diagnosis: `${MARK} edit`,
    line_items: [line], labor_rate: 135, subtotal_labor: 135, subtotal_parts: 0,
    diagnostic_fee: 0, road_call_fee: 0, tax_rate: 0, tax_amount: 0, total: 135,
    notes: null, valid_until: null, customer_po_number: null, status: 'draft',
  })
  const quoteId = String(((made.json.quote ?? {}) as Record<string, unknown>).id ?? '')
  if (quoteId) created.hdQuotes.add(quoteId)
  await adoptSmokeCustomer(made.json.customer_id)
  if (!record(F, 'a draft quote saves', made.status === 201 && !!quoteId, `-> ${made.status}`)) return

  const detail = await page(`/hd/quotes/${quoteId}`)
  record(F, 'a draft quote offers Edit',
    !!detail && detail.html.includes(`/hd/quotes/${quoteId}/edit`), !detail ? 'did not load' : detail.html.includes('/edit') ? 'Edit link renders' : 'no Edit link')
  const editPage = await page(`/hd/quotes/${quoteId}/edit`)
  record(F, 'the edit screen is the quote form, seeded from the quote',
    !!editPage && editPage.text.includes('EDIT QUOTE') && editPage.html.includes(NAME) && editPage.text.includes('Line Items'),
    !editPage ? 'did not load' : !editPage.text.includes('EDIT QUOTE') ? 'not the edit form' : !editPage.html.includes(NAME) ? 'customer not seeded' : 'seeded')

  // Edit the draft: customer name and the money, as the form sends them.
  const twoHours = { ...line, amount: 270, amount_max: 270, mobile_hours: 2, mobile_hours_max: 2 }
  const ed = await api('PUT', `/api/hd/quotes/${quoteId}`, {
    company_name: NAME2, customer_name: NAME2, line_items: [twoHours], subtotal_labor: 270, total: 270,
    status: 'draft', quote_number: 'ZZ-HIJACK', user_id: '00000000-0000-0000-0000-000000000000',
  })
  const q1 = (await rest<Record<string, unknown>>(`hd_quotes?id=eq.${quoteId}&select=customer_name,total,status,quote_number,user_id`))[0] ?? {}
  record(F, 'editing a draft saves the changes', ed.status === 200 && q1.customer_name === NAME2 && usd(q1.total) === '270.00' && q1.status === 'draft',
    `-> ${ed.status}, ${q1.customer_name}, ${usd(q1.total)}, ${q1.status}`)
  record(F, 'the edit cannot write fields outside the allow-list',
    q1.quote_number !== 'ZZ-HIJACK' && q1.user_id === OWNER, `number ${q1.quote_number}, owner kept: ${q1.user_id === OWNER}`)

  // Send it, then edit the SENT quote: the customer's link must not change.
  const sent = await api('PUT', `/api/hd/quotes/${quoteId}`, { status: 'sent' })
  const q2 = (await rest<Record<string, unknown>>(`hd_quotes?id=eq.${quoteId}&select=status,public_token`))[0] ?? {}
  const token = String(q2.public_token ?? '')
  if (!record(F, 'marking it sent issues a customer link', sent.status === 200 && q2.status === 'sent' && !!token,
    `-> ${sent.status}, ${q2.status}, token ${token ? 'issued' : 'none'}`)) return
  const ed2 = await api('PUT', `/api/hd/quotes/${quoteId}`, {
    customer_name: NAME2, diagnosis: `${MARK} edited after send`, status: 'draft', public_token: 'zz-rotated',
  })
  const q3 = (await rest<Record<string, unknown>>(`hd_quotes?id=eq.${quoteId}&select=status,public_token,diagnosis`))[0] ?? {}
  record(F, 'editing a SENT quote keeps the same customer link',
    ed2.status === 200 && q3.public_token === token && q3.status === 'sent' && String(q3.diagnosis ?? '').includes('edited after send'),
    `-> ${ed2.status}, token ${q3.public_token === token ? 'unchanged' : 'CHANGED'}, ${q3.status}`)
  const pub = await page(`/hd/quote/${token}`)
  record(F, 'the customer link still opens, showing the edit',
    !!pub && pub.text.includes('edited after send'), !pub ? 'link did not load' : pub.text.includes('edited after send') ? 'shows the change' : 'old content')

  // Approve it: from here it is LOCKED.
  const conv = await api('POST', `/api/hd/quotes/${quoteId}/work-order`, { record_verbal_approval: true, note: `${MARK} edit` })
  const wos = await rest<Record<string, unknown>>(`hd_work_orders?quote_id=eq.${quoteId}&select=id,labor_rate,total_amount`)
  wos.forEach(w => created.hdWorkOrders.add(String(w.id)))
  if (!record(F, 'the quote is approved into a work order', conv.status === 200 && wos.length === 1, `-> ${conv.status}`)) return
  const locked = await api('PUT', `/api/hd/quotes/${quoteId}`, { customer_name: `${MARK} too late`, total: 1 })
  const q4 = (await rest<Record<string, unknown>>(`hd_quotes?id=eq.${quoteId}&select=customer_name,total,status`))[0] ?? {}
  record(F, 'an APPROVED quote refuses edits',
    locked.status === 409 && q4.customer_name === NAME2 && usd(q4.total) === '270.00',
    `-> ${locked.status}, ${q4.status}, total ${usd(q4.total)}`)
  const lockedDetail = await page(`/hd/quotes/${quoteId}`)
  const lockedEdit = await page(`/hd/quotes/${quoteId}/edit`)
  record(F, 'the approved quote says it is locked, and why',
    !!lockedDetail && lockedDetail.text.includes('Locked') && !lockedDetail.html.includes(`/hd/quotes/${quoteId}/edit`)
      && !!lockedEdit && lockedEdit.text.includes('is locked') && lockedEdit.text.includes('agreed to these numbers'),
    !lockedDetail || !lockedEdit ? 'a page did not load' : lockedEdit.text.includes('is locked') ? 'locked, with the reason' : 'no lock notice')

  // ── THE WORK ORDER HEADER ────────────────────────────────────────────────
  const woId = String(wos[0].id)
  const before = wos[0]
  const woDetail = await page(`/hd/work-orders/${woId}`)
  record(F, 'an open work order offers Edit Details',
    !!woDetail && woDetail.text.includes('Edit Details'), !woDetail ? 'did not load' : woDetail.text.includes('Edit Details') ? 'renders' : 'absent')
  const woEdit = await page(`/hd/work-orders/${woId}/edit`)
  record(F, 'the work order edit screen renders the header fields',
    !!woEdit && missingControls(woEdit.text, ['CUSTOMER', 'UNIT', 'Complaint', 'Diagnosis', 'Scheduled', 'Save Changes']).length === 0,
    !woEdit ? 'did not load' : missingControls(woEdit.text, ['CUSTOMER', 'UNIT', 'Complaint', 'Diagnosis', 'Scheduled', 'Save Changes']).join(', ') || 'all render')

  const patch = await api('PATCH', `/api/hd/work-orders/${woId}`, {
    customer_name: `${MARK} wo fixed`, unit_number: 'ZZ-X-UNIT', unit_year: '2019',
    service_requests: `${MARK} fixed complaint`, comments: `${MARK} fixed diagnosis`,
    scheduled_at: '2026-10-20T14:00:00.000Z',
    // Money that must NOT move through this route.
    labor_rate: 999, total_amount: 1, tax_amount: 1,
  })
  const w = (await rest<Record<string, unknown>>(`hd_work_orders?id=eq.${woId}&select=*`))[0] ?? {}
  record(F, 'the header edit saves customer, unit, complaint, diagnosis and schedule',
    patch.status === 200 && w.customer_name === `${MARK} wo fixed` && w.unit_number === 'ZZ-X-UNIT'
      && w.service_requests === `${MARK} fixed complaint` && w.comments === `${MARK} fixed diagnosis`
      && new Date(String(w.scheduled_at)).toISOString() === '2026-10-20T14:00:00.000Z',
    `-> ${patch.status} ${String(patch.json.error ?? '')}`)
  if ('unit_year' in w) {
    record(F, 'the header edit saves the unit year (159)', w.unit_year === '2019', String(w.unit_year))
  } else {
    const notSaved = (patch.json.not_saved ?? []) as string[]
    record(F, 'before 159 the unit year is reported as not saved, not dropped silently',
      notSaved.includes('unit_year'), `not_saved: ${notSaved.join(', ') || 'nothing'}`)
  }
  record(F, 'money does not move through the header edit',
    String(w.labor_rate) === String(before.labor_rate) && String(w.total_amount) === String(before.total_amount),
    `labor_rate ${w.labor_rate}, total ${w.total_amount}`)
  const woAfter = await page(`/hd/work-orders/${woId}`)
  record(F, 'the work order shows the corrected complaint',
    !!woAfter && woAfter.text.includes('fixed complaint') && woAfter.text.includes('ZZ-X-UNIT'),
    !woAfter ? 'did not load' : woAfter.text.includes('fixed complaint') ? 'renders' : 'old text')

  // THE UNIT LINK through the PATCH: one of this shop's units links; an id from
  // anywhere else is refused rather than trusted to the foreign key.
  const unitRes = await fetch(`${SUPA}/rest/v1/hd_units`, {
    method: 'POST', headers: { ...SVC_H, Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: OWNER, unit_number: 'ZZ-X-LINK', manufacturer: 'Thermo King', model: 'S-600', serial_number: 'ZZSERIALX01', status: 'active' }),
  })
  const linkUnitId = unitRes.ok ? String(((await unitRes.json()) as Record<string, unknown>[])[0]?.id ?? '') : ''
  if (linkUnitId) created.fleetUnits.add(linkUnitId)
  if (record(F, 'a unit is arranged to link', !!linkUnitId, `-> ${unitRes.status}`)) {
    const linked = await api('PATCH', `/api/hd/work-orders/${woId}`, { unit_id: linkUnitId })
    const wl = (await rest<Record<string, unknown>>(`hd_work_orders?id=eq.${woId}&select=unit_id`))[0] ?? {}
    record(F, 'the PATCH links the work order to one of the shop\'s units',
      linked.status === 200 && wl.unit_id === linkUnitId, `-> ${linked.status}, unit ${wl.unit_id ?? 'null'}`)
    // A unit id that is not this shop's - a random uuid stands in for another account's.
    const foreign = await api('PATCH', `/api/hd/work-orders/${woId}`, { unit_id: '00000000-0000-4000-8000-000000000000' })
    const wf = (await rest<Record<string, unknown>>(`hd_work_orders?id=eq.${woId}&select=unit_id`))[0] ?? {}
    record(F, 'the PATCH refuses a unit that is not the shop\'s',
      foreign.status === 400 && wf.unit_id === linkUnitId, `-> ${foreign.status}, unit still ${wf.unit_id === linkUnitId ? 'ours' : wf.unit_id}`)
  }

  // Invoiced: locked on the server, and the button is gone.
  await fetch(`${SUPA}/rest/v1/hd_work_orders?id=eq.${woId}`, { method: 'PATCH', headers: SVC_H, body: JSON.stringify({ status: 'invoiced' }) })
  const late = await api('PATCH', `/api/hd/work-orders/${woId}`, { customer_name: `${MARK} too late` })
  const lateDetail = await page(`/hd/work-orders/${woId}`)
  record(F, 'an invoiced work order refuses header edits and hides Edit Details',
    late.status === 409 && !!lateDetail && !lateDetail.text.includes('Edit Details'),
    `-> ${late.status}, button ${lateDetail?.text.includes('Edit Details') ? 'still shown' : 'hidden'}`)
}

// ── Y: the equipment rollup reads one account, against the LIVE database ──
//
// The pure tests (scripts/verify-equipment-rollup.ts) prove the arithmetic ignores
// another shop's rows. This proves the READ does: the loader runs on a client signed in
// as the smoke owner - RLS in force, exactly as a page would - and is asked for ANOTHER
// account's id. It must come back empty. Asked for its own id, it must not.
async function flowY(): Promise<void> {
  const F = 'Y equipment RLS'
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!record(F, 'the anon key is configured', !!anon && !!accessToken, anon ? 'present' : 'NEXT_PUBLIC_SUPABASE_ANON_KEY missing')) return
  const asOwner = createSupabase(SUPA, anon!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  // Any OTHER account that has HD rows - read with the service key only to pick one.
  const other = (await rest<{ user_id: string }>(`hd_units?select=user_id&user_id=neq.${OWNER}&limit=1`))[0]?.user_id
  if (!record(F, 'another account with HD units exists to test against', !!other, other ? 'found' : 'none - cannot test isolation')) return

  const year = { from: `${new Date().getFullYear()}-01-01`, to: `${new Date().getFullYear()}-12-31` }
  try {
    const theirs = await loadRollupInput(asOwner, other!, year, 'America/New_York')
    const leaked = theirs.units.length + theirs.invoices.length + theirs.workOrders.length + theirs.categories.length + theirs.fleets.length
    record(F, 'asking for another account\'s rows returns none of them', leaked === 0,
      `${theirs.units.length} units, ${theirs.invoices.length} invoices, ${theirs.workOrders.length} work orders, ${theirs.categories.length} categories`)

    const mine = await loadRollupInput(asOwner, OWNER, year, 'America/New_York')
    record(F, 'its own rows are readable (the control)', mine.units.length > 0 && mine.workOrders.length > 0,
      `${mine.units.length} units, ${mine.workOrders.length} work orders`)
    record(F, 'every row read belongs to the signed-in account',
      [...mine.units, ...mine.invoices, ...mine.workOrders, ...mine.categories, ...mine.fleets].every(r => r.user_id === OWNER))
    const jobs = jobsFor(mine)
    const byCat = rollupByCategory(mine, jobs)
    const byUnit = rollupByUnit(mine, jobs)
    const catSum = byCat.reduce((s, c) => s + c.invoiced, 0)
    const jobSum = jobs.reduce((s, j) => s + j.invoiced, 0)
    record(F, 'the category table accounts for every job - nothing dropped',
      byCat.reduce((s, c) => s + c.jobs, 0) === jobs.length && Math.abs(catSum - jobSum) < 0.005,
      `${jobs.length} jobs, ${byCat.length} category rows, ${byUnit.length} unit rows, invoiced ${usd(catSum)}`)
  } catch (e) {
    record(F, 'the loader runs as the signed-in user', false, e instanceof Error ? e.message : String(e))
  }
}

// ── W: LD document lines - several lines, detail, $0.00, unchanged, no-op ─────
//
// docs/NWI-ESTIMATE-DOCUMENT-SPEC.md section 7 items 1-2, on the customer's copy.
// The quote is built the way the editor builds it - EditItems through the shared
// line model, money through lib/document-money - not a hand-typed row shape, so the
// fixture is one the product can actually produce. Asserted against RENDERED HTML.
async function flowW(): Promise<void> {
  const F = 'W doc lines'
  const DETAIL = 'Disarm the SRS system, remove the steering wheel,\ntransfer the sensor and reassemble the column.'
  const items: EditItem[] = [
    { _id: 'w1', kind: 'labor', description: `${MARK} Labor: Clock Spring Replacement`, part_number: '',
      quantity: 1.5, unit_price: shop.labor_rate, detail: DETAIL },
    { _id: 'w2', description: `${MARK} Clock spring`, part_number: 'SMOKE-CS', quantity: 1, unit_price: 80 },
    { _id: 'w3', kind: 'labor', description: `${MARK} Diagnostic scan`, part_number: '',
      quantity: 0.5, unit_price: shop.labor_rate, included: true },
    { _id: 'w4', description: `${MARK} Steering column bolt kit`, part_number: '', quantity: 1, unit_price: 12, customer_supplied: true },
    { _id: 'w5', description: `${MARK} Shop rag`, part_number: '', quantity: 1, unit_price: 0 },
  ]
  const money = documentMoney({
    items, markupPct: shop.markup, laborRate: shop.labor_rate, taxPct: shop.taxParts,
    taxSettings: { tax_parts: shop.taxOnParts, tax_labor: shop.taxOnLabor, tax_rate_parts: shop.taxParts, tax_rate_labor: shop.taxLabor },
    extrasSettings: EXTRAS_OFF, extras: { travelHours: 0, mileageMiles: 0 },
  })
  const c = await api('POST', '/api/quotes', { notes: `${MARK} W - document lines`, ...money.columns })
  const qId = (c.json.quote as { id?: string } | undefined)?.id
  if (!record(F, 'a quote with several lines saves', (c.status === 201 || c.status === 200) && !!qId,
    `-> ${c.status} ${qId ? '' : JSON.stringify(c.json).slice(0, 130)}`)) return
  created.quotes.add(qId!)

  const stored = (await rest(`quotes?select=*&id=eq.${qId}`))[0]
  const li = (stored.line_items ?? []) as Array<Record<string, unknown>>
  record(F, 'all five lines stored, in the order arranged',
    li.length === 5 && li.map(l => l.description).join('|') === items.map(i => i.description).join('|'),
    `${li.length} lines`)
  record(F, 'labour lines are typed and summed into labor_hours (1.5 + 0.5)',
    li.filter(l => l.type === 'labor').length === 2 && Number(stored.labor_hours) === 2, `labor_hours ${stored.labor_hours}`)
  record(F, 'detail, included and customer-supplied are stored on their lines',
    li[0].detail === DETAIL && li[2].is_included === true && li[3].customer_supplied === true &&
    Number(li[2].total) === 0 && Number(li[3].total) === 0)

  // A link without SENDING it: preview mints the token and leaves the quote a draft.
  const prev = await api('POST', `/api/quotes/${qId}/send`, { method: 'link', preview: true })
  const url  = String(prev.json.quote_url ?? '')
  const token = url.split('/quote/')[1]
  if (!record(F, 'a customer link exists (preview - not sent)', !!token, `-> ${prev.status}`)) return

  const res = await fetch(`${BASE}/quote/${token}`)
  if (!record(F, 'the customer copy loads', res.ok, `-> ${res.status}`)) return
  const html = await res.text()
  const text = visibleText(html)
  record(F, 'the customer copy shows every line', items.every(i => text.includes(i.description)),
    items.filter(i => !text.includes(i.description)).map(i => i.description).join(', ') || '5 of 5')
  // The detail prints in its own indented element, under its line, with its line break.
  const detailEl = html.match(/data-testid="line-detail"[^>]*>([\s\S]*?)<\/span>/)
  record(F, 'the line detail prints under its line, smaller and indented',
    !!detailEl && visibleText(detailEl[1]).includes('Disarm the SRS system') && /pl-3/.test(html.slice(html.indexOf('data-testid="line-detail"') - 200, html.indexOf('data-testid="line-detail"') + 200)),
    detailEl ? 'line-detail element present' : 'no line-detail element')
  const detailAt = html.indexOf('Disarm the SRS system')
  const lineAt   = html.indexOf(items[0].description)
  record(F, 'the detail follows its own line, not another', lineAt >= 0 && detailAt > lineAt && detailAt - lineAt < 1500,
    `line @${lineAt}, detail @${detailAt}`)
  // Each $0.00 line prints $0.00 in its own row - never blank, never a dash.
  const rowOf = (desc: string) => {
    const at = html.indexOf(desc)
    const start = html.lastIndexOf('<tr', at)
    const end = html.indexOf('</tr>', at)
    return at < 0 || start < 0 || end < 0 ? '' : visibleText(html.slice(start, end))
  }
  const zeroRows = [items[2], items[3], items[4]].map(i => ({ d: i.description, row: rowOf(i.description) }))
  record(F, 'every $0.00 line renders $0.00 cleanly - no blank, no dash',
    zeroRows.every(z => z.row.includes('$0.00') && !/[—–]\s*$/.test(z.row.trim())),
    zeroRows.map(z => `${z.d.replace(`${MARK} `, '')}: "${z.row.replace(/\s+/g, ' ').trim().slice(-40)}"`).join(' | '))
  record(F, 'the included line says "included"; the customer part says so',
    /included/i.test(zeroRows[0].row) && /customer supplied/i.test(zeroRows[1].row))
  record(F, 'the customer copy shows the stored total', text.includes(usd(stored.grand_total)) ||
    text.includes(Number(stored.grand_total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
    `stored ${usd(stored.grand_total)}`)

  // ── A no-op save: open it the way the editor does and save without a change ──
  const markup = markupOnReopen(stored.parts_markup_percent as number | null)
  const reopened = fromLineItems(stored.line_items as never, markup.percent, undefined, { withLabor: true })
  const ext = documentExtras(stored)
  const again = documentMoney({
    items: reopened, markupPct: markup.percent, laborRate: Number(stored.labor_rate ?? 0),
    taxPct: Number(stored.tax_percent ?? 0),
    taxSettings: documentTaxSettings(stored.tax_breakdown, null, Number(stored.tax_percent ?? 0)),
    extrasSettings: ext.settings, extras: ext.input, stored,
  })
  const put = await api('PUT', `/api/quotes/${qId}`, { ...again.columns, notes: stored.notes, customer_name: '', customer_phone: '' })
  const after = (await rest(`quotes?select=*&id=eq.${qId}`))[0]
  const moved = ['grand_total', 'tax_amount', 'labor_subtotal', 'parts_subtotal', 'labor_hours']
    .filter(k => Number(after[k]) !== Number(stored[k]))
  record(F, 'a no-op save changes no total and no line',
    put.status === 200 && moved.length === 0 && JSON.stringify(after.line_items) === JSON.stringify(stored.line_items),
    put.status !== 200 ? `PUT -> ${put.status} ${JSON.stringify(put.json).slice(0, 120)}`
      : moved.length ? moved.map(k => `${k} ${stored[k]} -> ${after[k]}`).join('; ') : `grand ${usd(after.grand_total)} unchanged`)

  // ── An existing document prints as it did ──
  // A real, already-sent quote and invoice of the owner's (not the suite's), read only.
  // Nothing they store carries the new fields, so none of the new markup may appear,
  // and the total they print is still the stored total.
  const oldQ = (await rest(`quotes?select=public_token,grand_total,notes&user_id=eq.${OWNER}&status=eq.sent&public_token=not.is.null&order=created_at.asc&limit=5`))
    .find(q => !String(q.notes ?? '').includes(MARK))
  if (record(F, 'an existing sent quote to compare', !!oldQ, oldQ ? '' : 'none on the owner account')) {
    const r = await fetch(`${BASE}/quote/${oldQ!.public_token}`)
    const h = await r.text()
    record(F, 'an existing quote prints unchanged - no detail, flag or terms markup, same total',
      r.ok && !h.includes('data-testid="line-detail"') && !h.includes('data-testid="line-flag"') &&
      !h.includes('data-testid="terms-block"') && !h.includes('data-testid="discount-row"') &&
      (visibleText(h).includes(usd(oldQ!.grand_total)) || visibleText(h).includes(Number(oldQ!.grand_total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))),
      `-> ${r.status}, stored ${usd(oldQ!.grand_total)}`)
  }
  const oldI = (await rest(`invoices?select=public_token,total,notes&user_id=eq.${OWNER}&public_token=not.is.null&order=created_at.asc&limit=5`))
    .find(i => !String(i.notes ?? '').includes(MARK))
  if (record(F, 'an existing invoice to compare', !!oldI, oldI ? '' : 'none on the owner account')) {
    const r = await fetch(`${BASE}/invoice/${oldI!.public_token}`)
    const h = await r.text()
    record(F, 'an existing invoice prints unchanged - no detail, terms, pay-link or discount markup',
      r.ok && !h.includes('data-testid="line-detail"') && !h.includes('data-testid="terms-block"') &&
        !h.includes('data-testid="pay-link"') && !h.includes('data-testid="discount-row"'),
      `-> ${r.status}`)
  }
}

// ── Tm: the terms block, end to end (migration 164, spec 2.8) ────────────────
//
// Settings saves the three fields; a quote records the shop's terms at its first SEND
// and an invoice at FINALIZE; the customer's copy prints what the document recorded;
// and changing Settings afterwards does not rewrite a document the customer already
// has. The owner's real terms are read first and written back in a finally - and the
// cleanup sweeps a marker left by a crashed run.
async function flowTerms(): Promise<void> {
  const F = 'Tm terms'
  const COLS = 'warranty_terms,customer_supplied_parts_clause,pay_link_url,default_payment_terms,default_payment_instructions'
  const original = (await rest(`profiles?select=${COLS}&id=eq.${OWNER}`))[0]
  if (!record(F, 'the 164 columns exist on the owner profile', !!original && 'warranty_terms' in original,
    original ? '' : 'profiles read failed - is migration 164 applied?')) return

  const WARRANTY_1 = `${MARK} 90 days / 4,000 miles on workmanship.`
  const CLAUSE     = `${MARK} Customer parts are installed without warranty; re-diagnosis is billable.`
  const PAY_LINK   = 'https://pay.example.com/smoke-shop'
  const WARRANTY_2 = `${MARK} CHANGED AFTER SEND - must not appear on a sent document.`
  try {
    // ── Settings ──
    const bad = await api('PUT', '/api/user/profile', { pay_link_url: 'http://pay.example.com/plain' })
    const evil = await api('PUT', '/api/user/profile', { pay_link_url: 'javascript:alert(1)' })
    record(F, 'a non-https or script pay link is refused with a readable message',
      bad.status === 400 && evil.status === 400 && /https/.test(String(bad.json.error ?? '')),
      `http -> ${bad.status}, javascript: -> ${evil.status}`)
    const save = await api('PUT', '/api/user/profile', {
      warranty_terms: `  ${WARRANTY_1}  `, customer_supplied_parts_clause: CLAUSE, pay_link_url: PAY_LINK,
    })
    const saved = (await rest(`profiles?select=${COLS}&id=eq.${OWNER}`))[0]
    if (!record(F, 'Settings saves warranty, clause and pay link (trimmed)',
      save.status === 200 && saved.warranty_terms === WARRANTY_1 && saved.customer_supplied_parts_clause === CLAUSE &&
        saved.pay_link_url === PAY_LINK,
      save.status !== 200 ? `-> ${save.status} ${JSON.stringify(save.json).slice(0, 140)}` : '')) return
    const settings = await page('/settings')
    record(F, 'the Settings page renders the three fields with the saved values',
      !!settings && missingControls(settings.text, ['Pay link (optional)', 'Warranty terms', 'Customer-supplied parts']).length === 0 &&
        settings.html.includes(WARRANTY_1) && settings.html.includes(PAY_LINK) && !settings.text.includes('need migration 164'),
      !settings ? 'did not load'
        : missingControls(settings.text, ['Pay link (optional)', 'Warranty terms', 'Customer-supplied parts']).join(', ') ||
          (settings.html.includes(WARRANTY_1) ? 'renders' : 'saved warranty not in the field'))

    // ── A quote records the terms at its first send ──
    const items: EditItem[] = [
      { _id: 't1', description: `${MARK} Terms check part`, part_number: '', quantity: 1, unit_price: 40 },
    ]
    const money = documentMoney({
      items, markupPct: shop.markup, laborRate: shop.labor_rate, taxPct: shop.taxParts,
      taxSettings: { tax_parts: shop.taxOnParts, tax_labor: shop.taxOnLabor, tax_rate_parts: shop.taxParts, tax_rate_labor: shop.taxLabor },
      extrasSettings: EXTRAS_OFF, extras: { travelHours: 0, mileageMiles: 0 },
    })
    const c = await api('POST', '/api/quotes', { notes: `${MARK} Tm - terms`, ...money.columns })
    const qId = (c.json.quote as { id?: string } | undefined)?.id
    if (!record(F, 'a quote saves', !!qId, `-> ${c.status}`)) return
    created.quotes.add(qId!)

    // A preview link is not a send: nothing may be recorded yet.
    await api('POST', `/api/quotes/${qId}/send`, { method: 'link', preview: true })
    const draft = (await rest(`quotes?select=terms_snapshot,status&id=eq.${qId}`))[0]
    record(F, 'a preview link records no terms (not sent)', draft.terms_snapshot === null, `status ${draft.status}`)

    // 'link' is a real send with no SMS or email: the tech hands the link over.
    const sent = await api('POST', `/api/quotes/${qId}/send`, { method: 'link' })
    const token = String(sent.json.quote_url ?? '').split('/quote/')[1]
    const q = (await rest(`quotes?select=terms_snapshot,status&id=eq.${qId}`))[0]
    const qs = q.terms_snapshot as Record<string, unknown> | null
    record(F, 'the send records the shop\'s terms on the quote',
      sent.status === 200 && q.status === 'sent' && !!qs && qs.version === 1 && qs.warranty === WARRANTY_1 &&
        qs.customer_supplied_clause === CLAUSE && qs.pay_link === PAY_LINK &&
        qs.payment_terms === (saved.default_payment_terms ?? null) &&
        qs.payment_instructions === ((String(saved.default_payment_instructions ?? '').trim()) || null),
      `-> ${sent.status}, status ${q.status}, snapshot ${qs ? JSON.stringify(qs).slice(0, 120) : 'null'}`)
    if (!record(F, 'the sent quote has a customer link', !!token, `-> ${sent.status}`)) return

    const readQuote = async () => {
      const r = await fetch(`${BASE}/quote/${token}`)
      const h = await r.text()
      const m = h.match(/<div data-testid="terms-block"[\s\S]*?<\/div>\s*<\/div>/)
      return { ok: r.ok, status: r.status, block: m ? visibleText(m[0]) : '', blockHtml: m?.[0] ?? '' }
    }
    const qp = await readQuote()
    const qWant = ['Terms', 'Warranty', WARRANTY_1, 'Customer-supplied parts', CLAUSE, 'How to pay', 'Pay online']
    if (saved.default_payment_terms) qWant.push('Payment terms')
    record(F, 'the customer\'s quote prints the Terms block with every recorded row',
      qp.ok && qWant.every(w => qp.block.includes(w)),
      !qp.ok ? `-> ${qp.status}` : qp.block ? `missing: ${qWant.filter(w => !qp.block.includes(w)).join(', ') || 'none'}` : 'no terms-block')
    record(F, 'the quote\'s pay link is the recorded https link, opened safely',
      qp.blockHtml.includes(`href="${PAY_LINK}"`) && /rel="noopener noreferrer nofollow"/.test(qp.blockHtml))

    // ── Settings change after the send ──
    const change = await api('PUT', '/api/user/profile', { warranty_terms: WARRANTY_2 })
    await api('POST', `/api/quotes/${qId}/send`, { method: 'link' })
    const qAfter = (await rest(`quotes?select=terms_snapshot&id=eq.${qId}`))[0]
    const qp2 = await readQuote()
    record(F, 'changing Settings and resending keeps the terms the quote recorded',
      change.status === 200 && (qAfter.terms_snapshot as Record<string, unknown>)?.warranty === WARRANTY_1 &&
        (qAfter.terms_snapshot as Record<string, unknown>)?.captured_at === qs?.captured_at &&
        qp2.block.includes(WARRANTY_1) && !qp2.block.includes(WARRANTY_2),
      `stored warranty "${String((qAfter.terms_snapshot as Record<string, unknown>)?.warranty ?? '').slice(0, 40)}"`)

    // ── An invoice records the terms at finalize ──
    const lineTotal = 40
    const inv = await api('POST', '/api/invoices', {
      invoice_number: `${MARK}-TERMS-${Date.now()}`, notes: `${MARK} Tm - terms`,
      line_items: [{ description: `${MARK} Terms check part`, quantity: 1, unit_price: lineTotal, total: lineTotal }],
      subtotal: lineTotal, tax_rate: 0, tax_amount: 0, total: lineTotal, invoice_status: 'in_progress',
    })
    const invId = (inv.json.invoice as { id?: string } | undefined)?.id
    if (!record(F, 'an in-progress invoice saves', !!invId, `-> ${inv.status} ${invId ? '' : JSON.stringify(inv.json).slice(0, 120)}`)) return
    created.invoices.add(invId!)
    const before = (await rest(`invoices?select=terms_snapshot&id=eq.${invId}`))[0]
    record(F, 'an in-progress invoice records no terms yet', before.terms_snapshot === null)

    const fin = await api('POST', `/api/invoices/${invId}/finalize`)
    const fi = (await rest(`invoices?select=terms_snapshot,public_token,invoice_status&id=eq.${invId}`))[0]
    const isnap = fi.terms_snapshot as Record<string, unknown> | null
    record(F, 'finalize records the shop\'s terms as they stand now',
      (fin.status === 200 || fin.status === 201) && !!isnap && isnap.warranty === WARRANTY_2 &&
        isnap.customer_supplied_clause === CLAUSE && isnap.pay_link === PAY_LINK,
      `-> ${fin.status}, ${isnap ? `warranty "${String(isnap.warranty).slice(0, 40)}"` : 'no snapshot'}`)

    const readInvoice = async () => {
      const r = await fetch(`${BASE}/invoice/${fi.public_token}`)
      const h = await r.text()
      const m = h.match(/<div data-testid="terms-block"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)
      const pay = h.match(/<a[^>]*data-testid="pay-link"[^>]*>/)
      return { ok: r.ok, status: r.status, block: m ? visibleText(m[0]) : '', pay: pay?.[0] ?? '' }
    }
    const ip = await readInvoice()
    record(F, 'the customer\'s invoice prints warranty and clause in the Terms block',
      ip.ok && [WARRANTY_2, CLAUSE, 'Warranty', 'Customer-supplied parts'].every(w => ip.block.includes(w)),
      !ip.ok ? `-> ${ip.status}` : ip.block ? ip.block.slice(0, 120) : 'no terms-block')
    record(F, 'the invoice\'s Terms block does not repeat payment terms or How to pay',
      !!ip.block && !ip.block.includes('Payment terms') && !ip.block.includes('How to pay'))
    record(F, 'the invoice prints the recorded pay link under How to Pay',
      ip.pay.includes(`href="${PAY_LINK}"`) && ip.pay.includes('noopener'), ip.pay ? ip.pay.slice(0, 120) : 'no pay-link')

    // Reopen, change Settings, finalize again: the invoice keeps what it recorded.
    await api('POST', `/api/invoices/${invId}/reopen`)
    await api('PUT', '/api/user/profile', { warranty_terms: WARRANTY_1, pay_link_url: '' })
    const fin2 = await api('POST', `/api/invoices/${invId}/finalize`)
    const fi2 = (await rest(`invoices?select=terms_snapshot&id=eq.${invId}`))[0]
    const ip2 = await readInvoice()
    record(F, 'refinalizing after a Settings change keeps the recorded terms and link',
      (fin2.status === 200 || fin2.status === 201) &&
        (fi2.terms_snapshot as Record<string, unknown>)?.warranty === WARRANTY_2 &&
        ip2.block.includes(WARRANTY_2) && !ip2.block.includes(WARRANTY_1) && ip2.pay.includes(PAY_LINK),
      `-> ${fin2.status}, stored warranty "${String((fi2.terms_snapshot as Record<string, unknown>)?.warranty ?? '').slice(0, 40)}"`)
  } finally {
    // The owner's own terms, exactly as they were - service role, so even values the
    // route would now refuse go back untouched.
    const r = await fetch(`${SUPA}/rest/v1/profiles?id=eq.${OWNER}`, {
      method: 'PATCH', headers: SVC_H,
      body: JSON.stringify({
        warranty_terms: original.warranty_terms ?? null,
        customer_supplied_parts_clause: original.customer_supplied_parts_clause ?? null,
        pay_link_url: original.pay_link_url ?? null,
      }),
    })
    const back = (await rest(`profiles?select=${COLS}&id=eq.${OWNER}`))[0]
    record(F, 'the owner\'s terms are restored to what they were',
      r.ok && back.warranty_terms === original.warranty_terms &&
        back.customer_supplied_parts_clause === original.customer_supplied_parts_clause && back.pay_link_url === original.pay_link_url,
      `-> ${r.status}`)
  }
}

// ── Dc: the discount, end to end (migration 165) ────────────────────────────
//
// The brief's worked example on a real quote: labour 870.00, parts 822.39, 7.75% on
// each, $100 off the whole document -> 1715.80. Saved, printed for the customer,
// saved again with nothing changed, carried to an invoice, changed on the invoice
// while it is in progress, finalized and printed. Then the subscriber's case: an
// invoice already in progress with NO discount takes one without being recreated.
// And a quote -> work order -> invoice carry. Every row is the suite's and is deleted.
//
// Before 165 is applied the discount cannot be stored, so those steps FAIL and say
// so; what can be proven without it (a discount is refused readably, nothing old
// prints a discount row) is still checked.
async function flowDiscount(): Promise<void> {
  const F = 'Dc discount'
  const TAX = { tax_parts: true, tax_labor: true, tax_rate_parts: 7.75, tax_rate_labor: 7.75 }
  const REASON = `${MARK} fleet customer`
  const items: EditItem[] = [
    { _id: 'd1', kind: 'labor', description: `${MARK} Labor: brake job`, part_number: '', quantity: 8.7, unit_price: 100 },
    { _id: 'd2', description: `${MARK} Brake parts`, part_number: 'SMOKE-BRK', quantity: 1, unit_price: 822.39 },
  ]
  const priced = (d: unknown) => documentMoney({
    items, markupPct: 0, laborRate: 100, taxPct: 7.75, taxSettings: TAX,
    extrasSettings: EXTRAS_OFF, extras: { travelHours: 0, mileageMiles: 0 }, discount: normalizeDiscount(d),
  })
  const money = priced({ type: 'flat', value: 100, scope: 'document', reason: REASON })
  record(F, 'the worked example prices to 1715.80 (labor 818.59, parts 773.80, tax 63.44 + 59.97)',
    money.grandTotal === 1715.8 && money.taxBreakdown?.labor?.amount === 63.44 && money.taxBreakdown?.parts?.amount === 59.97,
    `${money.grandTotal}`)

  // ── Is 165 applied? ──
  const probe = await fetch(`${SUPA}/rest/v1/quotes?select=discount&limit=1`, { headers: SVC_H })
  const has165 = probe.ok
  if (!has165) {
    const c = await api('POST', '/api/quotes', { notes: `${MARK} Dc - before 165`, ...money.columns })
    const qId = (c.json.quote as { id?: string } | undefined)?.id
    if (qId) created.quotes.add(qId)
    record(F, 'before 165: a quote WITH a discount is refused readably, never saved without it',
      c.status === 409 && /migration 165/i.test(String(c.json.error ?? '')) && !qId,
      `-> ${c.status} ${String(c.json.error ?? '').slice(0, 90)}`)
    const plain = await api('POST', '/api/quotes', { notes: `${MARK} Dc - before 165, none`, ...priced(null).columns })
    const pId = (plain.json.quote as { id?: string } | undefined)?.id
    if (pId) created.quotes.add(pId)
    record(F, 'before 165: a quote with NO discount still saves', plain.status === 201 && !!pId, `-> ${plain.status}`)
    record(F, 'migration 165 applied - the discount can be stored', false,
      'quotes.discount does not exist yet: apply supabase/migrations/165_document_discount.sql, then rerun')
    return
  }

  // ── The quote ──
  const c = await api('POST', '/api/quotes', { notes: `${MARK} Dc - discount`, ...money.columns })
  const qId = (c.json.quote as { id?: string } | undefined)?.id
  if (!record(F, 'a quote with a discount saves', c.status === 201 && !!qId, `-> ${c.status} ${qId ? '' : JSON.stringify(c.json).slice(0, 120)}`)) return
  created.quotes.add(qId!)
  const q = (await rest(`quotes?select=*&id=eq.${qId}`))[0]
  const qd = q.discount as Record<string, unknown> | null
  record(F, 'stored: 1715.80, tax 123.41, $100 split 51.41 labor / 48.59 parts, with the reason',
    Number(q.grand_total) === 1715.8 && Number(q.tax_amount) === 123.41 && qd?.amount === 100 &&
      qd?.labor_amount === 51.41 && qd?.parts_amount === 48.59 && qd?.reason === REASON,
    `grand ${q.grand_total}, tax ${q.tax_amount}, discount ${JSON.stringify(qd)?.slice(0, 80)}`)

  // A record that contradicts itself is refused, never stored as a negative total.
  const bad = await api('PUT', `/api/quotes/${qId}`, {
    ...money.columns, notes: q.notes, customer_name: '', customer_phone: '',
    discount: { ...(qd ?? {}), amount: 5000, labor_amount: 2500, parts_amount: 2500 }, grand_total: -3000,
  })
  const afterBad = (await rest(`quotes?select=grand_total,discount&id=eq.${qId}`))[0]
  record(F, 'a discount larger than the subtotal is refused with a readable message',
    (bad.status === 422) && /negative|larger than/i.test(String(bad.json.error ?? '')) && Number(afterBad.grand_total) === 1715.8,
    `-> ${bad.status} ${String(bad.json.error ?? '').slice(0, 80)}`)

  // No-op save: reopen exactly as the editor does and save without a change.
  const reopened = fromLineItems(q.line_items as never, 0, undefined, { withLabor: true })
  const again = documentMoney({
    items: reopened, markupPct: 0, laborRate: Number(q.labor_rate ?? 0), taxPct: Number(q.tax_percent ?? 0),
    taxSettings: documentTaxSettings(q.tax_breakdown, null, Number(q.tax_percent ?? 0)),
    extrasSettings: documentExtras(q).settings, extras: documentExtras(q).input,
    discount: parseDiscount(q.discount), stored: q,
  })
  const put = await api('PUT', `/api/quotes/${qId}`, { ...again.columns, notes: q.notes, customer_name: '', customer_phone: '' })
  const q2 = (await rest(`quotes?select=*&id=eq.${qId}`))[0]
  const movedQ = ['grand_total', 'tax_amount', 'labor_subtotal', 'parts_subtotal'].filter(k => Number(q2[k]) !== Number(q[k]))
  record(F, 'a no-op save of the discounted quote moves nothing',
    put.status === 200 && movedQ.length === 0 && JSON.stringify(q2.discount) === JSON.stringify(q.discount),
    put.status !== 200 ? `PUT -> ${put.status}` : movedQ.join(', ') || 'unchanged')

  // ── The customer's quote ──
  const sent = await api('POST', `/api/quotes/${qId}/send`, { method: 'link' })
  const token = String(sent.json.quote_url ?? '').split('/quote/')[1]
  const qPage = token ? await fetch(`${BASE}/quote/${token}`) : null
  const qHtml = qPage ? await qPage.text() : ''
  const qText = visibleText(qHtml)
  const usdc = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const qRow = qHtml.match(/data-testid="discount-row"[\s\S]*?<\/div>/)?.[0] ?? ''
  record(F, 'the customer quote prints Subtotal, the discount with its reason, then the total',
    !!qPage?.ok && qText.includes(usdc(1692.39)) && visibleText(qRow).includes('Discount') && !visibleText(qRow).includes('($100.00)') &&
      visibleText(qRow).includes(REASON) && visibleText(qRow).includes('-$100.00') && qText.includes(usdc(1715.8)) &&
      qText.indexOf(usdc(1692.39)) < qText.indexOf('-$100.00') && qText.indexOf('-$100.00') < qText.lastIndexOf(usdc(1715.8)),
    !qPage ? 'no link' : qRow ? visibleText(qRow).slice(0, 90) : 'no discount-row')

  // ── Carried to an invoice ──
  await api('POST', `/api/quotes/${qId}/respond`, { action: 'approve' })
  const conv = await api('POST', `/api/quotes/${qId}/convert`)
  const invId = (conv.json.invoice as { id?: string } | undefined)?.id
  if (!record(F, 'the approved quote converts to an invoice', conv.status === 201 && !!invId,
    `-> ${conv.status} ${invId ? '' : JSON.stringify(conv.json).slice(0, 120)}`)) return
  created.invoices.add(invId!)
  const inv = (await rest(`invoices?select=*&id=eq.${invId}`))[0]
  record(F, 'the discount carries quote -> invoice unchanged',
    JSON.stringify(inv.discount) === JSON.stringify(q.discount) && Number(inv.total) === 1715.8 &&
      Number(inv.discount_amount) === 100 && Number(inv.subtotal) === 1692.39 && Number(inv.tax_amount) === 123.41,
    `total ${inv.total}, subtotal ${inv.subtotal}, discount_amount ${inv.discount_amount}`)

  // The in-progress screen renders the discount control, already open with it.
  const ip = await page(`/financials/invoices/${invId}`)
  record(F, 'the in-progress invoice renders the discount editor with the carried discount',
    !!ip && ip.html.includes('data-testid="discount-editor"') && ip.html.includes(REASON),
    !ip ? 'did not load' : !ip.html.includes('discount-editor') ? 'no discount editor'
      : !ip.html.includes(REASON) ? 'reason missing' : 'editor open with the reason')

  // Changed while in progress, computed the way the screen computes it: the baseline is
  // the split BEFORE the discount, the discount applied once.
  const inProgress = (row: Record<string, unknown>, d: unknown) => {
    const stored = parseDiscount(row.discount)
    const baseline = stored ? stored.pre_tax_breakdown : parseBreakdown(row.tax_breakdown)
    return applyDiscount({
      discount: normalizeDiscount(d), laborLines: laborFromLines(row.line_items),
      partsLines: partsBaseFromLines(row.line_items), subtotal: Number(row.subtotal),
      breakdown: baseline, taxAmount: breakdownTaxTotal(baseline), taxPct: Number(row.tax_rate ?? 0) * 100,
    })
  }
  const ten = inProgress(inv, { type: 'percent', value: 10, scope: 'document', reason: REASON })
  if (record(F, 'the in-progress figures for 10% compute', ten.ok, ten.ok ? '' : ten.error) && ten.ok) {
    const pr = await api('PATCH', `/api/invoices/${invId}/progress`, {
      subtotal: Number(inv.subtotal), tax_amount: ten.taxAmount, tax_breakdown: ten.breakdown, total: ten.grandTotal, discount: ten.discount,
    })
    const inv2 = (await rest(`invoices?select=*&id=eq.${invId}`))[0]
    record(F, 'an in-progress invoice takes a changed discount and recomputes (10% -> 1641.19)',
      pr.status === 200 && Number(inv2.total) === 1641.19 && Number(inv2.discount_amount) === 169.24 &&
        Number(inv2.tax_amount) === 118.04 && Number(inv2.subtotal) === 1692.39,
      `-> ${pr.status}, total ${inv2.total}, discount ${inv2.discount_amount}, tax ${inv2.tax_amount}`)
    // No-op: the same screen opened again and saved with nothing changed.
    const same = inProgress(inv2, parseDiscount(inv2.discount))
    if (same.ok) {
      await api('PATCH', `/api/invoices/${invId}/progress`, {
        subtotal: Number(inv2.subtotal), tax_amount: same.taxAmount, tax_breakdown: same.breakdown, total: same.grandTotal, discount: same.discount,
      })
    }
    const inv3 = (await rest(`invoices?select=*&id=eq.${invId}`))[0]
    const movedI = ['total', 'tax_amount', 'subtotal', 'discount_amount'].filter(k => Number(inv3[k]) !== Number(inv2[k]))
    record(F, 'a no-op save of the in-progress invoice moves nothing (the discount is not taken twice)',
      same.ok && movedI.length === 0 && JSON.stringify(inv3.tax_breakdown) === JSON.stringify(inv2.tax_breakdown),
      movedI.length ? movedI.map(k => `${k} ${inv2[k]} -> ${inv3[k]}`).join('; ') : `total ${inv3.total}`)
  }

  // ── Finalized and printed ──
  const fin = await api('POST', `/api/invoices/${invId}/finalize`)
  const finRow = (await rest(`invoices?select=public_token,total,invoice_status&id=eq.${invId}`))[0]
  const iPage = finRow.public_token ? await fetch(`${BASE}/invoice/${finRow.public_token}`) : null
  const iHtml = iPage ? await iPage.text() : ''
  const iText = visibleText(iHtml)
  const iRow = iHtml.match(/data-testid="discount-row"[\s\S]*?<\/div>/)?.[0] ?? ''
  record(F, 'the customer invoice prints Subtotal, the discount with its reason, then the total',
    (fin.status === 200 || fin.status === 201) && !!iPage?.ok && iText.includes(usdc(1692.39)) &&
      visibleText(iRow).includes('Discount (10%)') && visibleText(iRow).includes(REASON) &&
      visibleText(iRow).includes('-$169.24') && iText.includes(usdc(1641.19)),
    !iPage ? `finalize -> ${fin.status}, no token` : iRow ? visibleText(iRow).slice(0, 90) : 'no discount-row')
  const finPage = await page(`/financials/invoices/${invId}`)
  record(F, 'the shop\'s finalized view shows the discount row',
    !!finPage && finPage.html.includes('data-testid="discount-row"') && finPage.text.includes('-$169.24'),
    !finPage ? 'did not load' : finPage.html.includes('data-testid="discount-row"') ? '-$169.24 row' : 'discount row missing')

  // ── The subscriber's case: in progress, NO discount, takes one without recreating ──
  const plain = priced(null)
  const c2 = await api('POST', '/api/quotes', { notes: `${MARK} Dc - plain`, ...plain.columns })
  const q2Id = (c2.json.quote as { id?: string } | undefined)?.id
  if (q2Id) {
    created.quotes.add(q2Id)
    await api('POST', `/api/quotes/${q2Id}/send`, { method: 'link' })
    await api('POST', `/api/quotes/${q2Id}/respond`, { action: 'approve' })
    const conv2 = await api('POST', `/api/quotes/${q2Id}/convert`)
    const inv2Id = (conv2.json.invoice as { id?: string } | undefined)?.id
    if (inv2Id) {
      created.invoices.add(inv2Id)
      const before = (await rest(`invoices?select=*&id=eq.${inv2Id}`))[0]
      const ipPlain = await page(`/financials/invoices/${inv2Id}`)
      record(F, 'an in-progress invoice with no discount offers "+ Add discount" and prints no discount row',
        !!ipPlain && ipPlain.html.includes('data-testid="add-discount"') && !ipPlain.html.includes('data-testid="discount-row"'),
        !ipPlain ? 'did not load' : '')
      const labor = inProgress(before, { type: 'flat', value: 100, scope: 'labor', reason: REASON })
      if (labor.ok) {
        const pr = await api('PATCH', `/api/invoices/${inv2Id}/progress`, {
          subtotal: Number(before.subtotal), tax_amount: labor.taxAmount, tax_breakdown: labor.breakdown, total: labor.grandTotal, discount: labor.discount,
        })
        const after = (await rest(`invoices?select=*&id=eq.${inv2Id}`))[0]
        record(F, 'the same invoice - not recreated - takes $100 off labor: 1715.81, parts tax untouched',
          pr.status === 200 && after.id === before.id && Number(after.total) === 1715.81 &&
            (after.tax_breakdown as { parts?: { amount: number } })?.parts?.amount === 63.74 &&
            (after.tax_breakdown as { labor?: { amount: number } })?.labor?.amount === 59.68,
          `-> ${pr.status}, total ${after.total}`)
      } else record(F, 'the same invoice takes $100 off labor', false, labor.error)
    } else record(F, 'a plain quote converts for the in-progress case', false, `-> ${conv2.status}`)
  } else record(F, 'a plain quote saves for the in-progress case', false, `-> ${c2.status}`)

  // ── Quote -> work order -> invoice ──
  // Priced the way THIS shop prices a new quote - its own shop-supplies setting on -
  // because the work order's server re-total applies the shop's supplies to anything
  // that recorded none. A quote with supplies off is a shape this shop's editor does
  // not produce (CLAUDE.md: fixtures from a real shape), and it measured that re-total,
  // not the carry. The worked example's exact figures are proven above and in
  // verify-document-discount; this leg proves the carry: same total on every document.
  const shopExtras = {
    ...EXTRAS_OFF,
    billShopSupplies: shop.billsSupplies, shopSuppliesPercent: shop.suppliesPct, shopSuppliesCap: shop.suppliesCap,
  }
  const viaWo = documentMoney({
    items, markupPct: 0, laborRate: 100, taxPct: 7.75, taxSettings: TAX,
    extrasSettings: shopExtras, extras: { travelHours: 0, mileageMiles: 0 },
    discount: normalizeDiscount({ type: 'flat', value: 100, scope: 'parts', reason: REASON }),
  })
  const c3 = await api('POST', '/api/quotes', { notes: `${MARK} Dc - via work order`, ...viaWo.columns })
  const q3Id = (c3.json.quote as { id?: string } | undefined)?.id
  if (!q3Id) { record(F, 'a quote for the work-order carry saves', false, `-> ${c3.status}`); return }
  created.quotes.add(q3Id)
  const toWo = await api('POST', `/api/quotes/${q3Id}/to-work-order`)
  const woId = (toWo.json.work_order as { id?: string } | undefined)?.id ?? (toWo.json.work_order_id as string | undefined)
  if (!record(F, 'the quote opens a work order', toWo.status === 201 && !!woId, `-> ${toWo.status} ${JSON.stringify(toWo.json).slice(0, 100)}`)) return
  created.workOrders.add(woId!)
  const wo = (await rest(`work_orders?select=*&id=eq.${woId}`))[0]
  const q3 = (await rest(`quotes?select=discount,grand_total,tax_breakdown&id=eq.${q3Id}`))[0]
  const quoted = Number(q3.grand_total)
  const quotedPartsTax = (q3.tax_breakdown as { parts?: { amount: number } })?.parts?.amount
  record(F, 'the work order carries the discount and the quoted total ($100 off parts)',
    JSON.stringify(wo.discount) === JSON.stringify(q3.discount) && Number(wo.grand_total) === quoted &&
      (q3.discount as { parts_amount?: number })?.parts_amount === 100,
    `quote ${usd(quoted)}, work order ${usd(wo.grand_total)}`)
  // A save of the work order - the server re-totals on every write - keeps it.
  await api('PATCH', `/api/work-orders/${woId}`, { job_description: `${MARK} Dc - saved` })
  const woSaved = (await rest(`work_orders?select=grand_total,discount,tax_amount&id=eq.${woId}`))[0]
  record(F, 'a work-order save keeps the discount in its total (server re-total)',
    Number(woSaved.grand_total) === quoted && (woSaved.discount as { amount?: number })?.amount === 100,
    `quote ${usd(quoted)}, saved ${usd(woSaved.grand_total)}, tax ${woSaved.tax_amount}`)
  await api('POST', `/api/work-orders/${woId}/status`, { status: 'complete', notify: false })
  const woConv = await api('POST', `/api/work-orders/${woId}/convert`)
  const woInvId = (woConv.json.invoice as { id?: string } | undefined)?.id
  if (woInvId) created.invoices.add(woInvId)
  const woInv = woInvId ? (await rest(`invoices?select=*&id=eq.${woInvId}`))[0] : null
  record(F, 'and carries work order -> invoice: the quoted total, $100 off parts, the quoted parts tax',
    !!woInv && Number(woInv.total) === quoted && Number(woInv.discount_amount) === 100 &&
      (woInv.tax_breakdown as { parts?: { amount: number } })?.parts?.amount === quotedPartsTax,
    woInv ? `quote ${usd(quoted)}, invoice ${usd(woInv.total)}, discount ${woInv.discount_amount}`
      : `convert -> ${woConv.status} ${JSON.stringify(woConv.json).slice(0, 120)}`)
}

// ── Ie: saving an existing HD invoice (Phase A money fixes) ─────────────────
//
// The editor prices through lib/hd/invoice-edit-save, and this drives that same code
// against a SAVED row, then the real PUT, then reads the row back. The rendered edit
// page is asserted for what the tech sees (the assumed rate, the does-not-add-up
// prompt). scripts/replay-hd-invoice-save.ts runs the unchanged save over every stored
// invoice; this proves the edited paths.
//
// THE FIXTURE IS A REAL ROW. The money of the newest owner invoice that adds up and
// has parts and a stored tax split is copied (inserted directly over REST, so no stock
// ledger runs and no customer is linked), then put into the state each check needs:
// no recorded labor rate (A4), blank terms (A3), no recorded supplies while the shop
// bills them (A1).
async function flowIe(): Promise<void> {
  const F = 'Ie HD invoice edit'
  const candidates = await rest<Record<string, unknown>>(
    `hd_invoices?user_id=eq.${OWNER}&tax_breakdown=not.is.null&subtotal_parts=gt.0&customer_name=not.like.${MARK}*&select=*&order=created_at.desc&limit=20`)
  const real = candidates.find(r => !invoiceDoesNotAddUp(r) && r.shop_supplies_percent_applied == null)
  if (!record(F, 'a real saved invoice to copy the shape of', !!real,
    real ? `${real.invoice_number} (${usd(real.total)})` : 'no owner invoice with parts, a tax split and no supplies adds up')) return

  const prof = (await rest<Record<string, unknown>>(
    `profiles?id=eq.${OWNER}&select=hd_labor_rate,default_labor_rate,bill_shop_supplies,shop_supplies_percent`))[0] ?? {}
  const shopRate = prof.hd_labor_rate != null ? Number(prof.hd_labor_rate) : prof.default_labor_rate != null ? Number(prof.default_labor_rate) : null
  const copy: Record<string, unknown> = {
    user_id: OWNER, status: 'unpaid',
    invoice_number: `${MARK}-IE-${Date.now()}`, customer_name: `${MARK} Ie edit save`,
    line_items: real!.line_items, subtotal_labor: real!.subtotal_labor, subtotal_parts: real!.subtotal_parts,
    diagnostic_fee: real!.diagnostic_fee, road_call_fee: real!.road_call_fee,
    tax_rate: real!.tax_rate, tax_amount: real!.tax_amount, tax_breakdown: real!.tax_breakdown, total: real!.total,
    // The states under test.
    labor_rate: null, payment_terms: null, internal_notes: null,
    travel_hours: 0, travel_rate: null, mileage_miles: 0, mileage_rate: null,
    shop_supplies_percent_applied: null, shop_supplies_cap_applied: null, shop_supplies_fee: 0,
  }
  const ins = await fetch(`${SUPA}/rest/v1/hd_invoices`, {
    method: 'POST', headers: { ...SVC_H, Prefer: 'return=representation' }, body: JSON.stringify(copy),
  })
  const insJson = await ins.json().catch(() => null)
  const id = Array.isArray(insJson) ? String(insJson[0]?.id ?? '') : ''
  if (id) created.hdInvoices.add(id)
  if (!record(F, 'the copy is stored', !!id, id ? '' : `-> ${ins.status} ${JSON.stringify(insJson).slice(0, 160)}`)) return
  const readRow = async () => (await rest<Record<string, unknown>>(`hd_invoices?id=eq.${id}&select=*`))[0] ?? {}

  // ── A4: no recorded labor rate - the shop's, shown as assumed, noted on save ──
  let row = await readRow()
  const pg = await page(`/hd/invoices/${id}/edit`)
  if (record(F, 'the edit page renders', !!pg, pg ? '' : 'did not load')) {
    const want = shopRate != null ? `Assumed rate: $${shopRate.toFixed(2)}/hr from your settings` : 'No labor rate on this invoice and none in your settings'
    record(F, 'a missing labor rate shows as assumed, not invented (A4)', pg!.text.includes(want), want)
    record(F, 'an invoice that adds up shows no correction prompt', !pg!.text.includes('does not add up'))
  }
  const opened = openInvoiceEdit(row, shopRate)
  const body = invoiceSaveBody(row, opened, opened.state)
  record(F, 'an unchanged save writes only the assumed rate and its note (A3, A4)',
    JSON.stringify(Object.keys(body).sort()) === JSON.stringify(shopRate != null ? ['internal_notes', 'labor_rate'] : []),
    JSON.stringify(body).slice(0, 200))
  const put = await api('PUT', `/api/hd/invoices/${id}`, body)
  const after = await readRow()
  record(F, 'the save is accepted', put.status === 200, `-> ${put.status} ${String(put.json.error ?? '')}`)
  record(F, 'blank terms stay blank - no net30 (A3)', after.payment_terms == null, String(after.payment_terms))
  if (shopRate != null) {
    record(F, "the shop's rate is recorded with a note saying so (A4)",
      Number(after.labor_rate) === shopRate && String(after.internal_notes ?? '').includes('taken from shop settings - the invoice had none recorded'),
      `labor_rate ${after.labor_rate}; notes ${JSON.stringify(after.internal_notes)}`)
  }
  record(F, 'the total and tax did not move', usd(after.total) === usd(row.total) && usd(after.tax_amount) === usd(row.tax_amount),
    `total ${usd(row.total)} -> ${usd(after.total)}, tax ${usd(row.tax_amount)} -> ${usd(after.tax_amount)}`)

  // ── An unchanged save of the saved row writes nothing ──
  row = after
  const again = openInvoiceEdit(row, shopRate)
  const none = invoiceSaveBody(row, again, again.state)
  record(F, 'reopened and saved unchanged, nothing is written', Object.keys(none).length === 0, JSON.stringify(none))

  // ── A1 + A5: add a $100.00 part. No recorded supplies stays none; tax is carried ──
  const bd = parseBreakdown(row.tax_breakdown)!
  const partRate = bd.parts?.rate ?? Number(row.tax_rate)
  const partsTaxed = bd.parts ? bd.parts.taxed : true
  const oldPartsBase = bd.parts?.base ?? 0
  const partsTaxDelta = partsTaxed ? r2(r2((oldPartsBase + 100) * partRate / 100) - r2(oldPartsBase * partRate / 100)) : 0
  const edited = { ...again.state, lines: [...again.state.lines, {
    id: crypto.randomUUID(), type: 'parts' as const, description: `${MARK} part`, mobile_hours: 0,
    part_number: '', quantity: 1, unit_cost: 100, amount: 100,
  }] }
  const put2 = await api('PUT', `/api/hd/invoices/${id}`, invoiceSaveBody(row, again, edited))
  const a2 = await readRow()
  record(F, 'the edited save is accepted', put2.status === 200, `-> ${put2.status} ${String(put2.json.error ?? '')}`)
  const billsSupplies = prof.bill_shop_supplies === true && Number(prof.shop_supplies_percent ?? 0) > 0
  record(F, `no recorded supplies stays none${billsSupplies ? ` though the shop bills ${prof.shop_supplies_percent}%` : ' (shop bills none today - check is weaker)'} (A1)`,
    Number(a2.shop_supplies_fee ?? 0) === 0 && a2.shop_supplies_percent_applied == null,
    `fee ${a2.shop_supplies_fee}, pct ${a2.shop_supplies_percent_applied}`)
  record(F, 'the tax moves by exactly the tax on the new part',
    usd(a2.tax_amount) === usd(r2(Number(row.tax_amount) + partsTaxDelta)),
    `${usd(row.tax_amount)} + ${usd(partsTaxDelta)} -> ${usd(a2.tax_amount)}`)
  record(F, 'the total moves by the part and its tax',
    usd(a2.total) === usd(r2(Number(row.total) + 100 + partsTaxDelta)),
    `${usd(row.total)} + 100.00 + ${usd(partsTaxDelta)} -> ${usd(a2.total)}`)
  const bd2 = parseBreakdown(a2.tax_breakdown)
  const split = bd2 ? r2((bd2.parts?.amount ?? 0) + (bd2.labor?.amount ?? 0) + (bd2.services?.amount ?? 0)) : NaN
  record(F, 'the stored tax split sums to the tax, to the cent (A5)', usd(split) === usd(a2.tax_amount),
    `split ${usd(split)} vs tax ${usd(a2.tax_amount)}`)

  // ── A11 shape: a diagnostic fee outside the total (INV-2026-0002's pattern) ──
  const fee = 125
  await fetch(`${SUPA}/rest/v1/hd_invoices?id=eq.${id}`, {
    method: 'PATCH', headers: SVC_H, body: JSON.stringify({ diagnostic_fee: r2(Number(a2.diagnostic_fee ?? 0) + fee) }),
  })
  const broken = await readRow()
  const lb = parseBreakdown(broken.tax_breakdown)?.labor
  const laborTaxDelta = lb && lb.taxed ? r2(r2((lb.base + fee) * lb.rate / 100) - r2(lb.base * lb.rate / 100)) : 0
  const own = r2(Number(broken.total) + fee + laborTaxDelta)
  const prompt = `This invoice does not add up. Its stored total is $${usd(broken.total)} and its own lines and fees come to $${usd(own)}. Bring it to $${usd(own)}?`
  record(F, 'a stored total outside its own lines is refused, never saved silently', !!invoiceDoesNotAddUp(broken),
    JSON.stringify(invoiceDoesNotAddUp(broken)))
  const bpg = await page(`/hd/invoices/${id}/edit`)
  record(F, 'the edit page offers the one correction, worded with both figures',
    !!bpg && bpg.text.includes(prompt), prompt)
  const fix = await api('PUT', `/api/hd/invoices/${id}`, correctionBody(broken))
  const fixed = await readRow()
  record(F, 'taking the correction brings it to its own figure and notes it',
    fix.status === 200 && usd(fixed.total) === usd(own) && String(fixed.internal_notes ?? '').includes('corrected on purpose')
      && !invoiceDoesNotAddUp(fixed),
    `-> ${fix.status}, total ${usd(fixed.total)} (want ${usd(own)}), notes ${JSON.stringify(fixed.internal_notes).slice(0, 120)}`)

  // ── A2: a saved quote that recorded no supplies % does not pick up today's ──
  // The quote editor's pricing is inline in QuoteForm, so this runs the reader it now
  // uses (documentExtras) on a real saved quote, with its supplies set to "none".
  const q = (await rest<Record<string, unknown>>(
    `hd_quotes?user_id=eq.${OWNER}&customer_name=not.like.${MARK}*&select=*&order=created_at.desc&limit=1`))[0]
  if (record(F, 'a real saved quote to read', !!q, q ? String(q.quote_number) : 'none')) {
    const noneRecorded = { ...q, shop_supplies_percent_applied: null, shop_supplies_cap_applied: null }
    const doc = documentExtras(noneRecorded)
    const ex = computeExtras(200, { ...doc.input }, doc.settings, Number(q.labor_rate ?? 0))
    record(F, `a quote with no recorded supplies prices none on $200.00 of parts${billsSupplies ? '' : ' (shop bills none today)'} (A2)`,
      ex.shopSupplies.amount === 0, `supplies ${usd(ex.shopSupplies.amount)}`)
  }
}

// ── Hq: the HD discount and terms, quote -> work order -> invoice ───────────
//
// Migration 168 end to end through the routes and screens a shop uses. The quote is
// built from a REAL saved quote's shape - its money, tax split and extras - with the
// line text and part numbers replaced by SMOKE values, so converting it cannot touch
// real stock. The arithmetic is unit-tested on real rows in verify-hd-discount.ts.
async function flowHq(): Promise<void> {
  const F = 'Hq HD discount + terms'
  const real = (await rest<Record<string, unknown>>(
    `hd_quotes?user_id=eq.${OWNER}&status=eq.approved&tax_breakdown=not.is.null&customer_name=not.like.${MARK}*&select=*&order=created_at.desc&limit=20`))
    .find(q => Array.isArray(q.line_items) && (q.line_items as unknown[]).length > 0 &&
      (q.line_items as Array<Record<string, unknown>>).some(l => l.type === 'labor'))
  if (!record(F, 'a real approved quote to copy the shape of', !!real, real ? String(real.quote_number) : 'none with labor lines and a tax split')) return

  const lines: Array<Record<string, unknown>> = (real!.line_items as Array<Record<string, unknown>>).map((l, i) => ({
    ...l, id: `zz-hq-${i}`, description: `${MARK} hq line ${i}`, part_number: l.type === 'parts' ? `${MARK}-HQ-${i}` : '',
  }))
  const lab = r2(lines.filter(l => l.type === 'labor').reduce((s, l) => s + Number(l.amount ?? 0), 0))
  const par = r2(lines.filter(l => l.type === 'parts').reduce((s, l) => s + Number(l.amount ?? 0), 0))
  const sub = r2(lab + par + Number(real!.diagnostic_fee ?? 0) + Number(real!.road_call_fee ?? 0) +
    Number(real!.travel_amount ?? 0) + Number(real!.mileage_amount ?? 0) + Number(real!.shop_supplies_fee ?? 0))
  const REASON = `${MARK} fleet`
  const d = hdApplyDiscount({ discount: normalizeDiscount({ type: 'flat', value: 25, scope: 'document', reason: REASON }),
    laborLines: lab, partsLines: par, subtotal: sub, breakdown: parseBreakdown(real!.tax_breakdown),
    taxAmount: Number(real!.tax_amount ?? 0), taxRatePct: null })
  if (!record(F, 'the discount prices on the real figures', d.ok, d.ok ? `${usd(sub)} - 25.00, total ${usd(d.grandTotal)}` : d.error)) return
  if (!d.ok || !d.discount) return
  const label = discountPrintLabel(d.discount)

  const pick = (k: string) => real![k] ?? null
  const body: Record<string, unknown> = {
    customer_name: `${MARK} hq discount`, customer_phone: '+15555550166', status: 'sent',
    unit_manufacturer: pick('unit_manufacturer'), unit_model: pick('unit_model'), unit_serial: 'ZZ-HQ-TEST',
    payment_terms: pick('payment_terms'), labor_rate: pick('labor_rate'), labor_hours: pick('labor_hours'),
    parts_markup_percent: pick('parts_markup_percent'), line_items: lines, subtotal_labor: lab, subtotal_parts: par,
    diagnostic_fee: pick('diagnostic_fee'), road_call_fee: pick('road_call_fee'),
    travel_hours: pick('travel_hours'), travel_rate: pick('travel_rate'), travel_amount: pick('travel_amount'),
    mileage_miles: pick('mileage_miles'), mileage_rate: pick('mileage_rate'), mileage_amount: pick('mileage_amount'),
    shop_supplies_percent_applied: pick('shop_supplies_percent_applied'), shop_supplies_cap_applied: pick('shop_supplies_cap_applied'),
    shop_supplies_fee: pick('shop_supplies_fee'),
    tax_rate: pick('tax_rate'), tax_amount: d.taxAmount, tax_breakdown: d.breakdown, total: d.grandTotal, discount: d.discount,
    // A client cannot set the recorded terms. The route drops this.
    terms_snapshot: { version: 1, captured_at: 'x', warranty: `${MARK} forged` },
  }
  const made = await api('POST', '/api/hd/quotes', body)
  await adoptSmokeCustomer(made.json.customer_id)
  const quote = (made.json.quote ?? {}) as Record<string, unknown>
  const quoteId = String(quote.id ?? '')
  if (quoteId) created.hdQuotes.add(quoteId)
  if (!record(F, 'a discounted quote saves as sent', made.status === 201 && !!quoteId, `-> ${made.status} ${String(made.json.error ?? '')}`)) return

  const qRow = (await rest<Record<string, unknown>>(`hd_quotes?id=eq.${quoteId}&select=*`))[0] ?? {}
  const qd = parseDiscount(qRow.discount)
  record(F, 'the quote stores the discount and the discounted total',
    !!qd && qd.amount === 25 && usd(qRow.total) === usd(d.grandTotal) && usd(qRow.tax_amount) === usd(d.taxAmount),
    `discount ${qd?.amount}, total ${usd(qRow.total)}, tax ${usd(qRow.tax_amount)}`)
  const prof = (await rest<Record<string, unknown>>(
    `profiles?id=eq.${OWNER}&select=warranty_terms,customer_supplied_parts_clause,default_payment_terms,default_payment_instructions,pay_link_url`))[0] ?? {}
  const want = termsSnapshotFrom(prof)
  const got = parseTermsSnapshot(qRow.terms_snapshot)
  const sameTerms = (a: ReturnType<typeof parseTermsSnapshot>, b: ReturnType<typeof parseTermsSnapshot>) =>
    !!a && !!b && JSON.stringify({ ...a, captured_at: '' }) === JSON.stringify({ ...b, captured_at: '' })
  record(F, "sent, it records the shop's terms - not the forged ones the body carried",
    sameTerms(got, want) && got?.warranty !== `${MARK} forged`, JSON.stringify(got).slice(0, 160))

  const bad = await api('PUT', `/api/hd/quotes/${quoteId}`, { discount: { ...d.discount, labor_amount: d.discount.labor_amount + 5 } })
  record(F, 'a discount whose parts do not add up is refused', bad.status === 400, `-> ${bad.status} ${String(bad.json.error ?? '')}`)

  const qpg = await page(`/hd/quotes/${quoteId}`)
  record(F, 'the quote screen prints the discount row with its reason, between subtotal and tax',
    !!qpg && qpg.text.includes(label) && qpg.text.includes('-$25.00') && qpg.text.indexOf('Subtotal') < qpg.text.indexOf(label),
    label)
  const qed = await page(`/hd/quotes/${quoteId}/edit`)
  record(F, 'the quote editor renders the discount control and Net 3',
    !!qed && qed.html.includes('data-testid="discount-editor"') && qed.text.includes('Net 3 (due in 3 days)'),
    qed ? '' : 'did not load')

  // Approval -> work order: the discount and the terms travel.
  const token = String(qRow.public_token ?? '')
  const ok = await fetch(`${BASE}/api/hd/quotes/public/${token}/respond`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }) })
  record(F, 'the customer approves it', ok.ok, `-> ${ok.status}`)
  const wo = (await rest<Record<string, unknown>>(`hd_work_orders?quote_id=eq.${quoteId}&select=*`))[0]
  if (wo) created.hdWorkOrders.add(String(wo.id))
  if (!record(F, 'the work order exists', !!wo)) return
  record(F, 'the work order carries the discount and the terms',
    JSON.stringify(parseDiscount(wo.discount)) === JSON.stringify(qd) && sameTerms(parseTermsSnapshot(wo.terms_snapshot), got),
    `discount ${parseDiscount(wo.discount)?.amount}`)
  const wpg = await page(`/hd/work-orders/${wo.id}`)
  record(F, 'the work order screen shows the discount card', !!wpg && wpg.text.includes('DISCOUNT') && wpg.text.includes(`${label} comes to -$25.00`),
    wpg ? '' : 'did not load')

  // Changed on the work order, then put back: the quoted total moves and returns.
  const w10 = await api('PUT', `/api/hd/work-orders/${wo.id}/discount`, { discount: { type: 'percent', value: 10, scope: 'document', reason: REASON } })
  const wAfter = (await rest<Record<string, unknown>>(`hd_work_orders?id=eq.${wo.id}&select=total_amount,tax_amount,discount`))[0] ?? {}
  record(F, 'a work order discount change is priced and saved', w10.status === 200 && parseDiscount(wAfter.discount)?.type === 'percent' &&
    usd(wAfter.total_amount) !== usd(wo.total_amount), `-> ${w10.status}, quoted total ${usd(wo.total_amount)} -> ${usd(wAfter.total_amount)} ${String(w10.json.error ?? '')}`)
  const wBack = await api('PUT', `/api/hd/work-orders/${wo.id}/discount`, { discount: { type: 'flat', value: 25, scope: 'document', reason: REASON } })
  const wRow = (await rest<Record<string, unknown>>(`hd_work_orders?id=eq.${wo.id}&select=total_amount,tax_amount,tax_breakdown`))[0] ?? {}
  record(F, 'put back, the quoted total and tax return to the cent', wBack.status === 200 &&
    usd(wRow.total_amount) === usd(wo.total_amount) && usd(wRow.tax_amount) === usd(wo.tax_amount) &&
    JSON.stringify(parseBreakdown(wRow.tax_breakdown)) === JSON.stringify(parseBreakdown(wo.tax_breakdown)),
    `${usd(wRow.total_amount)} / ${usd(wRow.tax_amount)}`)

  // Convert and bill.
  const built = await api('GET', `/api/hd/work-orders/${wo.id}/convert`)
  const payload = (built.json.invoice_payload ?? {}) as Record<string, unknown>
  record(F, 'the converter bills the discounted quote total exactly', built.status === 200 && usd(payload.total) === usd(qRow.total) &&
    usd(payload.tax_amount) === usd(qRow.tax_amount) && parseDiscount(payload.discount)?.amount === 25,
    `-> ${built.status} total ${usd(payload.total)} (quote ${usd(qRow.total)}) ${String(built.json.error ?? '')}`)
  const inv = await api('POST', '/api/hd/invoices', payload)
  await adoptSmokeCustomer(inv.json.customer_id)
  const invRow = (inv.json.invoice ?? {}) as Record<string, unknown>
  const invId = String(invRow.id ?? '')
  if (invId) created.hdInvoices.add(invId)
  if (!record(F, 'the invoice is created', (inv.status === 201 || inv.status === 200) && !!invId, `-> ${inv.status} ${String(inv.json.error ?? '')}`)) return
  const stored = (await rest<Record<string, unknown>>(`hd_invoices?id=eq.${invId}&select=*`))[0] ?? {}
  record(F, "the invoice stores the discount, the quote total and the quote's terms",
    parseDiscount(stored.discount)?.amount === 25 && usd(stored.total) === usd(qRow.total) &&
    sameTerms(parseTermsSnapshot(stored.terms_snapshot), got) && !invoiceDoesNotAddUp(stored),
    `total ${usd(stored.total)}`)
  const ipg = await page(`/hd/invoices/${invId}`)
  record(F, 'the invoice screen prints the discount row with its reason', !!ipg && ipg.text.includes(label) && ipg.text.includes('-$25.00'))
  const ied = await page(`/hd/invoices/${invId}/edit`)
  record(F, 'the invoice editor opens on the discount, with no correction prompt',
    !!ied && ied.html.includes('data-testid="discount-editor"') && !ied.text.includes('does not add up'))
  const o = openInvoiceEdit(stored, null)
  record(F, 'reopened and saved unchanged, the invoice writes nothing (no double discount)',
    Object.keys(invoiceSaveBody(stored, o, o.state)).length === 0)
  const locked = await api('PUT', `/api/hd/work-orders/${wo.id}/discount`, { discount: null })
  record(F, 'once invoiced, the work order discount is locked', locked.status === 409, `-> ${locked.status}`)

  // The settings screen exposes the five terms fields and Net 3.
  const spg = await page('/hd/settings')
  const fields = ['default_payment_terms', 'default_payment_instructions', 'pay_link_url', 'warranty_terms', 'customer_supplied_parts_clause']
  const missing = spg ? fields.filter(f => !spg.html.includes(`name="${f}"`)) : fields
  record(F, 'HD settings shows the five terms fields', !!spg && missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : '')
  record(F, 'and offers Net 3', !!spg && spg.text.includes('Net 3'))
}

// ── Pe: the three customer documents - discount, terms, tax labels, contrast ──
//
// The PDF (/api/hd/invoices/[id]/pdf), the customer's quote (/hd/quote/[token]) and
// the pay page (/hd/invoices/pay/[token]), read as HTML. Fixtures are SMOKE copies of
// a real quote and a real invoice (their money, tax split and extras), with a discount
// priced by the shared engine and a recorded terms snapshot.
//
// CONTRAST. Text that IS in the HTML can still be unreadable - the quote form's Tax %
// rendered white on white and passed every check. So every text colour these pages set
// is checked: a hardcoded hex must reach 4.5:1 on white - no hardcoded LIGHT text
// colour. Pure white is allowed (it appears only on a dark fill), and theme tokens are
// left to the in-browser audit, which knows the background they land on. That
// measurement of every
// HD screen in both themes is scripts/audit-contrast.ts (needs a browser; not smoke).
const lumHex = (hex: string) => {
  const h = hex.replace('#', ''); const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const ch = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
const onWhite = (hex: string) => 1.05 / (lumHex(hex) + 0.05)
/** Every text colour a page sets: inline style="color:..." and stylesheet `color:` (not background/border). */
function textColours(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/(?<![-\w])color:\s*(#[0-9a-fA-F]{3,6}\b|white\b|rgba?\([^)]*\)|var\([^)]*\))/g)) out.push(m[1])
  return out
}
function hardcodedLight(html: string): string[] {
  const bad = new Set<string>()
  for (const c of textColours(html)) {
    if (c.startsWith('var(')) continue
    const hex = c === 'white' ? '#ffffff' : c.startsWith('#') ? c : null
    if (!hex) { if (/rgba?\(\s*2[0-9]{2}/.test(c)) bad.add(c); continue }   // a light rgb()
    if (!/^#(fff|ffffff)$/i.test(hex) && onWhite(hex) < 4.5) bad.add(hex)
  }
  return [...bad]
}
async function flowPe(): Promise<void> {
  const F = 'Pe HD print surfaces'
  const realQ = (await rest<Record<string, unknown>>(
    `hd_quotes?user_id=eq.${OWNER}&status=eq.approved&tax_breakdown=not.is.null&customer_name=not.like.${MARK}*&select=*&order=created_at.desc&limit=1`))[0]
  const realI = (await rest<Record<string, unknown>>(
    `hd_invoices?user_id=eq.${OWNER}&tax_breakdown=not.is.null&customer_name=not.like.${MARK}*&select=*&order=created_at.desc&limit=20`))
    .find(r => !invoiceDoesNotAddUp(r))
  if (!record(F, 'a real quote and invoice to copy the shape of', !!realQ && !!realI,
    `${realQ?.quote_number ?? 'no quote'} / ${realI?.invoice_number ?? 'no invoice'}`)) return

  const REASON = `${MARK} fleet`
  const TERMS = {
    version: 1, captured_at: new Date().toISOString(),
    warranty: `${MARK} 90 days on workmanship.`, customer_supplied_clause: `${MARK} customer parts carry no warranty.`,
    payment_terms: 'net_7', payment_instructions: `${MARK} checks payable to the shop.`, pay_link: 'https://pay.example.com/smoke',
  }
  const discounted = (doc: Record<string, unknown>) => {
    const lines = Array.isArray(doc.line_items) ? doc.line_items as Array<Record<string, unknown>> : []
    const lab = r2(lines.filter(l => l.type === 'labor').reduce((s, l) => s + Number(l.amount ?? 0), 0))
    const par = r2(lines.filter(l => l.type === 'parts').reduce((s, l) => s + Number(l.amount ?? 0), 0))
    const sub = r2(lab + par + Number(doc.diagnostic_fee ?? 0) + Number(doc.road_call_fee ?? 0) +
      Number(doc.travel_amount ?? 0) + Number(doc.mileage_amount ?? 0) + Number(doc.shop_supplies_fee ?? 0))
    return hdApplyDiscount({ discount: normalizeDiscount({ type: 'flat', value: 25, scope: 'document', reason: REASON }),
      laborLines: lab, partsLines: par, subtotal: sub, breakdown: parseBreakdown(doc.tax_breakdown),
      taxAmount: Number(doc.tax_amount ?? 0), taxRatePct: null })
  }
  const tok = () => Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
  const DROP = ['id', 'created_at', 'updated_at', 'customer_id', 'fleet_account_id', 'unit_id', 'work_order_id', 'quote_id', 'public_token']
  const strip = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([k]) => !DROP.includes(k)))
  const insert = async (table: string, row: Record<string, unknown>, bucket: Set<string>) => {
    const res = await fetch(`${SUPA}/rest/v1/${table}`, { method: 'POST', headers: { ...SVC_H, Prefer: 'return=representation' }, body: JSON.stringify(row) })
    const j = await res.json().catch(() => null)
    const id = Array.isArray(j) ? String(j[0]?.id ?? '') : ''
    if (id) bucket.add(id)
    return id ? j[0] as Record<string, unknown> : null
  }

  const dq = discounted(realQ!), di = discounted(realI!)
  if (!record(F, 'the discount prices on both real documents', dq.ok && di.ok, dq.ok && di.ok ? '' : `${dq.ok ? '' : dq.error} ${di.ok ? '' : di.error}`)) return
  if (!dq.ok || !di.ok) return
  const money = (d: typeof dq & { ok: true }) => ({ discount: d.discount, tax_amount: d.taxAmount, tax_breakdown: d.breakdown, total: d.grandTotal })
  const q = await insert('hd_quotes', { ...strip(realQ!), ...money(dq), quote_number: `${MARK}-PE-${Date.now()}`,
    customer_name: `${MARK} Pe quote`, status: 'sent', public_token: tok(), approved_at: null, approval_method: null,
    payment_terms: 'net30', terms_snapshot: TERMS }, created.hdQuotes)
  const inv = await insert('hd_invoices', { ...strip(realI!), ...money(di), invoice_number: `${MARK}-PE-${Date.now()}`,
    customer_name: `${MARK} Pe invoice`, status: 'sent', public_token: tok(), payment_terms: null, terms_snapshot: TERMS }, created.hdInvoices)
  // No discount, no terms anywhere: prints exactly as an old invoice did, with no Terms line.
  const bare = await insert('hd_invoices', { ...strip(realI!), invoice_number: `${MARK}-PE0-${Date.now()}`,
    customer_name: `${MARK} Pe bare`, status: 'sent', public_token: tok(), payment_terms: null, terms_snapshot: null, discount: null }, created.hdInvoices)
  if (!record(F, 'the fixtures are stored', !!q && !!inv && !!bare)) return

  const label = discountPrintLabel(dq.discount!)
  const surfaces: Array<{ name: string; url: string; auth: boolean; themed: boolean; doc: Record<string, unknown>; ownTerms: string }> = [
    { name: 'PDF', url: `/api/hd/invoices/${inv!.id}/pdf`, auth: true, themed: false, doc: inv!, ownTerms: 'Net 7' },
    { name: 'pay page', url: `/hd/invoices/pay/${inv!.public_token}`, auth: false, themed: false, doc: inv!, ownTerms: 'Net 7' },
    { name: 'customer quote', url: `/hd/quote/${q!.public_token}`, auth: false, themed: true, doc: q!, ownTerms: 'Net 30' },
  ]
  for (const s of surfaces) {
    const res = await fetch(`${BASE}${s.url}`, { headers: s.auth ? { cookie } : {}, redirect: 'follow' })
    const html = res.ok ? await res.text() : ''
    const text = visibleText(html)
    if (!record(F, `${s.name}: renders`, res.ok && !!html, `-> ${res.status}`)) continue
    const d = parseDiscount(s.doc.discount)!
    const rowHtml = html.match(/data-testid="discount-row"[\s\S]*?<\/div>/)?.[0] ?? ''
    record(F, `${s.name}: the discount row, with its reason`, visibleText(rowHtml).includes(label), visibleText(rowHtml).slice(0, 80) || 'no discount-row')
    record(F, `${s.name}: the minus sign and the amount are ONE text node`,
      new RegExp(`>-\\$${usd(d.amount).replace('.', '\\.')}<`).test(rowHtml), rowHtml.replace(/\s+/g, ' ').slice(-90))
    const iSub = text.indexOf('Subtotal'), iDisc = text.indexOf(label)
    const firstTax = html.search(/data-testid="tax-row"/), discAt = html.indexOf('data-testid="discount-row"')
    record(F, `${s.name}: subtotal, then the discount, then the tax`, iSub >= 0 && iSub < iDisc && discAt >= 0 && discAt < firstTax,
      `subtotal ${iSub}, discount ${iDisc}, tax row ${firstTax}`)
    // The tax label states the rate this document recorded.
    const bd = parseBreakdown(s.doc.tax_breakdown)
    const rates = bd ? (['parts', 'labor', 'services'] as const).map(k => bd[k]).filter(b => b && b.taxed && b.amount > 0).map(b => b!.rate) : [Number(s.doc.tax_rate)]
    const taxLabels = [...html.matchAll(/data-testid="tax-row"[\s\S]*?<\/div>/g)].map(m => visibleText(m[0]))
    record(F, `${s.name}: every tax label carries its recorded rate`,
      rates.length > 0 && rates.every(r => taxLabels.some(l => l.includes(`${String(r)}%`))), `rates ${rates.join(', ')}; labels ${JSON.stringify(taxLabels).slice(0, 120)}`)
    // The terms block: warranty, the clause, how to pay - recorded, at the bottom.
    const block = visibleText(html.match(/data-testid="terms-block"[\s\S]*$/)?.[0] ?? '')
    record(F, `${s.name}: the terms block prints what was recorded`,
      block.includes(TERMS.warranty) && block.includes(TERMS.customer_supplied_clause) && block.includes(TERMS.payment_instructions) && block.includes(TERMS.pay_link),
      block.slice(0, 100) || 'no terms-block')
    const pt = visibleText(html.match(/data-testid="payment-terms"[^>]*>[\s\S]*?<\/p>/)?.[0] ?? '')
    record(F, `${s.name}: payment terms are the document's own (${s.ownTerms}), else its recorded ones`, pt.includes(s.ownTerms), pt || 'no payment-terms line')
    const light = hardcodedLight(html)
    record(F, `${s.name}: no text uses a hardcoded light colour`, light.length === 0, light.join(', '))
  }
  // The bare invoice: no discount row, no terms block, and no invented "Terms:" line.
  for (const [name, url, auth] of [['PDF', `/api/hd/invoices/${bare!.id}/pdf`, true], ['pay page', `/hd/invoices/pay/${bare!.public_token}`, false]] as const) {
    const res = await fetch(`${BASE}${url}`, { headers: auth ? { cookie } : {}, redirect: 'follow' })
    const html = res.ok ? await res.text() : ''
    record(F, `${name}, nothing recorded: no discount row, no terms block, no payment terms line`,
      res.ok && !html.includes('data-testid="discount-row"') && !html.includes('data-testid="terms-block"') && !html.includes('data-testid="payment-terms"'),
      res.ok ? '' : `-> ${res.status}`)
  }
}

// ── Z: equipment categories, By Equipment and the audit exports ─────────────
//
// docs/KURT-EQUIPMENT-TRACKING-SPEC.md, end to end through the routes a shop uses. The
// rollup arithmetic is unit-tested in scripts/verify-equipment-rollup.ts; this proves
// the SCREENS and the API produce it from real rows: a unit with several invoiced jobs,
// an open work order that is not a job, paid vs unpaid, Uncategorized, a category move,
// and the LD-only gate.
//
// NOTE: the first call into categories seeds the owner's defaults (migration 161's
// hd_ensure_equipment_categories) - the same thing the shop's first visit does.
async function flowZ(): Promise<void> {
  const F = 'Z equipment'
  const year = new Date().getFullYear()
  const RANGE = `from=${year}-01-01&to=${year}-12-31`

  // ── categories ──
  const list = await api('GET', '/api/hd/equipment-categories')
  const cats = (list.json.categories ?? []) as Array<Record<string, unknown>>
  if (!record(F, 'categories load (seeded on first access)', list.status === 200 && cats.length > 0,
    `-> ${list.status}, ${cats.length} categories`)) return
  record(F, 'every category returned is the owner\'s', cats.every(c => c.user_id === OWNER))
  const CAT = `${MARK} Crane`
  const add = await api('POST', '/api/hd/equipment-categories', { name: CAT })
  const added = ((add.json.categories ?? []) as Array<Record<string, unknown>>).find(c => c.name === CAT)
  if (added?.id) created.equipmentCategories.add(String(added.id))
  record(F, 'a shop can add its own category', add.status === 201 && !!added, `-> ${add.status}`)
  const dupe = await api('POST', '/api/hd/equipment-categories', { name: CAT.toLowerCase() })
  record(F, 'the same name in another case is refused readably',
    dupe.status === 409 && /already exists/i.test(String(dupe.json.error ?? '')), `-> ${dupe.status} ${String(dupe.json.error ?? '')}`)
  const blank = await api('POST', '/api/hd/equipment-categories', { name: '   ' })
  record(F, 'a blank category name is refused', blank.status === 400, `-> ${blank.status}`)

  // ── the units screens ──
  const units = await page('/hd/fleet-units')
  record(F, 'the units list renders the category controls',
    !!units && missingControls(units.text, ['Manage categories', 'Category']).length === 0
      && units.html.includes('name="unit_category"') && units.html.includes('Select all loaded units'),
    !units ? 'did not load' : missingControls(units.text, ['Manage categories', 'Category']).join(', ') || 'renders')
  const unitForm = await page('/hd/fleet-units?new=1')
  record(F, 'the unit form picks a category, not truck/trailer',
    !!unitForm && unitForm.html.includes('name="category_id"') && !unitForm.html.includes('name="unit_type"'),
    !unitForm ? 'did not load' : unitForm.html.includes('name="unit_type"') ? 'the old unit_type select still renders' : 'category select')
  // A new unit must say what it is: the select is required and nothing is preselected.
  const catSelect = unitForm?.html.match(/<select[^>]*name="category_id"[^>]*>([\s\S]*?)<\/select>/)
  record(F, 'a new unit must choose a category - required, no default',
    !!catSelect && /\srequired(=""|\s|>)/.test(catSelect[0].slice(0, catSelect[0].indexOf('>') + 1))
      // The empty placeholder is the selected-and-disabled entry, so the browser refuses
      // to submit until a real category is picked; no real category may be preselected.
      && /<option value="" disabled=""( selected="")?>Choose a category<\/option>/.test(catSelect[1]) && !catSelect[1].includes('>Uncategorized<')
      && !/<option value="[^"]+"[^>]*selected/.test(catSelect[1]),
    !catSelect ? 'category select not found' : catSelect[0].slice(0, 120))

  // ── the CSV importer reads the type from the file, and leaves it blank otherwise ──
  const uncIn = async () => (((await api('GET', '/api/hd/financials/equipment?' + RANGE)).json.categories ?? []) as Array<Record<string, any>>)
    .find(c => c.key === '__uncategorized__')?.unitsInClass ?? 0
  const uncBefore = await uncIn()
  const imp = await api('POST', '/api/hd/import/units', { rows: [
    { unit_number: 'ZZ-TYPE-1', manufacturer: 'Thermo King', model: 'S-600', serial_number: 'ZZSERIALTY01', unit_type: 'truck' },
    { unit_number: 'ZZ-TYPE-2', manufacturer: 'Thermo King', model: 'S-600', serial_number: 'ZZSERIALTY02', unit_type: 'Hovercraft' },
    { unit_number: 'ZZ-TYPE-3', manufacturer: 'Thermo King', model: 'S-600', serial_number: 'ZZSERIALTY03' },
  ] })
  const impTypes = imp.json.types as Record<string, any> | undefined
  record(F, 'the CSV import reports which types matched and which landed Uncategorized',
    imp.status === 200 && imp.json.imported === 3 && impTypes?.categorized === 1 && impTypes?.uncategorized === 2
      && impTypes?.noTypeInFile === 1 && impTypes?.unmatchedTypes?.[0]?.type === 'Hovercraft',
    `-> ${imp.status} ${JSON.stringify(impTypes ?? imp.json.error ?? '')}`)
  const typed = await rest<{ serial_number: string; category_id: string | null; unit_type: string | null }>(
    `hd_units?select=serial_number,category_id,unit_type&user_id=eq.${OWNER}&serial_number=in.(ZZSERIALTY01,ZZSERIALTY02,ZZSERIALTY03)`)
  const bySerial = new Map(typed.map(u => [u.serial_number, u]))
  const truckCat = cats.find(c => String(c.name).toLowerCase() === 'truck')
  const t1 = bySerial.get('ZZSERIALTY01'), t2 = bySerial.get('ZZSERIALTY02'), t3 = bySerial.get('ZZSERIALTY03')
  record(F, 'a type naming a category sets it (and unit_type mirrors it)',
    !!truckCat && t1?.category_id === truckCat.id && t1?.unit_type === 'truck', JSON.stringify(t1))
  record(F, "a type naming no category is left blank - not Trailer",
    !!t2 && t2.category_id === null && t2.unit_type === null, JSON.stringify(t2))
  record(F, "no type in the file is left blank - not Trailer",
    !!t3 && t3.category_id === null && t3.unit_type === null, JSON.stringify(t3))
  const uncAfter = await uncIn()
  record(F, 'the blank units show in the report under Uncategorized', uncAfter === uncBefore + 2, `units in class ${uncBefore} -> ${uncAfter}`)

  const manage = await page('/hd/fleet-units/categories')
  record(F, 'the category management screen renders',
    !!manage && missingControls(manage.text, ['EQUIPMENT CATEGORIES', 'Add category', 'Uncategorized']).length === 0,
    !manage ? 'did not load' : missingControls(manage.text, ['EQUIPMENT CATEGORIES', 'Add category', 'Uncategorized']).join(', ') || 'renders')

  // ── a unit with several invoiced jobs, an open work order, paid vs unpaid ──
  const uRes = await fetch(`${SUPA}/rest/v1/hd_units`, {
    method: 'POST', headers: { ...SVC_H, Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: OWNER, unit_number: 'ZZ-EQ-1', manufacturer: 'Thermo King', model: 'S-600', serial_number: 'ZZSERIALEQ01', status: 'active' }),
  })
  const unitId = uRes.ok ? String(((await uRes.json()) as Record<string, unknown>[])[0]?.id ?? '') : ''
  if (unitId) created.fleetUnits.add(unitId)
  if (!record(F, 'an uncategorized unit is arranged', !!unitId, `-> ${uRes.status}`)) return

  // Invoice rows in the shape the app stores (INV-2026-0020's labor line).
  const labor = { id: 'zz-eq-l', type: 'labor', amount: 202.5, quantity: 0, unit_cost: 0, description: `${MARK} eq labor`, part_number: '', mobile_hours: 1.5 }
  const mkInv = async (n: string, total: number, status: string, lines: unknown[]) => {
    const r = await fetch(`${SUPA}/rest/v1/hd_invoices`, {
      method: 'POST', headers: { ...SVC_H, Prefer: 'return=representation' },
      body: JSON.stringify({ user_id: OWNER, invoice_number: `ZZ-EQ-${n}`, customer_name: `${MARK} eq customer`,
        unit_id: unitId, status, total, subtotal_labor: lines.length ? 202.5 : 0, subtotal_parts: 0, tax_amount: 0, line_items: lines }),
    })
    const id = r.ok ? String(((await r.json()) as Record<string, unknown>[])[0]?.id ?? '') : ''
    if (id) created.hdInvoices.add(id)
    return id
  }
  const paidId   = await mkInv('PAID', 202.5, 'paid', [labor])
  const unpaidId = await mkInv('UNPAID', 50, 'unpaid', [])
  const woRes = await fetch(`${SUPA}/rest/v1/hd_work_orders`, {
    method: 'POST', headers: { ...SVC_H, Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: OWNER, work_order_number: 'ZZ-EQ-OPEN', status: 'open', unit_id: unitId,
      customer_name: `${MARK} eq customer`, total_amount: 999, service_type: 'Diagnostic' }),
  })
  const openWo = woRes.ok ? String(((await woRes.json()) as Record<string, unknown>[])[0]?.id ?? '') : ''
  if (openWo) created.hdWorkOrders.add(openWo)
  if (!record(F, 'two invoices and an open work order are arranged on it', !!paidId && !!unpaidId && !!openWo,
    `paid ${!!paidId}, unpaid ${!!unpaidId}, wo ${!!openWo}`)) return

  const eq = await api('GET', `/api/hd/financials/equipment?${RANGE}`)
  const urow = ((eq.json.units ?? []) as Array<Record<string, any>>).find(u => u.unitId === unitId)
  if (record(F, 'By Equipment returns the unit', eq.status === 200 && !!urow, `-> ${eq.status} ${String(eq.json.error ?? '')}`)) {
    record(F, 'a unit with several invoiced jobs rolls up (2 jobs, 252.50)', urow!.jobs === 2 && usd(urow!.invoiced) === '252.50',
      `jobs ${urow!.jobs}, invoiced ${usd(urow!.invoiced)}`)
    record(F, 'an open work order is not a job', urow!.jobsFromWorkOrders === 0, `${urow!.jobsFromWorkOrders} work-order jobs`)
    record(F, 'invoiced and collected differ on an unpaid invoice', usd(urow!.collected?.value) === '202.50' && urow!.collected?.missing === 0,
      `collected ${usd(urow!.collected?.value)}, unknown on ${urow!.collected?.missing}`)
    record(F, 'hours come from the labor line, and a job without them is counted as unrecorded',
      urow!.laborHours?.value === 1.5 && urow!.laborHours?.missing === 1, JSON.stringify(urow!.laborHours))
    record(F, 'an uncategorized unit reports under Uncategorized', urow!.categoryName === 'Uncategorized', String(urow!.categoryName))
    const unc = ((eq.json.categories ?? []) as Array<Record<string, any>>).find(c => c.key === '__uncategorized__')
    record(F, 'the Uncategorized row carries it', !!unc && unc.jobs >= 2, JSON.stringify({ jobs: unc?.jobs }))
  }

  // Move it into the shop's own category: the trigger mirrors the name into unit_type.
  if (added?.id) {
    const set = await api('POST', '/api/hd/fleet-units/category', { unit_ids: [unitId], category_id: added.id })
    const u = (await rest<Record<string, unknown>>(`hd_units?id=eq.${unitId}&select=category_id,unit_type`))[0] ?? {}
    record(F, 'setting a category saves, and unit_type mirrors its name',
      set.status === 200 && u.category_id === added.id && u.unit_type === CAT.toLowerCase(), `-> ${set.status}, unit_type ${u.unit_type}`)
    const eq2 = await api('GET', `/api/hd/financials/equipment?${RANGE}`)
    const crow = ((eq2.json.categories ?? []) as Array<Record<string, any>>).find(c => c.key === added.id)
    record(F, 'the unit\'s jobs move to that category', crow?.jobs === 2 && usd(crow?.invoiced) === '252.50', JSON.stringify({ jobs: crow?.jobs, invoiced: crow?.invoiced }))
    const foreign = await api('POST', '/api/hd/fleet-units/category', { unit_ids: ['00000000-0000-4000-8000-000000000000'], category_id: added.id })
    record(F, 'a unit that is not the shop\'s is refused', foreign.status === 404, `-> ${foreign.status}`)
  }

  const bad = await api('GET', '/api/hd/financials/equipment?from=2026-06-01&to=2026-05-01')
  record(F, 'By Equipment refuses a backwards range', bad.status === 400, `-> ${bad.status}`)
  const fin = await page('/hd/financials')
  record(F, 'HD Financials offers the By Equipment tab', !!fin && fin.text.includes('By Equipment'), !fin ? 'did not load' : 'tab text')

  // ── the audit exports ──
  const audit = await page(`/hd/reports/audit?${RANGE}`)
  record(F, 'the audit page renders all four downloads and the labels form',
    !!audit && ['audit-schedule-pdf', 'audit-schedule-csv', 'audit-packet-pdf', 'audit-packet-csv', 'audit-labels'].every(t => audit.html.includes(`data-testid="${t}"`)),
    !audit ? 'did not load' : 'testids')
  for (const [kind, fmt] of [['audit-schedule', 'pdf'], ['audit-schedule', 'csv'], ['audit-packet', 'pdf'], ['audit-packet', 'csv']] as const) {
    const res = await fetch(`${BASE}/api/hd/reports/${kind}?${RANGE}&format=${fmt}`, { headers: { cookie } })
    const buf = Buffer.from(await res.arrayBuffer())
    const ok = fmt === 'pdf'
      ? res.status === 200 && buf.subarray(0, 5).toString() === '%PDF-'
      : res.status === 200 && /text\/csv/.test(res.headers.get('content-type') ?? '')
    let detail = `-> ${res.status} ${res.headers.get('content-type')}`
    let extra = true
    if (ok && kind === 'audit-schedule' && fmt === 'csv') {
      const text = buf.toString('utf8').replace(/^\uFEFF/, '')
      extra = text.split(/\r?\n/)[0].startsWith('section') && text.includes(`ZZ-EQ-1`)
      detail += extra ? ', unit in appendix' : ', the smoke unit is missing from the appendix'
    }
    if (ok && kind === 'audit-packet' && fmt === 'csv') {
      const text = buf.toString('utf8').replace(/^\uFEFF/, '')
      extra = text.split(/\r?\n/)[0].includes('approved_by_recorded')
      detail += extra ? ', approver column present' : ', approved_by_recorded missing'
    }
    record(F, `${kind} ${fmt.toUpperCase()} downloads`, ok && extra, detail)
  }
  const anon = await fetch(`${BASE}/api/hd/reports/audit-schedule?${RANGE}&format=csv`)
  record(F, 'the exports refuse a signed-out caller', anon.status === 401, `-> ${anon.status}`)
  const badRange = await fetch(`${BASE}/api/hd/reports/audit-packet?from=2023-01-01&to=2026-12-31&format=pdf`, { headers: { cookie } })
  record(F, 'the exports refuse a range over 3 years', badRange.status === 400, `-> ${badRange.status}`)

  // ── report labels (migration 162): save, read back, reach the export, restore ──
  // The owner's real overrides are read first with the service key and written back
  // exactly - null included - in a finally, so a run never leaves its wording behind.
  const before = await rest<{ hd_report_labels: unknown }>(`profiles?id=eq.${OWNER}&select=hd_report_labels`)
  if (!record(F, 'the labels column exists (migration 162)', before.length === 1 && 'hd_report_labels' in before[0],
    before.length ? 'present' : 'profile row not found')) return
  const original = before[0].hd_report_labels ?? null
  try {
    const g0 = await api('GET', '/api/hd/reports/labels')
    record(F, 'the labels API says saving is available', g0.status === 200 && g0.json.available === true,
      `-> ${g0.status}, available ${String(g0.json.available)}`)
    const CLASS = `${MARK} Vehicle type`
    const CATNAME = `${MARK} Aerial lift`
    const body = { text: { classColumn: CLASS }, categories: added?.id ? { [String(added.id)]: CATNAME } : {} }
    const save = await api('PATCH', '/api/hd/reports/labels', body)
    const savedText = ((save.json.labels as Record<string, any> | undefined)?.text ?? {}) as Record<string, string>
    record(F, 'labels save', save.status === 200 && savedText.classColumn === CLASS,
      `-> ${save.status} ${String(save.json.error ?? '')}`)
    const stored = (await rest<{ hd_report_labels: any }>(`profiles?id=eq.${OWNER}&select=hd_report_labels`))[0]?.hd_report_labels
    record(F, 'the saved labels are in profiles.hd_report_labels',
      stored?.text?.classColumn === CLASS && (!added?.id || stored?.categories?.[String(added.id)] === CATNAME), JSON.stringify(stored))
    const g1 = await api('GET', '/api/hd/reports/labels')
    const g1Text = ((g1.json.labels as Record<string, any> | undefined)?.text ?? {}) as Record<string, string>
    record(F, 'the labels read back after saving', g1.status === 200 && g1Text.classColumn === CLASS && g1Text.jobs === 'Jobs',
      `classColumn ${g1Text.classColumn}, jobs ${g1Text.jobs}`)
    const csvRes = await fetch(`${BASE}/api/hd/reports/audit-schedule?${RANGE}&format=csv`, { headers: { cookie } })
    const csv = (await csvRes.text()).replace(/^\uFEFF/, '')
    const header = csv.split(/\r?\n/)[0]
    record(F, 'the schedule CSV prints the saved column label', csvRes.status === 200 && header.includes(CLASS) && !header.includes('Equipment class'),
      `header: ${header.slice(0, 80)}`)
    record(F, 'the schedule CSV prints the saved category name', !added?.id ? false : csv.includes(CATNAME),
      !added?.id ? 'the smoke category was not created' : csv.includes(CATNAME) ? 'present' : 'missing')
    const pdfRes = await fetch(`${BASE}/api/hd/reports/audit-schedule?${RANGE}&format=pdf`, { headers: { cookie } })
    const pdf = Buffer.from(await pdfRes.arrayBuffer())
    record(F, 'the schedule PDF still renders with saved labels', pdfRes.status === 200 && pdf.subarray(0, 5).toString() === '%PDF-', `-> ${pdfRes.status}`)
    const unknown = await api('PATCH', '/api/hd/reports/labels', { text: { notALabel: 'x' } })
    record(F, 'an unknown label key is refused', unknown.status === 400, `-> ${unknown.status}`)
    const foreignCat = await api('PATCH', '/api/hd/reports/labels', { categories: { '00000000-0000-4000-8000-000000000000': 'x' } })
    record(F, "a category that is not the shop's is refused", foreignCat.status === 400, `-> ${foreignCat.status}`)
    const tooLong = await api('PATCH', '/api/hd/reports/labels', { text: { jobs: 'x'.repeat(61) } })
    record(F, 'an over-long label is refused', tooLong.status === 400, `-> ${tooLong.status}`)
    const reset = await api('PATCH', '/api/hd/reports/labels', { text: {}, categories: {} })
    const afterReset = (await rest<{ hd_report_labels: unknown }>(`profiles?id=eq.${OWNER}&select=hd_report_labels`))[0]?.hd_report_labels
    record(F, 'clearing every label stores null (back to defaults)', reset.status === 200 && afterReset === null, JSON.stringify(afterReset))
  } finally {
    const res = await fetch(`${SUPA}/rest/v1/profiles?id=eq.${OWNER}`, {
      method: 'PATCH', headers: SVC_H, body: JSON.stringify({ hd_report_labels: original }),
    })
    record(F, "the owner's original labels are restored", res.ok, `-> ${res.status}`)
  }

  // ── GATE D: an LD-only subscriber ──
  // A dedicated LD-only TEST account is required: the suite does not sign in as a real
  // customer. Until one is configured this step cannot run, and so it FAILS, saying why.
  const ldId = process.env.SMOKE_LD_ONLY_ID
  if (!ldId) {
    record(F, 'an LD-only subscriber gets no By Equipment data and no HD Financials', false,
      'SMOKE_LD_ONLY_ID is not set - point it at an LD-only TEST account (not a customer)')
  } else {
    const ld = await openSession(ldId)
    const r = await fetch(`${BASE}/api/hd/financials/equipment?${RANGE}`, { headers: { cookie: ld.cookie } })
    const pg = await fetch(`${BASE}/hd/financials`, { headers: { cookie: ld.cookie }, redirect: 'follow' })
    const landed = new URL(pg.url).pathname
    record(F, 'an LD-only subscriber gets no By Equipment data and no HD Financials',
      r.status === 403 && landed !== '/hd/financials', `api -> ${r.status}, /hd/financials -> ${landed}`)
  }
}

// ── Rf: Reefer Standalone, end to end as a REAL reefer_standalone account ──────
//
// A throwaway account is made for the run (auth user + its profile, from the signup
// trigger) and given a reefer_standalone subscriptions row - the row the webhook writes.
// Everything is then driven as that account, through the deployed routes and screens:
//   - the /reefer surface renders with its own nav and none of HD's truck, trailer,
//     inspection, import or Foreman screens; /hd refuses it
//   - the APIs it must not reach answer 403, the ones it must reach answer
//   - labor cards are reefer-only (RF- codes), on the same hd_repair_items table
//   - quote -> work order -> invoice, from a REAL saved HD quote's shape, with every
//     total read back from the database at each step and compared to the cent
// The account, its subscription and every row it made are deleted in cleanup.
// If the subscriptions insert is refused, a live CHECK constraint on tier is still
// in place - that is reported as the failure, in its own words.
async function flowReefer(): Promise<void> {
  const F = 'Rf reefer standalone'
  const email = `smoke-reefer-${Date.now()}@example.com`
  const made = await fetch(`${SUPA}/auth/v1/admin/users`, {
    method: 'POST', headers: SVC_H,
    body: JSON.stringify({ email, password: `Smk-${Date.now()}-x9!`, email_confirm: true,
      user_metadata: { full_name: `${MARK} reefer tech`, business_name: `${MARK} Reefer Shop` } }),
  })
  const u = await made.json().catch(() => ({})) as { id?: string; msg?: string; message?: string }
  if (!record(F, 'a throwaway reefer account is created', made.ok && !!u.id, made.ok ? '' : `-> ${made.status} ${u.msg ?? u.message ?? ''}`)) return
  const uid = u.id!
  created.reeferUsers.add(uid)

  const prof = (await rest<Record<string, unknown>>(`profiles?id=eq.${uid}&select=id`))[0]
  if (!record(F, 'its profile exists (signup trigger)', !!prof)) return

  const subIns = await fetch(`${SUPA}/rest/v1/subscriptions`, {
    method: 'POST', headers: { ...SVC_H, Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: uid, tier: 'reefer_standalone', status: 'active', is_comped: false,
      vertical: 'heavy_duty', modules: [...REEFER_STANDALONE_MODULES], cancel_at_period_end: false }),
  })
  const subTxt = await subIns.text()
  if (!record(F, 'a reefer_standalone subscriptions row can be written (no tier CHECK refuses it)', subIns.ok,
    subIns.ok ? '' : `-> ${subIns.status} ${subTxt.slice(0, 200)}`)) return

  const ownerCookie = cookie
  try {
    const s = await openSession(uid)
    cookie = s.cookie
    record(F, 'signed in as the reefer account', true, s.email)

    // ── The surface ──
    const dash = await page('/reefer/dashboard')
    record(F, '/reefer/dashboard renders for it', !!dash, dash ? '' : 'bounced or errored')
    const navWant = ['NWI REEFER', 'Reefer Diagnostics', 'Reefer Units', 'Labor Cards', 'Intel Hub', 'Financials', 'Calendar', 'Quotes', 'Work Orders', 'Invoices']
    const navGone = ['DOT Inspections', 'Equipment Inspections', 'Inspection Status', 'Foreman', 'Import Data', 'OEM Resources', 'NWI HD SUITE']
    record(F, 'its nav carries the reefer screens', !!dash && missingControls(dash.text, navWant).length === 0,
      dash ? missingControls(dash.text, navWant).join(', ') : '')
    record(F, 'and none of the HD-only ones', !!dash && navGone.every(x => !dash.text.includes(x)),
      dash ? navGone.filter(x => dash.text.includes(x)).join(', ') : '')

    const landing = async (path: string, extraCookie = '') => {
      const res = await fetch(`${BASE}${path}`, { headers: { cookie: extraCookie ? `${cookie}; ${extraCookie}` : cookie }, redirect: 'follow' })
      return new URL(res.url).pathname
    }
    for (const p of ['/reefer/dot-inspections', '/reefer/aerial-inspections/new', '/reefer/equipment-inspections', '/reefer/import',
                     '/reefer/fleet-units/categories', '/reefer/resources', '/reefer/reports/audit', '/reefer/foreman']) {
      const to = await landing(p)
      record(F, `${p} is not a reefer screen - sent to the dashboard`, to === '/reefer/dashboard', `-> ${to}`)
    }
    // First hop only: the HD layout sends a non-HD account to /hd/signup, and the middleware
    // sends a signed-in visitor on /hd/signup back to /hd/dashboard - an existing loop for
    // ANY signed-in non-HD account (LD too), reported in the plan, not changed here.
    const hdRes = await fetch(`${BASE}/hd/quotes`, { headers: { cookie }, redirect: 'manual' })
    const hdLoc = hdRes.headers.get('location') ?? ''
    record(F, '/hd refuses it (the HD layout gate sends it to /hd/signup)', hdRes.status >= 300 && hdRes.status < 400 && hdLoc.includes('/hd/signup'),`-> ${hdRes.status} ${hdLoc}`)
    const linkTo = await landing('/hd/quotes', 'nwi_surface=reefer')
    record(F, 'an /hd link followed on the reefer surface comes back to /reefer', linkTo === '/reefer/quotes', `-> ${linkTo}`)
    const dotTo = await landing('/hd/dot-inspections', 'nwi_surface=reefer')
    record(F, 'an /hd link to a non-reefer screen goes to the reefer dashboard', dotTo === '/reefer/dashboard', `-> ${dotTo}`)

    const qw = await page('/reefer/quickwrench')
    record(F, 'Reefer Diagnostics: Reefer, Procedures and Parts tabs only',
      !!qw && qw.text.includes('REEFER DIAGNOSTICS') && qw.text.includes('Reefer Unit') && qw.text.includes('Parts Ref') &&
      !['Truck Engine', 'Trailer Systems', 'Trailer ABS', 'Electrical Systems'].some(t => qw.text.includes(t)),
      qw ? '' : 'did not load')

    const units = await page('/reefer/fleet-units?new=1')
    record(F, 'Reefer Units: setpoint and tractor fields, no category manager, no boom/aerial',
      !!units && ['REEFER UNITS', 'ADD REEFER UNIT', 'Setpoint', 'Truck Make', 'Truck Model', 'Truck Year', 'VIN', 'BM Number', 'Serial Number'].every(x => units.text.includes(x)) &&
      !units.text.includes('Manage categories') && !/Boom|Aerial|Digger Derrick|Genset/.test(units.text),
      units ? missingControls(units.text, ['REEFER UNITS', 'ADD REEFER UNIT', 'Setpoint', 'VIN']).join(', ') : 'did not load')

    const pms = await page('/reefer/pm-schedules')
    record(F, 'PM Schedules: TK and Carrier only, no truck or trailer intervals',
      !!pms && pms.text.includes('Thermo King') && !pms.text.includes('TRUCK & TRAILER PM INTERVALS') && !pms.text.includes('Kingpin'),
      pms ? '' : 'did not load')
    const set = await page('/reefer/settings')
    record(F, 'Settings: no data import', !!set && !set.text.includes('DATA IMPORT'), set ? '' : 'did not load')

    // ── APIs ──
    const refused: [string, string, unknown][] = [
      ['POST', '/api/hd/truck-diagnostic', { truckBrand: 'Cummins', spn: '1', fmi: '1' }],
      ['GET',  '/api/hd/trailer-reference', undefined],
      ['POST', '/api/hd/trailer-abs-diagnostic', { code: '1-1' }],
      ['POST', '/api/hd/quickwrench', { mode: 'electrical', question: 'test' }],
      ['POST', '/api/hd/quickwrench', { mode: 'truck' }],
      ['POST', '/api/hd/dot-inspections', {}],
      ['POST', '/api/hd/aerial-inspections', {}],
      ['POST', '/api/hd/equipment-inspections', {}],
      ['POST', '/api/hd/import', {}],
      ['POST', '/api/hd/equipment-categories', { name: `${MARK} cat` }],
      ['POST', '/api/hd/parts-manager', { manufacturer: 'Cummins', model: 'X15' }],
      ['POST', '/api/reefer/checkout', {}],
    ]
    for (const [m, p, b] of refused) {
      const r = await api(m, p, b)
      const want = p === '/api/reefer/checkout' ? 409 : 403
      record(F, `${m} ${p}${b && typeof b === 'object' && 'mode' in (b as object) ? ` (${(b as { mode: string }).mode})` : ''} is refused`,
        r.status === want, `-> ${r.status} ${String(r.json.error ?? '')}`)
    }
    const ac = await api('GET', '/api/hd/alarm-codes?manufacturer=TK&alarm_code=10')
    record(F, 'GET /api/hd/alarm-codes answers (the verified alarm-code lookup)', ac.status === 200, `-> ${ac.status} ${String(ac.json.error ?? '')}`)
    const pr = await api('GET', '/api/hd/parts-reference')
    record(F, 'GET /api/hd/parts-reference answers', pr.status === 200 && Array.isArray(pr.json.parts) && (pr.json.parts as unknown[]).length > 0,
      `-> ${pr.status}, ${Array.isArray(pr.json.parts) ? (pr.json.parts as unknown[]).length : 0} parts`)

    // ── Labor cards: the same table, reefer only ──
    const truckCard = await api('POST', '/api/hd/labor-cards', { description: `${MARK} rf truck card`, mobile_hours: 1, equipment_type: 'truck' })
    record(F, 'a truck labor card is refused', truckCard.status === 400, `-> ${truckCard.status} ${String(truckCard.json.error ?? '')}`)
    const rfCard = await api('POST', '/api/hd/labor-cards', { description: `${MARK} rf reefer card`, mobile_hours: 1.5, equipment_type: 'reefer' })
    const card = (rfCard.json.card ?? {}) as Record<string, unknown>
    if (card.id) created.libraryItems.add(String(card.id))
    record(F, 'a reefer labor card saves, with an RF- code, in hd_repair_items', rfCard.status === 201 && /^RF-\d{4,}$/.test(String(card.labor_code ?? '')),
      `-> ${rfCard.status} ${String(card.labor_code ?? rfCard.json.error ?? '')}`)
    const stored = card.id ? (await rest<Record<string, unknown>>(`hd_repair_items?id=eq.${card.id}&select=user_id,equipment_type,is_master`))[0] : null
    record(F, 'read back: the shop\'s own reefer row', !!stored && stored.user_id === uid && stored.equipment_type === 'reefer' && stored.is_master === false,
      JSON.stringify(stored))
    const lcp = await page('/reefer/labor-cards')
    record(F, 'the labor cards screen has no equipment-type picker',
      !!lcp && lcp.text.includes(`${MARK} rf reefer card`) && !lcp.text.includes('Equipment type (required') && !lcp.text.includes('All equipment types'),
      lcp ? '' : 'did not load')
    const lib = await api('GET', '/api/hd/repair-items')
    const libItems = (lib.json.items ?? []) as Array<Record<string, unknown>>
    record(F, 'the labor library it picks from is reefer only, NWI catalog included',
      lib.status === 200 && libItems.length > 0 && libItems.every(i => i.equipment_type === 'reefer') && libItems.some(i => i.is_master === true),
      `-> ${lib.status}, ${libItems.length} items`)

    // ── Money: quote -> work order -> invoice, from a real saved quote's shape ──
    const real = (await rest<Record<string, unknown>>(
      `hd_quotes?user_id=eq.${OWNER}&status=eq.approved&tax_breakdown=not.is.null&customer_name=not.like.${MARK}*&select=*&order=created_at.desc&limit=20`))
      .find(q => Array.isArray(q.line_items) && (q.line_items as unknown[]).length > 0 &&
        (q.line_items as Array<Record<string, unknown>>).some(l => l.type === 'labor'))
    if (!record(F, 'a real approved HD quote to copy the money shape of', !!real, real ? String(real.quote_number) : 'none')) return
    const lines = (real!.line_items as Array<Record<string, unknown>>).map((l, i) => ({
      ...l, id: `zz-rf-${i}`, description: `${MARK} rf line ${i}`, part_number: l.type === 'parts' ? `${MARK}-RF-${i}` : '',
    }))
    const pick = (k: string) => real![k] ?? null
    const body: Record<string, unknown> = {
      customer_name: `${MARK} reefer customer`, customer_phone: '+15555550177', status: 'sent',
      unit_manufacturer: 'Thermo King', unit_model: 'Precedent S-600', unit_serial: 'ZZ-RF-TEST',
      truck_make: 'Freightliner', truck_model: 'Cascadia', truck_year: '2021', vin: '1FUJGLDR0ZZRF0001',
      payment_terms: pick('payment_terms'), labor_rate: pick('labor_rate'), labor_hours: pick('labor_hours'),
      parts_markup_percent: pick('parts_markup_percent'), line_items: lines,
      subtotal_labor: pick('subtotal_labor'), subtotal_parts: pick('subtotal_parts'),
      diagnostic_fee: pick('diagnostic_fee'), road_call_fee: pick('road_call_fee'),
      travel_hours: pick('travel_hours'), travel_rate: pick('travel_rate'), travel_amount: pick('travel_amount'),
      mileage_miles: pick('mileage_miles'), mileage_rate: pick('mileage_rate'), mileage_amount: pick('mileage_amount'),
      shop_supplies_percent_applied: pick('shop_supplies_percent_applied'), shop_supplies_cap_applied: pick('shop_supplies_cap_applied'),
      shop_supplies_fee: pick('shop_supplies_fee'),
      tax_rate: pick('tax_rate'), tax_amount: pick('tax_amount'), tax_breakdown: pick('tax_breakdown'), total: pick('total'),
    }
    const q = await api('POST', '/api/hd/quotes', body)
    await adoptSmokeCustomer(q.json.customer_id)
    const quote = (q.json.quote ?? {}) as Record<string, unknown>
    const quoteId = String(quote.id ?? '')
    if (quoteId) created.hdQuotes.add(quoteId)
    if (!record(F, 'the reefer account saves a quote', q.status === 201 && !!quoteId, `-> ${q.status} ${String(q.json.error ?? '')}`)) return
    const qRow = (await rest<Record<string, unknown>>(`hd_quotes?id=eq.${quoteId}&select=*`))[0] ?? {}
    const moneyKeys = ['subtotal_labor', 'subtotal_parts', 'diagnostic_fee', 'road_call_fee', 'travel_amount', 'mileage_amount', 'shop_supplies_fee', 'tax_amount', 'total']
    const qDiff = moneyKeys.filter(k => usd(qRow[k]) !== usd(real![k]))
    record(F, 'read back: the quote is the reefer account\'s, every money field to the cent',
      qRow.user_id === uid && qDiff.length === 0 && JSON.stringify(parseBreakdown(qRow.tax_breakdown)) === JSON.stringify(parseBreakdown(real!.tax_breakdown)),
      qDiff.length ? `differs: ${qDiff.map(k => `${k} ${usd(qRow[k])} vs ${usd(real![k])}`).join(', ')}` : `total ${usd(qRow.total)}`)
    record(F, 'the tractor fields are kept beside the unit fields', qRow.truck_make === 'Freightliner' && qRow.vin === '1FUJGLDR0ZZRF0001',
      `${String(qRow.truck_make)} ${String(qRow.vin)}`)
    const money = (n: unknown) => '$' + Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const qpg = await page(`/reefer/quotes/${quoteId}`)
    record(F, '/reefer/quotes/<id> shows the total', !!qpg && qpg.text.includes(money(qRow.total)), qpg ? money(qRow.total) : 'did not load')

    const token = String(qRow.public_token ?? '')
    const appr = await fetch(`${BASE}/api/hd/quotes/public/${token}/respond`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: 'approve' }) })
    record(F, 'the customer approves it', appr.ok, `-> ${appr.status}`)
    const wo = (await rest<Record<string, unknown>>(`hd_work_orders?quote_id=eq.${quoteId}&select=*`))[0]
    if (wo) created.hdWorkOrders.add(String(wo.id))
    if (!record(F, 'the work order exists, on the reefer account', !!wo && wo.user_id === uid)) return
    record(F, 'read back: the work order carries the quote total and tax to the cent',
      usd(wo.total_amount) === usd(qRow.total) && usd(wo.tax_amount) === usd(qRow.tax_amount),
      `${usd(wo.total_amount)} / ${usd(wo.tax_amount)} (quote ${usd(qRow.total)} / ${usd(qRow.tax_amount)})`)
    const wpg = await page(`/reefer/work-orders/${wo.id}`)
    record(F, '/reefer/work-orders/<id> renders, Reefer PM offered, no DOT/aerial/equipment inspection',
      !!wpg && wpg.text.includes('Start Reefer PM Inspection') &&
      !['Start DOT Inspection', 'Start Aerial Inspection', 'Start Equipment Inspection'].some(x => wpg.text.includes(x)),
      wpg ? '' : 'did not load')

    const built = await api('GET', `/api/hd/work-orders/${wo.id}/convert`)
    const payload = (built.json.invoice_payload ?? {}) as Record<string, unknown>
    record(F, 'the converter bills the quote total exactly', built.status === 200 && usd(payload.total) === usd(qRow.total) && usd(payload.tax_amount) === usd(qRow.tax_amount),
      `-> ${built.status} total ${usd(payload.total)} (quote ${usd(qRow.total)}) ${String(built.json.error ?? '')}`)
    const inv = await api('POST', '/api/hd/invoices', payload)
    await adoptSmokeCustomer(inv.json.customer_id)
    const invRow = (inv.json.invoice ?? {}) as Record<string, unknown>
    const invId = String(invRow.id ?? '')
    if (invId) created.hdInvoices.add(invId)
    if (!record(F, 'the invoice is created', (inv.status === 201 || inv.status === 200) && !!invId, `-> ${inv.status} ${String(inv.json.error ?? '')}`)) return
    const st = (await rest<Record<string, unknown>>(`hd_invoices?id=eq.${invId}&select=*`))[0] ?? {}
    record(F, 'read back: the invoice is the reefer account\'s, quote total and tax to the cent, and it adds up',
      st.user_id === uid && usd(st.total) === usd(qRow.total) && usd(st.tax_amount) === usd(qRow.tax_amount) && !invoiceDoesNotAddUp(st),
      `total ${usd(st.total)} tax ${usd(st.tax_amount)}`)
    const ipg = await page(`/reefer/invoices/${invId}`)
    record(F, '/reefer/invoices/<id> shows the total', !!ipg && ipg.text.includes(money(st.total)), ipg ? money(st.total) : 'did not load')
    const fin = await page('/reefer/financials')
    record(F, '/reefer/financials renders for it', !!fin, fin ? '' : 'did not load')
    const eq = await api('GET', '/api/hd/financials/equipment')
    const cats = (eq.json.categories ?? []) as Array<Record<string, unknown>>
    record(F, 'By Equipment lists no boom, aerial, truck or trailer category',
      eq.status === 200 && !cats.some(c => /boom|aerial|digger|truck|trailer|apu|genset/i.test(String(c.name ?? ''))),
      `-> ${eq.status}: ${cats.map(c => String(c.name)).join(', ')}`)
    for (const p of ['/reefer/scheduler', '/reefer/intel', '/reefer/reefer', '/reefer/epa-log', '/reefer/parts', '/reefer/fleet-accounts', '/reefer/invoicing']) {
      const pg = await page(p)
      record(F, `${p} renders for it`, !!pg, pg ? '' : 'bounced or errored')
    }
  } finally {
    cookie = ownerCookie
  }
}

async function main(): Promise<void> {
  console.log('='.repeat(96))
  console.log(`SMOKE  ${BASE}`)
  console.log('='.repeat(96))

  const session = await openSession(OWNER)
  cookie = session.cookie
  accessToken = session.accessToken
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
    await flowN()
    await flowO()
    await flowP()
    await flowQ()
    await flowR()
    await flowS()
    await flowT()
    await flowU()
    await flowV()
    await flowLaborCards()
    await flowX()
    await flowW()
    await flowTerms()
    await flowDiscount()
    await flowIe()
    await flowHq()
    await flowPe()
    await flowY()
    await flowZ()
    await flowReefer()
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
