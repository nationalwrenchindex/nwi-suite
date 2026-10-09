// Are the acceptance answers actually IN the loaded data? Asked of the database
// directly, before any search code exists, so a later green test cannot be the search
// agreeing with itself.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

async function q(path: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${S}/rest/v1/${path}`, { headers: H })
  if (!res.ok) { console.log(`  ${res.status} ${(await res.text()).slice(0, 140)}`); return [] }
  return await res.json() as Record<string, unknown>[]
}

async function main() {
  console.log('\nIS THE ANSWER IN THE DATA?')
  console.log('='.repeat(100))

  console.log('\n  totals')
  for (const t of ['parts', 'part_fitment', 'part_supersession', 'part_cross_reference']) {
    const res = await fetch(`${S}/rest/v1/${t}?select=id`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } })
    console.log(`    ${t.padEnd(22)} ${res.headers.get('content-range')?.split('/')[1] ?? '?'}`)
  }

  console.log('\n  SUPRA 660, filters, Carrier only, no catch-alls (the acceptance case)')
  const s660 = await q(
    'part_fitment?unit_model=eq.Supra%20660&select=unit_model,serial_from,serial_before,note,verified,source,' +
    'parts!inner(part_number,manufacturer,part_type,description,verified)',
  )
  const filters = s660.filter(f => {
    const p = f.parts as Record<string, unknown>
    return String(p.part_type).toLowerCase().includes('filter')
  })
  console.log(`    fitment rows for Supra 660 ......... ${s660.length}`)
  console.log(`    of which filters ................... ${filters.length}`)
  for (const f of filters) {
    const p = f.parts as Record<string, unknown>
    console.log(`      ${String(p.part_number).padEnd(14)} ${String(p.part_type).padEnd(24)} ${String(p.manufacturer).padEnd(20)} verified=${f.verified}  ${f.note ?? ''}`)
  }
  const mfrs = new Set(filters.map(f => String((f.parts as Record<string, unknown>).manufacturer)))
  console.log(`    manufacturers present ............. ${[...mfrs].join(', ')}`)
  console.log(`    any Thermo King? .................. ${[...mfrs].some(m => /thermo/i.test(m)) ? 'YES - WRONG' : 'no'}`)

  console.log('\n  SUPERSESSION: searching 30-01121-00 must surface 30-60143-01')
  const sup = await q('part_supersession?old_number_normalized=eq.300112100&select=old_number,new_number,manufacturer,note,verified,source')
  sup.forEach(s => console.log(`    ${s.old_number} -> ${s.new_number}  (${s.manufacturer}) verified=${s.verified}  "${s.note}"`))
  const newPart = await q('parts?part_number_normalized=eq.306014301&select=part_number,manufacturer,part_type')
  console.log(`    is the replacement cataloged? ...... ${newPart.length ? `yes - ${newPart[0].part_number} (${newPart[0].manufacturer})` : 'NO'}`)

  console.log('\n  NORMALIZATION: 78-1341 and 781341 are one part')
  const n1 = await q('parts?part_number_normalized=eq.781341&select=part_number,manufacturer,part_number_normalized')
  n1.forEach(p => console.log(`    printed "${p.part_number}"  normalized "${p.part_number_normalized}"  (${p.manufacturer})`))
  console.log(`    rows with that normalized number ... ${n1.length}  (1 means the two spellings are one part)`)

  console.log('\n  SERIAL SPLITS: fitment that differs by serial on the same model')
  const splits = await q('part_fitment?or=(serial_from.not.is.null,serial_before.not.is.null)&select=unit_model,serial_from,serial_before,parts!inner(part_number,part_type)&order=unit_model')
  console.log(`    rows carrying a serial break ....... ${splits.length}`)
  splits.slice(0, 16).forEach(f => {
    const p = f.parts as Record<string, unknown>
    const side = f.serial_from ? `from ${f.serial_from}` : `before ${f.serial_before}`
    console.log(`      ${String(f.unit_model).padEnd(14)} ${String(p.part_number).padEnd(14)} ${String(p.part_type).padEnd(22)} ${side}`)
  })

  console.log('\n  FITMENT BY ENGINE, not by unit')
  const byEngine = await q('part_fitment?engine_model=not.is.null&select=engine_model,note,parts!inner(part_number,description)')
  byEngine.forEach(f => {
    const p = f.parts as Record<string, unknown>
    console.log(`    ${String(f.engine_model).padEnd(12)} ${String(p.part_number).padEnd(14)} ${p.description}`)
  })

  console.log('\n  CATCH-ALLS IN THE NEW TABLES (must be zero - the constraint forbids them)')
  // The first version of this check used a PostgREST `or=` with an encoded comma and
  // returned PGRST100. The error path returned [] and it printed "0" - a green that
  // measured nothing. Every model is pulled and tested here instead, so the zero is
  // real.
  const everyModel = await q('part_fitment?select=unit_model,engine_model,compressor_model')
  const groupShaped = everyModel.filter(f =>
    [f.unit_model, f.engine_model, f.compressor_model]
      .filter(Boolean)
      .map(String)
      .some(v => v.includes(',') || v.includes('/') || v.includes('+') ||
                 /(^|[^a-z])(series|family|all|various)([^a-z]|$)/i.test(v) ||
                 /[0-9]x{2,}/i.test(v)))
  console.log(`    model fields checked ............... ${everyModel.length}`)
  console.log(`    group-shaped model fields .......... ${groupShaped.length}`)
  groupShaped.slice(0, 10).forEach(f => console.log(`      ${JSON.stringify(f)}`))

  console.log('\n  TM1000 - the honest ambiguity: two generations, no serial break')
  const tm = await q('part_fitment?unit_model=eq.TM1000&select=unit_model,note,parts!inner(part_number,part_type)')
  tm.forEach(f => {
    const p = f.parts as Record<string, unknown>
    console.log(`    ${String(p.part_number).padEnd(14)} ${String(p.part_type).padEnd(24)} ${f.note ?? ''}`)
  })

  console.log(`\n${'='.repeat(100)}\n`)
}

main()
