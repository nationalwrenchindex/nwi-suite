import { loadEnv } from './lib/smoke-session'

loadEnv()
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H    = { apikey: KEY, Authorization: `Bearer ${KEY}` }

const COLUMNS = [
  'terms_accepted_at',
  'terms_version',
  'privacy_accepted_at',
  'acceptance_ip',
  'acceptance_user_agent',
]

async function main() {
  console.log(`\nLIVE CHECK  ${SUPA}\n${'='.repeat(78)}`)

  // One request per column, so a single missing column cannot mask the rest.
  const present: string[] = []
  const absent:  string[] = []
  for (const col of COLUMNS) {
    const res  = await fetch(`${SUPA}/rest/v1/profiles?select=${col}&limit=1`, { headers: H })
    const body = await res.json()
    if (res.ok && Array.isArray(body)) { present.push(col); console.log(`  COLUMN  ${col.padEnd(24)} EXISTS`) }
    else {
      const e = body as { code?: string; message?: string }
      absent.push(col)
      console.log(`  COLUMN  ${col.padEnd(24)} MISSING   ${e.code ?? ''} ${String(e.message ?? '').slice(0, 70)}`)
    }
  }

  // The trigger cannot be read over PostgREST - information_schema is not exposed, and
  // the only behavioural test is an UPDATE to a real subscriber's profile, which is a
  // production write. Not run. Reported as undetermined instead of guessed.
  console.log(`\n  TRIGGER trg_require_terms_acceptance   NOT CHECKABLE from here (see note)`)

  if (present.length === COLUMNS.length) {
    const res  = await fetch(
      `${SUPA}/rest/v1/profiles?select=id,terms_accepted_at,terms_version&order=terms_accepted_at.desc.nullslast`,
      { headers: H },
    )
    const rows = await res.json() as Array<Record<string, unknown>>
    const accepted = rows.filter(r => r.terms_accepted_at)
    console.log(`\n  profiles: ${rows.length} total, ${accepted.length} with an acceptance recorded`)
    for (const r of accepted.slice(0, 10)) {
      console.log(`    ${String(r.id).slice(0, 8)}  ${r.terms_accepted_at}  version ${r.terms_version}`)
    }
    const orphan = rows.filter(r => r.terms_accepted_at && !r.terms_version)
    console.log(`  acceptances with no version recorded (should be 0): ${orphan.length}`)
  }

  console.log(`\n${'='.repeat(78)}`)
  console.log(absent.length === 0
    ? '  ALL FIVE COLUMNS EXIST - migration 147 has been applied'
    : `  ${absent.length} of ${COLUMNS.length} columns MISSING - migration 147 has NOT been applied`)
  console.log(`${'='.repeat(78)}\n`)
}

main()
