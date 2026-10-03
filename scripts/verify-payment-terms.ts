// Part 3 verification: payment terms, due dates, and the shop's own address.
//
// Read-only against production. Nothing is written.
//
//   npx tsx scripts/verify-payment-terms.ts

import fs from 'fs'
import {
  PAYMENT_TERMS, PAYMENT_TERMS_LABEL, DEFAULT_PAYMENT_TERMS,
  normalisePaymentTerms, termDays, termsDisplay, termsWithDueDate,
  computeDueDate, daysPastDue, isMissingPaymentTermsColumn,
} from '../src/lib/hd/payment-terms'
import { shopBlockFrom, SHOP_BLOCK_SELECT, SHOP_ADDRESS_SELECT_143 } from '../src/lib/invoice-document'

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
const get = async (p: string) => {
  const r = await fetch(`${U}/rest/v1/${p}`, { headers: H })
  const t = await r.text()
  try { return { ok: r.status === 200, body: JSON.parse(t) } } catch { return { ok: false, body: t } }
}

async function main() {
  // ══ 1. WHAT IS ACTUALLY STORED ═════════════════════════════════════════════
  hr('1. THE REAL NAMES AND THE REAL VALUES — reported before anything was built')

  const hd = (await get('hd_invoices?select=invoice_number,payment_terms,due_date,status,sent_at')).body as Record<string, unknown>[]
  const counts: Record<string, number> = {}
  for (const r of hd) { const k = String(r.payment_terms ?? '(null)'); counts[k] = (counts[k] ?? 0) + 1 }
  console.log('  hd_invoices.payment_terms  (exists already; src/lib/hd/payment-terms.ts drives it)')
  for (const [k, v] of Object.entries(counts)) console.log(`    ${JSON.stringify(k).padEnd(20)} x${v}`)
  console.log(`  hd_invoices.due_date set on ${hd.filter(r => r.due_date).length} of ${hd.length}`)

  const ld = (await get('invoices?select=invoice_number,terms,due_date,invoice_status,sent_to_customer_at,invoice_date')).body as Record<string, unknown>[]
  console.log(`\n  invoices.terms is FREE TEXT, set on ${ld.filter(r => r.terms).length} of ${ld.length}`)
  console.log(`  invoices.due_date set on ${ld.filter(r => r.due_date).length} of ${ld.length}`)

  const ldHasTerms = await get('invoices?select=payment_terms&limit=1')
  console.log(`  invoices.payment_terms exists: ${ldHasTerms.ok ? 'YES (143 applied)' : 'NO — migration 143 adds it'}`)

  ok(hd.length > 0 && ld.length > 0, `both invoice tables have rows (${hd.length} HD, ${ld.length} LD) — guards a vacuous pass`)
  ok(Object.keys(counts).some(k => k === 'net30' || k === 'net15' || k === 'Due on receipt'),
    'HD really does store the OLD spellings, which is why nothing was rewritten')

  // ══ 2. NORMALISATION, NOT A REWRITE ════════════════════════════════════════
  hr('2. EVERY STORED SPELLING STILL READS CORRECTLY')
  for (const stored of Object.keys(counts).filter(k => k !== '(null)')) {
    const norm = normalisePaymentTerms(stored)
    console.log(`  ${JSON.stringify(stored).padEnd(20)} -> ${String(norm).padEnd(16)} ${termDays(stored)} days   "${termsDisplay(stored)}"`)
    ok(norm !== null, `the stored value ${JSON.stringify(stored)} is recognised — no live row becomes unreadable`)
  }
  // The canonical set, and the one kept only for reading.
  for (const t of [...PAYMENT_TERMS, 'net_45'] as string[]) {
    ok(normalisePaymentTerms(t) === t, `canonical "${t}" normalises to itself`)
  }
  ok(normalisePaymentTerms('Net 30') === 'net_30', 'a spaced "Net 30" is understood')
  ok(normalisePaymentTerms('net-15') === 'net_15', 'and a hyphenated one')
  ok(normalisePaymentTerms('Payment due upon receipt.') === null,
    'a free-text sentence returns NULL rather than being reinterpreted as some number of days')
  ok(termsDisplay('Payment due upon receipt.') === 'Payment due upon receipt.',
    '...and renders VERBATIM, because it is a sentence the shop wrote')
  ok(termDays('Payment due upon receipt.') === 30,
    '...while the date maths keeps the pre-existing 30-day fallback, so the late-fee cron does not change for any row it already reads')

  ok(termDays('due_on_receipt') === 0, 'due_on_receipt is 0 days')
  ok(termDays('net_7') === 7 && termDays('net_15') === 15 && termDays('net_30') === 30, 'net 7/15/30 are 7/15/30 days')
  ok(DEFAULT_PAYMENT_TERMS === 'net_7', 'the business default is net_7, per the brief')
  ok(PAYMENT_TERMS.length === 4, `the picker offers exactly the four specified values (${PAYMENT_TERMS.join(', ')})`)
  ok(!(PAYMENT_TERMS as readonly string[]).includes('net_45'),
    'net_45 is NOT offered, but is still readable — a value that was once valid must not become unreadable')

  // ══ 3. DUE DATES DERIVED, AND NEVER RE-DERIVED ═════════════════════════════
  hr('3. THE DUE DATE — derived from the invoice date and the terms')
  const basis = '2026-10-03'
  for (const t of PAYMENT_TERMS) {
    const due = computeDueDate(basis, t)
    console.log(`  invoice dated ${basis}, ${PAYMENT_TERMS_LABEL[t].padEnd(16)} -> due ${due}   "${termsWithDueDate(t, due)}"`)
  }
  ok(computeDueDate(basis, 'net_7')  === '2026-10-10', 'net_7 on 2026-10-03 is due 2026-10-10')
  ok(computeDueDate(basis, 'net_30') === '2026-11-02', 'net_30 on 2026-10-03 is due 2026-11-02')
  ok(computeDueDate(basis, 'due_on_receipt') === basis, 'due_on_receipt is due the day it is issued')
  ok(termsWithDueDate('net_7', '2026-10-10') === 'Net 7 — due 10/10/2026',
    'the phrasing is exactly "Net 7 — due 10/10/2026", as specified')
  ok(termsWithDueDate('net_7', null) === 'Net 7',
    'with no stored due date it prints the terms ALONE — nothing is derived for a document already sent')
  ok(termsWithDueDate('due_on_receipt', '2026-10-03') === 'Due on receipt',
    '"Due on receipt" does not append a redundant "— due 10/3/2026" repeating the invoice date')
  ok(termsWithDueDate('Due on receipt', '2026-09-11') === 'Due on receipt',
    'including for the legacy free-text spelling')

  // Against the real HD rows that already have a due date.
  console.log('\n  Real HD invoices, as they will now read:')
  for (const r of hd.filter(x => x.due_date).slice(0, 6)) {
    console.log(`    ${String(r.invoice_number).padEnd(15)} ${termsWithDueDate(r.payment_terms as string, r.due_date as string)}`)
  }
  for (const r of hd.filter(x => !x.due_date).slice(0, 3)) {
    const line = termsWithDueDate(r.payment_terms as string, r.due_date as string | null)
    console.log(`    ${String(r.invoice_number).padEnd(15)} ${line}   (no due date stored)`)
    ok(!line.includes('due '), `${r.invoice_number}: no due date is invented for it`)
  }

  // ══ 4. PAST DUE ════════════════════════════════════════════════════════════
  hr('4. PAST DUE — and due on receipt is past due the day after it is sent')
  const today = new Date('2026-10-03T12:00:00Z')

  ok(daysPastDue({ payment_terms: 'net_30', due_date: '2026-09-03' }, today) === 30,
    'a net_30 invoice due 2026-09-03 is 30 days past due on 2026-10-03')
  ok(daysPastDue({ payment_terms: 'net_30', due_date: '2026-10-03' }, today) === 0,
    'due today is 0 days past due, not 1')
  ok(daysPastDue({ payment_terms: 'net_30', due_date: '2026-12-01' }, today) === 0,
    'a future due date is 0, not negative')

  // The rule the brief called out specifically.
  ok(daysPastDue({ payment_terms: 'due_on_receipt', due_date: null, sent_at: '2026-10-02T09:00:00Z' }, today) === 1,
    'DUE ON RECEIPT sent yesterday is 1 day past due, with no stored due date at all')
  ok(daysPastDue({ payment_terms: 'due_on_receipt', due_date: null, sent_at: '2026-10-03T09:00:00Z' }, today) === 0,
    'and sent today is not yet past due')
  ok(daysPastDue({ payment_terms: 'due_on_receipt', due_date: null, sent_to_customer_at: '2026-09-28T09:00:00Z' }, today) === 5,
    'the LD column name (sent_to_customer_at) works too')

  // THE NULL RULE.
  ok(daysPastDue({ payment_terms: 'net_30', due_date: null }, today) === null,
    'no due date and not due-on-receipt returns NULL — there is nothing to measure from')
  ok(daysPastDue({ payment_terms: 'due_on_receipt', due_date: null, sent_at: null }, today) === null,
    'due on receipt that was never SENT returns NULL, not 0 — an unsent invoice is not "due today"')

  console.log('\n  Real HD invoices, days past due as of 2026-10-03:')
  let anyPastDue = 0
  for (const r of hd) {
    const d = daysPastDue(r as Record<string, unknown>, today)
    if (d !== null && d > 0) {
      anyPastDue++
      console.log(`    ${String(r.invoice_number).padEnd(15)} ${String(d).padStart(4)} days past due  (${r.payment_terms}, due ${r.due_date ?? 'n/a'}, status ${r.status})`)
    }
  }
  console.log(`  ${anyPastDue} of ${hd.length} HD invoices are past due by the calendar`)
  ok(anyPastDue > 0, `real invoices are genuinely past due (${anyPastDue}) — the list is not empty by construction`)

  // ══ 5. THE SHOP'S OWN ADDRESS ══════════════════════════════════════════════
  hr('5. THE SHOP BLOCK — street and zip had no column at all')
  const applied = await get(`profiles?select=id,${SHOP_ADDRESS_SELECT_143}&limit=1`)
  console.log(`  MIGRATION 143 APPLIED: ${applied.ok ? 'YES' : 'NO — profiles.address_line1 does not exist yet'}`)

  const cols = applied.ok ? `id, ${SHOP_BLOCK_SELECT}, ${SHOP_ADDRESS_SELECT_143}` : `id, ${SHOP_BLOCK_SELECT}`
  const profiles = (await get(`profiles?select=${encodeURIComponent(cols)}`)).body as Record<string, unknown>[]
  const named = profiles.filter(p => p.business_name)
  ok(named.length > 0, `shops to render a block for (${named.length}) — guards a vacuous pass`)

  for (const p of named.slice(0, 4)) {
    const block = shopBlockFrom(p)
    console.log(`\n  ${block.name}`)
    console.log(`    address : ${block.addressLines.length ? block.addressLines.join('  /  ') : '(none — city and state are both unset)'}`)
    console.log(`    phone   : ${block.phone ?? '(none)'}`)
    console.log(`    email   : ${block.email ?? '(none)'}`)
  }

  // The seam: the helper already reads the 143 columns, so a filled-in shop works.
  const filled = shopBlockFrom({
    business_name: 'Refrigerated Transportation Service and Repair',
    phone: '7432167141', email: 'shop@example.com',
    address_line1: '2140 Fiddlers Ct', address_line2: 'Suite B',
    city: 'Winston-Salem', state: 'NC', zip: '27107',
  })
  console.log('\n  With the 143 columns filled in:')
  for (const l of filled.addressLines) console.log(`    ${l}`)
  ok(filled.addressLines.length === 3, 'street, unit, then "City, ST ZIP" — three lines')
  ok(filled.addressLines[0] === '2140 Fiddlers Ct', 'the street leads')
  ok(filled.addressLines[2] === 'Winston-Salem, NC 27107', 'and the tail reads as an address is written, not comma-separated')

  const cityOnly = shopBlockFrom({ business_name: 'C&K', city: 'Wauchula', state: 'FL' })
  ok(cityOnly.addressLines.length === 1 && cityOnly.addressLines[0] === 'Wauchula, FL',
    'a shop with only city and state still prints one line — which is all it could print before 143')
  const nothing = shopBlockFrom({ business_name: 'X' })
  ok(nothing.addressLines.length === 0,
    'and a shop with no address prints NO lines rather than an empty one')

  // ══ 6. The deploy-before-migration guard ═══════════════════════════════════
  hr('6. THE DEPLOY-BEFORE-MIGRATION GUARD')
  ok(isMissingPaymentTermsColumn({ code: 'PGRST204', message: "Could not find the 'payment_terms' column of 'invoices' in the schema cache" }),
    'a missing payment_terms is recognised')
  ok(isMissingPaymentTermsColumn({ code: '42703', message: 'column "due_date" does not exist' }),
    'so is a missing due_date')
  ok(!isMissingPaymentTermsColumn({ code: '23505', message: 'duplicate key value violates unique constraint' }),
    'an unrelated error is NOT swallowed, so a real failure still surfaces')
  ok(!isMissingPaymentTermsColumn({ code: 'PGRST204', message: "Could not find the 'nonsense' column" }),
    'and neither is a different missing column')

  hr(`${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
