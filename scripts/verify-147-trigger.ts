// Does trg_require_terms_acceptance actually refuse?
//
// PostgREST does not expose information_schema or pg_trigger, so the trigger cannot be
// READ from here - it can only be provoked. And the only way to provoke it is the
// business_name NULL->value transition on a profile, which is a write.
//
// So it is run against a THROWAWAY account created for this check and deleted in a
// finally. No real subscriber's profile is touched. The only trigger on auth.users is
// handle_new_user, which inserts (id, email, full_name) and nothing else - no billing,
// no email, no listing - and the probe account is created with email_confirm so no mail
// is ever sent. The address is on .invalid, a reserved TLD that cannot receive mail.
//
// Three things are checked, because "the trigger exists" is not the claim that matters:
//   1. It REFUSES onboarding with no acceptance on record.
//   2. It ALLOWS onboarding once an acceptance is recorded. A gate that never opens is
//      an outage, not a gate.
//   3. It IGNORES an existing profile editing other fields. That carve-out is the whole
//      reason existing subscribers are not locked out, and it is worth proving, not
//      assuming.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H    = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

const rows: Array<{ step: string; ok: boolean; detail: string }> = []
function record(step: string, ok: boolean, detail: string): boolean {
  rows.push({ step, ok, detail })
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${step.padEnd(52)} ${detail}`)
  return ok
}

async function patchProfile(id: string, body: Record<string, unknown>) {
  const res = await fetch(`${SUPA}/rest/v1/profiles?id=eq.${id}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

async function main() {
  console.log(`\nTRIGGER PROBE  ${SUPA}\n${'='.repeat(90)}`)

  const email = `trigger-probe-${Date.now()}@nationalwrenchindex.invalid`
  let userId: string | null = null

  try {
    const mk = await fetch(`${SUPA}/auth/v1/admin/users`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ email, password: `Pb-${Date.now()}-xQ7`, email_confirm: true,
                             user_metadata: { full_name: 'TRIGGER PROBE' } }),
    })
    const made = await mk.json() as { id?: string; msg?: string; error?: string }
    userId = made.id ?? null
    if (!record('throwaway account created', !!userId, userId ? email : JSON.stringify(made).slice(0, 120))) return

    // handle_new_user fires after insert; give PostgREST a moment to see the row.
    let profile: Record<string, unknown> | undefined
    for (let i = 0; i < 10 && !profile; i++) {
      const res = await fetch(
        `${SUPA}/rest/v1/profiles?id=eq.${userId}&select=id,business_name,terms_accepted_at`, { headers: H })
      profile = (await res.json() as Record<string, unknown>[])[0]
      if (!profile) await new Promise(r => setTimeout(r, 400))
    }
    if (!record('its profile row exists', !!profile, profile ? 'created by handle_new_user' : 'never appeared')) return
    record('starts with business_name NULL', profile!.business_name === null, String(profile!.business_name))
    record('starts with no acceptance', profile!.terms_accepted_at === null, String(profile!.terms_accepted_at))

    // 1. THE REFUSAL. This is the whole point of the migration.
    const blocked = await patchProfile(userId!, { business_name: 'TRIGGER PROBE SHOP' })
    const msg = JSON.stringify(blocked.json ?? {})
    record('onboarding REFUSED with no acceptance on record',
      blocked.status >= 400 && msg.includes('Terms of Service must be accepted'),
      `-> ${blocked.status} ${msg.slice(0, 90)}`)

    const after = (await (await fetch(
      `${SUPA}/rest/v1/profiles?id=eq.${userId}&select=business_name`, { headers: H })).json()
    ) as Record<string, unknown>[]
    record('and nothing was written', after[0]?.business_name === null, String(after[0]?.business_name))

    // 2. THE GATE OPENS. Record an acceptance, then the same update must succeed.
    const acc = await patchProfile(userId!, {
      terms_accepted_at: new Date().toISOString(), terms_version: '2026-10-06',
      privacy_accepted_at: new Date().toISOString(),
      acceptance_ip: '203.0.113.1', acceptance_user_agent: 'trigger probe',
    })
    record('an acceptance can be recorded', acc.status < 400, `-> ${acc.status}`)

    const allowed = await patchProfile(userId!, { business_name: 'TRIGGER PROBE SHOP' })
    record('onboarding ALLOWED once acceptance is recorded', allowed.status < 400,
      `-> ${allowed.status} ${allowed.status >= 400 ? JSON.stringify(allowed.json).slice(0, 80) : ''}`)

    // 3. THE CARVE-OUT. An existing profile with no acceptance must still be editable -
    //    this is what keeps 30 paying subscribers out of a lockout.
    const clear = await patchProfile(userId!, { terms_accepted_at: null, terms_version: null })
    record('acceptance cleared for the carve-out test', clear.status < 400, `-> ${clear.status}`)

    const edit = await patchProfile(userId!, { phone: '555-0100' })
    record('an EXISTING profile with no acceptance can still be edited', edit.status < 400,
      `-> ${edit.status} ${edit.status >= 400 ? JSON.stringify(edit.json).slice(0, 80) : 'not locked out'}`)
  } finally {
    if (userId) {
      const res = await fetch(`${SUPA}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: H })
      const gone = (await (await fetch(
        `${SUPA}/rest/v1/profiles?id=eq.${userId}&select=id`, { headers: H })).json()) as unknown[]
      record('throwaway account deleted', res.ok && gone.length === 0,
        `auth ${res.status}, profile rows left ${gone.length}`)
    }
  }

  const failed = rows.filter(r => !r.ok)
  console.log(`${'='.repeat(90)}`)
  console.log(`  ${rows.length - failed.length} passed, ${failed.length} failed`)
  if (failed.length) { console.log('\n  BROKEN:'); failed.forEach(f => console.log(`    ${f.step} -- ${f.detail}`)) }
  console.log(`${'='.repeat(90)}\n`)
  process.exitCode = failed.length ? 1 : 0
}

main()
