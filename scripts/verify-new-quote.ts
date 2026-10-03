// Verification for the LD from-scratch quote.
//
// Uses the REAL calculator and the REAL shop settings from production. It writes one
// quote and deletes it — a create path cannot be proven read-only, so the write is
// explicit, tagged, and cleaned up. Everything else is read-only.
//
//   npx tsx scripts/verify-new-quote.ts

import fs from 'fs'
import { computeTotals, toLineItems, fromLineItems, round2 } from '../src/components/shared/line-items'
import { taxSettingsFrom, taxDisplayRows, parseBreakdown } from '../src/lib/tax'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) pass++; else fail++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}
const usd = (n: number) => `$${n.toFixed(2)}`

async function main() {
  // ── The shop, and its real settings ──
  const profiles = await (await fetch(
    `${URL}/rest/v1/profiles?select=id,business_name,default_labor_rate,default_parts_markup_percent,tax_parts,tax_labor,tax_rate_parts,tax_rate_labor,default_tax_percent&business_type=eq.mechanic&business_name=not.is.null&limit=1`,
    { headers: H },
  )).json()
  const shop = profiles[0]
  if (!shop) { console.log('No mechanic profile in production to test against.'); return }

  const tax = taxSettingsFrom(shop)
  console.log('='.repeat(78))
  console.log(`Shop: ${shop.business_name}`)
  console.log(`  labour rate ${shop.default_labor_rate}  markup ${shop.default_parts_markup_percent}%`)
  console.log(`  tax: parts ${tax.tax_parts ? 'ON' : 'OFF'} @ ${tax.tax_rate_parts}%   labor ${tax.tax_labor ? 'ON' : 'OFF'} @ ${tax.tax_rate_labor}%`)
  console.log('='.repeat(78))

  // ── The lines a tech would type. unit_price is PRE-markup, the editor's convention ──
  const items = [
    { _id: 'a', description: 'Brake pads, front axle set', quantity: 1, unit_price: 58.40, part_number: 'MKD1363' },
    { _id: 'b', description: 'Rotor',                      quantity: 2, unit_price: 41.15, part_number: '' },
  ]
  const laborHours = 2.5
  const laborRate  = Number(shop.default_labor_rate) || 125
  const markupPct  = Number(shop.default_parts_markup_percent) || 20
  const taxPct     = tax.tax_rate_parts

  const totals = computeTotals({ items, markupPct, laborHours, laborRate, taxPct, taxSettings: tax })

  console.log('\nWhat the form computes:')
  console.log(`  parts base (what the shop pays)   ${usd(totals.partsBase)}`)
  console.log(`  markup @ ${markupPct}%                      ${usd(totals.markupAmt)}`)
  console.log(`  parts total (customer)            ${usd(totals.partsTotal)}`)
  console.log(`  labour ${laborHours}h @ ${usd(laborRate)}/h            ${usd(totals.laborSubtotal)}`)
  console.log(`  subtotal                          ${usd(totals.subtotal)}`)
  for (const r of taxDisplayRows(totals.taxBreakdown)) {
    console.log(`  ${r.text.padEnd(34)}${usd(r.amount)}`)
  }
  console.log(`  TAX                               ${usd(totals.taxAmount)}`)
  console.log(`  TOTAL                             ${usd(totals.grandTotal)}`)

  // ── The row the route will insert, field for field ──
  const lineItems = toLineItems({ items, markupPct, laborHours, laborRate })
  const TAG = `zz-verify-${Date.now()}`
  const row: Record<string, unknown> = {
    user_id:              shop.id,
    quote_number:         TAG,
    status:               'draft',
    // 'manual', not 'job' — the route no longer hard-codes it.
    source:               'manual',
    job_id:               null,
    customer_id:          null,
    vehicle_id:           null,
    notes:                TAG,
    line_items:           lineItems,
    labor_hours:          laborHours,
    labor_rate:           laborRate,
    parts_subtotal:       round2(totals.partsBase),
    parts_markup_percent: markupPct,
    labor_subtotal:       round2(totals.laborSubtotal),
    tax_percent:          taxPct,
    tax_amount:           round2(totals.taxAmount),
    grand_total:          round2(totals.grandTotal),
    tax_breakdown:        totals.taxBreakdown,
  }

  console.log('\nThe row it writes:')
  for (const [k, v] of Object.entries(row)) {
    const shown = k === 'line_items' || k === 'tax_breakdown' ? JSON.stringify(v) : String(v)
    console.log(`  ${k.padEnd(22)} ${shown.length > 92 ? shown.slice(0, 92) + '…' : shown}`)
  }

  // ── Write it ──
  console.log('\n' + '='.repeat(78))
  console.log('Writing to production, then deleting')
  console.log('='.repeat(78))
  const created = await (await fetch(`${URL}/rest/v1/quotes`, {
    method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row),
  })).json()
  const saved = Array.isArray(created) ? created[0] : null
  ok(!!saved?.id, 'the quote row inserted')
  if (!saved?.id) { console.log('  ' + JSON.stringify(created).slice(0, 300)); return }

  try {
    // ── Every money field round-trips ──
    const n = (v: unknown) => Number(v ?? 0)
    ok(n(saved.grand_total)   === round2(totals.grandTotal),   `grand_total stored ${usd(n(saved.grand_total))} = computed ${usd(round2(totals.grandTotal))}`)
    ok(n(saved.tax_amount)    === round2(totals.taxAmount),    `tax_amount  stored ${usd(n(saved.tax_amount))} = computed ${usd(round2(totals.taxAmount))}`)
    ok(n(saved.labor_subtotal) === round2(totals.laborSubtotal), `labor_subtotal stored ${usd(n(saved.labor_subtotal))} = computed ${usd(round2(totals.laborSubtotal))}`)
    ok(n(saved.parts_subtotal) === round2(totals.partsBase),   `parts_subtotal stored ${usd(n(saved.parts_subtotal))} = computed ${usd(round2(totals.partsBase))} (PRE-markup)`)
    ok(saved.source === 'manual', `source stored as "${saved.source}", not the old hard-coded "job"`)

    // ── The breakdown survived, and says what was taxed ──
    const stored = parseBreakdown(saved.tax_breakdown)
    ok(stored !== null, 'tax_breakdown round-tripped (this is the field the editor was dropping)')
    if (stored) {
      ok(stored.parts?.amount === totals.taxBreakdown?.parts?.amount,
        `parts tax ${usd(stored.parts?.amount ?? 0)} matches`)
      ok(stored.labor?.taxed === tax.tax_labor,
        `labor bucket taxed=${stored.labor?.taxed} matches the shop's setting (${tax.tax_labor})`)
      const sum = round2((stored.parts?.amount ?? 0) + (stored.labor?.amount ?? 0) + (stored.services?.amount ?? 0))
      ok(sum === n(saved.tax_amount), `the printed tax rows sum to tax_amount (${usd(sum)})`)
    }

    // ── THE ROUND TRIP THAT MATTERS: reopen it in the editor ──
    // Stored line_items carry POST-markup prices. The editor divides the markup back
    // out on read. If those two disagree, a reopened quote shows different money than
    // the one that was saved — which is the bug line-items.ts exists to prevent.
    const reopened = fromLineItems(saved.line_items, markupPct)
    const reTotals = computeTotals({
      items:      reopened,
      markupPct,
      laborHours: n(saved.labor_hours),
      laborRate:  n(saved.labor_rate),
      taxPct:     n(saved.tax_percent),
      taxSettings: tax,
    })
    console.log('\n  reopened in the editor:')
    console.log(`    parts base ${usd(reTotals.partsBase)}  labour ${usd(reTotals.laborSubtotal)}  total ${usd(reTotals.grandTotal)}`)
    ok(round2(reTotals.grandTotal) === n(saved.grand_total),
      `reopening reproduces the stored total to the cent (${usd(round2(reTotals.grandTotal))})`)
    ok(Math.abs(reTotals.partsBase - totals.partsBase) < 0.02,
      `the markup divides back out cleanly (${usd(reTotals.partsBase)} vs ${usd(totals.partsBase)})`)

    // A deliberate control: this MUST fail if the numbers were not really compared.
    ok(round2(totals.grandTotal) !== 0, 'the total under test is non-zero (guards a vacuous pass)')
  } finally {
    await fetch(`${URL}/rest/v1/quotes?id=eq.${saved.id}`, { method: 'DELETE', headers: H })
    const gone = await (await fetch(`${URL}/rest/v1/quotes?id=eq.${saved.id}&select=id`, { headers: H })).json()
    ok(Array.isArray(gone) && gone.length === 0, 'test quote deleted from production')
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
