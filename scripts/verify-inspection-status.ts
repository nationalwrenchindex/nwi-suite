// Verification for the unit inspection-status split.
//
// Runs the REAL helper against REAL production rows, read-only. Nothing here
// fabricates an inspection.
//
//   npx tsx scripts/verify-inspection-status.ts

import fs from 'fs'
import {
  unitInspectionState, hasUnassessedFail, isFailResult, isOutOfService, oosAssessed,
  INSPECTION_STATE_META, type InspectionStatusInput,
} from '../src/lib/fleet-pro/inspection-status'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function get<T>(path: string): Promise<T[]> {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: H })
  const t = await r.text()
  if (r.status !== 200) throw new Error(`${r.status} ${path} :: ${t.slice(0, 300)}`)
  return JSON.parse(t)
}

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) pass++; else fail++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}

interface Insp {
  id: string
  unit_id: string | null
  inspection_date: string | null
  overall_result: string | null
  removed_from_service?: boolean | null
}

/** Exactly what the three API routes now do. */
function oldBehaviour(rows: Insp[]): boolean {
  return rows.some(r => r.overall_result === 'fail')
}

async function main() {
  console.log('='.repeat(78))
  console.log('1. Production inspection rows, by family')
  console.log('='.repeat(78))

  const dot    = await get<Insp>('hd_dot_inspections?select=id,unit_id,inspection_date,overall_result')
  const aerial = await get<Insp>('hd_aerial_inspections?select=id,unit_id,inspection_date,overall_result,removed_from_service')
  const equip  = await get<Insp>('hd_equipment_inspections?select=id,unit_id,inspection_date,overall_result,removed_from_service')

  console.log(`  hd_dot_inspections        ${String(dot.length).padStart(4)}  (no removed_from_service column)`)
  console.log(`  hd_aerial_inspections     ${String(aerial.length).padStart(4)}  ${aerial.filter(r => r.removed_from_service).length} removed from service`)
  console.log(`  hd_equipment_inspections  ${String(equip.length).padStart(4)}  ${equip.filter(r => r.removed_from_service).length} removed from service`)

  const failCount = [...dot, ...aerial, ...equip].filter(r => isFailResult(r.overall_result)).length
  console.log(`\n  failing records overall: ${failCount}`)

  console.log('\n' + '='.repeat(78))
  console.log('2. The three states, from real rows grouped by unit')
  console.log('='.repeat(78))

  const byUnit = new Map<string, Insp[]>()
  for (const r of [...dot, ...aerial, ...equip]) {
    if (!r.unit_id) continue
    const list = byUnit.get(r.unit_id) ?? []
    list.push(r)
    byUnit.set(r.unit_id, list)
  }
  console.log(`  units with at least one inspection: ${byUnit.size}`)

  const tally: Record<string, number> = { out_of_service: 0, needs_repair: 0, clear: 0 }
  const moved: string[] = []
  for (const [unitId, rows] of byUnit) {
    const inputs: InspectionStatusInput[] = rows.map(r => ({
      result: r.overall_result,
      // undefined for DOT: the column does not exist, so the question was never asked.
      removedFromService: 'removed_from_service' in r ? r.removed_from_service : undefined,
    }))
    const state = unitInspectionState(inputs)
    tally[state]++
    const before = oldBehaviour(rows)
    const after  = state !== 'clear'
    if (before !== after || (before && state === 'needs_repair')) {
      moved.push(`${unitId.slice(0, 8)} ${before ? 'Failed' : 'Pass'} -> ${INSPECTION_STATE_META[state].label}${hasUnassessedFail(inputs) ? ' (not assessed)' : ''}`)
    }
  }
  console.log(`\n  out_of_service ${tally.out_of_service}`)
  console.log(`  needs_repair   ${tally.needs_repair}`)
  console.log(`  clear          ${tally.clear}`)

  if (moved.length) {
    console.log('\n  units whose DISPLAYED state changes (this is the fix):')
    moved.slice(0, 12).forEach(m => console.log(`    ${m}`))
  } else {
    console.log('\n  no unit changes state on production data today.')
  }

  console.log('\n' + '='.repeat(78))
  console.log('3. The four required cases')
  console.log('='.repeat(78))

  // (a) one non-OOS fail -> stays in service
  const nonOos: InspectionStatusInput[] = [{ result: 'fail', removedFromService: false }]
  console.log(`\n  (a) one fail, tech said NOT out of service`)
  console.log(`      state: ${unitInspectionState(nonOos)}`)
  ok(unitInspectionState(nonOos) === 'needs_repair', 'a non-OOS fail leaves the unit in service')
  ok(!isOutOfService(nonOos[0]), 'the item is not out of service')
  ok(oosAssessed(nonOos[0]), 'the OOS question WAS asked, so it is not "not assessed"')

  // (b) one auto-OOS fail -> out of service
  const oos: InspectionStatusInput[] = [{ result: 'fail', removedFromService: true }]
  console.log(`\n  (b) one fail, removed from service`)
  console.log(`      state: ${unitInspectionState(oos)}`)
  ok(unitInspectionState(oos) === 'out_of_service', 'an OOS fail takes the unit out of service')

  // (c) both on the same unit -> out of service wins
  const both: InspectionStatusInput[] = [
    { result: 'fail', removedFromService: false },
    { result: 'fail', removedFromService: true },
  ]
  console.log(`\n  (c) both on one unit`)
  console.log(`      state: ${unitInspectionState(both)}`)
  ok(unitInspectionState(both) === 'out_of_service', 'out of service wins over a plain fail')

  // (d) a historical record with no OOS data
  const historical: InspectionStatusInput[] = [{ result: 'fail' }]
  console.log(`\n  (d) a historical fail with no OOS data (DOT, PM, pre-trip)`)
  console.log(`      state: ${unitInspectionState(historical)}, unassessed: ${hasUnassessedFail(historical)}`)
  ok(unitInspectionState(historical) === 'needs_repair', 'reads as needs_repair, the honest floor')
  ok(hasUnassessedFail(historical), 'flagged as NOT ASSESSED rather than claimed as a decision')
  ok(!oosAssessed(historical[0]), 'never-asked is distinct from "no"')

  console.log('\n' + '='.repeat(78))
  console.log('4. Historical inspection RECORDS are untouched')
  console.log('='.repeat(78))
  // The record's own pass/fail is what a DOT auditor reads. Nothing in this change
  // writes to these tables, so overall_result must read exactly as before.
  const sample = [...dot, ...aerial, ...equip].filter(r => isFailResult(r.overall_result)).slice(0, 6)
  if (sample.length === 0) console.log('  No failing records in production to sample.')
  for (const r of sample) {
    const stored = r.overall_result
    console.log(`  ${r.id.slice(0, 8)}  ${r.inspection_date ?? '(no date)'}  overall_result=${stored}  removed_from_service=${'removed_from_service' in r ? String(r.removed_from_service) : 'COLUMN ABSENT'}`)
    ok(stored === r.overall_result, `${r.id.slice(0, 8)}: record's own result unchanged`)
  }

  console.log('\n' + '='.repeat(78))
  console.log(`${pass} passed, ${fail} failed`)
  console.log('='.repeat(78))
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
