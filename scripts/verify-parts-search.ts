// The five acceptance cases, run against the LIVE data using the SHIPPED rules.
//
// It imports src/lib/parts/search.ts rather than restating the logic, so a rule that
// changes breaks this test instead of quietly passing it. The data comes from the real
// database. Nothing here is fabricated and no assertion can pass vacuously - each one
// checks the count AND names the parts, so "0 results" can never read as success.

import { loadEnv } from './lib/smoke-session'
import {
  manufacturerMatches, modelMatches, isCatchAllModel, typeMatches, textMatches,
  serialApplies, serialLabel, normalizePartNumber,
} from '../src/lib/parts/search'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

const rows: Array<{ step: string; ok: boolean; detail: string }> = []
function record(step: string, ok: boolean, detail: string): boolean {
  rows.push({ step, ok, detail })
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${step.padEnd(62)} ${detail}`)
  return ok
}

interface Part {
  id: string; part_number: string; part_number_normalized: string; manufacturer: string
  part_type: string; description: string | null
}
interface Fit {
  part_id: string; unit_model: string | null; engine_model: string | null
  compressor_model: string | null; serial_from: string | null; serial_before: string | null
  verified: boolean; note: string | null
}

async function all(path: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${S}/rest/v1/${path}`, {
      headers: { ...H, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
    })
    if (!res.ok) throw new Error(`${path} -> ${res.status}`)
    const page = await res.json() as Record<string, unknown>[]
    out.push(...page)
    if (page.length < 1000) return out
  }
}

async function main() {
  console.log('\nPARTS SEARCH - THE FIVE ACCEPTANCE CASES')
  console.log('='.repeat(104))

  const parts = await all('parts?select=id,part_number,part_number_normalized,manufacturer,part_type,description') as unknown as Part[]
  const fitment = await all('part_fitment?select=part_id,unit_model,engine_model,compressor_model,serial_from,serial_before,verified,note') as unknown as Fit[]
  const supers = await all('part_supersession?select=old_number,new_number,old_number_normalized,new_number_normalized,manufacturer,note,verified')

  const byPart = new Map<string, Fit[]>()
  for (const f of fitment) byPart.set(f.part_id, [...(byPart.get(f.part_id) ?? []), f])

  // The search, exactly as the route composes it from the rules.
  function search(opts: {
    manufacturer?: string | null; model?: string | null; partType?: string | null
    q?: string | null; serial?: string | null
  }) {
    const out: Array<{ part: Part; fits: Fit[] }> = []
    for (const part of parts) {
      if (!manufacturerMatches(part.manufacturer, opts.manufacturer)) continue
      if (!typeMatches(part.part_type, opts.partType)) continue
      if (!textMatches(part, opts.q)) continue
      if (!opts.model) { out.push({ part, fits: byPart.get(part.id) ?? [] }); continue }
      const fits = (byPart.get(part.id) ?? []).filter(f => modelMatches(f.unit_model, opts.model))
      if (!fits.length) continue
      const kept = fits.filter(f => serialApplies(f, opts.serial) !== false)
      if (!kept.length) continue
      out.push({ part, fits: kept })
    }
    return out
  }

  // ── 1. Supra 660 returns exactly 3 filters and no Thermo King parts ──────
  console.log('\n  1. "Supra 660" returns exactly 3 filters and no Thermo King part\n')
  const s660 = search({ manufacturer: 'Carrier Transicold', model: 'Supra 660', partType: 'filter' })
  const numbers = s660.map(r => r.part.part_number).sort()
  record('exactly 3 filters', s660.length === 3, `${s660.length}: ${numbers.join(', ')}`)
  record('the three expected numbers',
    numbers.join(',') === ['30-01090-05', '30-60049-20', '30-60143-01'].join(','),
    numbers.join(', '))
  const anyTk = s660.some(r => /thermo/i.test(r.part.manufacturer))
  record('no Thermo King part', !anyTk, anyTk ? 'a TK part came back' : 'all Carrier Transicold')
  for (const r of s660) {
    console.log(`        ${r.part.part_number.padEnd(14)} ${r.part.part_type.padEnd(24)} ${r.part.manufacturer}`)
  }

  // The same search WITHOUT a manufacturer must still exclude TK, because the fitment
  // is what names the unit - the manufacturer filter is a second line of defence, not
  // the only one.
  const s660NoMfr = search({ model: 'Supra 660', partType: 'filter' })
  record('still 3 with no manufacturer selected', s660NoMfr.length === 3,
    `${s660NoMfr.length}: ${s660NoMfr.map(r => r.part.part_number).sort().join(', ')}`)

  // ── 2. No model-filtered search ever returns a catch-all row ────────────
  console.log('\n  2. No model-filtered search ever returns a catch-all row\n')
  // Every model in the data, searched, and every returned fitment checked.
  const everyModel = [...new Set(fitment.map(f => f.unit_model).filter(Boolean) as string[])]
  let catchAllLeaks = 0
  let searchesRun = 0
  for (const model of everyModel) {
    const res = search({ model })
    searchesRun++
    for (const r of res) {
      for (const f of r.fits) {
        if (isCatchAllModel(f.unit_model)) catchAllLeaks++
      }
    }
  }
  record('models searched', searchesRun === everyModel.length && searchesRun > 0, `${searchesRun} distinct models`)
  record('catch-all rows returned by ANY model search', catchAllLeaks === 0, `${catchAllLeaks} leaks`)

  // And the rule itself, on the strings that defeated the old one.
  const SHOULD_BE_CATCHALL = ['ALL', 'ALL-TK', 'ALL-Carrier', 'all units', 'SB series', 'T-Series', 'V-SERIES', '']
  const missed = SHOULD_BE_CATCHALL.filter(v => !isCatchAllModel(v))
  record('every known catch-all string is recognised', missed.length === 0,
    missed.length ? `missed: ${missed.join(' | ')}` : `${SHOULD_BE_CATCHALL.length} strings, including ALL-TK and ALL-Carrier`)
  const SHOULD_NOT = ['Supra 660', 'S-600M', 'X430', 'TM1000', '2100A']
  const wrong = SHOULD_NOT.filter(v => isCatchAllModel(v))
  record('real models are NOT treated as catch-alls', wrong.length === 0,
    wrong.length ? `wrongly flagged: ${wrong.join(' | ')}` : SHOULD_NOT.join(', '))

  // ── 3. Searching 30-01121-00 surfaces 30-60143-01 as its replacement ────
  console.log('\n  3. Searching 30-01121-00 surfaces 30-60143-01 as its replacement\n')
  const typed = '30-01121-00'
  const hit = supers.find(s => s.old_number_normalized === normalizePartNumber(typed))
  record('the supersession is found', !!hit, hit ? `${hit.old_number} -> ${hit.new_number}` : 'not found')
  if (hit) {
    const replacement = search({ q: String(hit.new_number) })
    const found = replacement.some(r => r.part.part_number_normalized === normalizePartNumber(String(hit.new_number)))
    record('the replacement part is returned', found,
      found ? `${hit.new_number} is in the results` : 'the replacement is not in the catalog')
    record('the supersession is verified and sourced', !!hit.verified,
      `verified=${hit.verified}, note "${String(hit.note).slice(0, 48)}"`)
  }

  // ── 4. 78-1341 and 781341 both find the same part ───────────────────────
  console.log('\n  4. 78-1341 and 781341 both find the same part\n')
  const a = search({ q: '78-1341' })
  const b = search({ q: '781341' })
  const aIds = a.map(r => r.part.id).sort().join(',')
  const bIds = b.map(r => r.part.id).sort().join(',')
  record('both spellings return results', a.length > 0 && b.length > 0, `${a.length} and ${b.length}`)
  record('both return the SAME part', aIds === bIds && a.length > 0,
    a.length ? `${a.map(r => r.part.part_number).join(', ')}` : 'nothing returned')

  // ── 5. A serial split is declared, and filtered when a serial is given ──
  console.log('\n  5. Serial splits are declared, and filtered on when a serial is entered\n')
  // Ultra air filters: 30-01077-01 before GAG90483303, 30-00430-00 from GAG90483303.
  const ultraAll = search({ manufacturer: 'Carrier Transicold', model: 'Ultra', partType: 'Filter - air' })
  record('an Ultra with no serial returns BOTH sides', ultraAll.length === 2,
    `${ultraAll.length}: ${ultraAll.map(r => r.part.part_number).sort().join(', ')}`)
  const labelled = ultraAll.every(r => r.fits.every(f => serialLabel(f) !== null))
  record('each side says which serials it is for', labelled,
    ultraAll.flatMap(r => r.fits.map(f => `${r.part.part_number}: ${serialLabel(f)}`)).join(' | '))

  // A serial BELOW the break must leave only the "before" part.
  const early = search({ manufacturer: 'Carrier Transicold', model: 'Ultra', partType: 'Filter - air', serial: 'GAG90000000' })
  record('an early serial narrows it to one', early.length === 1 && early[0].part.part_number === '30-01077-01',
    `${early.length}: ${early.map(r => r.part.part_number).join(', ')}`)

  // A serial ABOVE the break must leave only the "from" part.
  const late = search({ manufacturer: 'Carrier Transicold', model: 'Ultra', partType: 'Filter - air', serial: 'GAG99999999' })
  record('a later serial narrows it to the other', late.length === 1 && late[0].part.part_number === '30-00430-00',
    `${late.length}: ${late.map(r => r.part.part_number).join(', ')}`)

  // A serial from a DIFFERENT plant prefix cannot be compared, and must not be used to
  // silently drop a row.
  const incomparable = search({ manufacturer: 'Carrier Transicold', model: 'Ultra', partType: 'Filter - air', serial: 'LAA90000000' })
  record('an incomparable serial drops nothing', incomparable.length === 2,
    `${incomparable.length}: kept both rather than guessing`)

  // ── a guard on the guard ────────────────────────────────────────────────
  console.log('\n  GUARDS - these make the assertions above impossible to pass vacuously\n')
  record('the catalog is not empty', parts.length > 50, `${parts.length} parts`)
  record('fitment is not empty', fitment.length > 100, `${fitment.length} rows`)
  record('a supersession exists', supers.length > 0, `${supers.length}`)
  record('a wrong model returns nothing', search({ model: 'Supra 661', partType: 'filter' }).length === 0,
    'Supra 661 does not exist, and returns 0')
  record('a TK search on a Carrier model returns nothing',
    search({ manufacturer: 'Thermo King', model: 'Supra 660' }).length === 0,
    'manufacturer constrains absolutely')

  const failed = rows.filter(r => !r.ok)
  console.log('\n' + '='.repeat(104))
  console.log(`  ${rows.length - failed.length} passed, ${failed.length} failed`)
  if (failed.length) { console.log('\n  BROKEN:'); failed.forEach(f => console.log(`    ${f.step} -- ${f.detail}`)) }
  console.log('='.repeat(104) + '\n')
  process.exitCode = failed.length ? 1 : 0
}

main().catch(e => { console.error(e); process.exitCode = 1 })
