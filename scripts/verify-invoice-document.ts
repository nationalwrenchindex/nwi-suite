// Phase 3 verification: the customer-facing invoice documents.
//
// Runs the REAL presentation helpers against REAL production rows, read-only.
// Nothing is written. The helpers are what decide what every template prints, so
// exercising them against live data is the thing that can actually fail — and the
// new PostgREST selects are issued verbatim, because a bad embed hint is the
// failure mode that would blank a whole block at runtime.
//
//   npx tsx scripts/verify-invoice-document.ts

import fs from 'fs'
import {
  shopBlockFrom,
  customerBlockFrom,
  ldInvoiceDates,
  formatDocDate,
  isLaborLine,
  enrichLaborDescription,
  quantityText,
  lineMeta,
  serviceUnitLines,
  documentDisclaimers,
  epa608Line,
  inspectionOutcome,
  feeRows,
  SHOP_BLOCK_SELECT,
} from '../src/lib/invoice-document'
import { parseBreakdown, taxDisplayRows } from '../src/lib/tax'

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

async function q(path: string): Promise<{ status: number; body: unknown }> {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: H })
  const t = await r.text()
  try { return { status: r.status, body: JSON.parse(t) } } catch { return { status: r.status, body: t } }
}

// The exact selects the templates now issue. A typo or an ambiguous embed here is
// a runtime 400 that silently empties a block, so they are exercised for real.
const LD_SELECT = `
  id, invoice_number, po_number, invoice_status, public_token,
  invoice_date, due_date, terms, total, subtotal, tax_rate, tax_amount, tax_breakdown,
  job_category, job_subtype, job_notes, jobs,
  line_items, shop_supplies, additional_parts, additional_labor,
  payment_instructions, finalized_at, created_at,
  customer_view_count, customer_viewed_at, times_sent,
  sent_to_customer_at, paid_at,
  service_lines, adjustments, tip_amount_cents,
  customer:customers(id, first_name, last_name, phone, email, address_line1, address_line2, city, state, zip),
  vehicle:vehicles(id, year, make, model, vin),
  source_quote:quotes!invoices_source_quote_id_fkey(id, quote_number, parts_subtotal, parts_markup_percent, labor_subtotal, labor_hours, labor_rate),
  user_id
`.replace(/\s+/g, ' ').trim()

async function main() {
  // ══ 1. The new selects actually resolve ════════════════════════════════════
  hr('1. The selects the templates issue — do they resolve against production?')

  const ldAll = await q(`invoices?select=${encodeURIComponent(LD_SELECT)}&order=created_at.desc`)
  ok(ldAll.status === 200, `LD invoice select returns 200 (got ${ldAll.status})${ldAll.status !== 200 ? ' :: ' + JSON.stringify(ldAll.body).slice(0, 300) : ''}`)
  const ldRows = (Array.isArray(ldAll.body) ? ldAll.body : []) as Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
  ok(ldRows.length > 0, `production returned LD invoices to render (${ldRows.length}) — guards a vacuous pass`)

  // `id` is deliberately NOT part of SHOP_BLOCK_SELECT — every real caller
  // filters by .eq('id', userId) — so this script has to ask for it to key a map.
  const shopSel = await q(`profiles?select=${encodeURIComponent('id, ' + SHOP_BLOCK_SELECT + ', business_type, bill_consumables_separately, default_payment_instructions, hd_epa_cert_number')}`)
  ok(shopSel.status === 200, `shop-block select returns 200 (got ${shopSel.status})`)
  const profiles = (Array.isArray(shopSel.body) ? shopSel.body : []) as Record<string, unknown>[]

  // ══ 2. tax_breakdown was never selected, so the split never printed ════════
  hr('2. The parts/labor tax split on the LD customer invoice')
  console.log('  The split shipped in migration 140 and the page read inv.tax_breakdown —')
  console.log('  but tax_breakdown was NOT in the page\'s select, so parseBreakdown() always')
  console.log('  saw undefined and every invoice fell through to one blended Tax line.')
  const withBreakdown = ldRows.filter(r => r.tax_breakdown)
  ok('tax_breakdown' in (ldRows[0] ?? {}), 'the new select returns a tax_breakdown key at all (the old one did not)')
  ok(withBreakdown.length > 0, `LD invoices carrying a stored breakdown: ${withBreakdown.length} — these were printing blended`)
  for (const r of withBreakdown) {
    const rows = taxDisplayRows(parseBreakdown(r.tax_breakdown))
    console.log(`\n  ${r.invoice_number}`)
    console.log(`    BEFORE : Tax (${Math.round(Number(r.tax_rate) * 10000) / 100}%)  $${Number(r.tax_amount).toFixed(2)}   <- one blended line`)
    for (const t of rows) console.log(`    AFTER  : ${t.text.padEnd(26)} ${t.taxed ? '$' + t.amount.toFixed(2) : '—'}`)
    // An invoice with labour only legitimately has ONE category row. What makes
    // it a split rather than the old blended line is that the row NAMES the
    // category it applies to, instead of saying "Tax" over everything.
    ok(rows.length > 0 && rows.every(t => /parts|labor|service/i.test(t.text)),
      `${r.invoice_number}: every tax row names its category (${rows.map(t => t.text).join(' | ')})`)
    ok(rows.reduce((s, t) => s + (t.taxed ? t.amount : 0), 0).toFixed(2) === Number(r.tax_amount).toFixed(2),
      `${r.invoice_number}: the split's taxed rows sum to the stored tax amount ($${Number(r.tax_amount).toFixed(2)}) — the customer's total is unchanged`)
  }

  // ══ 3. A real LD invoice, field by field ═══════════════════════════════════
  hr('3. A real LD invoice — every field, before and after')
  const prof = new Map(profiles.map(p => [p.id as string, p]))

  // The invoice with the most to show: a customer, a vehicle, line items.
  const ldPick = ldRows.find(r => r.customer && r.vehicle && Array.isArray(r.line_items) && r.line_items.length > 1)
                 ?? ldRows.find(r => r.customer) ?? ldRows[0]
  const shop = shopBlockFrom(prof.get(ldPick.user_id) as never)
  const cust = customerBlockFrom(ldPick.customer)
  const dates = ldInvoiceDates(ldPick)
  const srcQuote = Array.isArray(ldPick.source_quote) ? ldPick.source_quote[0] : ldPick.source_quote
  const qctx = { laborHours: srcQuote?.labor_hours ?? null, laborRate: srcQuote?.labor_rate ?? null }

  console.log(`\n  ${ldPick.invoice_number}  (${ldPick.invoice_status})\n`)
  console.log('  SHOP BLOCK — was: logo + "Invoice from <name>" and nothing else')
  console.log(`    name          : ${shop.name}`)
  console.log(`    logo          : ${shop.logoUrl ? 'YES ' + shop.logoUrl.slice(-28) : 'none'}`)
  console.log(`    address       : ${shop.addressLines.length ? shop.addressLines.join(' / ') : '(EMPTY)'}`)
  console.log(`    phone         : ${shop.phone ?? '(EMPTY)'}`)
  console.log(`    email         : ${shop.email ?? '(EMPTY)'}`)
  ok(shop.name.length > 0, 'shop name is never blank')
  ok(shop.logoUrl !== null, 'the uploaded logo reaches the document (it is on profiles.business_logo_url)')
  ok(shop.email !== null, 'the shop email now reaches the document — the old page never selected it')

  console.log('\n  BILL TO — was: first + last name only')
  console.log(`    name          : ${cust.name}`)
  console.log(`    address       : ${cust.addressLines.length ? cust.addressLines.join(' / ') : '(EMPTY)'}`)
  console.log(`    phone         : ${cust.phone ?? '(EMPTY)'}`)
  console.log(`    email         : ${cust.email ?? '(EMPTY)'}`)
  ok(cust.addressLines.length > 0, `the customer's own address now prints (${cust.addressLines.join(' / ')})`)
  ok(!cust.addressLines.some(l => /^[A-Z]{2} \d{5}/.test(l) && cust.addressLines.length === 1),
    'a state+zip is never emitted as the only address line')

  console.log('\n  DATES — was: no date of any kind on the document')
  console.log(`    invoice date  : ${formatDocDate(dates.issued) ?? '(EMPTY)'}   [stored: ${dates.issued}]`)
  console.log(`    due date      : ${formatDocDate(dates.due) ?? '(EMPTY)'}   [stored: ${dates.due ?? 'null'}]`)
  console.log(`    terms         : ${dates.termsText ?? '(EMPTY)'}`)
  console.log(`    PO #          : ${ldPick.po_number ?? '(EMPTY)'}`)
  ok(formatDocDate(dates.issued) !== null, 'the invoice date is present and formatted — the document was previously undated')
  ok(dates.due === null || formatDocDate(dates.due) !== null, 'a due date is only ever a stored one, never derived')

  console.log('\n  LINE ITEMS — was: "Labor"  Qty 2  $190.00')
  for (const li of (ldPick.line_items ?? []) as Record<string, unknown>[]) {
    const labor = isLaborLine(li, qctx)
    const desc = labor
      ? enrichLaborDescription(String(li.description ?? ''), {
          jobSubtype: ldPick.job_subtype, jobCategory: ldPick.job_category, jobNotes: ldPick.job_notes,
        })
      : String(li.description ?? '')
    // The REAL helper the template calls, not a copy of its formatting.
    const meta = lineMeta(Number(li.quantity ?? 0), Number(li.unit_price ?? 0), labor)
    console.log(`    BEFORE : ${String(li.description).padEnd(38)} Qty ${li.quantity}`)
    console.log(`    AFTER  : ${desc.padEnd(38)} ${meta ?? ''}`)
    // "2.5 each" of a part is nonsense, and was being printed. A fractional
    // quantity must never carry the "ea" suffix.
    ok(!(meta ?? '').includes(' ea') || Number.isInteger(Number(li.quantity)),
      `${ldPick.invoice_number}: "${li.description}" — "ea" appears only on a whole-number quantity (meta: ${meta})`)
  }

  // Labour hour labelling, against every LD line in production.
  hr('3b. Labour labelling across EVERY LD line item in production')
  let laborSeen = 0, hourLabelled = 0, partsMislabelled = 0
  for (const r of ldRows) {
    const sq = Array.isArray(r.source_quote) ? r.source_quote[0] : r.source_quote
    const ctx = { laborHours: sq?.labor_hours ?? null, laborRate: sq?.labor_rate ?? null }
    for (const li of (r.line_items ?? []) as Record<string, unknown>[]) {
      const labor = isLaborLine(li, ctx)
      const qt = quantityText(Number(li.quantity ?? 0), labor)
      if (labor) {
        laborSeen++
        if (qt && /hour/.test(qt)) hourLabelled++
        console.log(`  ${String(r.invoice_number).padEnd(15)} LABOR  "${li.description}"  ->  ${qt}`)
      } else if (/hour/.test(qt ?? '')) {
        partsMislabelled++
        console.log(`  ${String(r.invoice_number).padEnd(15)} !!     "${li.description}" labelled as hours but not proven labour`)
      }
    }
  }
  ok(laborSeen > 0, `labour lines found in production (${laborSeen}) — guards a vacuous pass`)
  ok(hourLabelled === laborSeen, `every labour line is labelled in hours (${hourLabelled}/${laborSeen})`)
  ok(partsMislabelled === 0, `no non-labour line is labelled in hours (${partsMislabelled} mislabelled)`)

  // ══ 4. HD ══════════════════════════════════════════════════════════════════
  hr('4. HD — the Service Unit block')
  const hdAll = await q('hd_invoices?select=*&order=created_at.desc')
  const hdRows = (Array.isArray(hdAll.body) ? hdAll.body : []) as Record<string, any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
  ok(hdRows.length > 0, `production returned HD invoices (${hdRows.length}) — guards a vacuous pass`)

  let emptyUnit = 0
  for (const r of hdRows) {
    const lines = serviceUnitLines(r)
    if (lines.length === 0) {
      emptyUnit++
      console.log(`  ${String(r.invoice_number).padEnd(15)} BLOCK HIDDEN  (was: "Service Unit" heading over blank space)`)
    } else {
      console.log(`  ${String(r.invoice_number).padEnd(15)} ${lines.map(l => (l.label ? `${l.label}: ${l.value}` : l.value)).join(' | ')}`)
    }
  }
  ok(emptyUnit > 0, `at least one real invoice knows nothing about its unit (${emptyUnit}) — this is the empty-header case, and it is now hidden`)
  ok(emptyUnit < hdRows.length, `and the block still renders for the rest (${hdRows.length - emptyUnit} of ${hdRows.length}) — so it was not hidden unconditionally`)
  for (const r of hdRows) {
    const lines = serviceUnitLines(r)
    const anyData = Boolean(r.unit_manufacturer || r.unit_model || r.unit_serial || r.unit_year || r.truck_make || r.truck_model || r.truck_year || r.vin)
    ok(lines.length > 0 === anyData, `${r.invoice_number}: the block renders exactly when the invoice has unit data`)
  }

  hr('5. HD — manufacturer and EPA 608 claims, per invoice')
  console.log('  BEFORE: every invoice footed with "National Wrench Index HD Suite - EPA')
  console.log('  Section 608 certified refrigeration work - All work performed by certified')
  console.log('  technicians", unconditionally.\n')
  let keeps = 0, loses = 0
  for (const r of hdRows) {
    const d = documentDisclaimers(r)
    const label = d.epa608 ? 'EPA 608 KEPT' : 'EPA 608 DROPPED'
    if (d.epa608) keeps++; else loses++
    const marks = d.manufacturers.filter(m => !/identify the equipment/.test(m)).map(m => m.split('®')[0]).join(' + ') || 'none'
    console.log(`  ${String(r.invoice_number).padEnd(15)} ${label.padEnd(16)} marks=${marks.padEnd(22)} mfr="${r.unit_manufacturer ?? ''}"`)
  }
  ok(loses > 0, `the certification claim is dropped from ${loses} invoice(s) that are not refrigeration work`)
  ok(keeps > 0, `and kept on ${keeps} that are — so it was not simply deleted`)

  // The two specific invoices the complaint was about.
  const aerial = hdRows.find(r => /aerial/i.test(String(r.notes ?? '')))
  if (aerial) {
    const d = documentDisclaimers(aerial)
    ok(d.epa608 === false, `${aerial.invoice_number} (auto-created from an AERIAL inspection) no longer claims EPA 608 refrigeration certification`)
    ok(d.manufacturers.length === 0, `${aerial.invoice_number}: no Thermo King or Carrier trademark notice on an aerial job`)
  } else {
    ok(false, 'expected to find the aerial-created invoice in production')
  }
  const dot = hdRows.find(r => /dot inspection/i.test(String(r.complaint ?? '')) && !/thermo|carrier/i.test(String(r.unit_manufacturer ?? '')))
  if (dot) {
    const d = documentDisclaimers(dot)
    ok(d.epa608 === false, `${dot.invoice_number} (DOT inspection on an ${dot.unit_manufacturer}) no longer claims refrigeration certification`)
  } else {
    ok(false, 'expected to find the non-reefer DOT invoice in production')
  }
  // And a Thermo King job must not name Carrier.
  const tk = hdRows.find(r => /thermo/i.test(String(r.unit_manufacturer ?? '')))
  if (tk) {
    const d = documentDisclaimers(tk)
    ok(d.manufacturers.some(m => /Thermo King/.test(m)), `${tk.invoice_number}: Thermo King is named on a Thermo King unit`)
    ok(!d.manufacturers.some(m => /Carrier/.test(m)), `${tk.invoice_number}: Carrier is NOT named on a Thermo King unit`)
  } else {
    ok(false, 'expected a Thermo King invoice in production')
  }
  console.log(`\n  cert line with a number set    : ${epa608Line('ABC-12345')}`)
  console.log(`  cert line with none set        : ${epa608Line(null)}`)
  const epaProfiles = profiles.filter(p => (p as { hd_epa_cert_number?: string }).hd_epa_cert_number)
  console.log(`  profiles with hd_epa_cert_number set: ${epaProfiles.length} of ${profiles.length}`)

  hr('6. HD — a zero fee must not print a line')
  // feeRows() is the rule BOTH HD templates now render from, so asserting on it
  // asserts on what the customer sees. The previous version of this check was
  // `ok(printsDiag === (Number(r.diagnostic_fee) > 0), ...)` — x === x, which
  // could not fail. Deleted.
  let zeroFeeInvoices = 0, chargedFeeInvoices = 0
  for (const r of hdRows) {
    const rows = feeRows(r)
    const labels = rows.map(x => x.label)
    const diag = Number(r.diagnostic_fee ?? 0)
    const road = Number(r.road_call_fee ?? 0)
    if (diag === 0 && road === 0) zeroFeeInvoices++
    if (diag > 0 || road > 0) chargedFeeInvoices++
    console.log(`  ${String(r.invoice_number).padEnd(15)} diag=${String(diag).padEnd(5)} road=${String(road).padEnd(4)} -> prints: ${labels.length ? labels.join(', ') : 'NO FEE LINES'}`)

    ok(labels.includes('Diagnostic Fee') === diag > 0,
      `${r.invoice_number}: a Diagnostic Fee line appears exactly when the fee is non-zero (fee=${diag})`)
    ok(labels.includes('Road Call Fee') === road > 0,
      `${r.invoice_number}: a Road Call Fee line appears exactly when the fee is non-zero (fee=${road})`)
    ok(rows.every(x => x.amount > 0), `${r.invoice_number}: no fee row is ever rendered with a zero amount`)
  }
  ok(zeroFeeInvoices > 0, `invoices charging no fee at all exist (${zeroFeeInvoices}) and print no fee line — guards a vacuous pass`)
  ok(chargedFeeInvoices > 0, `invoices that DO charge a fee exist (${chargedFeeInvoices}) and still print it — so fees were not suppressed wholesale`)

  hr('7. The attached inspection — FAIL, and what happened to the unit')
  const insp = await q('hd_aerial_inspections?select=invoice_id,inspection_id,overall_result,removed_from_service&invoice_id=not.is.null')
  const inspRows = (Array.isArray(insp.body) ? insp.body : []) as Record<string, unknown>[]
  for (const r of inspRows) {
    const before = String(r.overall_result).toUpperCase()
    const after = inspectionOutcome(r.overall_result as string, r.removed_from_service as boolean | null).join(' · ')
    console.log(`  ${r.inspection_id}`)
    console.log(`    stored removed_from_service = ${JSON.stringify(r.removed_from_service)}`)
    console.log(`    BEFORE : ${before}`)
    console.log(`    AFTER  : ${after}`)
    ok(after.length > before.length, `${r.inspection_id}: the determination is now stated alongside the result`)
  }
  ok(inspRows.length > 0, `a real inspection is attached to a real invoice (${inspRows.length}) — guards a vacuous pass`)

  // The three-valued contract from migration 141.
  ok(inspectionOutcome('fail', true).includes('UNIT TAKEN OUT OF SERVICE'), 'removed_from_service = true  says the unit was taken out of service')
  ok(inspectionOutcome('fail', false).includes('Unit remains in service'), 'removed_from_service = false says it remains in service')
  ok(inspectionOutcome('fail', null).length === 1, 'removed_from_service = NULL says NOTHING — nobody was asked, so no determination is asserted')
  ok(!inspectionOutcome('fail', null).some(s => /service/i.test(s)), 'and specifically does not claim "remains in service" on a pre-141 inspection')

  const pmNull = await q('hd_pm_checklists?select=id,removed_from_service&invoice_id=not.is.null&removed_from_service=is.null')
  const pmNullRows = (Array.isArray(pmNull.body) ? pmNull.body : []) as unknown[]
  ok(pmNullRows.length > 0, `${pmNullRows.length} attached PM checklists predate 141 and will print no determination — which is the point`)

  hr(`${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
