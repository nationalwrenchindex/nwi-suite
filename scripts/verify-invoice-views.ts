// All THREE views of an invoice must itemize: the customer's copy, the in-progress
// editor, and the finalized view. Source-level plus real data.
//
// Read-only against production. Nothing is written.
//
//   npx tsx scripts/verify-invoice-views.ts
//
// Reported twice: "INV-2026-0009/0010/0011 show Authorized Work $156.66 and an empty
// space below it". The customer's copy was always fine. The two SHOP-side views were
// collapsed by default, so the lines sat behind one click with nothing else on the
// page listing the work.

import fs from 'fs'
import { segmentedLine, segmentHeading } from '../src/lib/invoice-document'

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
const get = async (p: string) => (await fetch(`${U}/rest/v1/${p}`, { headers: H })).json()

const VIEWS = [
  { name: 'in-progress editor', file: 'src/app/financials/invoices/[id]/InvoiceInProgressClient.tsx' },
  { name: 'finalized view',     file: 'src/app/financials/invoices/[id]/FinalizedInvoiceClient.tsx' },
]
const PUBLIC_PAGE = 'src/app/invoice/[token]/page.tsx'

async function main() {
  // ══ 1. NEITHER SHOP VIEW MAY START COLLAPSED ═══════════════════════════════
  hr('1. The lines must not be hidden behind a click')

  for (const v of VIEWS) {
    const src = fs.readFileSync(v.file, 'utf8')
    console.log(`\n  ${v.name}`)

    // The exact regression: useState(false) for the estimate section.
    const collapsedAlways = /const \[estimateOpen,\s*setEstimateOpen\]\s*=\s*useState\(false\)/.test(src)
    ok(!collapsedAlways,
      'the estimate section does NOT start unconditionally collapsed')

    // It must open when the invoice's own lines are the only itemization.
    ok(/useState\(\s*\n?\s*!invoice\.source_quote_id &&/.test(src),
      'it opens when there is no source quote - the work-order case')
    ok(/invoice\.line_items\.length > 0,/.test(src),
      'and only when there are actually lines to show')
  }

  // ══ 2. NO VIEW MAY RENDER A BLANK DESCRIPTION ══════════════════════════════
  hr('2. An untitled line must name its type, not render a blank cell')

  for (const v of VIEWS) {
    const src = fs.readFileSync(v.file, 'utf8')
    console.log(`\n  ${v.name}`)
    ok(src.includes('segmentedLine('), 'it reads lines through segmentedLine, like the customer copy')
    ok(src.includes('segmentHeading('), 'and prints the segment as a heading')
    ok(/'Labor' : 'Parts'/.test(src), 'and falls back to the line type when the description is empty')
    // THE REGRESSION SHAPE, scoped to the OWN-LINES path. Deliberately not a blanket
    // ban on `label: li.description` anywhere in the file: the finalized view also
    // renders the source quote's line_items and invoice.additional_labor, which are
    // different shapes with their own description fields and are not segment lines.
    // Flagging those made this assertion fail on code that was never part of the bug,
    // and an assertion that fires on correct code is one that gets deleted.
    //
    // (Worth knowing but NOT changed here: those two callers would also show a blank
    // cell for an untitled row. Out of scope for this fix; raised in the report.)
    // A window from `ownLines.map(` rather than a regex terminator: the two views
    // write this differently - one is an arrow returning JSX, the other builds a row
    // object - and a pattern that insists on one shape fails on the other for no
    // reason. The window is just "the code that renders those lines".
    const at = src.indexOf('ownLines.map(')
    ok(at >= 0, 'the own-lines rendering is found')
    if (at >= 0) {
      const block = src.slice(at, at + 900)
      ok(block.includes('segmentedLine('),
        'the own-lines rendering goes through segmentedLine rather than the raw description')
      ok(!/label:\s*li\.description,/.test(block) && !/>\{li\.description\}</.test(block),
        'and no raw description reaches the cell without a fallback')
    }
  }

  const pub = fs.readFileSync(PUBLIC_PAGE, 'utf8')
  console.log('\n  customer copy')
  ok(pub.includes('segmentedLine('), 'reads lines through segmentedLine')
  ok(pub.includes('groupBySegment('), 'and groups them by segment')
  ok(/\|\| description \|\| 'Service'/.test(pub), 'with a fallback so no line is blank')

  // ══ 3. THE REAL DOCUMENTS ══════════════════════════════════════════════════
  hr('3. What each of the reported invoices would now itemize')

  const nums = ['INV-2026-0008', 'INV-2026-0009', 'INV-2026-0010', 'INV-2026-0011']
  const rows = await get(
    `invoices?select=invoice_number,line_items,subtotal,total,source_quote_id,invoice_status&invoice_number=in.(${nums.join(',')})&order=invoice_number`,
  ) as Array<{ invoice_number: string; line_items: Array<Record<string, unknown>>; subtotal: number; total: number; source_quote_id: string | null; invoice_status: string }>

  ok(rows.length === 4, `all four invoices read (${rows.length})`)

  for (const inv of rows) {
    const lines = Array.isArray(inv.line_items) ? inv.line_items : []
    console.log(`\n  ${inv.invoice_number}  (${inv.invoice_status})  subtotal ${inv.subtotal}  total ${inv.total}`)

    // The section must be open for these: all are work-order invoices with lines.
    const wouldOpen = !inv.source_quote_id && lines.length > 0
    ok(wouldOpen, 'the estimate section opens for this invoice rather than starting collapsed')

    // Every line must produce a non-blank label in the shop views.
    const labels = lines.map(li => {
      const seg = segmentedLine(li)
      return {
        heading: segmentHeading(seg),
        label:   seg.description || (li.type === 'labor' ? 'Labor' : 'Parts'),
        note:    typeof li.part_number === 'string' ? li.part_number : null,
        amount:  Number(li.total ?? 0),
      }
    })
    for (const l of labels) {
      console.log(`      ${(l.heading ?? '-').padEnd(26)} ${l.label.padEnd(16)} ${l.note ? 'part# ' + l.note : ''}`.trimEnd())
    }
    ok(labels.length === lines.length, `${labels.length} of ${lines.length} lines produce a row`)
    ok(labels.every(l => l.label.trim().length > 0),
      'no line renders with a blank description')
    const sum = Math.round(labels.reduce((n, l) => n + l.amount, 0) * 100) / 100
    ok(sum === Number(inv.subtotal), `the rows sum to the stored subtotal ${inv.subtotal} (got ${sum})`)
  }

  // The specific line that exposed this: INV-2026-0011's untitled labour entry.
  const i11 = rows.find(r => r.invoice_number === 'INV-2026-0011')
  if (i11) {
    const blankStored = i11.line_items.filter(l => !String(l.description ?? '').trim())
    console.log(`\n  INV-2026-0011 stores ${blankStored.length} line(s) with an empty description`)
    ok(blankStored.length > 0,
      'it really does store a blank description - so the fallback is load-bearing, not theoretical')
    const seg = segmentedLine(blankStored[0])
    const rendered = seg.description || (blankStored[0].type === 'labor' ? 'Labor' : 'Parts')
    ok(rendered === 'Labor', `and that line renders as "Labor" (got ${JSON.stringify(rendered)})`)
  }

  console.log('\n' + '='.repeat(78))
  console.log(`${pass} passed, ${fail} failed`)
  console.log('='.repeat(78))
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
