// npx tsx scripts/verify-hd-jobs.ts
//
// HD multi-job work orders (migration 177). READS the database, writes nothing. Prints
// real figures, not just pass/fail:
//
//   1. EVERY existing HD work order with lines, through the converter exactly as it runs
//      today (no jobs) and as it will run after 177 (every line on job 1). The whole
//      invoice payload must be identical - every figure, every line, every key.
//   2. EVERY existing HD invoice: totals as stored, and that none of them groups (they
//      carry no job keys), so each renders exactly as it does now.
//   3. A THREE-JOB work order - parts + labor, labor only, parts only - on a real work
//      order's own terms (rates, tax, fees, extras, discount as recorded), its lines
//      priced by normalizeLine, the function the save route prices every line with.
//      Every job subtotal, the invoice grouped by job, and the grand total, which must
//      equal the same lines converted with no jobs at all, to the cent.

import { loadEnv } from './lib/smoke-session'
import { normalizeLine, type WorkOrderLineInput } from '../src/lib/shared/work-order-lines'
import { buildInvoicePayload, type WorkOrderLineRow, type ShopFallback } from '../src/lib/hd/wo-to-invoice'
import { invoiceJobGroups, type WorkOrderJob } from '../src/lib/hd/work-order-jobs'
import { taxSettingsFrom, TAX_SETTINGS_SELECT } from '../src/lib/tax'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const FOUNDER = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

async function all(q: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = []
  for (let f = 0; ; f += 1000) {
    const j = await (await fetch(`${S}/rest/v1/${q}`, { headers: { ...H, Range: `${f}-${f + 999}` } })).json()
    if (!Array.isArray(j)) throw new Error(`${q}: ${JSON.stringify(j)}`)
    out.push(...j); if (j.length < 1000) break
  }
  return out
}

let failures = 0, passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++; else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}
const usd = (n: unknown) => `$${(Number(n) || 0).toFixed(2)}`
const r2 = (n: number) => Math.round(n * 100) / 100

async function fallbackFor(userId: string): Promise<ShopFallback> {
  const [p] = await all(`profiles?select=hd_labor_rate,default_labor_rate,${TAX_SETTINGS_SELECT}&id=eq.${userId}`)
  const rate = p?.hd_labor_rate != null ? Number(p.hd_labor_rate) : p?.default_labor_rate != null ? Number(p.default_labor_rate) : null
  return { laborRate: rate, taxSettings: taxSettingsFrom(p) }
}

async function main() {
  const lines = await all('hd_work_order_line_items?select=id,work_order_id,type,description,part_number,quantity,unit_cost,unit_price,markup_percent,total,sort_order&order=id')
  const woIds = [...new Set(lines.map(l => l.work_order_id))]
  const wos = await all(`hd_work_orders?select=*&id=in.(${woIds.join(',')})&order=id`)
  const fallbacks = new Map<string, ShopFallback>()
  for (const u of new Set(wos.map(w => w.user_id))) fallbacks.set(u, await fallbackFor(u))

  // ── 1. existing work orders, before and after 177 ─────────────────────────────
  console.log(`\n1. EXISTING WORK ORDERS - ${wos.length} with lines (${lines.length} lines). Before 177 vs after 177 (all lines on job 1)`)
  console.log('   ' + ['work order', 'lines', 'labor', 'parts', 'tax', 'total before', 'total after'].join(' | '))
  let same = 0
  for (const wo of wos) {
    const rows = lines.filter(l => l.work_order_id === wo.id) as WorkOrderLineRow[]
    const fb = fallbacks.get(wo.user_id)!
    const before = buildInvoicePayload({ ...wo }, rows, fb).payload
    const job1: WorkOrderJob = { id: `job1-${wo.id}`, job_number: 1, description: null, status: 'complete' }
    const after = buildInvoicePayload({ ...wo }, rows.map(r => ({ ...r, job_id: job1.id })), fb, [job1]).payload
    // internal_notes carries today's date when settings filled a gap; identical on both.
    const eq = JSON.stringify(before) === JSON.stringify(after)
    if (eq) same++
    console.log('   ' + [wo.work_order_number, rows.length, usd(before.subtotal_labor), usd(before.subtotal_parts), usd(before.tax_amount), usd(before.total), usd(after.total)].join(' | ') + (eq ? '' : '   <-- DIFFERS'))
  }
  check(`all ${wos.length} existing work orders convert to an identical invoice payload before and after 177`, same === wos.length, `${same}/${wos.length}`)

  // ── 2. existing invoices ──────────────────────────────────────────────────────
  const invs = await all('hd_invoices?select=invoice_number,total,subtotal_labor,subtotal_parts,tax_amount,line_items,user_id&order=id')
  const grouped = invs.filter(i => invoiceJobGroups(Array.isArray(i.line_items) ? i.line_items : []) !== null)
  const founderInvs = invs.filter(i => i.user_id === FOUNDER)
  console.log(`\n2. EXISTING INVOICES - ${invs.length} (${founderInvs.length} yours). 177 does not touch hd_invoices; its self-check compares every one.`)
  for (const i of founderInvs.slice(-5)) console.log(`   ${i.invoice_number}: labor ${usd(i.subtotal_labor)}, parts ${usd(i.subtotal_parts)}, tax ${usd(i.tax_amount)}, total ${usd(i.total)}`)
  check('no existing invoice carries job keys, so every one renders exactly as now (no headings)', grouped.length === 0, `${grouped.length} would group`)

  // ── 3. a three-job work order ─────────────────────────────────────────────────
  // The base is a real work order of yours that has lines, with its own recorded terms.
  const base = wos.filter(w => w.user_id === FOUNDER).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
  const fb = fallbacks.get(FOUNDER)!
  const laborRate = Number(base.labor_rate ?? fb.laborRate ?? 0)
  const sent: Array<WorkOrderLineInput & { job: number }> = [
    { job: 1, type: 'part',  description: 'Compressor X430P', part_number: '102-1100', quantity: 1, unit_cost: 812.40, markup_percent: 30 },
    { job: 1, type: 'part',  description: 'Receiver drier', part_number: '66-8712', quantity: 1, unit_cost: 46.15, markup_percent: 30 },
    { job: 1, type: 'labor', description: 'R&R compressor, evacuate and charge', quantity: 4.5, unit_price: laborRate },
    { job: 2, type: 'labor', description: 'Diagnose high head pressure', quantity: 1.25, unit_price: laborRate },
    { job: 3, type: 'part',  description: 'Fuel filter', part_number: '11-9098', quantity: 2, unit_cost: 18.37, markup_percent: 30 },
    { job: 3, type: 'part',  description: 'Air filter', part_number: '11-9300', quantity: 1, unit_cost: 41.09, markup_percent: 30 },
  ]
  const jobs: WorkOrderJob[] = [
    { id: 'j1', job_number: 1, description: 'Replace compressor', status: 'complete' },
    { id: 'j2', job_number: 2, description: 'Diagnose high head pressure', status: 'complete' },
    { id: 'j3', job_number: 3, description: 'PM filters', status: 'complete' },
  ]
  const priced = sent.map((l, i) => ({ ...normalizeLine(l, i)!, id: `l${i}`, job_id: `j${l.job}` })) as WorkOrderLineRow[]

  console.log(`\n3. THREE-JOB WORK ORDER on ${base.work_order_number}'s recorded terms (labor rate ${usd(laborRate)}, tax ${base.tax_amount != null ? 'recorded ' + usd(base.tax_amount) : 'from your settings'}, fees ${usd(Number(base.diagnostic_fee ?? 0) + Number(base.road_call_fee ?? 0))}, travel ${usd(base.travel_amount)}, mileage ${usd(base.mileage_amount)}, supplies ${usd(base.shop_supplies_fee)}${base.discount ? ', discount recorded' : ''})`)
  console.log('   The work order card, job by job:')
  for (const j of jobs) {
    const js = priced.filter(p => p.job_id === j.id)
    const lab = r2(js.filter(p => p.type === 'labor').reduce((t, p) => t + Number(p.total), 0))
    const prt = r2(js.filter(p => p.type === 'part').reduce((t, p) => t + Number(p.total), 0))
    console.log(`   Job ${j.job_number} - ${j.description}: labor ${usd(lab)}, parts ${usd(prt)}, job subtotal ${usd(lab + prt)}`)
    for (const p of js) console.log(`        ${p.type === 'labor' ? 'LAB' : 'PRT'} ${String(p.description).padEnd(38)} qty ${String(p.quantity).padStart(5)}  cost ${p.unit_cost == null ? '   -   ' : usd(p.unit_cost).padStart(8)}  sell ${usd(p.unit_price).padStart(8)}  total ${usd(p.total).padStart(9)}`)
  }

  const withJobs = buildInvoicePayload({ ...base, id: 'three-job-test', work_order_number: 'WO-TEST-3JOB' }, priced, fb, jobs)
  const noJobs = buildInvoicePayload({ ...base, id: 'three-job-test', work_order_number: 'WO-TEST-3JOB' }, priced.map(p => ({ ...p, job_id: null })), fb, [])
  const inv = withJobs.payload
  const items = inv.line_items as Array<Record<string, unknown>>
  const groups = invoiceJobGroups(items)

  console.log('\n   The invoice, grouped by job:')
  for (const g of groups ?? []) {
    console.log(`   ${g.label}`)
    for (const l of g.lines) console.log(`        ${String(l.type).padEnd(5)} ${String(l.description).padEnd(38)} ${l.type === 'labor' ? `${l.mobile_hours} hrs` : `${l.quantity} x ${usd(l.unit_cost)}`}`.padEnd(70) + usd(l.amount).padStart(10))
    console.log(`        ${g.label} subtotal`.padEnd(70) + usd(g.subtotal).padStart(10))
  }
  const extras = Number(inv.travel_amount ?? 0) + Number(inv.mileage_amount ?? 0) + Number(inv.shop_supplies_fee ?? 0)
  const fees = Number(inv.diagnostic_fee ?? 0) + Number(inv.road_call_fee ?? 0)
  const disc = Number((inv.discount as { amount?: number } | null)?.amount ?? 0)
  console.log(`   ${'Labor subtotal'.padEnd(67)}${usd(inv.subtotal_labor).padStart(10)}`)
  console.log(`   ${'Parts subtotal'.padEnd(67)}${usd(inv.subtotal_parts).padStart(10)}`)
  console.log(`   ${'Fees (diagnostic + road call)'.padEnd(67)}${usd(fees).padStart(10)}`)
  console.log(`   ${'Travel + mileage + shop supplies'.padEnd(67)}${usd(extras).padStart(10)}`)
  if (disc) console.log(`   ${'Discount'.padEnd(67)}${('-' + usd(disc)).padStart(10)}`)
  console.log(`   ${`Tax (${inv.tax_rate}%)`.padEnd(67)}${usd(inv.tax_amount).padStart(10)}`)
  console.log(`   ${'GRAND TOTAL'.padEnd(67)}${usd(inv.total).padStart(10)}`)

  const jobSum = r2((groups ?? []).reduce((t, g) => t + g.subtotal, 0))
  check('the invoice groups into exactly the three jobs, in order', !!groups && groups.map(g => g.job).join(',') === '1,2,3', groups?.map(g => g.label).join(' / '))
  check('job 2 is labor only, job 3 is parts only', !!groups && groups[1].lines.every(l => l.type === 'labor') && groups[2].lines.every(l => l.type === 'parts'))
  check(`job subtotals ${usd(jobSum)} = labor + parts ${usd(Number(inv.subtotal_labor) + Number(inv.subtotal_parts))} to the cent`,
    jobSum === r2(Number(inv.subtotal_labor) + Number(inv.subtotal_parts)))
  check(`grand total ${usd(inv.total)} = lines + fees + extras - discount + tax`,
    r2(jobSum + fees + extras - disc + Number(inv.tax_amount)) === Number(inv.total),
    usd(r2(jobSum + fees + extras - disc + Number(inv.tax_amount))))
  check(`grand total with jobs ${usd(inv.total)} = the same lines with no jobs ${usd(noJobs.payload.total)}`, inv.total === noJobs.payload.total)
  const money = (p: Record<string, unknown>) => JSON.stringify(['subtotal_labor', 'subtotal_parts', 'parts_cost', 'parts_sell', 'tax_amount', 'tax_breakdown', 'total', 'discount'].map(k => p[k]))
  check('every money figure on the invoice is identical with and without jobs', money(inv) === money(noJobs.payload))
  check('the invoice records the parts COST (unit_cost_base), which the ledger deducts at', items.filter(l => l.type === 'parts').every(l => l.unit_cost_base != null)
    && Number(inv.parts_cost) === r2(812.40 + 46.15 + 2 * 18.37 + 41.09), `parts_cost ${usd(inv.parts_cost)}`)
  check('a one-job work order\'s invoice carries no job keys (renders as before)',
    (buildInvoicePayload({ ...base }, priced.map(p => ({ ...p, job_id: 'j1' })), fb, jobs).payload.line_items as Array<Record<string, unknown>>).every(l => !('job' in l)))

  // ── 3b. the same three jobs with a road call fee, travel, mileage and shop supplies ──
  // Recorded on the work order the way the quote and the editors record them, so the
  // converter carries them exactly as it does for a real job.
  const loaded = {
    ...base, id: 'three-job-test-b', work_order_number: 'WO-TEST-3JOB-B',
    road_call_fee: 95, diagnostic_fee: 0,
    travel_hours: 1.5, travel_rate: laborRate, travel_amount: r2(1.5 * laborRate),
    mileage_miles: 42, mileage_rate: 2, mileage_amount: 84,
    shop_supplies_percent_applied: 10, shop_supplies_cap_applied: 50, shop_supplies_fee: 50,
  }
  const b1 = buildInvoicePayload({ ...loaded }, priced, fb, jobs).payload
  const b0 = buildInvoicePayload({ ...loaded }, priced.map(p => ({ ...p, job_id: null })), fb, []).payload
  console.log(`\n3b. THE SAME THREE JOBS with road call ${usd(95)}, travel ${usd(loaded.travel_amount)}, mileage ${usd(84)} (untaxed), shop supplies ${usd(50)} (10%, capped)`)
  console.log(`   labor ${usd(b1.subtotal_labor)}, parts ${usd(b1.subtotal_parts)}, tax ${usd(b1.tax_amount)}, total with jobs ${usd(b1.total)}, total with no jobs ${usd(b0.total)}`)
  check('with fees and extras, every money figure is identical with and without jobs', money(b1) === money(b0) && b1.total === b0.total)
  // The extras are taxed as today: road call and travel in the labor bucket, supplies in
  // the parts bucket, mileage not at all. Per bucket, at your settings' rates.
  const ts = fb.taxSettings
  const expectTax = r2(r2((ts.tax_labor ? ts.tax_rate_labor : 0) / 100 * (Number(b1.subtotal_labor) + 95 + loaded.travel_amount))
    + r2((ts.tax_parts ? ts.tax_rate_parts : 0) / 100 * (Number(b1.subtotal_parts) + 50)))
  check(`tax ${usd(b1.tax_amount)} = labor bucket (lines + road call + travel) + parts bucket (lines + supplies), mileage untaxed`,
    Number(b1.tax_amount) === expectTax, `expected ${usd(expectTax)} at ${ts.tax_rate_labor}% labor / ${ts.tax_rate_parts}% parts`)

  console.log(`\n${passes} passed, ${failures} failed`)
  if (failures) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
