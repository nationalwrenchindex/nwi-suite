// Segment lines must be itemised on the customer's invoice.
//
// Read-only against production. Nothing is written.
//
//   npx tsx scripts/verify-segment-invoice.ts
//
// Verified against the shop owner's own real test: WO-2026-0008 -> INV-2026-0008.

import fs from 'fs'
import { invoiceFromSegments } from '../src/lib/segments/invoice'
import { segmentedLine, groupBySegment, segmentHeading, isLaborLine } from '../src/lib/invoice-document'
import type { WorkOrderSegment } from '../src/types/segments'

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

async function main() {
  // ══ 1. THE REAL WORK ORDER ═════════════════════════════════════════════════
  hr('1. WO-2026-0008 - are segment lines stored individually at all?')

  const wos = (await get('work_orders?select=id,work_order_number,customer_id&work_order_number=eq.WO-2026-0008')).body as Array<{ id: string; customer_id: string | null }>
  ok(Array.isArray(wos) && wos.length === 1, 'WO-2026-0008 exists')
  if (!wos.length) return
  const wo = wos[0]

  const segs = (await get(`work_order_segments?select=*&ld_work_order_id=eq.${wo.id}&order=sequence`)).body as WorkOrderSegment[]
  ok(segs.length === 2, `two segments on the work order (found ${segs.length})`)

  const everyHasLines = segs.every(s => Array.isArray(s.line_items) && s.line_items.length > 0)
  ok(everyHasLines, 'every segment stores its own line_items - so the lines DO exist')

  const s1 = segs.find(s => s.sequence === 1)
  const s2 = segs.find(s => s.sequence === 2)
  ok(!!s1 && !!s2, 'segments 1 and 2 both present')
  if (!s1 || !s2) return

  const p1 = s1.line_items[0]
  ok(p1?.type === 'part', `segment 1 line is type 'part' (singular, the DB vocabulary) - got ${JSON.stringify(p1?.type)}`)
  ok(p1?.part_number === '123456', `segment 1 line carries part_number 123456 - got ${JSON.stringify(p1?.part_number)}`)
  ok(Number(p1?.unit_cost) === 40, 'segment 1 line carries unit_cost 40')
  ok(Number(p1?.markup_percent) === 30, 'segment 1 line carries markup_percent 30')
  ok(s2.line_items[0]?.type === 'labor', 'segment 2 line is type labor')

  // ══ 2. WHAT THE CONVERTER PRODUCES NOW ═════════════════════════════════════
  hr('2. invoiceFromSegments - the fields that were being dropped')

  const money = invoiceFromSegments(segs)
  console.log('\n  lines the converter now emits:')
  for (const l of money.line_items) console.log('    ' + JSON.stringify(l))
  console.log('')

  ok(money.line_items.length === 2, `one invoice line per segment line, not per segment rollup (${money.line_items.length})`)

  const partLine  = money.line_items.find(l => l.type === 'parts')
  const laborLine = money.line_items.find(l => l.type === 'labor')
  ok(!!partLine,  'the parts line is typed')
  ok(!!laborLine, 'the labor line is typed')
  if (!partLine || !laborLine) return

  ok(partLine.type === 'parts',
    `'part' is translated to 'parts' for the invoice vocabulary - got ${JSON.stringify(partLine.type)}`)
  ok(partLine.part_number === '123456',
    `the part number reaches the invoice - got ${JSON.stringify(partLine.part_number)}`)
  ok(partLine.description === 'test part',
    `the description is the LINE's own, not "Segment 1 - ..." - got ${JSON.stringify(partLine.description)}`)
  ok(partLine.segment === 1, 'the line records which segment it belonged to')
  ok(partLine.segment_label === 'test job', `and that segment's complaint - got ${JSON.stringify(partLine.segment_label)}`)
  ok(laborLine.part_number === null, 'a labor line gets no part number')
  ok(laborLine.segment === 2 && laborLine.segment_label === 'second test', 'the labor line belongs to segment 2')

  // isLaborLine is what every template uses to decide parts vs labor.
  ok(isLaborLine(laborLine as unknown as Record<string, unknown>) === true,
    'isLaborLine recognises the labor line from its type alone')
  ok(isLaborLine(partLine as unknown as Record<string, unknown>) === false,
    'isLaborLine does NOT mistake the parts line for labor')

  // ── The leak check. These must NOT travel to the customer's browser. ──
  const leaked = money.line_items.filter(l =>
    Object.prototype.hasOwnProperty.call(l, 'unit_cost') ||
    Object.prototype.hasOwnProperty.call(l, 'markup_percent'))
  ok(leaked.length === 0,
    'NO unit_cost and NO markup_percent on an invoice line - the customer never receives what the shop paid')

  // ══ 3. THE MONEY IS UNTOUCHED ══════════════════════════════════════════════
  hr('3. The money the owner verified by hand - must not have moved')

  ok(money.subtotal === 147,    `subtotal 147.00 (got ${money.subtotal})`)
  ok(money.tax_amount === 11.39, `tax 11.39 (got ${money.tax_amount})`)
  ok(money.total === 158.39,     `grand total 158.39 (got ${money.total})`)
  ok(Number(partLine.total) === 52,  'the part still bills at its 52.00 sell price, not re-marked-up')
  ok(Number(partLine.unit_price) === 52, 'unit_price is the sell price the customer approved')
  ok(Number(laborLine.total) === 95, 'labor still bills at 95.00')
  const parts = money.tax_breakdown?.parts, labor = money.tax_breakdown?.labor
  ok(Number(parts?.amount) === 4.03, `tax split: parts 4.03 (got ${parts?.amount})`)
  ok(Number(labor?.amount) === 7.36, `tax split: labor 7.36 (got ${labor?.amount})`)

  // ══ 4. INV-2026-0008 AFTER THE REPAIR ══════════════════════════════════════
  //
  // This section used to assert the DEFECT: no part_number, no type, the segment
  // glued into the description. That was the state on 2026-10-04 and it is what the
  // report was about. scripts/reitemize-inv-2026-0008.sql was run on 2026-10-05, so
  // asserting the defect would now fail for the best possible reason.
  //
  // Pinning a broken state is how a test dies the moment someone acts on it. So this
  // asserts the REPAIR instead - and critically, that the repair moved no money.
  hr('4. INV-2026-0008 after the re-itemize - the data the SQL put back')

  const invs = (await get('invoices?select=id,invoice_number,line_items,subtotal,tax_amount,total&invoice_number=eq.INV-2026-0008')).body as Array<{ line_items: Array<Record<string, unknown>>; subtotal: number; tax_amount: number; total: number }>
  ok(invs.length === 1, 'INV-2026-0008 exists')
  if (!invs.length) return
  const stored = invs[0]

  for (const l of stored.line_items) console.log('    ' + JSON.stringify(l))

  ok(stored.line_items.length === 2, `still exactly 2 lines (got ${stored.line_items.length})`)
  ok(stored.line_items.some(l => l.part_number === '123456'),
    'the part number 123456 is on the stored invoice - it could only get there by a write')
  ok(stored.line_items.every(l => l.type === 'parts' || l.type === 'labor'),
    'every line carries a type in the INVOICE vocabulary')
  ok(stored.line_items.every(l => l.segment !== undefined),
    'every line records its segment')
  ok(stored.line_items.every(l => !/^Segment \d+/.test(String(l.description))),
    'and no description carries the prefix any more - the segment travels as its own field')

  // THE PART THAT MATTERS MOST: a rewrite of billed history must not move money.
  ok(Number(stored.subtotal) === 147, `subtotal still 147.00 (got ${stored.subtotal})`)
  ok(Number(stored.tax_amount) === 11.39, `tax still 11.39 (got ${stored.tax_amount})`)
  ok(Number(stored.total) === 158.39, `total still 158.39 (got ${stored.total})`)
  const lineSum = Math.round(stored.line_items.reduce((n, l) => n + Number(l.total ?? 0), 0) * 100) / 100
  ok(lineSum === Number(stored.subtotal),
    `and the rebuilt lines still sum to the subtotal (${lineSum} = ${stored.subtotal})`)

  // ══ 5. LEGACY ROWS STILL GROUP ═════════════════════════════════════════════
  //
  // Against INV-2026-0009, which is genuinely still in the legacy shape: it was
  // converted before the fix deployed and has not been re-itemized. This capability
  // cannot be retired - every invoice converted before 2026-10-05 still depends on
  // it, and most of them will never be rewritten.
  hr('5. segmentedLine - a REAL legacy invoice must still group correctly')

  const legacyInv = (await get('invoices?select=invoice_number,line_items&invoice_number=eq.INV-2026-0009')).body as Array<{ line_items: Array<Record<string, unknown>> }>
  ok(legacyInv.length === 1, 'INV-2026-0009 exists')

  if (legacyInv.length) {
    const legacyLines = legacyInv[0].line_items
    ok(legacyLines.every(l => l.segment === undefined),
      'it really is the legacy shape - no segment field on any line')
    ok(legacyLines.every(l => /^Segment \d+/.test(String(l.description))),
      'and the sequence is inside the description, which is the only place to read it')

    for (const l of legacyLines) {
      const sl = segmentedLine(l)
      console.log(`    ${JSON.stringify(l.description)}  ->  seq=${sl.sequence}  desc=${JSON.stringify(sl.description)}`)
    }
    const parsed = legacyLines.map(l => segmentedLine(l))
    ok(parsed.every(p => p.sequence !== null),
      'every legacy line resolves to a segment from its description prefix')
    ok(parsed.every(p => p.label === null),
      'no segment label is invented for a legacy row - the complaint was never stored on the line')
    const legacyGroups = groupBySegment(parsed, p => ({ sequence: p.sequence, label: p.label }))
    ok(legacyGroups.length === 2, `it groups into 2 segments (got ${legacyGroups.length})`)
    ok(segmentHeading(legacyGroups[0]) === 'Segment 1',
      `headed without a complaint it does not have - got ${JSON.stringify(segmentHeading(legacyGroups[0]))}`)
  }

  // And the same capability on fixed input, so coverage does not depend on one row in
  // production surviving. INV-2026-0009 could be re-itemized tomorrow.
  const synthLegacy = [
    { description: 'Segment 1 — test part', quantity: 1, unit_price: 52, total: 52 },
    { description: 'Segment 2 — testing',   quantity: 1, unit_price: 95, total: 95 },
    { description: 'Segment 3' },
  ].map(l => segmentedLine(l as unknown as Record<string, unknown>))
  ok(synthLegacy[0].sequence === 1 && synthLegacy[0].description === 'test part',
    'em-dash prefix parses and strips')
  ok(synthLegacy[1].sequence === 2 && synthLegacy[1].description === 'testing',
    'the second one too')
  ok(synthLegacy[2].sequence === 3 && synthLegacy[2].description === 'Segment 3',
    'a bare "Segment 3" keeps its text rather than ending up with no description at all')

  // ══ 6. THE CASE FROM THE BRIEF ═════════════════════════════════════════════
  hr('6. "three parts and two labor entries should print five lines under one heading"')

  const synthetic = [{
    ...s1,
    sequence: 7,
    complaint: 'no heat',
    line_items: [
      { type: 'part',  description: 'heater core',   part_number: 'HC-1', quantity: 1, unit_cost: 100, unit_price: 130, markup_percent: 30, total: 130, sort_order: 0 },
      { type: 'part',  description: 'hose, upper',   part_number: 'H-2',  quantity: 2, unit_cost: 10,  unit_price: 13,  markup_percent: 30, total: 26,  sort_order: 1 },
      { type: 'part',  description: 'coolant',       part_number: 'C-3',  quantity: 2, unit_cost: 8,   unit_price: 10.4, markup_percent: 30, total: 20.8, sort_order: 2 },
      { type: 'labor', description: 'diagnose',      part_number: null,   quantity: 1, unit_cost: null, unit_price: 95, markup_percent: null, total: 95, sort_order: 3 },
      { type: 'labor', description: 'replace core',  part_number: null,   quantity: 3, unit_cost: null, unit_price: 95, markup_percent: null, total: 285, sort_order: 4 },
    ],
  }] as unknown as WorkOrderSegment[]

  const synth = invoiceFromSegments(synthetic)
  ok(synth.line_items.length === 5, `five invoice lines, not one (got ${synth.line_items.length})`)

  const groups = groupBySegment(
    synth.line_items.map((l, i) => ({ ...l, i })),
    l => ({ sequence: l.segment ?? null, label: l.segment_label ?? null }),
  )
  ok(groups.length === 1, `under ONE heading (got ${groups.length} groups)`)
  ok(groups[0].rows.length === 5, `with all five lines in it (got ${groups[0].rows.length})`)
  ok(segmentHeading(groups[0]) === 'Segment 7 - no heat',
    `headed by the complaint - got ${JSON.stringify(segmentHeading(groups[0]))}`)
  ok(synth.line_items.filter(l => l.type === 'parts').length === 3, 'three parts lines typed as parts')
  ok(synth.line_items.filter(l => l.type === 'labor').length === 2, 'two labor lines typed as labor')
  ok(synth.line_items.filter(l => l.part_number).length === 3, 'three part numbers carried, none invented for labor')

  // A heading carries no money of its own; the lines under it must sum to the segment.
  const headSum = groups[0].rows.reduce((n, r) => n + Number(r.total), 0)
  ok(Math.round(headSum * 100) / 100 === 556.8,
    `the lines under the heading sum to the segment's own total 556.80 (got ${Math.round(headSum * 100) / 100})`)

  // ══ 7. NON-SEGMENTED INVOICES ARE UNCHANGED ════════════════════════════════
  hr('7. A parent-priced invoice must render exactly as it did before')

  const plain = [
    { description: 'Brake pads', quantity: 1, unit_price: 80, total: 80 },
    { description: 'Labor',      quantity: 2, unit_price: 95, total: 190 },
  ]
  const plainParsed = plain.map(l => segmentedLine(l as unknown as Record<string, unknown>))
  ok(plainParsed.every(p => p.sequence === null), 'no segment is inferred where there is none')
  ok(plainParsed[0].description === 'Brake pads', 'the description is left alone')
  const plainGroups = groupBySegment(plainParsed, p => ({ sequence: p.sequence, label: p.label }))
  ok(plainGroups.length === 1 && plainGroups[0].sequence === null, 'one group, sequence null')
  ok(segmentHeading(plainGroups[0]) === null,
    'and NO heading is printed - a non-segmented invoice gains nothing')

  // A description that merely begins with the word "Segment" is not a prefix.
  const tricky = segmentedLine({ description: 'Segmented drive belt' })
  ok(tricky.sequence === null && tricky.description === 'Segmented drive belt',
    '"Segmented drive belt" is not parsed as a segment prefix')

  console.log('\n' + '='.repeat(78))
  console.log(`${pass} passed, ${fail} failed`)
  console.log('='.repeat(78))
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
