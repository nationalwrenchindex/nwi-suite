// Item 1a verification: an LD quote converts to an invoice without retyping.
//
// Read-only against production. The conversion is REPLAYED here with the real
// route's own mapping so the row it would insert can be printed field by field,
// but nothing is written — the quotes belong to a live subscriber.
//
//   npx tsx scripts/verify-quote-convert.ts

import fs from 'fs'
import { toLineItems, fromLineItems, isLaborItem, type EditItem } from '../src/components/shared/line-items'
import { MIGRATION_142_COLUMNS, missingMigration142Column, withoutMigration142Columns } from '../src/lib/migration-142'

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
  try { return JSON.parse(t) } catch { return { __raw: t, __status: r.status } }
}

/**
 * The route's own mapping, lifted so the conversion can be replayed read-only.
 * Kept in the same order as api/quotes/[id]/convert so a drift between the two is
 * visible side by side rather than hidden behind a passing test.
 */
function convertQuoteToInvoiceRow(quote: Record<string, unknown>): Record<string, unknown> {
  return {
    customer_id:          quote.customer_id ?? null,
    vehicle_id:           quote.vehicle_id  ?? null,
    job_id:               quote.job_id      ?? null,
    job_category:         quote.job_category ?? null,
    job_subtype:          quote.job_subtype  ?? null,
    line_items:           quote.line_items   ?? [],
    po_number:            quote.po_number ?? null,
    notes:                quote.notes ?? null,
    jobs:                 quote.jobs ?? [],
    tax_breakdown:        quote.tax_breakdown ?? null,
    parts_markup_percent: quote.parts_markup_percent ?? null,
    parts_subtotal:       quote.parts_subtotal       ?? null,
    parts_cost_total:     quote.parts_cost_total     ?? null,
    labor_subtotal:       quote.labor_subtotal       ?? null,
    labor_hours:          quote.labor_hours          ?? null,
    labor_rate:           quote.labor_rate           ?? null,
    unit_number:          quote.unit_number ?? null,
    internal_notes:       quote.internal_notes ?? null,
  }
}

async function main() {
  const quotes = await get('quotes?select=*,customer:customers(id,first_name,last_name,phone,email,address_line1,address_line2,city,state,zip),vehicle:vehicles(id,year,make,model,vin)&order=created_at.desc') as Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
  ok(Array.isArray(quotes) && quotes.length > 0, `production returned quotes to convert (${quotes.length}) — guards a vacuous pass`)

  // Kurt's shop. Identified by the quotes named in the brief, not hardcoded by id.
  const kurt = quotes.filter(q => ['QT-2026-0001', 'QT-2026-0002', 'QT-2026-0003'].includes(q.quote_number)
    && q.user_id === quotes.find(x => x.quote_number === 'QT-2026-0003')?.user_id)
  ok(kurt.length === 3, `the three quotes named in the brief all belong to one shop (${kurt.length} of 3, user ${String(kurt[0]?.user_id).slice(0, 8)})`)

  hr('1. FIELD BY FIELD — what the conversion carries, for each of Kurt\'s quotes')
  const CARRIED = [
    'customer_id', 'vehicle_id', 'job_category', 'job_subtype', 'line_items',
    'po_number', 'notes', 'tax_breakdown',
    'parts_markup_percent', 'parts_subtotal', 'parts_cost_total',
    'labor_subtotal', 'labor_hours', 'labor_rate', 'unit_number', 'internal_notes',
  ]

  for (const q of kurt) {
    const row = convertQuoteToInvoiceRow(q)
    console.log(`\n  ${q.quote_number}  (status=${q.status})`)
    for (const f of CARRIED) {
      const src = q[f]
      const dst = row[f]
      const present = src != null && !(Array.isArray(src) && src.length === 0)
      const carried = JSON.stringify(dst ?? null) === JSON.stringify(src ?? null)
      const mark = !present ? '    ' : carried ? ' ok ' : ' !! '
      const show = (v: unknown) => {
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '(null)')
        return s.length > 46 ? s.slice(0, 43) + '...' : s
      }
      console.log(`   ${mark} ${f.padEnd(22)} quote=${show(src).padEnd(48)} invoice=${show(dst)}`)
      if (present) {
        ok(carried, `${q.quote_number}: ${f} reaches the invoice unchanged`)
      }
    }

    // THE RULE THAT MATTERS: an ID, never text where an ID belongs.
    if (q.customer_id) {
      ok(row.customer_id === q.customer_id, `${q.quote_number}: the invoice carries the same customer_id — not a re-derived or retyped name`)
    }
    if (q.vehicle_id) {
      ok(row.vehicle_id === q.vehicle_id, `${q.quote_number}: the invoice carries the same vehicle_id`)
    }
  }

  hr('2. THE SIX COLUMNS THAT HAD NOWHERE TO GO BEFORE MIGRATION 142')
  console.log('  invoices had no parts_markup_percent, parts_subtotal, parts_cost_total,')
  console.log('  labor_subtotal, labor_hours or labor_rate. Every reader reached back through')
  console.log('  source_quote_id instead, and read 0 when there was no source quote.\n')
  const SELF = ['parts_markup_percent', 'parts_subtotal', 'labor_subtotal', 'labor_hours', 'labor_rate']
  for (const q of kurt) {
    const row = convertQuoteToInvoiceRow(q)
    const recorded = SELF.filter(f => row[f] != null)
    console.log(`  ${q.quote_number}: ${recorded.length}/${SELF.length} recorded on the invoice -> ${recorded.map(f => `${f}=${row[f]}`).join(', ')}`)
    ok(recorded.length === SELF.length,
      `${q.quote_number}: all ${SELF.length} pricing terms are now recorded on the invoice itself`)
    // A NULL markup must stay NULL, never become 0.
    ok(!(q.parts_markup_percent == null && row.parts_markup_percent === 0),
      `${q.quote_number}: an unrecorded markup is not silently converted to 0%`)
  }

  hr('3. PART NUMBERS — the reason parts did not survive')
  const allLineKeys = new Set<string>()
  let partRows = 0, withPartNumber = 0
  for (const q of quotes) {
    for (const li of (Array.isArray(q.line_items) ? q.line_items : [])) {
      for (const k of Object.keys(li as object)) allLineKeys.add(k)
      if (!isLaborItem(li)) { partRows++; if ((li as { part_number?: string }).part_number) withPartNumber++ }
    }
  }
  console.log(`  keys present on real stored line items : ${[...allLineKeys].sort().join(', ')}`)
  console.log(`  parts rows in production               : ${partRows}`)
  console.log(`  ... carrying a part number             : ${withPartNumber}`)
  ok(partRows > 0, `there are real parts rows to check (${partRows}) — guards a vacuous pass`)
  ok(!allLineKeys.has('part_number'),
    'no stored row has a part number yet, which is the defect: the quote builder never captured one')

  // The round trip must now preserve it. This is the thing that was broken.
  const sample: EditItem[] = [
    { _id: 'a', description: 'Valve Cover Gasket Set', quantity: 1, unit_price: 28.07, part_number: 'VS50521R' },
    { _id: 'b', description: 'RTV Sealant',            quantity: 2, unit_price: 10.00, part_number: '' },
  ]
  const written = toLineItems({ items: sample, markupPct: 20, laborHours: 3.5, laborRate: 150 })
  console.log('\n  What the builder now writes:')
  for (const w of written) console.log('    ' + JSON.stringify(w))

  ok(written[0].part_number === 'VS50521R', 'a typed part number is stored on the line item')
  ok(!('part_number' in written[1]), 'an empty part number is OMITTED, not stored as "" — absent means "not captured"')
  ok(written[0].type === 'parts' && written[2].type === 'labor',
    'every new row carries an explicit type, so no reader has to guess labour from the description')

  const back = fromLineItems(written, 20)
  ok(back.length === 2, `the labour row is filtered back out of the editor (${back.length} parts rows)`)
  ok(back[0].part_number === 'VS50521R', 'the part number survives the read back into the editor')
  ok(Math.abs(back[0].unit_price - 28.07) < 0.005,
    `the markup divides back out to the base price the tech paid (${back[0].unit_price} vs 28.07)`)
  const rewritten = toLineItems({ items: back, markupPct: 20, laborHours: 3.5, laborRate: 150 })
  ok(rewritten[0].unit_price === written[0].unit_price,
    `a save-reopen-save cycle does not change the price (${written[0].unit_price} -> ${rewritten[0].unit_price})`)
  ok(rewritten[0].part_number === written[0].part_number,
    'and does not lose the part number')

  hr('4. EXPLICIT TYPE vs THE OLD DESCRIPTION GUESS')
  // The case the guess got wrong, taken from a real production invoice.
  const segmentLabor = { description: 'Segment 2 — replace cat and sensors', quantity: 4, unit_price: 95, total: 380 }
  ok(isLaborItem(segmentLabor) === false,
    'untyped, the old guess still reads a segment labour line as parts — unchanged, because rewriting history is not an option')
  ok(isLaborItem({ ...segmentLabor, type: 'labor' }) === true,
    'typed, the same line is correctly labour')
  ok(isLaborItem({ description: 'Labor', quantity: 2, unit_price: 95, total: 190 }) === true,
    'and the description fallback still works for every row written before type existed')
  ok(isLaborItem({ description: 'Laboratory test kit', quantity: 1, unit_price: 40, total: 40, type: 'parts' }) === false,
    'an explicit parts type beats a description that merely starts with "labor"')

  hr('5. THE DEPLOY-BEFORE-MIGRATION GUARD')
  console.log('  Migration 142 is applied by hand, so the code can reach production first.')
  console.log('  Without a retry the converter would 500 on every quote until the SQL is run.\n')
  const pgrst204 = { code: 'PGRST204', message: "Could not find the 'parts_markup_percent' column of 'invoices' in the schema cache" }
  ok(missingMigration142Column(pgrst204) === 'parts_markup_percent',
    'a PGRST204 for a 142 column is recognised')
  ok(missingMigration142Column({ code: '42703', message: 'column "shop_supplies_percent_applied" does not exist' }) === 'shop_supplies_percent_applied',
    'the longer name is not shadowed by the shorter shop_supplies_percent')
  ok(missingMigration142Column({ code: '23505', message: 'duplicate key value violates unique constraint' }) === null,
    'an unrelated error is NOT treated as a missing column, so a real failure still surfaces')
  ok(missingMigration142Column({ code: 'PGRST204', message: "Could not find the 'nonsense_column' of 'invoices'" }) === null,
    'a missing column that is not one of ours is not swallowed either')

  const stripped = withoutMigration142Columns(convertQuoteToInvoiceRow(kurt[0] ?? quotes[0]))
  const leftover = MIGRATION_142_COLUMNS.filter(c => c in stripped)
  ok(leftover.length === 0, `the retry strips every 142 column (${leftover.length} left behind)`)
  // THE BUG THIS ASSERTION EXISTS TO CATCH. hd_quotes.customer_id is added by 142,
  // so putting 'customer_id' in the strip list looked right — and would have
  // dropped the customer link off every LD invoice on any retry, because
  // invoices.customer_id has existed since migration 001.
  ok('customer_id' in stripped && stripped.customer_id === (kurt[0] ?? quotes[0]).customer_id,
    'customer_id SURVIVES the retry — it is not a 142 column on invoices, and stripping it would orphan the document')
  ok('vehicle_id' in stripped, 'vehicle_id survives the retry too')
  ok('line_items' in stripped && 'tax_breakdown' in stripped,
    'the work and the tax split survive the retry')
  ok(Object.keys(stripped).length > 0,
    `the stripped row still carries the money and the links (${Object.keys(stripped).length} fields), so the document still saves`)

  hr(`${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
