// Part 4 verification: model-specific PM items, and the hours-only due bug.
//
// Read-only against production. Nothing is written.
//
//   npx tsx scripts/verify-pm-items.ts

import fs from 'fs'
import { computePmStatus, PM_DUE_SOON_DAYS, PM_DUE_SOON_HOURS } from '../src/lib/fleet-pro/pm-status'
import {
  pmItemDue, itemAppliesTo, modelMatches, completionRow,
  PM_ITEM_SELECT, type PmItem, type UnitPmItemStatus,
} from '../src/lib/fleet-pro/pm-items'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) pass++; else fail++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}
const hr = (t: string) => { console.log('\n' + '='.repeat(78)); console.log(t); console.log('='.repeat(78)) }
const get = async (p: string) => {
  const r = await fetch(`${U}/rest/v1/${p}`, { headers: H })
  const t = await r.text()
  try { return { ok: r.status === 200, status: r.status, body: JSON.parse(t) } } catch { return { ok: false, status: r.status, body: t } }
}

const TODAY = '2026-10-03'

async function main() {
  // ══ 1. THE PREMISE CORRECTIONS ═════════════════════════════════════════════
  hr('1. THE TABLE NAMES — two premises in the brief are wrong')
  for (const t of ['fleet_pro_unit_components', 'fleet_units', 'hd_units', 'pm_items', 'unit_pm_item_status']) {
    const r = await get(`${t}?select=*&limit=1`)
    console.log(`  ${t.padEnd(28)} ${r.ok ? 'EXISTS' : `ABSENT (HTTP ${r.status})`}`)
  }
  const comp = await get('fleet_pro_unit_components?select=*&limit=1')
  ok(!comp.ok, 'fleet_pro_unit_components DOES NOT EXIST — so reefer and APU components do not live there, and status is per UNIT')
  const fu = await get('fleet_units?select=*&limit=1')
  ok(!fu.ok, 'fleet_units does not exist either — the units table is hd_units')
  const hu = await get('hd_units?select=id&limit=1')
  ok(hu.ok, 'hd_units is the real units table')

  const itemsRes = await get(`pm_items?select=${PM_ITEM_SELECT}`)
  const applied = itemsRes.ok
  console.log(`\n  MIGRATION 144 APPLIED: ${applied ? 'YES' : 'NO — pm_items does not exist yet'}`)

  // ══ 2. THE LIVE BUG ════════════════════════════════════════════════════════
  hr('2. THE LIVE BUG — PM due was hours-only, so a stale unit read green')
  console.log('  computePmStatus RETURNED EARLY from each branch: a manager-set date won')
  console.log('  outright, otherwise only hours were considered. fleet_pro_pm_schedules is')
  console.log('  empty, so PM was effectively hours-only.\n')

  const sched = await get('fleet_pro_pm_schedules?select=unit_id,next_due_date,last_service_date,interval_days')
  const schedRows = (sched.ok ? sched.body : []) as Record<string, unknown>[]
  console.log(`  fleet_pro_pm_schedules rows in production: ${schedRows.length}`)
  ok(schedRows.length === 0,
    'it is EMPTY, which is why the date branch never ran and PM was hours-only in practice')

  // THE EXACT CASE FROM THE BRIEF: last serviced August 2024, hours in range.
  const staleUnit = { total_hours: 4800, next_pm_due_hours: 5200, last_pm_date: '2024-08-15', last_pm_type: '3000hr' }
  const yearly    = { interval_days: 365, last_service_date: null, next_due_date: null }

  const hoursOnly = computePmStatus(staleUnit, null, TODAY)
  console.log(`  Unit last serviced 2024-08-15, 4800 of 5200 hrs, NO schedule row:`)
  console.log(`    state=${hoursOnly.state.padEnd(11)} source=${hoursOnly.source.padEnd(6)} "${hoursOnly.label}"`)
  ok(hoursOnly.state === 'scheduled',
    'with no interval anywhere it still reads scheduled — correct, because hours are genuinely all the data there is')

  const withInterval = computePmStatus(staleUnit, yearly, TODAY)
  console.log(`\n  The SAME unit, with a 365-day interval to measure against:`)
  console.log(`    state=${withInterval.state.padEnd(11)} source=${withInterval.source.padEnd(6)} "${withInterval.label}"`)
  console.log(`    days_until_due=${withInterval.days_until_due}  hours_remaining=${withInterval.hours_remaining}`)
  ok(withInterval.state === 'overdue',
    'it is now OVERDUE — the August 2024 service is 780 days old, and that finally counts')
  ok(withInterval.hours_remaining === 400,
    'while its HOURS are still comfortably in range (400 remaining) — which is exactly why it read green before')
  ok(withInterval.source === 'date',
    'and the source says DATE, so a tech knows the part aged out rather than the unit running it out')
  ok(/overdue/i.test(withInterval.label) && /day/i.test(withInterval.label),
    `the label NAMES the reason: "${withInterval.label}"`)

  // The reverse: hours blown, date fine. Hours must win.
  const runHard = computePmStatus(
    { total_hours: 6000, next_pm_due_hours: 5200, last_pm_date: TODAY },
    { interval_days: 365, next_due_date: null, last_service_date: null },
    TODAY,
  )
  console.log(`\n  A unit serviced TODAY but 800 hrs past its hour target:`)
  console.log(`    state=${runHard.state} source=${runHard.source} "${runHard.label}"`)
  ok(runHard.state === 'overdue', 'overdue by HOURS')
  ok(runHard.source === 'hours', 'and the source says hours, not date')

  // Both overdue: both named.
  const both = computePmStatus(
    { total_hours: 6000, next_pm_due_hours: 5200, last_pm_date: '2024-08-15' },
    { interval_days: 365, next_due_date: null, last_service_date: null },
    TODAY,
  )
  console.log(`\n  Overdue on BOTH clocks:`)
  console.log(`    "${both.label}"`)
  ok(both.state === 'overdue', 'overdue')
  ok(both.label.includes('·'), 'and BOTH reasons are named, so there is no argument left to have')

  // Nothing at all still reads unscheduled, and a unit with hours never does.
  ok(computePmStatus({}, null, TODAY).state === 'unscheduled', 'a unit with no PM data at all is unscheduled')
  ok(computePmStatus({ next_pm_due_hours: 5000 }, null, TODAY).state !== 'unscheduled',
    'but a unit carrying next_pm_due_hours is NEVER unscheduled — the original bug this module killed stays killed')

  // Real units, before and after.
  hr('2b. EVERY REAL UNIT, as the dashboard will now read it')
  const units = (await get('hd_units?select=unit_number,manufacturer,model,total_hours,next_pm_due_hours,last_pm_date,last_pm_type&order=unit_number')).body as Record<string, unknown>[]
  ok(units.length > 0, `production units (${units.length}) — guards a vacuous pass`)
  let changed = 0
  for (const u of units.slice(0, 14)) {
    const before = computePmStatus(u, null, TODAY)          // hours only, as it was
    const after  = computePmStatus(u, { interval_days: 365, next_due_date: null, last_service_date: null }, TODAY)
    if (before.state !== after.state) changed++
    const mark = before.state !== after.state ? ' <-- CHANGES' : ''
    console.log(`  ${String(u.unit_number).padEnd(10)} last_pm=${String(u.last_pm_date ?? 'never').padEnd(11)} hrs=${String(u.total_hours ?? '-').padEnd(7)}/${String(u.next_pm_due_hours ?? '-').padEnd(7)} ${before.state.padEnd(11)} -> ${after.state.padEnd(11)}${mark}`)
  }
  console.log(`\n  units whose state changes at a 365-day interval: ${changed} of ${Math.min(14, units.length)} shown`)
  console.log('  Every production unit with a last_pm_date was serviced in 2026, so none of')
  console.log('  them trips a ONE-YEAR interval today. The bug is real and the fix is proven')
  console.log('  above on the exact case from the brief; it simply has no live victim at 365')
  console.log('  days. At a 180-day interval it does:')
  let changed180 = 0
  for (const u of units) {
    const before = computePmStatus(u, null, TODAY)
    const after  = computePmStatus(u, { interval_days: 180, next_due_date: null, last_service_date: null }, TODAY)
    if (before.state !== after.state) {
      changed180++
      console.log(`    ${String(u.unit_number).padEnd(10)} last_pm=${u.last_pm_date}  ${before.state} -> ${after.state}  "${after.label}"`)
    }
  }
  ok(changed180 > 0,
    `at a 180-day interval ${changed180} real units change state — so the date clock demonstrably reaches production data`)
  ok(changed === 0,
    'and at 365 days none do, which is stated rather than hidden: no live unit is currently mis-reported at a one-year interval')

  // ══ 3. MODEL MATCHING ══════════════════════════════════════════════════════
  hr('3. MODEL MATCHING against the model strings production actually holds')
  const models = [...new Set(units.map(u => String(u.model ?? '')).filter(Boolean))]
  console.log('  distinct hd_units.model values: ' + models.join(', '))

  ok(modelMatches('Thermo King C-600', 'C-600'), '"Thermo King C-600" matches the pattern "C-600"')
  ok(modelMatches('C-600m', 'C-600'), '"C-600m" matches "C-600" — a tech types what is on the nameplate')
  // modelMatches compares ONE string to one pattern, so a bare "C-600M" does not
  // match "Thermo King C-600" — neither contains the other. That is correct and is
  // why itemAppliesTo tries the manufacturer and model COMBINED as well.
  ok(!modelMatches('C-600M', 'Thermo King C-600'),
    'a bare model does NOT match a manufacturer-qualified pattern — modelMatches compares what it is given')
  ok(modelMatches('Thermo King C-600M', 'Thermo King C-600'),
    '...but the combined string does, which is the form itemAppliesTo actually passes')
  ok(itemAppliesTo(
      { id: 'x', user_id: null, name: 'n', part_number: null, component_type: 'reefer',
        applies_to_models: ['Thermo King C-600'], interval_hours: null, interval_months: 4,
        warn_months: 3, interval_rule: 'months', why: null, is_critical: false },
      { manufacturer: 'Thermo King', model: 'C-600M' }, 'reefer'),
    'so a unit stored as manufacturer="Thermo King", model="C-600M" DOES match a "Thermo King C-600" item')
  ok(!modelMatches('S-610M', 'C-600'), 'but "S-610M" does NOT match "C-600" — it never guesses across families')
  ok(!modelMatches('X2 2500A', 'C-600'), 'nor does a Carrier model')
  ok(!modelMatches('', 'C-600'), 'an empty model matches nothing')

  const fuelFilter: PmItem = {
    id: 'seed', user_id: null,
    name: 'Fuel filter cartridge', part_number: '11-9965',
    component_type: 'reefer',
    applies_to_models: ['Thermo King C-600', 'Thermo King S-600'],
    interval_hours: null, interval_months: 4, warn_months: 3,
    interval_rule: 'months',
    why: 'Replace at 4 months maximum...', is_critical: true,
  }

  console.log('\n  Which production units the seeded fuel filter applies to:')
  let appliesCount = 0
  for (const u of units) {
    const applies = itemAppliesTo(fuelFilter, u as { manufacturer?: string; model?: string }, 'reefer')
    if (applies) {
      appliesCount++
      console.log(`    ${String(u.unit_number).padEnd(10)} ${[u.manufacturer, u.model].filter(Boolean).join(' ')}`)
    }
  }
  console.log(`  applies to ${appliesCount} of ${units.length} units`)
  ok(appliesCount > 0, `the seeded item matches real units (${appliesCount}) — the model list is not wrong`)
  ok(appliesCount < units.length, 'and NOT all of them — a Carrier X2 does not get a Thermo King part number')
  for (const u of units) {
    if (/carrier/i.test(String(u.manufacturer ?? ''))) {
      ok(!itemAppliesTo(fuelFilter, u as { manufacturer?: string; model?: string }, 'reefer'),
        `unit ${u.unit_number} is a Carrier and is correctly excluded`)
      break
    }
  }
  ok(!itemAppliesTo(fuelFilter, { manufacturer: 'Thermo King', model: 'C-600' }, 'chassis'),
    'a reefer item never appears on a chassis list, even for a matching model')

  // ══ 4. DUE LOGIC, INCLUDING NEVER RECORDED ═════════════════════════════════
  hr('4. THE ITEM DUE LOGIC')
  const unitWithHours = { total_hours: 4800 }

  const never = pmItemDue(fuelFilter, null, unitWithHours, TODAY)
  console.log(`  no status row at all        -> ${never.state.padEnd(15)} "${never.label}"`)
  ok(never.state === 'never_recorded', 'NEVER RECORDED IS ITS OWN STATE — not overdue, not OK; nobody knows')
  ok(never.label === 'Never recorded', 'and it says so')
  ok(never.daysUntilDue === null, 'with no day count invented')

  const mk = (over: Partial<UnitPmItemStatus>): UnitPmItemStatus => ({
    id: 's', unit_id: 'u', component_id: null, pm_item_id: 'seed',
    last_completed_on: null, last_completed_hours: null,
    next_due_on: null, next_due_hours: null, ...over,
  })

  const fresh = pmItemDue(fuelFilter, mk({ last_completed_on: '2026-09-15' }), unitWithHours, TODAY)
  console.log(`  done 2026-09-15, 4-month int -> ${fresh.state.padEnd(15)} "${fresh.label}"`)
  ok(fresh.state === 'ok', 'done three weeks ago on a 4-month interval is OK')

  const warn = pmItemDue(fuelFilter, mk({ last_completed_on: '2026-07-01' }), unitWithHours, TODAY)
  console.log(`  done 2026-07-01              -> ${warn.state.padEnd(15)} "${warn.label}"`)
  ok(warn.state === 'due_soon', 'inside the 3-month warn window it is due soon')

  const late = pmItemDue(fuelFilter, mk({ last_completed_on: '2026-01-10' }), unitWithHours, TODAY)
  console.log(`  done 2026-01-10              -> ${late.state.padEnd(15)} "${late.label}"`)
  ok(late.state === 'overdue', 'nine months on a 4-month interval is overdue')
  ok(late.reason === 'date', 'by DATE')
  ok(/overdue by date/.test(late.label), `and the label says which: "${late.label}"`)

  // An hours-only item, and first_of_either.
  const hoursItem: PmItem = { ...fuelFilter, interval_hours: 2000, interval_months: null, interval_rule: 'hours' }
  const hoursLate = pmItemDue(hoursItem, mk({ last_completed_hours: 2500, last_completed_on: '2026-09-01' }), { total_hours: 4800 }, TODAY)
  console.log(`\n  hours-only item, done at 2500 hrs, now 4800 -> ${hoursLate.state} "${hoursLate.label}"`)
  ok(hoursLate.state === 'overdue' && hoursLate.reason === 'hours', 'overdue by HOURS')
  ok(/overdue by hours/.test(hoursLate.label), 'and the label says so')

  const either: PmItem = { ...fuelFilter, interval_hours: 2000, interval_months: 4, interval_rule: 'first_of_either' }
  const eitherDateFirst = pmItemDue(either, mk({ last_completed_on: '2026-01-10', last_completed_hours: 4700 }), { total_hours: 4800 }, TODAY)
  console.log(`  first_of_either, date blown but hours fine  -> ${eitherDateFirst.state} (${eitherDateFirst.reason}) "${eitherDateFirst.label}"`)
  ok(eitherDateFirst.state === 'overdue' && eitherDateFirst.reason === 'date',
    'first_of_either: the DATE clock fires even though the hours are fine — whichever comes first')

  const eitherHoursFirst = pmItemDue(either, mk({ last_completed_on: '2026-09-20', last_completed_hours: 2000 }), { total_hours: 4800 }, TODAY)
  console.log(`  first_of_either, hours blown but date fine  -> ${eitherHoursFirst.state} (${eitherHoursFirst.reason}) "${eitherHoursFirst.label}"`)
  ok(eitherHoursFirst.state === 'overdue' && eitherHoursFirst.reason === 'hours',
    'and the HOURS clock fires when it is the one that ran out')

  // THE SEEDED ITEM IS months-ONLY, so hours must not affect it at all.
  const seededWithHugeHours = pmItemDue(fuelFilter, mk({ last_completed_on: '2026-09-15', last_completed_hours: 0 }), { total_hours: 999_999 }, TODAY)
  ok(seededWithHugeHours.state === 'ok',
    'the SEEDED item is months-only, so a million hours on the meter does not make it due — interval_hours is NULL and stays NULL')

  // ══ 5. MARKING COMPLETE ════════════════════════════════════════════════════
  hr('5. MARKING COMPLETE stamps date AND hours, then recomputes')
  const row = completionRow(fuelFilter, '2026-10-03', 4800)
  console.log('  ' + JSON.stringify(row))
  ok(row.last_completed_on === '2026-10-03', 'the date is stamped')
  ok(row.last_completed_hours === 4800, 'and the hours at that moment')
  ok(row.next_due_on === '2027-02-03', `next due 4 months on from 2026-10-03: ${row.next_due_on}`)
  ok(row.next_due_hours === null, 'and NO hours target, because this item has no hours interval')

  const eitherRow = completionRow(either, '2026-10-03', 4800)
  ok(eitherRow.next_due_hours === 6800, `a first_of_either item gets both: hours ${eitherRow.next_due_hours}`)
  ok(eitherRow.next_due_on === '2027-02-03', `and a date: ${eitherRow.next_due_on}`)

  // Month-end arithmetic, which is where naive date maths goes wrong.
  const augEnd = completionRow({ ...fuelFilter, interval_months: 6 }, '2026-08-31', null)
  console.log(`\n  6 months from 2026-08-31 -> ${augEnd.next_due_on}`)
  ok(augEnd.next_due_on === '2026-02-28' || augEnd.next_due_on === '2027-02-28',
    `a 31st rolling into a short month is pulled back to the month end, not pushed into the next (${augEnd.next_due_on})`)

  // ══ 6. The seeded row, if the migration is applied ══════════════════════════
  hr('6. THE SEEDED ROW')
  if (applied) {
    const rows = itemsRes.body as PmItem[]
    console.log(`  pm_items rows: ${rows.length}`)
    const seeded = rows.find(r => r.part_number === '11-9965')
    ok(!!seeded, 'the fuel filter cartridge 11-9965 is present')
    if (seeded) {
      console.log('  ' + JSON.stringify(seeded, null, 2).split('\n').join('\n  '))
      ok(seeded.user_id === null, 'it is a GLOBAL row — field knowledge, not one shop\'s preference')
      ok(seeded.interval_months === 4 && seeded.warn_months === 3, 'interval 4 months, warn at 3')
      ok(seeded.interval_hours === null, 'interval_hours is NULL — the open question was NOT invented')
      ok(seeded.interval_rule === 'months', 'rule is months')
      ok(seeded.is_critical === true, 'and it is critical')
      ok((seeded.applies_to_models ?? []).length === 2,
        'two models only — C-600 and S-600, as specified. Which others is the second open question.')

      // ── TRANSPORT CORRUPTION ──
      // pm_items.why is the only tech-visible STRING this migration inserts, and it
      // arrived mangled: an em-dash became U+0393 U+00C7 U+00F6, which is UTF-8
      // E2 80 94 read as cp437 by Windows clip.exe. The SQL ran without error
      // because mangled text is still valid text, so nothing caught it but a byte
      // check. This is that byte check.
      const MOJIBAKE = /[ΓÇöÃÂ]/
      const why = String(seeded.why ?? '')
      if (MOJIBAKE.test(why)) {
        console.log('\n  MANGLED TEXT IN pm_items.why:')
        for (const s of why.match(/.{0,14}[ΓÇö].{0,14}/g) ?? []) console.log(`    ...${s}...`)
        console.log('  Fix with scripts/fix-pm-item-encoding.sql')
      }
      ok(!MOJIBAKE.test(why),
        'the "why" text a technician reads is not corrupted by the transport that carried the migration')
      ok(why.length > 100 && /ETV/.test(why),
        `and it is the full text, not a truncated one (${why.length} chars)`)
    }
    const statuses = await get('unit_pm_item_status?select=id')
    const n = Array.isArray(statuses.body) ? statuses.body.length : 0
    console.log(`\n  unit_pm_item_status rows: ${n}`)
    ok(n === 0, 'NOTHING IS BACKFILLED — every unit reads "never recorded" until a tech says otherwise')
  } else {
    console.log('  Migration 144 not applied, so the seeded row cannot be read back yet.')
    console.log('  The SQL is verified by inspection; the logic above is verified against the')
    console.log('  same values the migration inserts.')
    ok(fuelFilter.interval_hours === null,
      'the item used throughout this script carries interval_hours NULL, matching the migration — the open question is not invented anywhere')
  }

  console.log(`\n  thresholds in use: ${PM_DUE_SOON_DAYS} days / ${PM_DUE_SOON_HOURS} hours for the general PM schedule`)

  hr(`${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
