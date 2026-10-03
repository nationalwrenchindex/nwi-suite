// Part 5: the orphan count. Read-only. NOTHING IS BACKFILLED.
//
//   npx tsx scripts/audit-invoice-orphans.ts

import fs from 'fs'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

const hr = (t: string) => { console.log('\n' + '='.repeat(78)); console.log(t); console.log('='.repeat(78)) }
const get = async (p: string) => {
  const r = await fetch(`${U}/rest/v1/${p}`, { headers: H })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return [] }
}

async function main() {
  hr('THE ORPHAN COUNT — NOT BACKFILLED, yours to decide')

  const ld = await get('invoices?select=invoice_number,customer_id,vehicle_id,source,invoice_status,total,created_at&order=created_at.desc') as Record<string, unknown>[]
  const hd = await get('hd_invoices?select=invoice_number,customer_id,unit_id,status,total,created_at&order=created_at.desc') as Record<string, unknown>[]

  console.log('\nLD invoices')
  let noCust = 0, noVeh = 0, neither = 0
  for (const i of ld) {
    const c = Boolean(i.customer_id), v = Boolean(i.vehicle_id)
    if (!c) noCust++
    if (!v) noVeh++
    if (!c && !v) neither++
    const flag = !c && !v ? '  <-- NEITHER' : !v ? '  (no vehicle)' : !c ? '  (no customer)' : ''
    console.log(`  ${String(i.invoice_number).padEnd(15)} src=${String(i.source ?? '-').padEnd(11)} cust=${c ? 'Y' : '.'} veh=${v ? 'Y' : '.'}${flag}`)
  }
  console.log(`\n  LD total                     : ${ld.length}`)
  console.log(`  no customer_id               : ${noCust}`)
  console.log(`  no vehicle_id                : ${noVeh}`)
  console.log(`  NEITHER (true orphans)       : ${neither}`)

  console.log('\nHD invoices')
  let hNoCust = 0, hNoUnit = 0, hNeither = 0
  for (const i of hd) {
    const c = Boolean(i.customer_id), u = Boolean(i.unit_id)
    if (!c) hNoCust++
    if (!u) hNoUnit++
    if (!c && !u) hNeither++
  }
  console.log(`  HD total                     : ${hd.length}`)
  console.log(`  no customer_id               : ${hNoCust}`)
  console.log(`  no unit_id                   : ${hNoUnit}`)
  console.log(`  NEITHER (true orphans)       : ${hNeither}`)

  hr('WHAT IT COSTS')
  console.log('  An LD invoice with no vehicle_id never reaches that unit\'s cost history.')
  console.log('  An LD invoice with no customer_id prints "Valued Customer" and has no')
  console.log('  address, phone or email on the customer\'s copy.')
  console.log('')
  console.log('  Worth repeating from the earlier audit: FLEET PRO NEVER READS THE LD')
  console.log('  `invoices` TABLE AT ALL. So the missing LD vehicle links are not')
  console.log('  currently hiding anything from a Fleet Pro dashboard — there is no LD')
  console.log('  equipment cost view for them to be missing from yet. The cost is on the')
  console.log('  customer-facing document and in the LD financials, not in Fleet Pro.')

  hr('NOT BACKFILLED, AND WHY')
  console.log('  Matching an invoice to a customer by name alone is how a bill ends up')
  console.log('  attached to the wrong person. The two LD invoices with neither link')
  console.log('  carry no name, phone or email anywhere on the row — there is nothing to')
  console.log('  match on, so there is no safe backfill to offer, only a guess.')
  console.log('')
  console.log('  Going forward the dashboard form picks from Intel Hub instead of asking')
  console.log('  for a pasted UUID, so new invoices cannot land this way.')
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
