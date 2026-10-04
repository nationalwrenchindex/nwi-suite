// The two smaller reports from the WO-2026-0008 test:
//   1. the Running Total printed tax three times
//   2. the work order header read "No contact details" for a real customer
//
// Read-only against production. Nothing is written.
//
//   npx tsx scripts/verify-invoice-display.ts

import fs from 'fs'

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
  try { return { ok: r.status === 200, status: r.status, body: JSON.parse(t) } } catch { return { ok: false, status: r.status, body: t } }
}

const INVOICE_CLIENT = 'src/app/financials/invoices/[id]/InvoiceInProgressClient.tsx'
const PICKER         = 'src/components/work-orders/CustomerUnitPicker.tsx'

async function main() {
  // ══ 1. TAX PRINTS ONCE ═════════════════════════════════════════════════════
  // Source-level, because the defect was a duplicated RENDERING, not a wrong
  // number. The figures were already correct and verified by hand; what was wrong
  // was printing them three times. A source assertion is what catches that coming
  // back, the same way the internal_notes leak test does.
  hr('1. The Running Total must print tax ONCE')

  const src = fs.readFileSync(INVOICE_CLIENT, 'utf8')

  // The blended "Tax (7.75%)" rendering: there must be exactly one, and it must be
  // the fallback for when no split exists.
  const blended = src.match(/Tax \(\$\{Math\.round\(taxRate \* 10000\) \/ 100\}%\)/g) ?? []
  ok(blended.length === 1, `exactly one blended-rate tax rendering remains (found ${blended.length})`)
  ok(/taxSplitRows\.length > 0 \? 'Tax' : `Tax \(\$\{Math\.round\(taxRate \* 10000\) \/ 100\}%\)`/.test(src),
    'and it is the FALLBACK - the blended rate only prints when there is no split to print')

  // The split rows must render from the memoised list, not a second inline call.
  const inlineSplit = src.match(/tax && taxDisplayRows\(/g) ?? []
  ok(inlineSplit.length === 0,
    'no inline `tax && taxDisplayRows(...)` render survives - the split comes from one computed list')
  const splitUse = src.match(/taxSplitRows\.map\(/g) ?? []
  ok(splitUse.length === 1, `the split renders in exactly one place (found ${splitUse.length})`)

  // The third rendering, in the authorized snapshot, must be qualified so it cannot
  // be read as the running figure printed again.
  ok(src.includes('Tax (authorized)'),
    'the authorized snapshot labels its tax "Tax (authorized)" rather than a bare "Tax"')
  const bareTax = src.match(/>Tax<\/span>/g) ?? []
  ok(bareTax.length === 0, `no unqualified bare "Tax" label is left anywhere (found ${bareTax.length})`)

  // And the total itself is untouched: still the computed amount, not re-derived.
  ok(/\{fmt\(newTaxAmount\)\}/.test(src), 'the total tax still prints newTaxAmount - the number is not recomputed')

  // ══ 2. "No contact details" ════════════════════════════════════════════════
  hr('2. "No contact details" - is the header reading the wrong source?')

  const pick = fs.readFileSync(PICKER, 'utf8')
  ok(/selected\.phone \|\| selected\.email \|\| 'No contact details'/.test(pick),
    'the header reads phone then email off the SELECTED CUSTOMER object - the right source')

  const wos = (await get('work_orders?select=id,customer_id&work_order_number=eq.WO-2026-0008')).body as Array<{ id: string; customer_id: string | null }>
  ok(wos.length === 1, 'WO-2026-0008 exists')
  if (!wos.length) return
  const linkedId = wos[0].customer_id
  ok(!!linkedId, 'it is linked to a customer at all')

  const linked = (await get(`customers?select=id,first_name,last_name,phone,email,created_at&id=eq.${linkedId}`)).body as Array<Record<string, unknown>>
  ok(linked.length === 1, 'that customer row exists')
  if (!linked.length) return
  const c = linked[0]

  console.log(`\n    linked row: ${c.first_name} ${c.last_name}`)
  console.log(`      phone = ${JSON.stringify(c.phone)}`)
  console.log(`      email = ${JSON.stringify(c.email)}`)
  console.log(`      created ${c.created_at}`)

  // THE FINDING: the header is telling the truth. The row it points at is empty.
  ok(!c.phone && !c.email,
    'the LINKED customer row genuinely has no phone and no email - so "No contact details" is TRUTHFUL, not a bug')

  const all = (await get('customers?select=id,first_name,last_name,phone,email,created_at&order=created_at')).body as Array<Record<string, unknown>>
  const sameName = all.filter(x =>
    String(x.first_name ?? '').toLowerCase() === String(c.first_name ?? '').toLowerCase() &&
    String(x.last_name  ?? '').toLowerCase() === String(c.last_name  ?? '').toLowerCase())

  console.log(`\n    rows with the same name: ${sameName.length}`)
  for (const d of sameName) {
    const mark = d.id === linkedId ? '  <== the work order points here' : ''
    console.log(`      ${d.id}  phone=${JSON.stringify(d.phone)} email=${JSON.stringify(d.email)}${mark}`)
  }

  ok(sameName.length > 1,
    `the same person exists more than once in customers (${sameName.length} rows) - this is a DUPLICATE problem, not a reader problem`)
  const populated = sameName.filter(d => d.phone || d.email)
  ok(populated.length >= 1,
    `and at least one of the duplicates DOES carry the phone and email (${populated.length} of ${sameName.length})`)
  ok(populated.every(d => d.id !== linkedId),
    'the work order is linked to the EMPTY duplicate, not a populated one - which is the whole bug')

  // Scale, so the merge is sized rather than guessed at.
  const byName = new Map<string, number>()
  for (const x of all) {
    const k = `${String(x.first_name ?? '').trim().toLowerCase()}|${String(x.last_name ?? '').trim().toLowerCase()}`
    if (k === '|') continue
    byName.set(k, (byName.get(k) ?? 0) + 1)
  }
  const dupeNames = [...byName.entries()].filter(([, n]) => n > 1)
  const dupeRows  = dupeNames.reduce((n, [, c2]) => n + c2, 0)
  console.log(`\n    customers total: ${all.length}`)
  console.log(`    names appearing more than once: ${dupeNames.length}, covering ${dupeRows} rows`)
  const emptyRows = all.filter(x => !x.phone && !x.email).length
  console.log(`    rows with neither phone nor email: ${emptyRows}`)
  ok(dupeNames.length > 0,
    'duplicates are a real population, so scripts/merge-duplicate-customers.sql is the fix and not a one-off edit')

  console.log('\n' + '='.repeat(78))
  console.log(`${pass} passed, ${fail} failed`)
  console.log('='.repeat(78))
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
