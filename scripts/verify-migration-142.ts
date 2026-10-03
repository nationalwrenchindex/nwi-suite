// Did migration 142 actually do everything it claimed? Read-only.
//
// Checks the LIVE schema column by column rather than trusting that the script ran
// without an error — a DO block that silently skipped a table would look identical
// to a success.
//
//   npx tsx scripts/verify-migration-142.ts

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

/** One row's keys = that table's columns, as PostgREST sees them. */
async function columnsOf(table: string): Promise<Set<string> | null> {
  const r = await fetch(`${U}/rest/v1/${table}?select=*&limit=1`, { headers: H })
  if (r.status !== 200) return null
  const rows = JSON.parse(await r.text()) as Record<string, unknown>[]
  // An empty table tells us nothing through this route, so ask for the column by
  // name instead and read the error.
  if (rows.length === 0) return new Set<string>(['__empty__'])
  return new Set(Object.keys(rows[0]))
}

/** For an empty table: does this specific column exist? */
async function hasColumn(table: string, col: string): Promise<boolean> {
  const r = await fetch(`${U}/rest/v1/${table}?select=${col}&limit=1`, { headers: H })
  return r.status === 200
}

async function check(table: string, cols: string[]) {
  const set = await columnsOf(table)
  if (set === null) { ok(false, `${table} is readable`); return }
  const empty = set.has('__empty__')
  for (const c of cols) {
    const present = empty ? await hasColumn(table, c) : set.has(c)
    ok(present, `${table}.${c}`)
  }
}

const EXTRAS = [
  'travel_hours', 'travel_rate', 'travel_amount',
  'mileage_miles', 'mileage_rate', 'mileage_amount',
  'shop_supplies_percent_applied', 'shop_supplies_cap_applied', 'shop_supplies_fee',
]

async function main() {
  hr('1. BILLABLE EXTRAS on all six document tables')
  for (const t of ['work_orders', 'quotes', 'invoices', 'hd_work_orders', 'hd_quotes', 'hd_invoices']) {
    await check(t, EXTRAS)
  }

  hr('2. unit_number — six documents, four inspection tables, and vehicles')
  for (const t of [
    'work_orders', 'quotes', 'invoices',
    'hd_work_orders', 'hd_quotes', 'hd_invoices',
    'hd_dot_inspections', 'hd_aerial_inspections', 'hd_equipment_inspections', 'hd_pm_checklists',
    'vehicles',
  ]) {
    await check(t, ['unit_number'])
  }

  hr('3. internal_notes — the shop-only field')
  for (const t of ['work_orders', 'quotes', 'invoices', 'hd_work_orders', 'hd_quotes', 'hd_invoices']) {
    await check(t, ['internal_notes'])
  }

  hr('4. THE PRICING TERMS an invoice could not record')
  await check('invoices', [
    'parts_markup_percent', 'parts_subtotal', 'parts_cost_total',
    'labor_subtotal', 'labor_hours', 'labor_rate',
  ])
  await check('hd_invoices', ['parts_markup_percent', 'labor_hours'])
  await check('hd_quotes',   ['parts_markup_percent', 'labor_hours'])
  await check('hd_work_orders', ['parts_markup_percent'])

  hr('5. profiles — the pricing defaults')
  await check('profiles', [
    'bill_travel', 'travel_rate_per_hour',
    'bill_mileage', 'mileage_rate_per_mile',
    'bill_shop_supplies', 'shop_supplies_percent', 'shop_supplies_cap',
  ])

  hr('6. hd_quotes.customer_id (item 7c)')
  await check('hd_quotes', ['customer_id'])

  // ══ THE ONE THAT MATTERS MOST ══════════════════════════════════════════════
  hr('7. THE PHANTOM $125 — is the DEFAULT actually gone?')
  console.log('  This is the only part of 142 that changes BEHAVIOUR rather than adding a')
  console.log('  column, so it cannot be seen by reading column names.')
  console.log('')
  console.log('  Read from PostgREST\'s own OpenAPI definition, which reports each column\'s')
  console.log('  DEFAULT. The obvious alternative — insert a row omitting diagnostic_fee and')
  console.log('  see what Postgres supplies — was rejected: hd_invoices numbering is derived')
  console.log('  from a row COUNT, so a probe row whose cleanup failed would both appear in')
  console.log('  the invoice list and skip an invoice number. This route writes nothing.\n')

  const specRes = await fetch(`${U}/rest/v1/`, { headers: { ...H, Accept: 'application/openapi+json' } })
  const spec = JSON.parse(await specRes.text()) as {
    definitions?: Record<string, { properties?: Record<string, { default?: unknown }> }>
  }
  ok(specRes.status === 200 && Boolean(spec.definitions), 'PostgREST returned its schema definition')

  for (const table of ['hd_invoices', 'hd_quotes']) {
    const props = spec.definitions?.[table]?.properties ?? {}
    const diagDefault = props.diagnostic_fee?.default
    const roadDefault = props.road_call_fee?.default

    console.log(`  ${table}.diagnostic_fee default = ${JSON.stringify(diagDefault)}`)
    ok(diagDefault === undefined,
      `${table}.diagnostic_fee HAS NO DEFAULT — the migration 057 trap that billed three customers a $125 fee nobody charged is disarmed`)
    ok(diagDefault !== 125 && diagDefault !== '125.00' && diagDefault !== 125.0,
      `${table}.diagnostic_fee is specifically NOT 125 any more`)

    console.log(`  ${table}.road_call_fee  default = ${JSON.stringify(roadDefault)}`)
    ok(Number(roadDefault) === 0,
      `${table}.road_call_fee defaults to 0, which is the only safe default for a fee`)
  }

  hr('8. NOTHING WAS BACKFILLED')
  const inv = JSON.parse(await (await fetch(`${U}/rest/v1/invoices?select=invoice_number,parts_markup_percent,unit_number,internal_notes,travel_amount,shop_supplies_fee`, { headers: H })).text()) as Record<string, unknown>[]
  const withMarkup = inv.filter(i => i.parts_markup_percent != null)
  const withUnit   = inv.filter(i => i.unit_number != null)
  const withNotes  = inv.filter(i => i.internal_notes != null)
  const withTravel = inv.filter(i => Number(i.travel_amount ?? 0) !== 0)
  console.log(`  invoices: ${inv.length} rows`)
  console.log(`    parts_markup_percent set : ${withMarkup.length}`)
  console.log(`    unit_number set          : ${withUnit.length}`)
  console.log(`    internal_notes set       : ${withNotes.length}`)
  console.log(`    travel_amount non-zero   : ${withTravel.length}`)
  ok(withMarkup.length === 0, 'no existing invoice was given a markup — an unrecorded markup stays unrecorded')
  ok(withUnit.length === 0,   'no existing invoice was given a unit number')
  ok(withNotes.length === 0,  'no existing invoice was given internal notes')
  ok(withTravel.length === 0, 'no existing invoice was given travel')

  const hdq = JSON.parse(await (await fetch(`${U}/rest/v1/hd_quotes?select=quote_number,customer_id`, { headers: H })).text()) as Record<string, unknown>[]
  const linked = hdq.filter(q => q.customer_id != null)
  console.log(`\n  hd_quotes: ${hdq.length} rows, ${linked.length} already linked to a customer`)
  ok(linked.length === 0,
    'no quote was auto-linked — the 3 linkable ones wait for scripts/link-hd-quote-customers.sql, which is yours to run')

  hr(`${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
