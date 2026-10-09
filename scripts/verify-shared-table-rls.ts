// The hd_parts_reference write hole: how many tables have it?
//
// Migration 124 says "Same policy pair as hd_parts_reference (061) and hd_alarm_codes
// (058)", which means the pattern was copied at least twice after 061. This tries an
// INSERT as a real subscriber against every shared reference table, so the answer is
// a count rather than an inference from a comment.

import { loadEnv, openSession } from './lib/smoke-session'

loadEnv()
const S    = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const OWNER = process.env.SMOKE_OWNER_ID ?? '4a8c046f-7db3-42bb-8422-fd47efb7678c'
const svcH = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }

// A minimal row for each table: enough to satisfy NOT NULL, marked so it is findable.
const PROBES: Array<[string, Record<string, unknown>]> = [
  ['hd_parts',            { part_number: 'ZZ-RLS-P1', manufacturer: 'Thermo King', description: 'ZZ-RLS probe', category: 'ZZ-RLS' }],
  ['hd_parts_cross_ref',  { part_number: 'ZZ-RLS-P1', cross_mfr: 'ZZ-RLS', cross_part: 'ZZ-RLS' }],
  ['hd_parts_reference',  { manufacturer: 'TK', part_category: 'ZZ-RLS', part_function: 'ZZ-RLS probe' }],
  ['hd_alarm_codes',      { manufacturer: 'TK', unit_family: 'ZZ-RLS', alarm_code: 'ZZ-RLS', display_text: 'ZZ-RLS probe' }],
  ['hd_trailer_reference',{ system: 'ZZ-RLS', component: 'ZZ-RLS probe', description: 'ZZ-RLS probe' }],
  ['hd_procedures',       { procedure_name: 'ZZ-RLS probe', category: 'ZZ-RLS', applies_to: 'ZZ-RLS', steps: 'ZZ-RLS probe' }],
  ['parts',               { part_number: 'ZZ-RLS-P2', manufacturer: 'ZZ Probe', part_type: 'ZZ-RLS', source: 'rls-probe' }],
  ['part_fitment',        { part_id: '00000000-0000-0000-0000-000000000000', unit_model: 'ZZ-RLS', source: 'rls-probe' }],
  ['part_cross_reference',{ part_id: '00000000-0000-0000-0000-000000000000', brand: 'ZZ-RLS', brand_number: 'ZZ-RLS', source: 'rls-probe' }],
  ['part_supersession',   { old_number: 'ZZ-RLS-A', new_number: 'ZZ-RLS-B', manufacturer: 'ZZ Probe', source: 'rls-probe' }],
]

async function main() {
  console.log(`\nWHICH SHARED TABLES CAN A SUBSCRIBER WRITE?  ${S}`)
  console.log('='.repeat(104))

  const session = await openSession(OWNER)
  const userH = { apikey: ANON, Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' }
  console.log(`  acting as: ${session.email}\n`)

  const writable: string[] = []
  const readonly: string[] = []
  const absent: string[] = []
  const cleanup: Array<{ table: string; filter: string }> = []

  try {
    for (const [table, row] of PROBES) {
      const res = await fetch(`${S}/rest/v1/${table}`, {
        method: 'POST', headers: { ...userH, Prefer: 'return=representation' }, body: JSON.stringify([row]),
      })
      const text = await res.text()
      let json: unknown = null
      try { json = JSON.parse(text) } catch { /* not json */ }
      const code = String((json as { code?: string })?.code ?? '')

      if (res.status === 404 || code === 'PGRST205') { absent.push(table); console.log(`  ----  ${table.padEnd(22)} table not present`); continue }

      if (res.status < 400) {
        writable.push(table)
        const made = Array.isArray(json) ? (json[0] as Record<string, unknown>) : null
        if (made?.id) cleanup.push({ table, filter: `id=eq.${made.id}` })
        console.log(`  WRITE ${table.padEnd(22)} a subscriber INSERTED a row  -> ${res.status}`)
      } else if (code === '42501') {
        readonly.push(table)
        console.log(`  ok    ${table.padEnd(22)} refused by RLS -> ${res.status} 42501`)
      } else {
        // A NOT NULL or FK failure means RLS let the statement THROUGH to the
        // constraints - which is itself a write permission. Reported as such rather
        // than counted as a refusal.
        // PGRST204/PGRST100 are PostgREST rejecting the request shape before the
        // database is reached - they say NOTHING about RLS. Counting them as writes
        // is how this script first reported hd_trailer_reference and hd_procedures as
        // writable when it had only got their column names wrong.
        if (code === 'PGRST204' || code === 'PGRST100') {
          console.log(`  ??    ${table.padEnd(22)} UNDETERMINED - probe row rejected by PostgREST (${code}), RLS never tested`)
          continue
        }
        const permissive = code !== '42501'
        if (permissive) {
          writable.push(`${table} (reached constraints: ${code})`)
          console.log(`  WRITE ${table.padEnd(22)} RLS allowed it; a constraint stopped it -> ${res.status} ${code}`)
        }
      }
    }
  } finally {
    for (const c of cleanup) await fetch(`${S}/rest/v1/${c.table}?${c.filter}`, { method: 'DELETE', headers: svcH })
    for (const [table] of PROBES) {
      for (const f of ['part_category=eq.ZZ-RLS', 'category=eq.ZZ-RLS', 'alarm_code=eq.ZZ-RLS',
                       'part_number=like.ZZ-RLS*', 'cross_mfr=eq.ZZ-RLS', 'brand=eq.ZZ-RLS',
                       'manufacturer=eq.ZZ%20Probe', 'unit_model=eq.ZZ-RLS']) {
        await fetch(`${S}/rest/v1/${table}?${f}`, { method: 'DELETE', headers: svcH }).catch(() => {})
      }
    }
  }

  console.log('\n' + '='.repeat(104))
  console.log(`  WRITABLE BY ANY SUBSCRIBER (${writable.length}):`)
  writable.forEach(t => console.log(`    ${t}`))
  console.log(`\n  READ-ONLY, as a shared table should be (${readonly.length}):`)
  readonly.forEach(t => console.log(`    ${t}`))
  if (absent.length) { console.log(`\n  not present (${absent.length}): ${absent.join(', ')}`) }
  console.log('='.repeat(104) + '\n')
}

main().catch(e => { console.error(e); process.exitCode = 1 })
