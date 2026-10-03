// Item 7b: the PostgREST 1,000-row cap audit.
//
// Two halves:
//   1. LIVE ROW COUNTS for every table Fleet Pro reads, so "could exceed 1,000" is
//      a measured fact rather than a guess.
//   2. A STATIC SCAN of every select under api/fleet-pro, api/inspect and the
//      fleet-pro libs, flagging multi-row reads on a high-volume table that have
//      no paging and no bound.
//
// Read-only.
//
//   npx tsx scripts/audit-row-cap.ts

import fs from 'fs'
import path from 'path'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

const hr = (t: string) => { console.log('\n' + '='.repeat(78)); console.log(t); console.log('='.repeat(78)) }

/** Exact count via the content-range header, which is not subject to the row cap. */
async function countOf(table: string): Promise<number | null> {
  const r = await fetch(`${U}/rest/v1/${table}?select=id`, {
    headers: { ...H, Prefer: 'count=exact', Range: '0-0' },
  })
  if (r.status >= 400) return null
  const cr = r.headers.get('content-range')
  const total = cr?.split('/')[1]
  return total && total !== '*' ? Number(total) : null
}

// Every table a Fleet Pro / inspect route reads more than one row from.
const TABLES = [
  'hd_units', 'hd_work_orders', 'hd_invoices', 'hd_quotes',
  'hd_pm_checklists', 'hd_dot_inspections', 'hd_aerial_inspections', 'hd_equipment_inspections',
  'fleet_pro_unit_meter_readings', 'fleet_pro_fuel_log', 'fleet_pro_pretrip_inspections',
  'fleet_pro_service_entries', 'fleet_pro_driver_incidents', 'fleet_pro_drivers',
  'fleet_pro_pm_schedules', 'fleet_pro_members', 'fleet_pro_fleet_accounts',
  'fleet_pro_compliance_docs', 'fleet_pro_unit_registration',
  'hd_fleet_accounts', 'customers', 'vehicles', 'invoices', 'quotes', 'work_orders',
  'expenses', 'jobs', 'notification_log', 'notifications',
]

const CAP = 1000

async function main() {
  hr('1. LIVE ROW COUNTS — which tables can actually breach the 1,000-row cap')
  const counts = new Map<string, number>()
  const over: string[] = []
  const near: string[] = []
  for (const t of TABLES) {
    const n = await countOf(t)
    if (n === null) { console.log(`  ${t.padEnd(34)} (absent)`); continue }
    counts.set(t, n)
    const flag = n > CAP ? '  <-- OVER THE CAP TODAY'
      : n > CAP * 0.5 ? '  <-- over half the cap'
      : ''
    console.log(`  ${t.padEnd(34)} ${String(n).padStart(7)}${flag}`)
    if (n > CAP) over.push(t)
    else if (n > CAP * 0.5) near.push(t)
  }
  console.log(`\n  OVER THE CAP NOW : ${over.length ? over.join(', ') : 'none'}`)
  console.log(`  over half        : ${near.length ? near.join(', ') : 'none'}`)

  // Tables that grow per-event rather than per-unit are the ones that will breach
  // it next, whatever they hold today.
  const GROWS_FAST = new Set([
    'fleet_pro_unit_meter_readings', 'fleet_pro_fuel_log', 'fleet_pro_pretrip_inspections',
    'fleet_pro_service_entries', 'fleet_pro_driver_incidents', 'notification_log',
    'notifications', 'hd_work_orders', 'hd_invoices', 'expenses', 'jobs',
  ])

  hr('2. STATIC SCAN — unbounded multi-row selects on a high-volume table')
  console.log('  A read is FINE when it has any of: fetchAllRows, fetchAllRowsForIds,')
  console.log('  .range(, .limit(, .single(, .maybeSingle(, or { head: true }.')
  console.log('  Anything else returns at most 1,000 rows and silently truncates.\n')

  const roots = [
    'src/app/api/fleet-pro',
    'src/app/api/inspect',
    'src/lib/fleet-pro',
  ]
  const files: string[] = []
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) files.push(p)
    }
  }
  for (const r of roots) walk(r)

  let flagged = 0, safe = 0
  const findings: { file: string; line: number; table: string; snippet: string }[] = []

  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    const lines = src.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const m = /\.from\(\s*['"`]([a-z_]+)['"`]\s*\)/.exec(lines[i])
      if (!m) continue
      const table = m[1]
      if (!GROWS_FAST.has(table) && (counts.get(table) ?? 0) <= CAP * 0.5) continue

      // The statement is this line plus the chained lines after it, up to the next
      // blank line or a line that starts a new statement.
      const chunk = lines.slice(Math.max(0, i - 6), i + 14).join('\n')

      const bounded =
        /fetchAllRows|fetchAllRowsForIds/.test(chunk) ||
        /\.range\(/.test(chunk) ||
        /\.limit\(/.test(chunk) ||
        /\.single\(\)/.test(chunk) ||
        /\.maybeSingle\(\)/.test(chunk) ||
        /head:\s*true/.test(chunk)

      // A write is not a read.
      const isWrite = /\.(insert|update|upsert|delete)\(/.test(chunk)

      if (isWrite) { continue }
      if (bounded) { safe++; continue }

      flagged++
      findings.push({ file, line: i + 1, table, snippet: lines[i].trim() })
    }
  }

  for (const f of findings) {
    console.log(`  UNPAGED  ${f.file}:${f.line}`)
    console.log(`           table=${f.table} (${counts.get(f.table) ?? '?'} rows)  ${f.snippet}`)
  }
  console.log(`\n  unpaged reads on a high-volume table : ${flagged}`)
  console.log(`  bounded reads on the same tables      : ${safe}`)

  hr('3. COUNTS — every count() must use { count: exact, head: true }')
  let badCounts = 0, goodCounts = 0
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      if (!/count:\s*'exact'/.test(lines[i])) continue
      const chunk = lines.slice(Math.max(0, i - 2), i + 3).join('\n')
      if (/head:\s*true/.test(chunk)) { goodCounts++; continue }
      badCounts++
      console.log(`  NO head:true  ${file}:${i + 1}  ${lines[i].trim()}`)
    }
  }
  console.log(`\n  counts with head:true    : ${goodCounts}`)
  console.log(`  counts WITHOUT head:true : ${badCounts}`)
  if (badCounts === 0) console.log('  (a count without head:true also transfers up to 1,000 rows it never reads)')

  hr('4. .limit() ABOVE THE CAP — a no-op that reads like a bound')
  let badLimits = 0
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    src.split('\n').forEach((l, i) => {
      const m = /\.limit\(\s*(\d+)\s*\)/.exec(l)
      if (m && Number(m[1]) > CAP) {
        badLimits++
        console.log(`  ${file}:${i + 1}  .limit(${m[1]}) — above the cap, so it does nothing`)
      }
    })
  }
  console.log(`\n  .limit() calls above 1,000 : ${badLimits}`)

  hr('SUMMARY')
  console.log(`  tables over the cap today : ${over.length ? over.join(', ') : 'none'}`)
  console.log(`  unpaged high-volume reads : ${flagged}`)
  console.log(`  counts missing head:true  : ${badCounts}`)
  console.log(`  useless .limit() calls    : ${badLimits}`)
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
