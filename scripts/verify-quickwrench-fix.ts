// Did the QuickWrench panel fix actually change the number the subscriber complained
// about? Measured, not asserted.
//
// The BEFORE matcher is the one that shipped; the AFTER matcher is the one now in
// quickwrench/page.tsx. Both are run against the live hd_parts_reference so the
// difference is a real count on real data.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

const UNIVERSAL = new Set(['ALL', 'ALL-TK', 'ALL-CARRIER'])
const normalizeModel = (v: string) => v.toLowerCase().replace(/[\s\-._/]+/g, '')
const isUniversal = (f: string | null) => !!f && UNIVERSAL.has(f.trim().toUpperCase())

// What shipped.
function matchedBefore(family: string | null, needle: string): boolean {
  if (!needle) return true
  if (isUniversal(family)) return true          // <- the leak
  if (!family) return false
  const n = normalizeModel(needle)
  return family.split(',').some(e => normalizeModel(e).includes(n))
}

// What is there now.
function matchedAfter(family: string | null, needle: string): boolean {
  if (!needle) return true
  if (isUniversal(family)) return false         // <- closed
  if (!family) return false
  const n = normalizeModel(needle)
  return family.split(',').some(e => normalizeModel(e).includes(n))
}

const CARRIER_MODEL = /^(supra|vector|ultra|ultima|solara|maxima|xtc|genx|phoenix|extra|tm1000|2100a|2500a|7300|7500)/i
const TK_MODEL = /^(sb|slx|spectrum|precedent|super|sentry|magnum|tripac|smx|rd|td|md|kd|bkd|t-?[0-9]|ts-|v-[0-9]|c-600|s-600|s-610|s-700|a500|shz|xmt|nwd)/i
function makeFromModel(m: string): 'TK' | 'Carrier' | null {
  if (CARRIER_MODEL.test(m.trim())) return 'Carrier'
  if (TK_MODEL.test(m.trim())) return 'TK'
  return null
}
function manufacturerAllows(rowMfr: string, wanted: 'TK' | 'Carrier' | null): boolean {
  if (!wanted) return true
  if (rowMfr === 'Both') return true
  return rowMfr === wanted
}

async function main() {
  console.log('\nQUICKWRENCH PANEL - BEFORE AND AFTER, ON LIVE DATA')
  console.log('='.repeat(100))

  const res = await fetch(
    `${S}/rest/v1/hd_parts_reference?select=manufacturer,unit_family,part_category,part_function,oem_part_number`,
    { headers: { ...H, Range: '0-999', 'Range-Unit': 'items' } },
  )
  const rows = await res.json() as Array<Record<string, unknown>>
  console.log(`  hd_parts_reference rows: ${rows.length}\n`)

  function run(model: string, category: string | null, after: boolean) {
    const implied = after ? makeFromModel(model) : null
    return rows.filter(r => {
      if (category && r.part_category !== category) return false
      if (after && !manufacturerAllows(String(r.manufacturer), implied)) return false
      const fn = after ? matchedAfter : matchedBefore
      return fn(r.unit_family as string | null, model)
    })
  }

  for (const [model, category] of [['Supra 660', 'Filter'], ['S-600', 'Filter'], ['Supra 660', null]] as const) {
    const before = run(model, category, false)
    const after  = run(model, category, true)
    const label = `${model}${category ? ` + ${category} chip` : ' (no chip)'}`
    console.log(`  ${label}`)
    console.log(`    before ... ${before.length} rows   (${before.filter(r => isUniversal(r.unit_family as string | null)).length} catch-all, ${before.filter(r => r.manufacturer === 'TK').length} TK)`)
    console.log(`    after .... ${after.length} rows   (${after.filter(r => isUniversal(r.unit_family as string | null)).length} catch-all, ${after.filter(r => r.manufacturer === 'TK').length} TK)`)
    after.forEach(r => console.log(`      ${String(r.manufacturer).padEnd(8)} ${String(r.oem_part_number ?? '-').padEnd(16)} ${String(r.part_function).slice(0, 34).padEnd(34)} [${r.unit_family}]`))
    console.log('')
  }

  // The catch-alls must still be reachable when NO model is typed - they are real
  // parts, and the fix must not have hidden them.
  const browsing = rows.filter(r => r.part_category === 'Filter' && matchedAfter(r.unit_family as string | null, ''))
  const universalWhileBrowsing = browsing.filter(r => isUniversal(r.unit_family as string | null))
  console.log(`  browsing the Filter chip with NO model typed: ${browsing.length} rows, of which ${universalWhileBrowsing.length} are catch-alls`)
  console.log(`  (they must still be here - "fits all TK units" is a real part, just not an answer to "what fits my Supra 660")`)

  console.log(`\n${'='.repeat(100)}\n`)
}

main()
