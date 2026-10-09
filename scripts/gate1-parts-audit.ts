// GATE 1: what the parts reference actually contains today, measured against the LIVE
// database rather than the seed file, because the seed and the table can disagree.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

async function all(table: string, select: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${S}/rest/v1/${table}?select=${select}`, {
      headers: { ...H, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
    })
    if (!res.ok) {
      console.log(`  ${table}: ${res.status} ${(await res.text()).slice(0, 140)}`)
      return out
    }
    const page = await res.json() as Record<string, unknown>[]
    out.push(...page)
    if (page.length < 1000) return out
  }
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')

// A catch-all is fitment that names no actual model.
//
// CORRECTED: the first version of this used whitespace word boundaries, so "ALL-TK" and
// "ALL-Carrier" did not match - the hyphen is not whitespace - and the count came out at
// 8 when the real figure is an order of magnitude higher. Those two values are exactly
// the ones the shipped matcher treats as universal, so missing them missed the defect.
// Separators are now normalized before the test.
const UNIVERSAL_EXACT = new Set(['ALL', 'ALLTK', 'ALLCARRIER', 'THERMOKING', 'CARRIER', 'CARRIERTRANSICOLD', 'TK', 'GENERIC'])

function isCatchAll(value: string | null | undefined): boolean {
  if (!value) return false
  const squashed = value.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (UNIVERSAL_EXACT.has(squashed)) return true
  return /(^|[^a-z0-9])(all|any|every|universal|various|series|family)([^a-z0-9]|$)/i.test(value)
}
const CATCHALL = { test: (v: string) => isCatchAll(v) }

// A group or range crammed into one field: a slash list, a comma list, an open-ended
// plus, a numeric range, or the word "series"/"family".
function groupShape(v: string): string | null {
  if (v.includes('/')) return 'slash list'
  if (v.includes(',')) return 'comma list'
  if (/\+\s*$/.test(v)) return 'open-ended +'
  if (/[0-9]{2,}\s*-\s*[0-9]{2,}/.test(v)) return 'numeric range'
  if (/(^|\s)(series|family)(\s|$)/i.test(v)) return 'series word'
  if (/(^|\s)(and|or|thru|through)(\s|$)/i.test(v)) return 'prose list'
  return null
}

async function main() {
  console.log(`\nGATE 1  PARTS AUDIT  ${S}`)
  console.log('='.repeat(94))

  const parts = await all('hd_parts', 'part_number,manufacturer,description,category,unit_models,superseded_by')
  const xref  = await all('hd_parts_cross_ref', 'part_number,cross_mfr,cross_part')
  const ref   = await all(
    'hd_parts_reference',
    'manufacturer,unit_family,part_category,part_function,oem_part_number,baldwin,napa_gold,luber_finer,donaldson,fleetguard,wix,dayco,continental,gates,verified',
  )

  console.log('\n(a) HOW MANY PARTS EXIST, AND HOW MUCH OF THE FITMENT IS A CATCH-ALL')
  console.log(`    hd_parts rows ................ ${parts.length}`)
  console.log(`    hd_parts_cross_ref rows ...... ${xref.length}`)
  console.log(`    hd_parts_reference rows ...... ${ref.length}`)

  let noFitment = 0
  let catchAll = 0
  const flagged: string[] = []
  for (const p of parts) {
    const models = (p.unit_models as string[] | null) ?? []
    if (models.length === 0) {
      noFitment++
      flagged.push(`${String(p.part_number).padEnd(16)} EMPTY unit_models`)
      continue
    }
    const hits = models.filter(m => CATCHALL.test(String(m)))
    if (hits.length) {
      catchAll++
      flagged.push(`${String(p.part_number).padEnd(16)} ${JSON.stringify(hits)}`)
    }
  }
  console.log(`\n    hd_parts with NO fitment at all ............. ${noFitment}`)
  console.log(`    hd_parts with a catch-all model string ...... ${catchAll}`)

  const refNoFamily = ref.filter(r => !r.unit_family).length
  const refCatchAll = ref.filter(r => r.unit_family && CATCHALL.test(String(r.unit_family)))
  console.log(`    hd_parts_reference with NO unit_family ...... ${refNoFamily}`)
  console.log(`    hd_parts_reference family is a catch-all .... ${refCatchAll.length}`)

  const guessing = noFitment + catchAll + refNoFamily + refCatchAll.length
  const total = parts.length + ref.length
  console.log(`\n    CANNOT ANSWER "does this fit THIS unit": ${guessing} of ${total} rows (${(100 * guessing / Math.max(1, total)).toFixed(0)}%)`)

  if (flagged.length) {
    console.log('\n    catch-all or empty fitment in hd_parts:')
    flagged.slice(0, 40).forEach(r => console.log(`      ${r}`))
    if (flagged.length > 40) console.log(`      ...and ${flagged.length - 40} more`)
  }
  if (refCatchAll.length) {
    console.log('\n    catch-all families in hd_parts_reference:')
    refCatchAll.slice(0, 24).forEach(r =>
      console.log(`      ${String(r.manufacturer).padEnd(20)} ${String(r.unit_family).padEnd(26)} ${r.part_function}`))
  }

  console.log('\n(b) GROUPS AND RANGES STORED AS ONE STRING')
  const groups: Array<{ where: string; value: string; shape: string }> = []
  for (const p of parts) {
    for (const m of ((p.unit_models as string[] | null) ?? [])) {
      const shape = groupShape(String(m))
      if (shape) groups.push({ where: `hd_parts ${p.part_number}`, value: String(m), shape })
    }
  }
  for (const r of ref) {
    const shape = r.unit_family ? groupShape(String(r.unit_family)) : null
    if (shape) groups.push({ where: `hd_parts_reference ${r.manufacturer}`, value: String(r.unit_family), shape })
  }
  console.log(`    fields holding a group or range ............. ${groups.length}`)
  const byShape = new Map<string, number>()
  groups.forEach(g => byShape.set(g.shape, (byShape.get(g.shape) ?? 0) + 1))
  for (const [shape, n] of [...byShape].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${shape.padEnd(16)} ${n}`)
  }
  if (groups.length) {
    console.log('\n    each one, because each is a search that cannot work:')
    groups.slice(0, 60).forEach(g => console.log(`      ${g.where.padEnd(44)} "${g.value}"`))
    if (groups.length > 60) console.log(`      ...and ${groups.length - 60} more`)
  }

  console.log('\n(c) DEDUPE CANDIDATES - THREE BUCKETS, NOTHING MERGED')

  const byNorm = new Map<string, string[]>()
  for (const p of parts) {
    const n = norm(String(p.part_number))
    byNorm.set(n, [...(byNorm.get(n) ?? []), String(p.part_number)])
  }
  const dupNorm = [...byNorm].filter(([, v]) => v.length > 1)
  console.log(`\n    1. SAME NORMALIZED NUMBER TWICE ............. ${dupNorm.length}`)
  dupNorm.forEach(([n, v]) => console.log(`       ${n}  <-  ${v.join(' , ')}`))
  if (!dupNorm.length) {
    console.log('       none. part_number is UNIQUE in hd_parts, but UNIQUE is on the PRINTED')
    console.log('       number, so 78-1341 and 781341 could both be stored - they are not, today.')
  }

  const partNumbersNorm = new Set(parts.map(p => norm(String(p.part_number))))
  const crossAlsoAPart = xref.filter(x => partNumbersNorm.has(norm(String(x.cross_part))))
  console.log(`\n    2. OEM + AFTERMARKET FOR THE SAME PART ...... ${crossAlsoAPart.length}  (LINK, never delete)`)
  crossAlsoAPart.slice(0, 30).forEach(x =>
    console.log(`       ${String(x.part_number).padEnd(16)} and ${String(x.cross_mfr)} ${String(x.cross_part)} are both rows in hd_parts`))
  if (!crossAlsoAPart.length) {
    console.log('       none: no cross_part is itself a row in hd_parts')
  }

  const refByOem = new Map<string, Set<string>>()
  for (const r of ref) {
    if (!r.oem_part_number) continue
    const n = norm(String(r.oem_part_number))
    refByOem.set(n, (refByOem.get(n) ?? new Set<string>()).add(`${r.manufacturer}/${r.unit_family ?? '-'}/${r.part_function}`))
  }
  const refOemTwice = [...refByOem].filter(([, v]) => v.size > 1)
  console.log(`\n       same OEM number under more than one function in hd_parts_reference: ${refOemTwice.length}`)
  refOemTwice.slice(0, 20).forEach(([n, v]) => console.log(`       ${n}  ->  ${[...v].join('  |  ')}`))

  const sig = new Map<string, string[]>()
  for (const p of parts) {
    const k = `${p.manufacturer}|${p.category}|${String(p.description).toLowerCase().trim()}`
    sig.set(k, [...(sig.get(k) ?? []), String(p.part_number)])
  }
  const unclear = [...sig].filter(([, v]) => v.length > 1)
  console.log(`\n    3. GENUINELY UNCLEAR ........................ ${unclear.length}`)
  unclear.slice(0, 30).forEach(([k, v]) => {
    const bits = k.split('|')
    console.log(`       ${v.join(' , ').padEnd(42)} all "${bits[2]}" (${bits[0]})`)
  })

  console.log('\n(d) WHERE PARTS LIVE TODAY')
  console.log('    hd_parts            part_number (UNIQUE), manufacturer (CHECK: 4 values), description,')
  console.log('                        category, unit_models TEXT[], notes, superseded_by, field_critical')
  console.log('    hd_parts_cross_ref  part_number -> hd_parts.part_number, cross_mfr, cross_part, cross_notes')
  console.log('    hd_parts_reference  manufacturer, unit_family, part_category, part_function, oem_part_number,')
  console.log('                        then ONE COLUMN PER BRAND: baldwin napa_gold luber_finer donaldson')
  console.log('                        fleetguard wix dayco continental gates, notes, verified')
  console.log('    parts_deliveries    unrelated - the Roadie delivery flow, parts_requested JSONB')

  const refVerified = ref.filter(r => r.verified !== false).length
  console.log(`\n    hd_parts_reference rows reading as verified .. ${refVerified} of ${ref.length}`)
  console.log('    (the column DEFAULTS to true, so "verified" there means "nobody said otherwise")')

  const cats = new Map<string, number>()
  parts.forEach(p => cats.set(String(p.category), (cats.get(String(p.category)) ?? 0) + 1))
  console.log('\n    hd_parts by category:')
  for (const [c, n] of [...cats].sort((a, b) => b[1] - a[1])) console.log(`      ${c.padEnd(24)} ${n}`)

  const mfrs = new Map<string, number>()
  parts.forEach(p => mfrs.set(String(p.manufacturer), (mfrs.get(String(p.manufacturer)) ?? 0) + 1))
  console.log('\n    hd_parts by manufacturer:')
  for (const [m, n] of [...mfrs].sort((a, b) => b[1] - a[1])) console.log(`      ${m.padEnd(24)} ${n}`)

  const supers = parts.filter(p => p.superseded_by)
  console.log(`\n    hd_parts with superseded_by set .............. ${supers.length}`)
  supers.slice(0, 20).forEach(p => console.log(`      ${String(p.part_number).padEnd(16)} -> ${p.superseded_by}`))

  console.log(`\n${'='.repeat(94)}\n`)
}

main()
