// GATE 1, the live complaint: what does a Supra 660 actually return today?
//
// Runs the SHIPPED matcher from quickwrench/page.tsx against the LIVE table, rather
// than describing what the code looks like it does. Copied here deliberately, because
// the point is to measure the behaviour that is in production right now.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

const XREF_KEYS = ['baldwin', 'napa_gold', 'luber_finer', 'donaldson', 'fleetguard', 'wix', 'dayco', 'continental', 'gates'] as const
const UNIVERSAL_FAMILIES = new Set(['ALL', 'ALL-TK', 'ALL-CARRIER'])

const normalizeModel = (v: string) => v.toLowerCase().replace(/[\s\-._/]+/g, '')
const isUniversalFamily = (f: string | null) => !!f && UNIVERSAL_FAMILIES.has(f.trim().toUpperCase())

function matchesUnitModel(unitFamily: string | null, needle: string): boolean {
  if (!needle) return true
  if (isUniversalFamily(unitFamily)) return true
  if (!unitFamily) return false
  const n = normalizeModel(needle)
  return unitFamily.split(',').some(entry => normalizeModel(entry).includes(n))
}

function matchesPartQuery(part: Record<string, unknown>, needle: string): boolean {
  if (!needle) return true
  if (String(part.part_function).toLowerCase().includes(needle)) return true
  if (!/[0-9]/.test(needle)) return false
  const asNumber = normalizeModel(needle)
  return [part.oem_part_number, ...XREF_KEYS.map(k => part[k])]
    .some(v => v && normalizeModel(String(v)).includes(asNumber))
}

async function all(table: string, select: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${S}/rest/v1/${table}?select=${select}`, {
      headers: { ...H, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
    })
    if (!res.ok) { console.log(`  ${table}: ${res.status}`); return out }
    const page = await res.json() as Record<string, unknown>[]
    out.push(...page)
    if (page.length < 1000) return out
  }
}

async function main() {
  console.log('\nGATE 1  THE SUPRA 660 COMPLAINT, REPRODUCED AGAINST LIVE DATA')
  console.log('='.repeat(100))

  const ref = await all(
    'hd_parts_reference',
    'manufacturer,unit_family,part_category,part_function,oem_part_number,baldwin,napa_gold,luber_finer,donaldson,fleetguard,wix,dayco,continental,gates,notes',
  )
  const parts = await all('hd_parts', 'part_number,manufacturer,description,category,unit_models')

  // The complaint is about filters on a Supra 660.
  const MODEL = 'Supra 660'
  const hits = ref.filter(r => matchesUnitModel(r.unit_family as string | null, MODEL))
  const filterHits = hits.filter(r => matchesPartQuery(r, 'filter'))

  console.log(`\n  model "${MODEL}" alone .................... ${hits.length} rows`)
  console.log(`  model "${MODEL}" + part text "filter" .... ${filterHits.length} rows   <- the complaint`)

  console.log('\n  WHAT COMES BACK, AND WHY:')
  for (const r of filterHits) {
    const universal = isUniversalFamily(r.unit_family as string | null)
    const why = universal ? 'CATCH-ALL, matched because universal rows always pass' : 'names the model'
    console.log(`    ${String(r.manufacturer).padEnd(9)} ${String(r.oem_part_number ?? '-').padEnd(15)} ${String(r.part_function).slice(0, 38).padEnd(38)} ${why}`)
    console.log(`              family: ${r.unit_family}`)
  }

  const byMfr = new Map<string, number>()
  filterHits.forEach(r => byMfr.set(String(r.manufacturer), (byMfr.get(String(r.manufacturer)) ?? 0) + 1))
  console.log('\n  BY MANUFACTURER (a Carrier unit must never return a TK part):')
  for (const [m, n] of byMfr) console.log(`    ${m.padEnd(10)} ${n}`)
  const universalCount = filterHits.filter(r => isUniversalFamily(r.unit_family as string | null)).length
  console.log(`\n  of those, catch-all rows carried in by the universal rule: ${universalCount}`)

  // The complaint could also be the FILTER CHIP rather than typed text, which is a
  // different code path (part_category === 'Filter'). Measured too, so the reported
  // number is not a guess about which control was used.
  const chipHits = hits.filter(r => r.part_category === 'Filter')
  console.log(`\n  model "${MODEL}" + the Filter CHIP ......... ${chipHits.length} rows`)
  for (const r of chipHits) {
    const universal = isUniversalFamily(r.unit_family as string | null)
    console.log(`    ${String(r.manufacturer).padEnd(9)} ${String(r.oem_part_number ?? '-').padEnd(15)} ${String(r.part_function).slice(0, 34).padEnd(34)} ${universal ? 'CATCH-ALL' : 'names the model'}  [${r.unit_family}]`)
  }
  const chipTk = chipHits.filter(r => r.manufacturer === 'TK').length
  const chipUniversal = chipHits.filter(r => isUniversalFamily(r.unit_family as string | null)).length
  console.log(`    of those: ${chipTk} are Thermo King parts on a Carrier unit, ${chipUniversal} are catch-alls`)

  // Do the three correct answers even exist in the data we hold?
  console.log('\n  THE THREE CORRECT ANSWERS - are they in the database at all?')
  const TARGETS = [
    ['fuel', '30-01090-05'],
    ['oil', '30-60143-01'],
    ['air', '30-60049-20'],
  ] as const
  for (const [kind, number] of TARGETS) {
    const n = normalizeModel(number)
    const inRef = ref.filter(r => [r.oem_part_number, ...XREF_KEYS.map(k => r[k])].some(v => v && normalizeModel(String(v)) === n))
    const inParts = parts.filter(p => normalizeModel(String(p.part_number)) === n)
    console.log(`    ${kind.padEnd(5)} ${number.padEnd(14)} hd_parts_reference: ${inRef.length}   hd_parts: ${inParts.length}`)
    inRef.forEach(r => console.log(`          ref  -> ${r.manufacturer} / ${r.unit_family} / ${r.part_function}`))
    inParts.forEach(p => console.log(`          part -> ${p.manufacturer} / ${p.description} / models ${JSON.stringify(p.unit_models)}`))
  }

  // And the supersession case.
  console.log('\n  THE SUPERSESSION CASE: 30-01121-00 -> 30-60143-01')
  for (const number of ['30-01121-00', '30-60143-01']) {
    const n = normalizeModel(number)
    const inParts = parts.filter(p => normalizeModel(String(p.part_number)) === n)
    const inRef = ref.filter(r => [r.oem_part_number, ...XREF_KEYS.map(k => r[k])].some(v => v && normalizeModel(String(v)) === n))
    console.log(`    ${number.padEnd(14)} hd_parts: ${inParts.length}   hd_parts_reference: ${inRef.length}`)
  }

  // And the normalization case.
  console.log('\n  THE NORMALIZATION CASE: 78-1341 and 781341')
  for (const number of ['78-1341', '781341']) {
    const n = normalizeModel(number)
    const inParts = parts.filter(p => normalizeModel(String(p.part_number)) === n)
    console.log(`    ${number.padEnd(14)} hd_parts rows with that normalized number: ${inParts.length}  ${inParts.map(p => p.part_number).join(', ')}`)
  }

  console.log(`\n${'='.repeat(100)}\n`)
}

main()
