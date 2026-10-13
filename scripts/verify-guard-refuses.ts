// Does the guard actually REFUSE, or does it just exist?
//
// verify-sms-guard.ts proves every sender CALLS checkSmsAllowed and that the 32 numbers
// are in the table. Neither of those proves the function says no. This calls the real
// checkSmsAllowed against the real database.
//
// READ ONLY. checkSmsAllowed only SELECTs. No message is sent, nothing is written.

import { checkSmsAllowed, isOptOutMessage, toE164 } from '../src/lib/sms/guard'
import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

const rows: Array<{ step: string; ok: boolean; detail: string }> = []
function record(step: string, ok: boolean, detail: string): boolean {
  rows.push({ step, ok, detail })
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${step.padEnd(60)} ${detail}`)
  return ok
}

async function main() {
  console.log('\nDOES THE GUARD REFUSE?  (read only - nothing is sent)')
  console.log('='.repeat(100))

  const blocked = await (await fetch(
    `${S}/rest/v1/do_not_contact?select=phone,reason,opted_out_at&order=opted_out_at.asc`,
    { headers: H })).json() as Array<Record<string, unknown>>

  if (!blocked.length) { record('do_not_contact has rows', false, 'empty'); return }
  console.log(`  ${blocked.length} numbers on the blocklist\n`)

  console.log('  1. EVERY BLOCKED NUMBER IS REFUSED BY THE REAL FUNCTION\n')
  let refused = 0
  const allowedWrongly: string[] = []
  for (const b of blocked) {
    const phone = String(b.phone)
    const verdict = await checkSmsAllowed(phone)
    if (!verdict.allowed && verdict.reason === 'do_not_contact') refused++
    else allowedWrongly.push(`${phone} -> ${verdict.allowed ? 'ALLOWED' : verdict.reason}`)
  }
  record(`all ${blocked.length} blocked numbers refused with reason do_not_contact`,
    allowedWrongly.length === 0,
    allowedWrongly.length ? `NOT REFUSED: ${allowedWrongly.join(' | ')}` : `${refused}/${blocked.length}`)

  // Show a couple so the detail is visible rather than just counted.
  for (const b of blocked.slice(0, 3)) {
    const v = await checkSmsAllowed(String(b.phone))
    console.log(`      ${String(b.phone).padEnd(16)} ${v.allowed ? 'ALLOWED' : v.detail}`)
  }

  console.log('\n  2. A NUMBER THAT NEVER OPTED OUT IS STILL ALLOWED\n')
  // Transactional SMS has to keep working. A guard that refuses everything is not a
  // fix, it is an outage - so this must come back allowed.
  const blockedSet = new Set(blocked.map(b => String(b.phone)))
  const everTexted = await (await fetch(
    `${S}/rest/v1/sms_send_log?select=phone&limit=1`, { headers: H })).json() as Array<Record<string, unknown>>
  void everTexted

  // A number from the messaged list that is NOT on the blocklist.
  const fs = await import('fs')
  const messaged = fs.readFileSync('data/outreach/messaged.csv', 'utf8')
    .split('\n').slice(1).filter(Boolean).map(l => l.split(',')[0].trim())
  const clean = messaged.find(p => /^\+1[0-9]{10}$/.test(p) && !blockedSet.has(p))
  if (clean) {
    const v = await checkSmsAllowed(clean)
    record('a number that never opted out is allowed', v.allowed,
      v.allowed ? `${clean} -> allowed` : `${clean} -> REFUSED (${v.reason}): ${v.detail}`)
  } else {
    record('found an unblocked number to test with', false, 'every number is blocked?')
  }

  console.log('\n  3. A MALFORMED NUMBER IS REFUSED, NOT GUESSED AT\n')
  for (const bad of ['', '555', 'not a number', '+1555']) {
    const v = await checkSmsAllowed(bad)
    record(`"${bad || '(empty)'}" refused`, !v.allowed && v.reason === 'invalid_number',
      v.allowed ? 'ALLOWED' : v.reason)
  }

  console.log('\n  4. E.164 NORMALIZATION - the same number in any spelling\n')
  const target = String(blocked[0].phone)
  const digits = target.replace(/\D/g, '').slice(1)
  for (const spelling of [digits, `1${digits}`, `+1${digits}`, `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`]) {
    const norm = toE164(spelling)
    const v = await checkSmsAllowed(spelling)
    record(`"${spelling}" normalizes and is refused`, norm === target && !v.allowed,
      `-> ${norm} ${v.allowed ? 'ALLOWED' : v.reason}`)
  }

  console.log('\n  5. OPT-OUT KEYWORD DETECTION, including the footer case\n')
  const CASES: Array<[string, boolean]> = [
    ['STOP', true],
    ['stop', true],
    ['Stop ', true],
    ['Cancel', true],
    ['UNSUBSCRIBE', true],
    ['quit', true],
    ['No soliciting', true],
    ['yes Reply STOP to opt out.', false],
    ['Thanks for reaching out! One of our agents will get back with you soon. Reply "STOP" to opt-out.', false],
    ["Thanks for the message. Configure your number's SMS URL to change this message.Reply HELP for help.Reply STOP to unsubscribe.", false],
    ['Do you have a cost estimate?', false],
    ['yes please', false],
  ]
  for (const [body, expected] of CASES) {
    const got = isOptOutMessage(body)
    record(`${expected ? 'opt-out' : 'NOT an opt-out'}: "${body.slice(0, 44)}"`, got === expected,
      got === expected ? '' : `got ${got}, expected ${expected}`)
  }

  const failed = rows.filter(r => !r.ok)
  console.log('\n' + '='.repeat(100))
  console.log(`  ${rows.length - failed.length} passed, ${failed.length} failed`)
  if (failed.length) { console.log('\n  BROKEN:'); failed.forEach(f => console.log(`    ${f.step} -- ${f.detail}`)) }
  console.log('  Nothing was sent and nothing was written.')
  console.log('='.repeat(100) + '\n')
  process.exitCode = failed.length ? 1 : 0
}

main().catch(e => { console.error(e); process.exitCode = 1 })
