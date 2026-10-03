// Did migration 143 do everything it claimed? Read-only. Writes nothing.
//
//   npx tsx scripts/verify-migration-143.ts

import fs from 'fs'
import { normalisePaymentTerms, termsDisplay, DEFAULT_PAYMENT_TERMS } from '../src/lib/hd/payment-terms'
import { shopBlockFrom } from '../src/lib/invoice-document'

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

/** Column presence without needing a non-empty table. */
async function hasColumn(table: string, col: string): Promise<boolean> {
  const r = await fetch(`${U}/rest/v1/${table}?select=${col}&limit=1`, { headers: H })
  return r.status === 200
}

async function main() {
  hr('1. THE COLUMNS')
  for (const [t, cols] of [
    ['invoices',    ['payment_terms', 'due_date']],
    ['quotes',      ['payment_terms']],
    ['hd_invoices', ['payment_terms', 'due_date']],
    ['hd_quotes',   ['payment_terms']],
    ['profiles',    ['default_payment_terms', 'address_line1', 'address_line2', 'zip', 'city', 'state']],
  ] as [string, string[]][]) {
    for (const c of cols) ok(await hasColumn(t, c), `${t}.${c}`)
  }

  hr('2. NO CHECK CONSTRAINT — the old HD spellings must still be WRITABLE')
  console.log('  A CHECK would have aborted 143 against the 18 HD invoices holding net30 /')
  console.log('  net15 / "Due on receipt". Those are meant to keep working untouched. If a')
  console.log('  constraint had somehow been added, PostgREST would reject them on write —')
  console.log('  and the reason this matters is that the late-fee cron UPDATES those rows.\n')
  const hd = (await get('hd_invoices?select=invoice_number,payment_terms,due_date,status')).body as Record<string, unknown>[]
  const spellings = [...new Set(hd.map(r => String(r.payment_terms ?? '(null)')))]
  console.log('  stored spellings: ' + spellings.map(s => JSON.stringify(s)).join(', '))
  for (const s of spellings) {
    if (s === '(null)') continue
    const norm = normalisePaymentTerms(s)
    ok(norm !== null, `${JSON.stringify(s)} still normalises (-> ${norm}) and renders as "${termsDisplay(s)}"`)
  }

  hr('3. default_payment_terms — every profile picks up net_7 from the DEFAULT')
  const profs = (await get('profiles?select=id,business_name,default_payment_terms,address_line1,address_line2,city,state,zip')).body as Record<string, unknown>[]
  const terms: Record<string, number> = {}
  for (const p of profs) { const k = String(p.default_payment_terms ?? '(null)'); terms[k] = (terms[k] ?? 0) + 1 }
  for (const [k, v] of Object.entries(terms)) console.log(`  ${JSON.stringify(k).padEnd(12)} x${v}`)
  ok(terms[DEFAULT_PAYMENT_TERMS] === profs.length,
    `all ${profs.length} profiles default to ${DEFAULT_PAYMENT_TERMS}, as the column DEFAULT intends`)
  ok(!('(null)' in terms), 'none is NULL — the DEFAULT applied to existing rows')

  hr('4. NOTHING WAS BACKFILLED onto a document')
  const ld = (await get('invoices?select=invoice_number,payment_terms,due_date,invoice_status')).body as Record<string, unknown>[]
  const ldTerms = ld.filter(i => i.payment_terms != null)
  const ldDue   = ld.filter(i => i.due_date != null)
  console.log(`  invoices: ${ld.length} rows, ${ldTerms.length} with terms, ${ldDue.length} with a due date`)
  ok(ldTerms.length === 0, 'no existing LD invoice was given payment terms')
  ok(ldDue.length === 0,
    'and NONE was given a due date — an invoice already sent must keep reading exactly as the customer received it')

  const hdDue = hd.filter(r => r.due_date != null)
  console.log(`  hd_invoices: ${hd.length} rows, ${hdDue.length} with a due date (12 had one BEFORE 143)`)
  ok(hdDue.length === 12, 'the 12 HD invoices that already had a due date still have exactly those 12 — none added, none lost')

  const q = (await get('quotes?select=quote_number,payment_terms')).body as Record<string, unknown>[]
  ok(q.filter(x => x.payment_terms != null).length === 0, 'no existing quote was given payment terms')

  hr('5. THE SHOP BLOCK — street and zip are now readable')
  for (const p of profs.filter(x => x.business_name)) {
    const block = shopBlockFrom(p)
    const addr = block.addressLines.length ? block.addressLines.join('  /  ') : '(empty)'
    console.log(`  ${String(block.name).slice(0, 44).padEnd(46)} ${addr}`)
  }
  const anyStreet = profs.filter(p => p.address_line1).length
  console.log(`\n  profiles with a street address set: ${anyStreet} of ${profs.length}`)
  ok(anyStreet === 0,
    'none yet — the columns exist and nothing was invented. Fill in Settings -> Business Address and the shop block starts printing it.')

  // The seam works the moment a value exists. Proven without writing one.
  const filled = shopBlockFrom({
    business_name: 'Refrigerated Transportation Service and Repair',
    phone: '7432167141', email: 'shop@example.com',
    address_line1: '2140 Fiddlers Ct', address_line2: 'Suite B',
    city: 'Winston-Salem', state: 'NC', zip: '27107',
  })
  ok(filled.addressLines.length === 3 && filled.addressLines[2] === 'Winston-Salem, NC 27107',
    `with the columns filled in it renders three lines ending "${filled.addressLines[2]}"`)

  hr('6. THE PAST-DUE INDEXES')
  // Indexes are not visible through PostgREST, so this checks the QUERY they exist
  // for actually runs rather than the index itself.
  const pastDue = await get('invoices?select=invoice_number,due_date&due_date=not.is.null&order=due_date.asc')
  ok(pastDue.ok, 'the LD past-due query (due_date not null, ordered) runs')
  const hdPastDue = await get('hd_invoices?select=invoice_number,due_date&due_date=not.is.null&order=due_date.asc')
  ok(hdPastDue.ok, 'and the HD one')
  console.log('  (the indexes themselves are invisible through PostgREST — only the queries')
  console.log('   they serve can be checked from here)')

  hr(`${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
