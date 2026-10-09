// Can the three correct Supra 660 answers be SOURCED from what we already hold?
//
// This decides whether the missing carrier-fitment.csv is actually needed or whether the
// existing verified seed already carries the fitment. Nothing is invented either way -
// this only looks.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

async function q(path: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${S}/rest/v1/${path}`, { headers: H })
  if (!res.ok) { console.log(`  ${res.status} ${(await res.text()).slice(0, 120)}`); return [] }
  return await res.json() as Record<string, unknown>[]
}

async function main() {
  console.log('\nCAN THE SUPRA 660 ANSWERS BE SOURCED FROM WHAT WE HOLD?')
  console.log('='.repeat(100))

  console.log('\n  every Carrier FUEL filter row in hd_parts_reference:')
  const fuel = await q("hd_parts_reference?manufacturer=eq.Carrier&part_function=ilike.*fuel*&select=unit_family,part_function,oem_part_number,notes")
  fuel.forEach(r => console.log(`    ${String(r.oem_part_number ?? '-').padEnd(16)} ${String(r.part_function).padEnd(30)} [${r.unit_family}]`))

  console.log('\n  every Carrier AIR filter row in hd_parts_reference:')
  const air = await q("hd_parts_reference?manufacturer=eq.Carrier&part_function=ilike.*air*&select=unit_family,part_function,oem_part_number,notes")
  air.forEach(r => console.log(`    ${String(r.oem_part_number ?? '-').padEnd(16)} ${String(r.part_function).padEnd(30)} [${r.unit_family}]`))

  console.log('\n  every Carrier OIL filter row in hd_parts_reference:')
  const oil = await q("hd_parts_reference?manufacturer=eq.Carrier&part_function=ilike.*oil*&select=unit_family,part_function,oem_part_number,notes")
  oil.forEach(r => console.log(`    ${String(r.oem_part_number ?? '-').padEnd(16)} ${String(r.part_function).padEnd(30)} [${r.unit_family}]`))

  console.log('\n  any row anywhere mentioning Supra 660 in hd_parts_reference:')
  const s660 = await q("hd_parts_reference?unit_family=ilike.*660*&select=manufacturer,unit_family,part_category,part_function,oem_part_number")
  s660.forEach(r => console.log(`    ${String(r.manufacturer).padEnd(9)} ${String(r.oem_part_number ?? '-').padEnd(16)} ${String(r.part_category).padEnd(12)} ${String(r.part_function).slice(0, 34).padEnd(34)} [${r.unit_family}]`))

  console.log('\n  hd_parts rows for the three target numbers, and their fitment:')
  for (const n of ['30-01090-05', '30-60143-01', '30-60049-20', '30-01121-00']) {
    const rows = await q(`hd_parts?part_number=eq.${encodeURIComponent(n)}&select=part_number,manufacturer,description,category,unit_models,superseded_by,notes`)
    if (!rows.length) { console.log(`    ${n.padEnd(14)} NOT in hd_parts`); continue }
    rows.forEach(r => console.log(`    ${String(r.part_number).padEnd(14)} ${r.description} | models ${JSON.stringify(r.unit_models)} | superseded_by ${r.superseded_by ?? '-'} | ${r.notes ?? ''}`))
  }

  console.log('\n  any supersession evidence for 30-01121-00 anywhere:')
  const bySup = await q("hd_parts?superseded_by=eq.30-60143-01&select=part_number,superseded_by")
  console.log(`    hd_parts rows whose superseded_by is 30-60143-01: ${bySup.length}`)
  const notes = await q("hd_parts_reference?notes=ilike.*0112100*&select=unit_family,part_function,notes")
  const notes2 = await q("hd_parts_reference?notes=ilike.*01121*&select=unit_family,part_function,notes")
  console.log(`    hd_parts_reference notes mentioning 01121: ${notes.length + notes2.length}`)
  notes2.forEach(r => console.log(`      [${r.unit_family}] ${r.part_function}: ${r.notes}`))

  console.log(`\n${'='.repeat(100)}\n`)
}

main()
