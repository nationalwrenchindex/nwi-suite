// Items 2c + 2d verification.
//
// 2c is a LEAK TEST and it is a source-level one on purpose. Whether a column
// reaches a customer is not a question about data — it is a question about which
// files can render it. So this reads the actual source of every customer-facing
// surface and fails if any of them so much as mentions internal_notes.
//
// 2d checks that no zero-value fee can print, through the one shared helper.
//
//   npx tsx scripts/verify-internal-notes.ts

import fs from 'fs'
import path from 'path'
import { feeRows } from '../src/lib/invoice-document'
import { extrasDisplayRows, extrasFromDocument } from '../src/lib/billable-extras'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) pass++; else fail++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}
const hr = (t: string) => { console.log('\n' + '='.repeat(78)); console.log(t); console.log('='.repeat(78)) }
const usd = (n: number) => `$${n.toFixed(2)}`
const get = async (p: string) => {
  const r = await fetch(`${U}/rest/v1/${p}`, { headers: H })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { __raw: t, __status: r.status } }
}

/**
 * EVERY SURFACE A CUSTOMER CAN SEE. Enumerated rather than globbed, so adding a
 * new customer-facing file is a deliberate act that includes adding it here.
 */
const CUSTOMER_FACING = [
  // LD
  'src/app/invoice/[token]/page.tsx',
  'src/app/invoice/[token]/InvoiceViewClient.tsx',
  'src/app/invoice/[token]/InvoiceApprovalClient.tsx',
  'src/app/quote/[token]/page.tsx',
  'src/app/quote/[token]/QuoteApprovalClient.tsx',
  'src/app/work-order/[token]/page.tsx',
  'src/app/api/invoices/public/[token]/route.ts',
  'src/app/api/invoices/[id]/send/route.ts',
  'src/lib/garage/email.ts',
  // HD
  'src/app/hd/invoices/pay/[token]/page.tsx',
  'src/components/hd/PublicInvoicePay.tsx',
  'src/app/api/hd/invoices/[id]/pdf/route.ts',
  'src/app/api/hd/invoices/[id]/send/route.ts',
  'src/lib/hd/sms-templates.ts',
  'src/app/api/hd/dot-inspections/[id]/pdf/route.ts',
  'src/app/api/hd/aerial-inspections/[id]/pdf/route.ts',
  'src/lib/hd/pm-report-pdf.ts',
  'src/lib/hd/pm-report-email.ts',
]

async function main() {
  hr('1. THE LEAK TEST — internal_notes must not appear in ANY customer-facing file')
  console.log('  LD had nowhere to put a shop-only note: `notes` AND `job_notes` both print')
  console.log('  on /invoice/[token]. That is why the work-order converter was left unable')
  console.log('  to carry tech notes — publishing them was the only option it had.\n')

  let checked = 0, missing = 0
  for (const rel of CUSTOMER_FACING) {
    const abs = path.join(process.cwd(), rel)
    if (!fs.existsSync(abs)) {
      missing++
      console.log(`  ----  ${rel}  (not present)`)
      continue
    }
    checked++
    const src = fs.readFileSync(abs, 'utf8')
    // A comment SAYING it must never appear is fine and desirable. Any other
    // mention is not. Strip comment lines before testing.
    const code = src
      .split('\n')
      .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    const mentions = code.includes('internal_notes') || code.includes('internalNotes')
    if (mentions) {
      const lines = src.split('\n')
        .map((l, i) => ({ l, i: i + 1 }))
        .filter(({ l }) => /internal_?[nN]otes/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l))
      console.log(`  LEAK  ${rel}`)
      for (const { l, i } of lines) console.log(`          ${i}: ${l.trim()}`)
    }
    ok(!mentions, `${rel} does not reference internal_notes`)
  }
  console.log(`\n  files checked: ${checked}   not present: ${missing}`)
  ok(checked >= 12, `a real set of customer-facing files was checked (${checked}) — guards a vacuous pass`)

  // The field has to exist SOMEWHERE, or this test passes by the column not existing.
  hr('2. ...while the shop-facing side DOES carry it')
  const SHOP_FACING = [
    'src/app/financials/invoices/[id]/InvoiceInProgressClient.tsx',
    'src/app/api/invoices/[id]/progress/route.ts',
    'src/app/api/work-orders/[id]/convert/route.ts',
    'src/app/api/quotes/[id]/convert/route.ts',
    'supabase/migrations/142_billable_extras_and_document_self_containment.sql',
  ]
  for (const rel of SHOP_FACING) {
    const abs = path.join(process.cwd(), rel)
    const src = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : ''
    ok(/internal_?[nN]otes/.test(src), `${rel} DOES carry internal_notes — so the leak test above is not passing by absence`)
  }

  hr('3. THE TECH NOTES NOW HAVE SOMEWHERE TO GO')
  const wos = await get('work_orders?select=work_order_number,tech_notes,converted_invoice_id') as Record<string, unknown>[]
  const withTechNotes = wos.filter(w => w.tech_notes)
  console.log(`  work orders carrying tech_notes: ${withTechNotes.length} of ${wos.length}`)
  for (const w of withTechNotes.slice(0, 5)) {
    console.log(`    ${w.work_order_number}  ${JSON.stringify(String(w.tech_notes).slice(0, 56))}  billed=${w.converted_invoice_id ? 'Y' : '.'}`)
  }
  const convertRoute = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/work-orders/[id]/convert/route.ts'), 'utf8')
  ok(/internal_notes:\s*wo\.tech_notes/.test(convertRoute),
    'the work-order converter now carries tech_notes into internal_notes, instead of dropping them')
  ok(!/notes:\s*\[wo\.job_description, wo\.tech_notes/.test(convertRoute),
    'and does NOT put them into `notes`, which prints to the customer')

  // ══ 2d ═════════════════════════════════════════════════════════════════════
  hr('4. ITEM 2d — no zero-value fee line, anywhere')
  const invs = await get('hd_invoices?select=invoice_number,diagnostic_fee,road_call_fee,status') as Record<string, unknown>[]
  ok(invs.length > 0, `HD invoices to check (${invs.length}) — guards a vacuous pass`)

  let zeroOnly = 0, someFee = 0
  for (const inv of invs) {
    const rows = feeRows(inv)
    const diag = Number(inv.diagnostic_fee ?? 0)
    const road = Number(inv.road_call_fee ?? 0)
    if (diag === 0 && road === 0) zeroOnly++; else someFee++
    ok(rows.every(r => r.amount > 0), `${inv.invoice_number}: every fee row rendered has a non-zero amount`)
    ok(rows.length === [diag, road].filter(v => v > 0).length,
      `${inv.invoice_number}: exactly ${rows.length} fee row(s) for ${[diag, road].filter(v => v > 0).length} non-zero fee(s)`)
  }
  ok(zeroOnly > 0, `invoices charging no fee at all (${zeroOnly}) print no fee line — guards a vacuous pass`)
  ok(someFee > 0, `invoices that DO charge one (${someFee}) still print it — fees were not suppressed wholesale`)

  console.log('\n  The same rule covers travel, mileage and shop supplies:')
  const allZero = extrasFromDocument({
    travel_hours: 3, travel_amount: 0,
    mileage_miles: 90, mileage_amount: 0,
    shop_supplies_percent_applied: 8, shop_supplies_fee: 0,
  })
  const zeroRows = extrasDisplayRows(allZero)
  console.log(`    hours and miles recorded but every amount zero -> ${zeroRows.length} rows printed`)
  ok(zeroRows.length === 0,
    'an extra with a zero AMOUNT prints nothing, even when the hours or miles were recorded')

  const mixed = extrasDisplayRows(extrasFromDocument({
    travel_hours: 2, travel_rate: 95, travel_amount: 190,
    mileage_miles: 0, mileage_amount: 0,
    shop_supplies_fee: 0,
  }))
  console.log(`    travel charged, mileage and supplies zero      -> ${mixed.length} row: ${mixed.map(r => r.label).join(', ')}`)
  ok(mixed.length === 1 && mixed[0].key === 'travel',
    'and the non-zero one still prints — this is suppression per line, not per document')

  // Negatives must not sneak through as "non-zero".
  ok(feeRows({ diagnostic_fee: -50, road_call_fee: 0 }).length === 0,
    'a NEGATIVE fee prints nothing either — a credit is not a fee, and a minus sign on an invoice fee line is a support call')
  ok(extrasDisplayRows(extrasFromDocument({ travel_amount: -10 })).length === 0,
    'nor does a negative travel amount')

  hr(`${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
