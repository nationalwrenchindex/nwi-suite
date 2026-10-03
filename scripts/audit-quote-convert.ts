// BIG RUN THREE, item 1a audit: what survives an LD quote -> invoice conversion.
// Read-only. Prints the real field-by-field table against Kurt's real quotes.
//
//   npx tsx scripts/audit-quote-convert.ts

import fs from 'fs'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

const get = async (p: string) => {
  const r = await fetch(`${U}/rest/v1/${p}`, { headers: H })
  const t = await r.text()
  try { return JSON.parse(t) } catch { return { __status: r.status, __raw: t } }
}
const hr = (t: string) => { console.log('\n' + '='.repeat(78)); console.log(t); console.log('='.repeat(78)) }

async function main() {
  // ── What columns do quotes and invoices actually have? ──
  const [q0] = await get('quotes?select=*&limit=1')
  const [i0] = await get('invoices?select=*&limit=1')
  const qCols = Object.keys(q0 ?? {}).sort()
  const iCols = Object.keys(i0 ?? {}).sort()

  hr('quotes columns (' + qCols.length + ')')
  console.log(qCols.join(', '))
  hr('invoices columns (' + iCols.length + ')')
  console.log(iCols.join(', '))

  hr('Columns on quotes with NO home on invoices (silently dropped on convert)')
  const dropped = qCols.filter(c => !iCols.includes(c))
  for (const c of dropped) console.log('  ' + c)

  // ── Kurt's quotes ──
  hr("The quotes named in the brief: QT-2026-0001, 0002, 0003")
  const quotes = await get('quotes?select=*,customer:customers(id,first_name,last_name,phone,email,address_line1,address_line2,city,state,zip),vehicle:vehicles(id,year,make,model,vin)&order=created_at.desc')
  for (const q of quotes) {
    console.log(`\n  ${q.quote_number}   status=${q.status}   user=${String(q.user_id).slice(0, 8)}   created=${String(q.created_at).slice(0, 10)}`)
    console.log(`    customer_id          : ${q.customer_id ?? '(null)'}  ${q.customer ? '-> ' + [q.customer.first_name, q.customer.last_name].filter(Boolean).join(' ') : ''}`)
    console.log(`    vehicle_id           : ${q.vehicle_id ?? '(null)'}  ${q.vehicle ? '-> ' + [q.vehicle.year, q.vehicle.make, q.vehicle.model].filter(Boolean).join(' ') : ''}`)
    console.log(`    job_id               : ${q.job_id ?? '(null)'}`)
    console.log(`    job_category/subtype : ${q.job_category ?? '-'} / ${q.job_subtype ?? '-'}`)
    console.log(`    labor_hours / rate   : ${q.labor_hours ?? '(null)'} / ${q.labor_rate ?? '(null)'}`)
    console.log(`    parts_subtotal       : ${q.parts_subtotal ?? '(null)'}`)
    console.log(`    parts_markup_percent : ${q.parts_markup_percent ?? '(null)'}`)
    console.log(`    labor_subtotal       : ${q.labor_subtotal ?? '(null)'}`)
    console.log(`    tax_percent / amount : ${q.tax_percent ?? '(null)'} / ${q.tax_amount ?? '(null)'}`)
    console.log(`    tax_breakdown        : ${q.tax_breakdown ? JSON.stringify(q.tax_breakdown) : '(null)'}`)
    console.log(`    grand_total          : ${q.grand_total ?? '(null)'}`)
    console.log(`    po_number            : ${q.po_number ?? '(null)'}`)
    console.log(`    notes                : ${q.notes ? JSON.stringify(String(q.notes).slice(0, 50)) : '(null)'}`)
    console.log(`    converted_invoice_id : ${q.converted_invoice_id ?? '(null)'}`)
    console.log(`    line_items           :`)
    for (const li of (Array.isArray(q.line_items) ? q.line_items : [])) {
      console.log('      ' + JSON.stringify(li))
    }
  }

  // ── Which invoices came from a quote, and what do they hold? ──
  hr('Invoices with source_quote_id — the conversion, as it really landed')
  const invs = await get('invoices?select=*&source_quote_id=not.is.null&order=created_at.desc')
  if (!Array.isArray(invs) || invs.length === 0) {
    console.log('  NONE. No LD quote has ever been converted to an invoice in production.')
  }
  for (const i of invs) {
    const q = quotes.find((x: Record<string, unknown>) => x.id === i.source_quote_id)
    console.log(`\n  ${i.invoice_number}  <- ${q?.quote_number ?? i.source_quote_id}`)
    console.log(`    customer_id / vehicle_id : ${i.customer_id ?? '(null)'} / ${i.vehicle_id ?? '(null)'}`)
    console.log(`    subtotal / tax / total   : ${i.subtotal} / ${i.tax_amount} / ${i.total}`)
    console.log(`    tax_breakdown            : ${i.tax_breakdown ? 'Y' : '(null)'}`)
    console.log(`    po_number                : ${i.po_number ?? '(null)'}`)
    console.log(`    line_items               :`)
    for (const li of (Array.isArray(i.line_items) ? i.line_items : [])) console.log('      ' + JSON.stringify(li))
  }

  // ── Which line-item keys appear anywhere, on either table? ──
  hr('Every key seen on a real line item, quotes vs invoices')
  const keysOf = (rows: Record<string, unknown>[]) => {
    const s = new Set<string>()
    for (const r of rows) for (const li of (Array.isArray(r.line_items) ? r.line_items : [])) {
      for (const k of Object.keys(li as object)) s.add(k)
    }
    return [...s].sort()
  }
  const allInv = await get('invoices?select=line_items')
  console.log('  quotes.line_items   keys: ' + keysOf(quotes).join(', '))
  console.log('  invoices.line_items keys: ' + keysOf(allInv).join(', '))

  // ── work_orders: does IT store markup / hours / rate? (item 2a) ──
  const [w0] = await get('work_orders?select=*&limit=1')
  hr('work_orders columns (' + Object.keys(w0 ?? {}).length + ')')
  console.log(Object.keys(w0 ?? {}).sort().join(', '))

  const [s0] = await get('work_order_segments?select=*&limit=1')
  hr('work_order_segments columns (' + Object.keys(s0 ?? {}).length + ')')
  console.log(Object.keys(s0 ?? {}).sort().join(', '))

  // ── HD side, for 1b/1c/7c ──
  const [hq] = await get('hd_quotes?select=*&limit=1')
  hr('hd_quotes columns (' + Object.keys(hq ?? {}).length + ')')
  console.log(Object.keys(hq ?? {}).sort().join(', '))

  const [hw] = await get('hd_work_orders?select=*&limit=1')
  hr('hd_work_orders columns (' + Object.keys(hw ?? {}).length + ')')
  console.log(Object.keys(hw ?? {}).sort().join(', '))

  const [hu] = await get('hd_units?select=*&limit=1')
  hr('hd_units columns (' + Object.keys(hu ?? {}).length + ')')
  console.log(Object.keys(hu ?? {}).sort().join(', '))

  // ── 7c: how many hd_quotes could be linked to a customer? ──
  hr('7c — hd_quotes customer linkage potential')
  const hqAll = await get('hd_quotes?select=id,quote_number,customer_name,customer_phone,customer_email')
  const custs = await get('customers?select=id,user_id,first_name,last_name,phone,email')
  console.log(`  hd_quotes rows: ${Array.isArray(hqAll) ? hqAll.length : JSON.stringify(hqAll)}`)
  if (Array.isArray(hqAll)) {
    let byName = 0, byPhone = 0, none = 0
    for (const q of hqAll) {
      const nm = String(q.customer_name ?? '').trim().toLowerCase()
      const ph = String(q.customer_phone ?? '').replace(/\D/g, '').slice(-10)
      const m = custs.find((c: Record<string, unknown>) =>
        (nm && `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim().toLowerCase() === nm))
      const p = ph && custs.find((c: Record<string, unknown>) => String(c.phone ?? '').replace(/\D/g, '').slice(-10) === ph)
      if (m) byName++; else if (p) byPhone++; else none++
    }
    console.log(`    matchable by exact name : ${byName}`)
    console.log(`    matchable by phone only : ${byPhone}`)
    console.log(`    not matchable           : ${none}`)
  }
}

main().catch(e => console.error('FAILED:', e.message))
