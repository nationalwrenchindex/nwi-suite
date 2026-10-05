// What does the customer's invoice page ACTUALLY render, for each real invoice?
//
// Read-only against production. Nothing is written.
//
//   npx tsx scripts/verify-invoice-rows.ts
//
// This mirrors the mapping in src/app/invoice/[token]/page.tsx line for line. If the
// page renders nothing for an invoice, this prints nothing for it too - which is the
// point. Guessing from the JSON is how you fix the wrong layer.

import fs from 'fs'
import {
  isLaborLine, enrichLaborDescription, lineMeta,
  segmentedLine, groupBySegment, segmentHeading,
} from '../src/lib/invoice-document'

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
  return r.json()
}

interface Inv {
  invoice_number: string
  line_items: Array<Record<string, unknown>>
  subtotal: number
  tax_amount: number
  total: number
  job_subtype: string | null
  job_category: string | null
  job_notes: string | null
  source_quote_id: string | null
}

/** Exactly what the page does, so what prints here is what prints there. */
function render(inv: Inv) {
  const lineItems = Array.isArray(inv.line_items) ? inv.line_items : []
  const quoteCtx = { laborHours: null, laborRate: null }

  const describedLines = lineItems.map((li, i) => {
    const labor = isLaborLine(li, quoteCtx)
    const qty   = Number(li.quantity ?? 0)
    const unit  = Number(li.unit_price ?? 0)
    const description = labor
      ? enrichLaborDescription(li.description as string, {
          jobSubtype:  inv.job_subtype,
          jobCategory: inv.job_category,
          jobNotes:    inv.job_notes,
        })
      : String(li.description ?? '').trim()
    const seg = segmentedLine(li)
    return {
      key: `li-${i}`,
      description: (labor ? description : seg.description) || description || 'Service',
      note: (li.part_number as string | null) || null,
      meta: lineMeta(qty, unit, labor),
      amount: Number(li.total ?? 0),
      sequence: seg.sequence,
      label: seg.label,
    }
  })

  return groupBySegment(describedLines, r => ({ sequence: r.sequence, label: r.label }))
}

async function main() {
  const nums = ['INV-2026-0008', 'INV-2026-0009', 'INV-2026-0010', 'INV-2026-0011']
  const rows = await get(
    'invoices?select=invoice_number,line_items,subtotal,tax_amount,total,job_subtype,job_category,job_notes,source_quote_id' +
    `&invoice_number=in.(${nums.join(',')})&order=invoice_number`) as Inv[]

  ok(rows.length === 4, `all four invoices read (${rows.length})`)

  for (const inv of rows) {
    hr(`${inv.invoice_number}  subtotal ${inv.subtotal}  tax ${inv.tax_amount}  total ${inv.total}`)

    const stored = Array.isArray(inv.line_items) ? inv.line_items : []
    const shape = stored.length === 0 ? 'EMPTY'
      : stored.some(l => l.segment !== undefined) ? 'NEW (segment carried)'
      : stored.some(l => l.type !== undefined)    ? 'typed, no segment'
      : 'LEGACY (prefix in description)'
    console.log(`  stored shape: ${shape},  ${stored.length} line(s)`)

    const groups = render(inv)
    const printed = groups.reduce((n, g) => n + g.rows.length, 0)
    console.log('')
    for (const g of groups) {
      const h = segmentHeading(g)
      if (h) console.log(`    [${h}]`)
      for (const r of g.rows) {
        console.log(`      ${r.description.padEnd(30)} ${(r.meta ?? '').padEnd(22)} ${r.amount.toFixed(2).padStart(10)}`)
        if (r.note) console.log(`        part# ${r.note}`)
      }
    }
    if (printed === 0) console.log('      (NOTHING RENDERS)')
    console.log('')

    // THE ASSERTION THAT MATTERS: every stored line must reach the page.
    ok(printed === stored.length,
      `every stored line renders: ${printed} of ${stored.length}`)
    // And none of them may render as a blank description.
    const blanks = groups.flatMap(g => g.rows).filter(r => !r.description.trim())
    ok(blanks.length === 0, `no line renders with a blank description (${blanks.length} blank)`)
    // The lines must sum to the subtotal the invoice bills.
    const sum = Math.round(groups.flatMap(g => g.rows).reduce((n, r) => n + r.amount, 0) * 100) / 100
    ok(sum === Number(inv.subtotal),
      `the rendered lines sum to the stored subtotal ${inv.subtotal} (got ${sum})`)
  }

  console.log('\n' + '='.repeat(78))
  console.log(`${pass} passed, ${fail} failed`)
  console.log('='.repeat(78))
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exitCode = 1 })
