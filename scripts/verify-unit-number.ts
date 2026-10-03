// Item 1b verification: the unit number reaches the customer's document.
//
// Read-only against production.
//
//   npx tsx scripts/verify-unit-number.ts

import fs from 'fs'
import { serviceUnitLines, unitSnapshot } from '../src/lib/invoice-document'

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

async function main() {
  // ══ 1. Where does the unit number live today? ══════════════════════════════
  hr('1. THE AUDIT ANSWER — the field exists on the unit record, no document had it')

  const units = await get('hd_units?select=id,unit_number,manufacturer,model,serial_number,year,truck_trailer_number&order=unit_number') as Record<string, unknown>[]
  ok(Array.isArray(units) && units.length > 0, `hd_units rows in production (${units.length}) — guards a vacuous pass`)
  const withNumber = units.filter(u => u.unit_number)
  console.log(`  hd_units carrying a unit_number : ${withNumber.length} of ${units.length}`)
  for (const u of units.slice(0, 8)) {
    console.log(`    ${String(u.unit_number ?? '(none)').padEnd(14)} ${[u.manufacturer, u.model].filter(Boolean).join(' ')}  serial=${u.serial_number ?? '-'}`)
  }
  ok(withNumber.length > 0, `real units have real unit numbers (${withNumber.length}) — so there was something to print all along`)

  // ══ 2. The snapshot helper, against a REAL unit row ═════════════════════════
  hr('2. unitSnapshot against a real hd_units row')
  const u = withNumber[0]
  const snap = unitSnapshot(u)
  console.log('  source unit : ' + JSON.stringify(u))
  console.log('  snapshot    : ' + JSON.stringify(snap))
  ok(snap.unit_number === u.unit_number, 'the unit number is carried onto the document')
  ok(snap.unit_manufacturer === (u.manufacturer ?? null), 'manufacturer carried')
  ok(snap.unit_serial === (u.serial_number ?? null), 'serial_number maps to unit_serial')
  ok(snap.unit_year === (u.year ?? null), `year carried as a number (${snap.unit_year})`)

  // An LD vehicles row has different column names and must work through the same helper.
  //
  // MIGRATION 142 MAY NOT BE APPLIED YET. It is run by hand, so this script has to
  // work both before and after — and which side of it we are on is itself a fact
  // worth printing rather than a crash.
  const vProbe = await get('vehicles?select=id,unit_number,year,make,model,vin&limit=5')
  const migrationApplied = Array.isArray(vProbe)
  console.log(`\n  MIGRATION 142 APPLIED: ${migrationApplied ? 'YES' : 'NO — vehicles.unit_number does not exist yet'}`)
  if (!migrationApplied) console.log(`  (${JSON.stringify(vProbe).slice(0, 150)})`)

  const vehicles = (migrationApplied
    ? vProbe
    : await get('vehicles?select=id,year,make,model,vin&limit=5')) as Record<string, unknown>[]
  ok(Array.isArray(vehicles) && vehicles.length > 0, `LD vehicles rows exist (${vehicles.length})`)
  const v = vehicles[0]
  const vsnap = unitSnapshot(v)
  console.log('  source vehicle : ' + JSON.stringify(v))
  console.log('  snapshot       : ' + JSON.stringify(vsnap))
  ok(vsnap.unit_manufacturer === (v.make ?? null), 'an LD vehicle\'s `make` maps to unit_manufacturer through the same helper')
  ok(vsnap.unit_serial === (v.vin ?? null), 'and its VIN maps to unit_serial')
  if (!migrationApplied) {
    ok(vsnap.unit_number === null,
      'pre-migration, the snapshot reports no unit number rather than inventing one')
  }

  // ══ 3. The unit number leads the block, on every real HD invoice ════════════
  hr('3. THE ORDER — unit number first, before year/make/model')
  const invCols = migrationApplied
    ? 'invoice_number,unit_number,unit_manufacturer,unit_model,unit_serial,unit_year,truck_make,truck_model,truck_year,vin'
    : 'invoice_number,unit_manufacturer,unit_model,unit_serial,unit_year,truck_make,truck_model,truck_year,vin'
  const invs = await get(`hd_invoices?select=${invCols}&order=created_at.desc`) as Record<string, unknown>[]
  ok(invs.length > 0, `HD invoices to render (${invs.length}) — guards a vacuous pass`)

  let numbered = 0
  for (const inv of invs) {
    const lines = serviceUnitLines(inv)
    if (inv.unit_number) numbered++
    console.log(`  ${String(inv.invoice_number).padEnd(15)} ${lines.map(l => (l.label ? `${l.label}: ${l.value}` : l.value)).join('  |  ') || '(block hidden)'}`)
    if (inv.unit_number) {
      ok(lines[0]?.label === 'Unit' && lines[0]?.value === inv.unit_number,
        `${inv.invoice_number}: the unit number is the FIRST line in the block`)
      const serialIdx = lines.findIndex(l => l.label === 'Serial')
      ok(serialIdx === -1 || serialIdx > 0,
        `${inv.invoice_number}: the serial comes after it — the serial is for warranty, the unit number is the identifier`)
    }
  }
  console.log(`\n  HD invoices with a stored unit_number: ${numbered} of ${invs.length}`)
  ok(numbered === 0,
    'no EXISTING invoice has one — which is the defect being fixed, and confirms nothing was backfilled')

  // ══ 4. Synthetic order check, since no stored row has one yet ═══════════════
  hr('4. The ordering rule itself')
  const withNo = serviceUnitLines({
    unit_number: '1R', unit_manufacturer: 'Thermo King', unit_model: 'C-600',
    unit_serial: '6001221332', unit_year: 2016, vin: '1FUJGLDR8CSBH1234',
  })
  console.log('  with a unit number : ' + withNo.map(l => (l.label ? `${l.label}: ${l.value}` : l.value)).join('  |  '))
  ok(withNo[0].label === 'Unit' && withNo[0].value === '1R', 'unit number first')
  ok(withNo[1].label === null && withNo[1].value === 'Thermo King C-600', 'then make and model as the headline')
  ok(withNo.findIndex(l => l.label === 'Serial') > 1, 'then the serial')

  const withoutNo = serviceUnitLines({
    unit_manufacturer: 'Thermo King', unit_model: 'C-600', unit_serial: '6001221332',
  })
  console.log('  without one        : ' + withoutNo.map(l => (l.label ? `${l.label}: ${l.value}` : l.value)).join('  |  '))
  ok(withoutNo[0].label === null && withoutNo[0].value === 'Thermo King C-600',
    'with no unit number the make/model leads, and no empty "Unit:" label is printed')
  ok(!withoutNo.some(l => l.label === 'Unit'), 'and specifically no Unit row at all — a blank identifier is worse than none')

  // The three conventions named in the brief must all survive verbatim.
  for (const n of ['1', '1R', '2APU']) {
    const lines = serviceUnitLines({ unit_number: n, unit_manufacturer: 'Carrier' })
    ok(lines[0].value === n, `"${n}" prints exactly as typed — the convention is the customer's, not ours`)
  }

  // ══ 5. Empty block still hides ═════════════════════════════════════════════
  hr('5. An empty unit block is still hidden (the Phase 3 behaviour must hold)')
  ok(serviceUnitLines({}).length === 0, 'an invoice that knows nothing about its unit renders no block')
  ok(serviceUnitLines({ unit_number: '' }).length === 0, 'an empty-string unit number is not a unit number')
  ok(serviceUnitLines({ unit_number: '   ' }).length === 0, 'nor is whitespace')
  ok(serviceUnitLines({ unit_number: '1R' }).length === 1, 'a unit number ALONE is enough to render the block')

  // ══ 6. Inspection reports ══════════════════════════════════════════════════
  hr('6. Inspection reports — these already led with Unit Number')
  const dotCols = migrationApplied
    ? 'inspection_id,unit_id,unit_number,unit_manufacturer,unit_serial'
    : 'inspection_id,unit_id,unit_manufacturer,unit_serial'
  const dot = await get(`hd_dot_inspections?select=${dotCols}`) as Record<string, unknown>[]
  const aerial = await get(`hd_aerial_inspections?select=inspection_id,unit_id,unit_serial`) as Record<string, unknown>[]
  ok(Array.isArray(dot) && Array.isArray(aerial), 'the inspection tables are readable')
  console.log(`  hd_dot_inspections    : ${dot.length} rows, ${dot.filter(r => r.unit_id).length} linked to a unit`)
  console.log(`  hd_aerial_inspections : ${aerial.length} rows, ${aerial.filter(r => r.unit_id).length} linked to a unit`)
  console.log('\n  The DOT and aerial PDFs resolve Unit Number from the LIVE unit record first,')
  console.log('  then the stored snapshot, then the legacy unit_identifier. So a report whose')
  console.log('  unit still exists already printed the right number — only the money')
  console.log('  documents were missing it.')
  const dotLinked = dot.filter(r => r.unit_id)
  if (dotLinked.length > 0) {
    const unitById = new Map(units.map(x => [x.id as string, x]))
    for (const r of dotLinked) {
      const live = unitById.get(r.unit_id as string)
      console.log(`    ${r.inspection_id}  unit_id -> ${live ? `unit_number=${live.unit_number}` : 'UNIT DELETED'}`)
      ok(live !== undefined || r.unit_number != null,
        `${r.inspection_id}: either the unit still exists or the snapshot holds the number — a report never ends up naming no unit`)
    }
  }

  hr(`${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
