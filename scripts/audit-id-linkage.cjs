// Do invoices link to a customer and a piece of equipment by ID, or carry typed text?
// An invoice with no unit_id is invisible to that unit cost history. Read-only.
//
//   node scripts/audit-id-linkage.cjs

const fs = require('fs')
for (const ln of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = ln.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL
const K = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: K, Authorization: `Bearer ${K}` }
const get = async p => {
  const r = await fetch(`${U}/rest/v1/${p}`, { headers: H })
  const t = await r.text()
  if (r.status !== 200) return { __err: `${r.status} ${t.slice(0, 160)}` }
  return JSON.parse(t)
}

;(async () => {
  console.log('PHASE 0a — ID LINKAGE'.padEnd(78, ' '))
  console.log('='.repeat(78))

  // ── LD invoices ──
  const ld = await get('invoices?select=id,invoice_number,customer_id,vehicle_id,job_id,source,created_at,total&order=created_at')
  if (ld.__err) { console.log('LD invoices: ' + ld.__err) } else {
    const n = ld.length
    const wc = ld.filter(x => x.customer_id).length
    const wv = ld.filter(x => x.vehicle_id).length
    const orph = ld.filter(x => !x.customer_id && !x.vehicle_id).length
    const noVeh = ld.filter(x => !x.vehicle_id).length
    console.log(`\nLD invoices: ${n}`)
    console.log(`  customer_id set : ${wc}/${n}`)
    console.log(`  vehicle_id  set : ${wv}/${n}   <-- the unit link`)
    console.log(`  NO vehicle_id   : ${noVeh}/${n}`)
    console.log(`  neither         : ${orph}/${n}`)
    console.log('  by source:')
    const bySrc = {}
    ld.forEach(x => {
      const k = x.source ?? 'null'
      bySrc[k] = bySrc[k] ?? { n: 0, cust: 0, veh: 0 }
      bySrc[k].n++; if (x.customer_id) bySrc[k].cust++; if (x.vehicle_id) bySrc[k].veh++
    })
    for (const [k, v] of Object.entries(bySrc)) {
      console.log(`    ${k.padEnd(13)} n=${String(v.n).padStart(3)}  customer=${v.cust}  vehicle=${v.veh}`)
    }
  }

  // ── HD invoices: unit_id is the equipment link ──
  const hd = await get('hd_invoices?select=id,invoice_number,customer_id,unit_id,fleet_account_id,unit_serial,unit_manufacturer,unit_model,customer_name,work_order_id,created_at,total&order=created_at')
  if (hd.__err) { console.log('HD invoices: ' + hd.__err) } else {
    const n = hd.length
    const wc = hd.filter(x => x.customer_id).length
    const wu = hd.filter(x => x.unit_id).length
    const wf = hd.filter(x => x.fleet_account_id).length
    const textOnly = hd.filter(x => !x.unit_id && (x.unit_serial || x.unit_manufacturer || x.unit_model)).length
    const nothing = hd.filter(x => !x.unit_id && !x.unit_serial && !x.unit_manufacturer && !x.unit_model).length
    console.log(`\nHD invoices: ${n}`)
    console.log(`  customer_id      set : ${wc}/${n}`)
    console.log(`  unit_id          set : ${wu}/${n}   <-- the equipment link`)
    console.log(`  fleet_account_id set : ${wf}/${n}`)
    console.log(`  NO unit_id but typed unit text : ${textOnly}/${n}   <-- ORPHANS`)
    console.log(`  no unit reference of any kind  : ${nothing}/${n}`)
    console.log('\n  every HD invoice:')
    for (const x of hd) {
      console.log(`    ${String(x.invoice_number).padEnd(14)} cust=${x.customer_id ? 'Y' : '.'} unit=${x.unit_id ? 'Y' : '.'} fleet=${x.fleet_account_id ? 'Y' : '.'} wo=${x.work_order_id ? 'Y' : '.'}  total=${String(x.total).padStart(9)}  typed="${[x.unit_manufacturer, x.unit_model, x.unit_serial].filter(Boolean).join(' ') || '—'}"`)
    }
  }

  // ── Could the orphans be matched to a real unit by serial? ──
  const units = await get('hd_units?select=id,unit_number,serial_number,manufacturer,model')
  if (!units.__err && !hd.__err) {
    const bySerial = new Map()
    units.forEach(u => { if (u.serial_number) bySerial.set(String(u.serial_number).trim().toLowerCase(), u) })
    const orphans = hd.filter(x => !x.unit_id)
    let matchable = 0
    console.log(`\n  hd_units on file: ${units.length}`)
    console.log(`  HD invoices with no unit_id: ${orphans.length}`)
    for (const o of orphans) {
      const s = String(o.unit_serial ?? '').trim().toLowerCase()
      const hit = s ? bySerial.get(s) : null
      if (hit) matchable++
      console.log(`    ${String(o.invoice_number).padEnd(14)} serial="${o.unit_serial ?? '—'}" -> ${hit ? 'MATCHES unit ' + hit.unit_number : 'no unit match'}`)
    }
    console.log(`  recoverable by serial: ${matchable}/${orphans.length}`)
  }
})()
