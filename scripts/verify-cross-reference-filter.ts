// npx tsx scripts/verify-cross-reference-filter.ts
//
// The cross-reference rule (src/lib/parts/cross-reference-filter.ts): manufacturer
// numbers kept, reseller / retailer / marketplace names and their SKUs dropped, names
// that cannot be told apart left out and LISTED. Fixed cases first, then every cached
// Parts Manager answer in hd_cached_diagnostics (READ ONLY), printed before -> after.

import { loadEnv } from './lib/smoke-session'
import { filterCrossReferences } from '../src/lib/parts/cross-reference-filter'

loadEnv()
let failures = 0, passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++; else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}

const block = `## SR-3 Control Board

OEM
845-2721

Supersession
Supersedes 45-2361, 845-2739

Aftermarket
FridayParts 845-2721, Total Parts 845-2721

Qty: 1
Est. Cost: $1,500 to $2,500`
const inline = `* **OEM:** 11-9098
* **Supersession Chain:** Supersedes 11-7382
* **Aftermarket:** Fleetguard FS19596 / Baldwin BF7633 / Donaldson P550440 / TES 10-42-100 / FridayParts 42-0100 / NAPA 3368 / eBay 11-9098
* **Est. Cost:** $18 to $30`
const unknown = `Aftermarket: Dorman 904-7111, WIX 33960, Cascadia Wire 3P-CUM-SEN`
const fluid = `Allison requires specific TES 295 or TES 389 fluid`

console.log('\n1. FIXED CASES')
const a = filterCrossReferences(block)
console.log(a.text.split('\n').map(l => '     ' + l).join('\n'))
check('a reseller-only cross block is removed entirely; OEM, supersession, qty and price stay',
  !/FridayParts|Total Parts|Aftermarket/i.test(a.text) && /845-2721/.test(a.text) && /Supersedes 45-2361/.test(a.text) && /Est\. Cost: \$1,500 to \$2,500/.test(a.text))
const b = filterCrossReferences(inline)
console.log(b.text.split('\n').map(l => '     ' + l).join('\n'))
check('manufacturer numbers kept: Fleetguard, Baldwin, Donaldson', ['Fleetguard FS19596', 'Baldwin BF7633', 'Donaldson P550440'].every(k => b.text.includes(k)))
check('TES, FridayParts, NAPA and eBay SKUs dropped', !/TES|FridayParts|NAPA|eBay/i.test(b.text), b.resellers.join(', '))
const c = filterCrossReferences(unknown)
console.log('     ' + c.text)
check('an unknown name is left out and listed', !/Dorman|Cascadia/.test(c.text) && c.unknown.includes('Dorman') && c.unknown.includes('Cascadia Wire') && c.text.includes('WIX 33960'), `unknown: ${c.unknown.join(', ')}`)
check("Allison's TES 295 fluid spec outside a cross-reference is untouched", filterCrossReferences(fluid).text === fluid)

async function main() {
  const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const rows = await (await fetch(`${S}/rest/v1/hd_cached_diagnostics?select=cache_key,result_html&source=eq.parts_manager`,
    { headers: { apikey: K, Authorization: `Bearer ${K}` } })).json() as Array<{ cache_key: string; result_html: string }>
  console.log(`\n2. EVERY CACHED PARTS MANAGER ANSWER (${rows.length}), as served after this change`)
  const allUnknown = new Map<string, string[]>()
  const allResellers = new Set<string>()
  let leaked = 0, lost = 0
  for (const r of rows) {
    const f = filterCrossReferences(r.result_html)
    console.log(`   ${r.cache_key}: kept ${f.kept.length ? f.kept.join(', ') : 'none'}${f.resellers.length ? `; dropped resellers ${f.resellers.join(', ')}` : ''}${f.unknown.length ? `; unknown ${f.unknown.join(', ')}` : ''}`)
    for (const u of f.unknown) allUnknown.set(u, [...(allUnknown.get(u) ?? []), r.cache_key])
    for (const s of f.resellers) allResellers.add(s)
    if (/fridayparts|diselmart|\btes\s+\d|thermo\s*by\s*products|wdpart|total parts|\bnapa\b|carquest|autozone|o'reilly|rockauto|\bebay\b/i.test(f.text)) leaked++
    // Every OEM / supersession line survives.
    // The labelled OEM, supersession and price lines - not the word "OEM" inside advice.
    const oem = (s: string) => s.split('\n').filter(l => /^\W*(OEM|Supersession|Supersedes|Est\.? Cost)\b/i.test(l)).length
    if (oem(f.text) !== oem(r.result_html)) { lost++; console.log(`     OEM/supersession/price lines ${oem(r.result_html)} -> ${oem(f.text)}`) }
  }
  check('no reseller, retailer or marketplace name survives in any cached answer', leaked === 0, `${leaked} with a reseller left`)
  check('every OEM number, supersession and price line survives in every cached answer', lost === 0, `${lost} answers lost one`)
  console.log(`\n   Resellers dropped across the cache: ${[...allResellers].join(', ') || 'none'}`)
  console.log('   NAMES I COULD NOT TELL APART - left out, for you to decide:')
  for (const [u, keys] of allUnknown) console.log(`     ${u}  (${keys.length}x: ${keys.join(', ')})`)
  console.log(`\n${passes} passed, ${failures} failed`)
  if (failures) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
