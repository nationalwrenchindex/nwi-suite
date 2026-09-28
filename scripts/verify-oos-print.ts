// Verifies the printed two-section split against the REAL aerial inspection stored in
// production, read-only.  npx tsx scripts/verify-oos-print.ts
import fs from 'fs'
import { splitFailures, deriveRemovedFromService, defaultOosFor } from '../src/lib/inspections/out-of-service'
import { AERIAL_FORMS } from '../src/lib/hd/aerial/forms'
import type { AerialInspectionType } from '../src/types/aerial'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) pass++; else fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}`) }

async function main() {
  const rows = await (await fetch(
    `${URL}/rest/v1/hd_aerial_inspections?select=id,inspection_id,inspection_type,inspection_data,deficiencies,overall_result,removed_from_service`,
    { headers: H },
  )).json()

  console.log('='.repeat(78))
  console.log(`Aerial inspections in production: ${rows.length}`)
  console.log('='.repeat(78))

  for (const r of rows) {
    const type = (r.inspection_type ?? 'pre_use') as AerialInspectionType
    const form = AERIAL_FORMS[type] ?? AERIAL_FORMS.pre_use
    const sections = (r.inspection_data?.sections ?? {}) as Record<string, { items?: Record<string, unknown> }>

    const failures = splitFailures(
      form.sections,
      (si, item) => sections[form.sections[si].id]?.items?.[item.id] as never,
    )
    const derived = deriveRemovedFromService(failures)

    console.log(`\n  ${r.inspection_id ?? r.id.slice(0, 8)}  type=${type}  overall_result=${r.overall_result}  stored removed_from_service=${r.removed_from_service}`)
    console.log(`  ${'-'.repeat(74)}`)
    if (failures.outOfService.length) {
      console.log('  OUT OF SERVICE — DO NOT OPERATE')
      for (const f of failures.outOfService) {
        console.log(`    ${f.label}`)
        console.log(`      section: ${f.sectionLabel}`)
        if (f.notes)   console.log(`      Tech note: ${f.notes}`)
        if (f.oosNote) console.log(`      Reason: ${f.oosNote}`)
      }
    }
    if (failures.repairs.length) {
      console.log('  REPAIRS NEEDED — UNIT REMAINS IN SERVICE')
      for (const f of failures.repairs) {
        console.log(`    ${f.label}`)
        if (f.notes)   console.log(`      Tech note: ${f.notes}`)
        if (f.oosNote) console.log(`      Reason: ${f.oosNote}`)
        if (f.overridden) console.log('      (kept in service — this checkpoint normally goes OOS)')
      }
    }
    if (!failures.outOfService.length && !failures.repairs.length) {
      const defs = Array.isArray(r.deficiencies) ? r.deficiencies.length : 0
      console.log(defs
        ? `  LEGACY: ${defs} deficienc${defs === 1 ? 'y' : 'ies'} recorded before the split — printed as-is, no section assigned`
        : '  IN SERVICE (clean)')
      ok(derived === null, 'a pre-141 record derives NULL, not a fabricated false')
    }

    // Mirrors the PDF exactly, including the grey 'no determination on file' banner.
    const header = (r.removed_from_service === true || derived === true)
      ? 'MACHINE REMOVED FROM SERVICE'
      : failures.unassessed.length
        ? `${failures.unassessed.length} defect(s) recorded — no out-of-service determination on file`
        : failures.repairs.length ? `IN SERVICE — ${failures.repairs.length} repair(s) needed` : 'IN SERVICE'
    console.log(`  header: ${header}`)
    ok(!(derived === true) || failures.outOfService.length > 0, 'OOS header only when an item says so')
    ok(failures.unassessed.length === 0 || !header.startsWith('IN SERVICE'),
      'a record with unassessed fails never prints a bare IN SERVICE header')
  }

  console.log('\n' + '='.repeat(78))
  console.log('autoOos defaults, sampled from the real form definitions')
  console.log('='.repeat(78))
  const form = AERIAL_FORMS.annual ?? AERIAL_FORMS.pre_use
  let autoCount = 0, total = 0
  for (const s of form.sections) for (const i of s.items) { total++; if (defaultOosFor(i)) autoCount++ }
  console.log(`  aerial annual: ${autoCount} of ${total} checkpoints default to out of service`)
  ok(autoCount > 0 && autoCount < total / 2, 'autoOos is a minority of checkpoints, not a dumping ground')

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1

}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
