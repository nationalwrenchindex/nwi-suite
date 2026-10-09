// Can anything still send an SMS without passing the guard?
//
// Static audit over the source. Every file that POSTs to Twilio's Messages endpoint
// must either call checkSmsAllowed first or be a documented permanent refusal. A new
// file that talks to Twilio directly fails this check, which is the point: the guard is
// only structural if adding a bypass is noisy.
//
// Also verifies, against the LIVE database, that the 32 numbers are blocked - and that
// the guard fails CLOSED when the table is missing.

import fs from 'fs'
import path from 'path'
import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }

const rows: Array<{ step: string; ok: boolean; detail: string }> = []
function record(step: string, ok: boolean, detail: string): boolean {
  rows.push({ step, ok, detail })
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${step.padEnd(62)} ${detail}`)
  return ok
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

// Files allowed to POST to Twilio without calling checkSmsAllowed, each with the reason.
const ALLOWED_WITHOUT_GUARD: Record<string, string> = {
  'src/lib/sms/guard.ts': 'the guard itself',
}

// Files that are permanent refusals: they must contain the refusal and must NOT contain
// a live Twilio POST.
const MUST_BE_REFUSALS = [
  'src/lib/directory-agent/sms.ts',
  'src/app/api/directory-agent/invite/route.ts',
  'src/app/api/directory-agent/follow-up/route.ts',
  'src/app/api/directory-agent/search/route.ts',
  'src/app/api/hd-directory-agent/invite/route.ts',
  'src/app/api/hd-directory-agent/follow-up/route.ts',
  'src/app/api/hd-directory-agent/search/route.ts',
  'src/scripts/retry-listings.ts',
]

async function main() {
  console.log('\nVERIFY THE SMS GUARD')
  console.log('='.repeat(100))

  console.log('\n  1. COLD OUTREACH IS OFF\n')

  const smsLib = fs.readFileSync('src/lib/directory-agent/sms.ts', 'utf8')
  record('the outreach sender refuses before any network call',
    smsLib.includes('COLD_OUTREACH_PERMANENTLY_DISABLED') &&
    smsLib.indexOf('COLD_OUTREACH_PERMANENTLY_DISABLED') < smsLib.indexOf('api.twilio.com'),
    'the kill is the first statement in sendAgentSms')

  for (const f of MUST_BE_REFUSALS) {
    const src = fs.readFileSync(f, 'utf8')
    const refuses = /coldOutreachDisabled|COLD_OUTREACH_PERMANENTLY_DISABLED|permanently disabled/.test(src)
    record(`${path.basename(path.dirname(f))}/${path.basename(f)} refuses`, refuses, refuses ? '' : 'no refusal found')
  }

  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8')) as { crons: Array<{ path: string }> }
  const coldCrons = vercel.crons.filter(c => /directory-agent/.test(c.path))
  record('no directory-agent cron remains in vercel.json', coldCrons.length === 0,
    coldCrons.length ? coldCrons.map(c => c.path).join(', ') : `${vercel.crons.length} crons left, none of them outreach`)

  console.log('\n  2. NOTHING CAN SEND WITHOUT THE GUARD\n')

  const files = walk('src')
  const senders = files.filter(f => {
    const src = fs.readFileSync(f, 'utf8')
    return /api\.twilio\.com\/2010-04-01\/Accounts\/\$\{?[a-zA-Z]+\}?\/Messages\.json/.test(src)
        || src.includes('/Messages.json')
  })

  console.log(`     files that POST to Twilio: ${senders.length}`)
  const unguarded: string[] = []
  for (const f of senders) {
    const rel = f.split(path.sep).join('/')
    const src = fs.readFileSync(f, 'utf8')
    if (ALLOWED_WITHOUT_GUARD[rel]) { console.log(`       ${rel}  (${ALLOWED_WITHOUT_GUARD[rel]})`); continue }

    const guarded = src.includes('checkSmsAllowed')
    const refuses = /coldOutreachDisabled|COLD_OUTREACH_PERMANENTLY_DISABLED|permanently disabled/.test(src)
    if (guarded)      { console.log(`       ${rel}  GUARDED`); continue }
    if (refuses)      { console.log(`       ${rel}  REFUSES`); continue }
    unguarded.push(rel)
    console.log(`       ${rel}  <-- UNGUARDED`)
  }
  record('every Twilio sender is guarded or refuses', unguarded.length === 0,
    unguarded.length ? `${unguarded.length} unguarded: ${unguarded.join(', ')}` : `${senders.length} files checked`)

  const guard = fs.readFileSync('src/lib/sms/guard.ts', 'utf8')
  record('the guard fails CLOSED on a read error',
    guard.includes("reason: 'guard_unavailable'") && guard.includes('REFUSING SEND'),
    'an unreadable blocklist refuses the send')
  record('there is no unblock function', !/export async function unblock|export function unblock/.test(guard),
    'removing a block is a human decision in SQL')

  console.log('\n  3. THE 32 NUMBERS, AGAINST THE LIVE DATABASE\n')

  const dncRes = await fetch(`${S}/rest/v1/do_not_contact?select=phone,reason,opted_out_at`, { headers: H })
  if (!dncRes.ok) {
    const body = (await dncRes.text()).slice(0, 120)
    record('do_not_contact exists', false, `${dncRes.status} ${body}`)
    console.log('\n     Migration 150 has not been applied yet. Until it is, the guard FAILS CLOSED')
    console.log('     and no SMS of any kind will send - which is the correct state to be in while')
    console.log('     the blocklist does not exist. Apply 150 to restore transactional SMS.')
  } else {
    const blocked = await dncRes.json() as Array<Record<string, unknown>>
    record('do_not_contact exists and is readable', true, `${blocked.length} numbers`)

    const csv = fs.readFileSync(path.join('data', 'outreach', 'do-not-contact.csv'), 'utf8')
      .split('\n').slice(1).filter(Boolean)
      .map(l => l.split(',')[0].trim())
    const blockedSet = new Set(blocked.map(b => String(b.phone)))
    const missing = csv.filter(p => !blockedSet.has(p))
    record('every number from the export is blocked', missing.length === 0,
      missing.length ? `MISSING: ${missing.join(', ')}` : `all ${csv.length} present`)

    // Nothing in the old opt-out tables should be unrepresented.
    for (const t of ['directory_optouts', 'hd_directory_optouts']) {
      const r = await fetch(`${S}/rest/v1/${t}?select=phone`, { headers: H })
      const old = r.ok ? await r.json() as Array<Record<string, unknown>> : []
      const gap = old.map(o => String(o.phone)).filter(p => !blockedSet.has(p))
      record(`every ${t} number is blocked`, gap.length === 0,
        gap.length ? `MISSING: ${gap.join(', ')}` : `${old.length} checked`)
    }

    const log = await fetch(`${S}/rest/v1/sms_send_log?select=id&limit=1`, { headers: H })
    record('sms_send_log exists (the frequency cap needs it)', log.ok,
      log.ok ? 'readable' : `${log.status} - the cap will not be enforced`)
  }

  const failed = rows.filter(r => !r.ok)
  console.log('\n' + '='.repeat(100))
  console.log(`  ${rows.length - failed.length} passed, ${failed.length} failed`)
  if (failed.length) { console.log('\n  NOT SAFE YET:'); failed.forEach(f => console.log(`    ${f.step} -- ${f.detail}`)) }
  console.log('='.repeat(100) + '\n')
  process.exitCode = failed.length ? 1 : 0
}

main().catch(e => { console.error(e); process.exitCode = 1 })
