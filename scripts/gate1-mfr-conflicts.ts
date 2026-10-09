// Two questions the search fix depends on:
//
//   1. "Manufacturer constrains absolutely" is only safe if the manufacturer column is
//      right. Where does it contradict the model family on the same row?
//
//   2. How many rows put a COMPRESSOR or an ENGINE in unit_family? Those are not unit
//      models at all, which is why part_fitment has three columns instead of one.
//
// NOTE ON THE FIRST PASS OF THIS SCRIPT: an earlier version matched /x2|x4/ for Carrier
// and flagged 49 rows. They were X426 / X430 / X214 / X418 - THERMO KING COMPRESSORS -
// so the heuristic was wrong, not the data. Carrier's X2 and X4 are standalone tokens;
// TK's compressors are X followed by three digits. Corrected below, and the compressor
// rows are counted on their own because that is the real finding.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

// Carrier UNIT families. X2/X4 only as standalone tokens, never X426-style.
const CARRIER_FAMILIES = /(supra|vector|ultra|ultima|solara|maxima|genesis|xtc|gen x|comfort pro|phoenix)|(^|[^a-z0-9])x[24]([^0-9]|$)/i
// Thermo King UNIT families.
const TK_FAMILIES = /(^|[^a-z0-9])(sb|slx|slxe|spectrum|precedent|super ii|super-2|sentry|magnum|tripac|rd-ii|td-ii|md|kd|bkd|t-6|t-8|t-1[02]|ts-|v-[0-9]|c-600|s-600|s-610|s-700|a500|smx|nwd|shz|xmt|di2)([^a-z0-9]|$)/i

// TK compressor model codes: X214, X418, X426, X430, X640, with optional P / LS / C5.
const COMPRESSOR = /(^|[^a-z0-9])x(214|418|426|430|640)/i
// Carrier compressor families, which are genuinely Carrier.
const CARRIER_COMPRESSOR = /(^|[^a-z0-9])(05g|05k|06d)([^a-z0-9]|$)/i
// Engine codes that show up in unit_family.
const ENGINE = /(^|[^a-z0-9])(tk3[0-9]{2}|v2203|v1505|d1105|d722|ct3-[0-9]+|c201|isuzu|kubota|yanmar|peugeot)([^a-z0-9]|$)/i

async function all(path: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${S}/rest/v1/${path}`, {
      headers: { ...H, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
    })
    if (!res.ok) { console.log(`  ${res.status}`); return out }
    const page = await res.json() as Record<string, unknown>[]
    out.push(...page)
    if (page.length < 1000) return out
  }
}

async function main() {
  console.log('\nMANUFACTURER AND MODEL-KIND PROBLEMS IN THE LIVE FITMENT')
  console.log('='.repeat(100))

  const ref = await all('hd_parts_reference?select=manufacturer,unit_family,part_category,part_function,oem_part_number')

  console.log('\n(1) MANUFACTURER CONTRADICTS THE FAMILY ON THE SAME ROW')
  const tkNamingCarrier = ref.filter(r =>
    r.manufacturer === 'TK' && r.unit_family &&
    CARRIER_FAMILIES.test(String(r.unit_family)) &&
    !COMPRESSOR.test(String(r.unit_family)))
  const carrierNamingTk = ref.filter(r =>
    r.manufacturer === 'Carrier' && r.unit_family &&
    TK_FAMILIES.test(String(r.unit_family)) &&
    !CARRIER_FAMILIES.test(String(r.unit_family)))

  console.log(`    manufacturer TK but the family is a Carrier UNIT ...... ${tkNamingCarrier.length}`)
  tkNamingCarrier.forEach(r =>
    console.log(`      ${String(r.oem_part_number ?? '-').padEnd(16)} ${String(r.part_function).slice(0, 38).padEnd(38)} [${r.unit_family}]`))

  console.log(`\n    manufacturer Carrier but the family is a TK UNIT ...... ${carrierNamingTk.length}`)
  carrierNamingTk.slice(0, 20).forEach(r =>
    console.log(`      ${String(r.oem_part_number ?? '-').padEnd(16)} ${String(r.part_function).slice(0, 38).padEnd(38)} [${r.unit_family}]`))
  if (carrierNamingTk.length > 20) console.log(`      ...and ${carrierNamingTk.length - 20} more`)

  console.log('\n(2) NOT A UNIT MODEL AT ALL - stored in unit_family anyway')
  const comp = ref.filter(r => r.unit_family && (COMPRESSOR.test(String(r.unit_family)) || CARRIER_COMPRESSOR.test(String(r.unit_family))))
  const eng  = ref.filter(r => r.unit_family && ENGINE.test(String(r.unit_family)))
  console.log(`    rows whose "family" is a COMPRESSOR model ............. ${comp.length}`)
  console.log(`    rows whose "family" is an ENGINE model ............... ${eng.length}`)
  console.log('\n    a sample of the compressor rows:')
  comp.slice(0, 12).forEach(r =>
    console.log(`      ${String(r.manufacturer).padEnd(8)} ${String(r.oem_part_number ?? '-').padEnd(16)} ${String(r.part_function).slice(0, 34).padEnd(34)} [${r.unit_family}]`))
  console.log('\n    a sample of the engine rows:')
  eng.slice(0, 12).forEach(r =>
    console.log(`      ${String(r.manufacturer).padEnd(8)} ${String(r.oem_part_number ?? '-').padEnd(16)} ${String(r.part_function).slice(0, 34).padEnd(34)} [${r.unit_family}]`))

  const mfrs = new Map<string, number>()
  ref.forEach(r => mfrs.set(String(r.manufacturer), (mfrs.get(String(r.manufacturer)) ?? 0) + 1))
  console.log('\n(3) THE MANUFACTURER COLUMN ITSELF')
  for (const [m, n] of [...mfrs].sort((a, b) => b[1] - a[1])) console.log(`    ${m.padEnd(12)} ${n}`)
  console.log('\n    "Both" is a third value, so the constraint is not a simple equality:')
  console.log('    a Carrier unit search must include Both rows and exclude TK-only rows.')

  console.log(`\n${'='.repeat(100)}\n`)
}

main()
