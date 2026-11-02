// PAGECHECK_BASE=http://localhost:3000 npx tsx scripts/walk-hd-jobs.ts
//
// The live three-job walk, for AFTER migration 177 is applied. Signs in as the smoke
// owner, and through the real routes: creates an HD work order, saves three jobs on it
// (parts + labor, labor only, parts only), reads the card back, builds the invoice
// through the converter, and prints it grouped by job with every subtotal and the grand
// total. It stops at the converter's payload - it does not create an invoice, so no
// stock moves. The work order (and with it its jobs and lines) is deleted in finally.
//
// Without 177 it FAILS and says so: the save is refused with a 409 rather than
// flattening three jobs into one.

import { loadEnv, openSession } from './lib/smoke-session'
import { invoiceJobGroups } from '../src/lib/hd/work-order-jobs'

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

async function main() {
  const session = await openSession(OWNER)
  const api = (path: string, init: RequestInit = {}) => fetch(`${BASE}${path}`, {
    ...init, headers: { 'Content-Type': 'application/json', cookie: session.cookie, ...(init.headers ?? {}) },
  })
  let woId: string | null = null
  try {
    const created = await api('/api/hd/work-orders', { method: 'POST', body: JSON.stringify({
      scheduled_date: new Date().toISOString().slice(0, 10), customer_name: 'ZZ WALK three-job test', unit_manufacturer: 'Thermo King', unit_model: 'SB-310',
    }) })
    const cj = await created.json()
    check('an HD work order is created', created.status === 201, `${created.status} ${cj.work_order?.work_order_number ?? JSON.stringify(cj).slice(0, 120)}`)
    woId = cj.work_order?.id ?? null
    if (!woId) return

    const jobs = [
      { job_number: 1, description: 'Replace compressor', status: 'complete' },
      { job_number: 2, description: 'Diagnose high head pressure', status: 'complete' },
      { job_number: 3, description: 'PM filters', status: 'complete' },
    ]
    const line_items = [
      { job_number: 1, type: 'part', description: 'Compressor X430P', part_number: '102-1100', quantity: 1, unit_cost: 812.40, markup_percent: 30 },
      { job_number: 1, type: 'part', description: 'Receiver drier', part_number: '66-8712', quantity: 1, unit_cost: 46.15, markup_percent: 30 },
      { job_number: 1, type: 'labor', description: 'R&R compressor, evacuate and charge', quantity: 4.5, unit_price: 145 },
      { job_number: 2, type: 'labor', description: 'Diagnose high head pressure', quantity: 1.25, unit_price: 145 },
      { job_number: 3, type: 'part', description: 'Fuel filter', part_number: '11-9098', quantity: 2, unit_cost: 18.37, markup_percent: 30 },
      { job_number: 3, type: 'part', description: 'Air filter', part_number: '11-9300', quantity: 1, unit_cost: 41.09, markup_percent: 30 },
    ]
    const saved = await api(`/api/hd/work-orders/${woId}/line-items`, { method: 'PUT', body: JSON.stringify({ jobs, line_items }) })
    const sj = await saved.json()
    check('three jobs and six lines save', saved.status === 200 && sj.has_jobs === true && sj.jobs?.length === 3 && sj.line_items?.length === 6,
      saved.status === 409 ? `409 - ${sj.error}` : `${saved.status}, ${sj.jobs?.length} jobs, ${sj.line_items?.length} lines`)
    if (saved.status !== 200) return

    const back = await (await api(`/api/hd/work-orders/${woId}/line-items`)).json()
    const jobNo = new Map((back.jobs as Array<{ id: string; job_number: number; description: string }>).map(j => [j.id, j]))
    console.log('\n   The work order, read back:')
    let cardSum = 0
    for (const j of back.jobs as Array<{ id: string; job_number: number; description: string }>) {
      const ls = (back.line_items as Array<Record<string, unknown>>).filter(l => l.job_id === j.id)
      const sub = r2(ls.reduce((t, l) => t + Number(l.total), 0)); cardSum = r2(cardSum + sub)
      console.log(`   Job ${j.job_number} - ${j.description}: ${ls.length} line(s), subtotal ${usd(sub)}`)
    }
    check(`job subtotals ${usd(cardSum)} = the card's line total ${usd(back.totals?.total)}`, cardSum === Number(back.totals?.total))
    check('every line points at a job on this work order', (back.line_items as Array<Record<string, unknown>>).every(l => jobNo.has(String(l.job_id))))

    const conv = await api(`/api/hd/work-orders/${woId}/convert`)
    const vj = await conv.json()
    check('the converter builds the invoice', conv.status === 200, `${conv.status}`)
    const inv = vj.invoice_payload ?? {}
    const groups = invoiceJobGroups((inv.line_items ?? []) as Array<Record<string, unknown>>)
    console.log('\n   The invoice, grouped by job:')
    for (const g of groups ?? []) {
      console.log(`   ${g.label}`)
      for (const l of g.lines) console.log(`        ${String(l.type).padEnd(5)} ${String(l.description).padEnd(40)}${usd(l.amount).padStart(12)}`)
      console.log(`        ${'subtotal'.padEnd(46)}${usd(g.subtotal).padStart(12)}`)
    }
    console.log(`   labor ${usd(inv.subtotal_labor)}  parts ${usd(inv.subtotal_parts)}  tax ${usd(inv.tax_amount)}  GRAND TOTAL ${usd(inv.total)}`)
    const jobSum = r2((groups ?? []).reduce((t, g) => t + g.subtotal, 0))
    check('the invoice groups into the three jobs', groups?.length === 3, groups?.map(g => g.label).join(' / '))
    check(`job subtotals ${usd(jobSum)} = labor + parts on the invoice`, jobSum === r2(Number(inv.subtotal_labor) + Number(inv.subtotal_parts)))
    check(`the invoice's lines equal the work order's lines ${usd(cardSum)}`, jobSum === cardSum)
  } finally {
    if (woId) {
      const del = await fetch(`${S}/rest/v1/hd_work_orders?id=eq.${woId}`, { method: 'DELETE', headers: { apikey: K, Authorization: `Bearer ${K}` } })
      console.log(`\n  cleanup: test work order deleted (${del.status}); its jobs and lines go with it`)
    }
  }
}

main().then(() => {
  console.log(`\n${passes} passed, ${failures} failed`)
  if (failures) process.exit(1)
}).catch(e => { console.error(e); process.exit(1) })
