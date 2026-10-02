// Does every invoice total equal the sum of its parts, and is tax present where the
// business charges it? Read-only against production.
//
//   node scripts/audit-invoice-totals.cjs

const fs = require('fs')
for (const ln of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = ln.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
const get = async p => JSON.parse(await (await fetch(`${U}/rest/v1/${p}`, { headers: H })).text())
const n = v => Number(v ?? 0)
const r2 = x => Math.round(x * 100) / 100
const usd = x => `$${x.toFixed(2)}`

;(async () => {
  const prof = await get('profiles?select=id,business_name,tax_parts,tax_labor,tax_rate_parts,tax_rate_labor')
  const shop = {}; prof.forEach(p => { shop[p.id] = p })

  console.log('='.repeat(78))
  console.log('PHASE 0c — TOTALS THAT DO NOT ADD UP')
  console.log('='.repeat(78))

  // ── HD ──
  const hd = await get('hd_invoices?select=id,invoice_number,user_id,status,subtotal_labor,subtotal_parts,diagnostic_fee,road_call_fee,late_fee_amount,tax_rate,tax_amount,total,created_at,line_items&order=created_at')
  console.log('\nHD INVOICES')
  console.log('  invoice        labor    parts    diag    road    tax      TOTAL   expected   delta  issue')
  let hdBad = 0, hdNoTax = 0
  const hdIssues = []
  for (const i of hd) {
    const labor = n(i.subtotal_labor), parts = n(i.subtotal_parts)
    const diag = n(i.diagnostic_fee), road = n(i.road_call_fee), late = n(i.late_fee_amount)
    const tax = n(i.tax_amount), total = n(i.total)
    const expected = r2(labor + parts + diag + road + late + tax)
    const delta = r2(total - expected)
    const s = shop[i.user_id] ?? {}
    // Tax expected when the business taxes anything and there is a base to tax.
    const taxable = (s.tax_parts !== false ? parts : 0) + (s.tax_labor !== false ? labor + diag + road : 0)
    const rate = n(s.tax_rate_parts) || n(s.tax_rate_labor)
    const taxMissing = tax === 0 && taxable > 0 && rate > 0
    const issues = []
    if (Math.abs(delta) >= 0.01) { issues.push('TOTAL MISMATCH'); hdBad++ }
    if (taxMissing) { issues.push('NO TAX'); hdNoTax++ }
    if (issues.length) hdIssues.push({ i, labor, parts, diag, road, tax, total, expected, delta, issues })
    console.log(`  ${String(i.invoice_number).padEnd(14)}${labor.toFixed(2).padStart(8)}${parts.toFixed(2).padStart(9)}${diag.toFixed(2).padStart(8)}${road.toFixed(2).padStart(8)}${tax.toFixed(2).padStart(8)}${total.toFixed(2).padStart(11)}${expected.toFixed(2).padStart(11)}${delta.toFixed(2).padStart(8)}  ${issues.join(' + ')}`)
  }
  console.log(`\n  HD: ${hdBad} total mismatches, ${hdNoTax} missing tax, of ${hd.length}`)

  // ── LD ──
  const ld = await get('invoices?select=id,invoice_number,user_id,status,invoice_status,subtotal,tax_rate,tax_amount,discount_amount,total,line_items,shop_supplies,additional_parts,additional_labor,created_at&order=created_at')
  console.log('\nLD INVOICES')
  console.log('  invoice        subtotal  disc    tax      TOTAL   expected   delta  issue')
  let ldBad = 0, ldNoTax = 0
  const ldIssues = []
  for (const i of ld) {
    const sub = n(i.subtotal), disc = n(i.discount_amount), tax = n(i.tax_amount), total = n(i.total)
    const expected = r2(sub + tax - disc)
    const delta = r2(total - expected)
    const s = shop[i.user_id] ?? {}
    const rate = n(s.tax_rate_parts) || n(s.tax_rate_labor)
    const taxMissing = tax === 0 && sub > 0 && rate > 0
    const issues = []
    if (Math.abs(delta) >= 0.01) { issues.push('TOTAL MISMATCH'); ldBad++ }
    if (taxMissing) { issues.push('NO TAX'); ldNoTax++ }
    if (issues.length) ldIssues.push({ i, sub, tax, total, expected, delta, issues })
    console.log(`  ${String(i.invoice_number).padEnd(14)}${sub.toFixed(2).padStart(9)}${disc.toFixed(2).padStart(7)}${tax.toFixed(2).padStart(8)}${total.toFixed(2).padStart(11)}${expected.toFixed(2).padStart(11)}${delta.toFixed(2).padStart(8)}  ${issues.join(' + ')}`)
  }
  console.log(`\n  LD: ${ldBad} total mismatches, ${ldNoTax} missing tax, of ${ld.length}`)

  // ── Who was affected, and was it sent? ──
  console.log('\n' + '='.repeat(78))
  console.log('CUSTOMER EXPOSURE — was the wrong number actually sent?')
  console.log('='.repeat(78))
  const SENT = new Set(['sent', 'unpaid', 'paid', 'partial', 'overdue', 'awaiting_payment'])
  for (const x of [...hdIssues, ...ldIssues]) {
    const st = String(x.i.status ?? x.i.invoice_status ?? '')
    console.log(`  ${String(x.i.invoice_number).padEnd(14)} status=${st.padEnd(16)} ${SENT.has(st) ? 'LIKELY SEEN BY CUSTOMER' : 'not sent'}  ${x.issues.join(' + ')}  understated by ${usd(Math.abs(x.delta))}`)
  }
  console.log(`\n  total affected invoices: ${hdIssues.length + ldIssues.length}`)
})()
