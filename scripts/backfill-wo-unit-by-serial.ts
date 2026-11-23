// Link existing HD work orders to their unit, by serial number. FOR BROCK TO RUN.
//
//   npx tsx scripts/backfill-wo-unit-by-serial.ts            REPORT ONLY - writes nothing
//   npx tsx scripts/backfill-wo-unit-by-serial.ts --apply    links the rows it reported
//
// Preview and production share one database: --apply changes production data.
//
// WHAT IT DOES. For every work order with unit_id NULL that carries a serial (or a VIN,
// which is a truck's serial), it looks for the ONE unit of the SAME account whose
// serial_number matches - trimmed, case-insensitive, nothing else - AND whose model agrees
// with the work order's unit_model (src/lib/hd/unit-match.ts, the rule every linking path
// uses since Nov 23, 2026). A serial alone NEVER links. Exactly one unit passing links.
// A serial whose unit's model disagrees, or several units passing, link nothing and are
// listed, because picking the wrong unit puts one machine's history on another.
//
// WHAT IT NEVER DOES. It never overwrites a unit_id that is already set (the write is
// guarded with unit_id=is.null), never creates or deletes a unit, never touches any
// other column, and never matches across accounts.
//
// EXPECT A SMALL NUMBER. On 2026-10-19 only 7 of 1,542 unlinked work orders carried a
// serial at all, against 43 units. The taylor oil company unit 103 serial is on TWO
// units until the duplicate is merged, so a work order carrying it reports AMBIGUOUS
// and links nothing - run the merge first if that one matters.

import { loadEnv } from './lib/smoke-session'
import { matchUnitBySerialAndModel, normSerial } from '../src/lib/hd/unit-match'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const APPLY = process.argv.includes('--apply')

interface Unit { id: string; user_id: string; serial_number: string | null; unit_number: string | null; model: string | null }
interface WO { id: string; user_id: string; work_order_number: string | null; unit_serial: string | null; unit_model: string | null; vin?: string | null }

/** Every row, paged: PostgREST returns at most 1,000 per request. */
async function all<T>(query: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${S}/rest/v1/${query}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    const page = await res.json()
    if (!Array.isArray(page)) throw new Error(`${query} -> ${JSON.stringify(page).slice(0, 200)}`)
    out.push(...(page as T[]))
    if (page.length < 1000) return out
  }
}

async function main() {
  console.log(APPLY ? '\nAPPLY MODE - linking work orders.\n' : '\nREPORT ONLY - nothing is written. Re-run with --apply to link.\n')

  const units = await all<Unit>('hd_units?select=id,user_id,serial_number,unit_number,model&order=id')
  // vin arrives with migration 159; fall back to serial only if the column is absent.
  let wos: WO[]
  try {
    wos = await all<WO>('hd_work_orders?select=id,user_id,work_order_number,unit_serial,unit_model,vin&unit_id=is.null&order=id')
  } catch {
    wos = await all<WO>('hd_work_orders?select=id,user_id,work_order_number,unit_serial,unit_model&unit_id=is.null&order=id')
  }

  const byUser = new Map<string, Unit[]>()
  for (const u of units) byUser.set(u.user_id, [...(byUser.get(u.user_id) ?? []), u])

  const link: Array<{ wo: WO; unit: Unit; via: string }> = []
  const ambiguous: Array<{ wo: WO; serial: string; count: number }> = []
  const noMatch: Array<{ wo: WO; serial: string }> = []
  // The serial found a unit, but its model disagrees with the work order's (or is blank).
  const refused: Array<{ wo: WO; serial: string }> = []
  let withoutSerial = 0

  for (const wo of wos) {
    const candidates = [['serial', wo.unit_serial], ['vin', wo.vin ?? null]] as const
    const typed = candidates.filter(([, v]) => normSerial(v) !== '')
    if (typed.length === 0) { withoutSerial++; continue }
    const mine = byUser.get(wo.user_id) ?? []
    let done = false
    for (const [via, value] of typed) {
      const found = matchUnitBySerialAndModel(mine, value, wo.unit_model)
      if (found.unit) { link.push({ wo, unit: found.unit, via }); done = true; break }
      if (found.reason === 'ambiguous') {
        ambiguous.push({ wo, serial: String(value), count: mine.filter(u => normSerial(u.serial_number) === normSerial(value)).length })
        done = true; break
      }
      if (found.reason === 'model_mismatch') { refused.push({ wo, serial: String(value) }); done = true; break }
    }
    if (done) continue
    noMatch.push({ wo, serial: String(typed[0][1]) })
  }

  console.log(`work orders with no unit_id:            ${wos.length}`)
  console.log(`  carrying no serial or VIN (skipped):  ${withoutSerial}`)
  console.log(`  WOULD LINK (serial + model, one unit): ${link.length}`)
  console.log(`  ambiguous (several units pass):       ${ambiguous.length}`)
  console.log(`  refused (serial found, model differs): ${refused.length}`)
  console.log(`  no unit with that serial:             ${noMatch.length}`)

  if (link.length) console.log('\nWOULD LINK:')
  for (const l of link) console.log(`  ${String(l.wo.work_order_number).padEnd(14)} -> unit ${l.unit.unit_number ?? '(no number)'} ${l.unit.id}  via ${l.via}`)
  if (ambiguous.length) console.log('\nAMBIGUOUS - left alone:')
  for (const a of ambiguous) console.log(`  ${String(a.wo.work_order_number).padEnd(14)} serial ${a.serial} is on ${a.count} units`)
  if (refused.length) console.log('\nREFUSED - the serial found a unit whose model disagrees - left alone:')
  for (const r of refused) console.log(`  ${String(r.wo.work_order_number).padEnd(14)} serial ${r.serial}, work order model ${r.wo.unit_model ?? '(blank)'}`)
  if (noMatch.length) console.log('\nNO MATCHING UNIT - left alone:')
  for (const n of noMatch) console.log(`  ${String(n.wo.work_order_number).padEnd(14)} serial ${n.serial}`)

  if (!APPLY) { console.log('\nNothing written.'); return }

  let ok = 0
  for (const l of link) {
    // unit_id=is.null in the filter: a row linked since the report is not overwritten.
    const res = await fetch(`${S}/rest/v1/hd_work_orders?id=eq.${l.wo.id}&unit_id=is.null&user_id=eq.${l.wo.user_id}`, {
      method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
      body: JSON.stringify({ unit_id: l.unit.id }),
    })
    const rows = await res.json().catch(() => [])
    if (res.ok && Array.isArray(rows) && rows.length === 1) ok++
    else console.log(`  FAILED ${l.wo.work_order_number}: ${res.status} ${JSON.stringify(rows).slice(0, 160)}`)
  }
  console.log(`\nlinked ${ok} of ${link.length}.`)
}

main().catch(e => { console.error(e); process.exit(1) })
