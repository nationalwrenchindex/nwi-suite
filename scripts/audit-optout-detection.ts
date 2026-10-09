// How good is the app's opt-out detection, measured against every real reply?
//
// READ ONLY. Twilio GETs and Supabase SELECTs only.
//
// The app decides an opt-out with matchesKeyword (src/lib/directory-agent/reply.ts):
//
//     keywords.some(k => new RegExp(`\\b${k}\\b`).test(text))
//
// so the keyword counts WHEREVER it appears, including inside the opt-out instruction
// that the sender's own auto-responder appended. And OPT_OUT_KEYWORDS contains 'no',
// which matches the bare word "no" anywhere in any sentence.
//
// This replays all 148 inbound replies through the app's rule and through a rule that
// strips the quoted instruction first, and prints every message the two disagree on.
// The disagreements are the numbers the app has suppressed without the person asking.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const SID   = process.env.TWILIO_ACCOUNT_SID!
const TOKEN = process.env.TWILIO_AUTH_TOKEN!
const auth  = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64')
const SUPA  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SUPA_H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

// Copied verbatim from src/lib/directory-agent/reply.ts so this measures what SHIPS.
const OPT_OUT_KEYWORDS = ['stop', 'no', 'unsubscribe', 'cancel', 'end', 'quit']
function withoutEmails(s: string): string { return s.replace(/\S+@\S+/g, ' ') }
function appMatchesKeyword(message: string): string | null {
  const text = withoutEmails(message).toLowerCase()
  for (const k of OPT_OUT_KEYWORDS) if (new RegExp(`\\b${k}\\b`).test(text)) return k
  return null
}

// The corrected rule: strip any quoted instruction, then look at what the human typed.
const INSTRUCTION_CLAUSES: RegExp[] = [
  /\b(reply|text|send|type)\s+\w+\s+to\s+(opt\s*out|unsubscribe|cancel|stop|end|quit)\b/g,
  /\b(reply|text|send|type)\s+(stop|stopall|unsubscribe|quit|cancel|end|help)\b/g,
  /\bto\s+(opt\s*out|unsubscribe)\b/g,
  /\bmsg\s*(and|&)?\s*data\s+rates\s+may\s+apply\b/g,
]
const AUTO_REPLY = ["configure your number's sms url", 'reply help for help', 'msg data rates may apply']

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
}
function corrected(message: string): { optOut: boolean; bare: boolean; stripped: string } {
  const n = normalize(message)
  if (AUTO_REPLY.some(sig => n.includes(normalize(sig)))) return { optOut: false, bare: false, stripped: '(auto-reply boilerplate)' }
  let b = n
  for (const re of INSTRUCTION_CLAUSES) b = b.replace(re, ' ')
  b = b.replace(/\s+/g, ' ').trim()
  const HARD = ['stop', 'stopall', 'unsubscribe', 'quit', 'cancel', 'end', 'optout', 'opt out', 'revoke']
  for (const k of HARD) {
    const present = b === k || b.startsWith(`${k} `) || b.endsWith(` ${k}`) || b.includes(` ${k} `)
    if (present) return { optOut: true, bare: b === k || b.replace(k, '').trim().length <= 2, stripped: b }
  }
  return { optOut: false, bare: false, stripped: b }
}

async function twilio(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Authorization: auth } })
  if (!res.ok) throw new Error(`Twilio ${res.status}`)
  return await res.json() as Record<string, unknown>
}

async function main() {
  console.log('\nAUDIT: THE APP\'S OPT-OUT DETECTION vs EVERY REAL REPLY  (read only)')
  console.log('='.repeat(108))

  const owned = ((await twilio(
    `https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json?PageSize=100`,
  )).incoming_phone_numbers as Array<Record<string, unknown>>).map(n => String(n.phone_number))

  const inbound: Array<{ from: string; body: string; date: string }> = []
  for (const num of owned) {
    let url: string | null = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json?To=${encodeURIComponent(num)}&PageSize=1000`
    let pages = 0
    while (url && pages < 20) {
      const page: Record<string, unknown> = await twilio(url)
      for (const m of (page.messages ?? []) as Array<Record<string, unknown>>) {
        if (!String(m.direction).startsWith('inbound')) continue
        inbound.push({ from: String(m.from), body: String(m.body ?? ''), date: String(m.date_sent ?? m.date_created) })
      }
      const next = page.next_page_uri as string | null | undefined
      url = next ? `https://api.twilio.com${next}` : null
      pages++
    }
  }
  console.log(`\n  replies examined: ${inbound.length}\n`)

  const appYes = inbound.filter(m => appMatchesKeyword(m.body))
  const corrYes = inbound.filter(m => corrected(m.body).optOut)
  console.log(`  the app's rule says OPT OUT for ......... ${appYes.length} replies`)
  console.log(`  the corrected rule says OPT OUT for .... ${corrYes.length} replies`)

  const falsePositives = inbound.filter(m => appMatchesKeyword(m.body) && !corrected(m.body).optOut)
  const falseNegatives = inbound.filter(m => !appMatchesKeyword(m.body) && corrected(m.body).optOut)

  console.log(`\n  SUPPRESSED WITHOUT ASKING (${falsePositives.length}) - the app called these an opt-out; they are not:\n`)
  for (const m of falsePositives) {
    const k = appMatchesKeyword(m.body)
    console.log(`    ${m.from.padEnd(16)} matched "${k}"  ${String(m.date).slice(5, 16)}`)
    console.log(`        "${m.body.replace(/\s+/g, ' ').slice(0, 96)}"`)
    console.log(`        what they actually typed: "${corrected(m.body).stripped.slice(0, 70)}"`)
  }

  console.log(`\n  MISSED OPT-OUTS (${falseNegatives.length}) - a real opt-out the app's rule would not catch:\n`)
  if (!falseNegatives.length) console.log('    none')
  for (const m of falseNegatives) {
    console.log(`    ${m.from.padEnd(16)} "${m.body.replace(/\s+/g, ' ').slice(0, 80)}"`)
  }

  // How exposed is the 'no' keyword specifically?
  const noOnly = inbound.filter(m => {
    const k = appMatchesKeyword(m.body)
    return k === 'no' && !corrected(m.body).optOut
  })
  console.log(`\n  replies caught ONLY by the 'no' keyword (${noOnly.length}):\n`)
  for (const m of noOnly) {
    console.log(`    ${m.from.padEnd(16)} "${m.body.replace(/\s+/g, ' ').slice(0, 86)}"`)
  }

  // Which of the false positives are recorded as opt-outs in the database right now?
  const ld = await (await fetch(`${SUPA}/rest/v1/directory_optouts?select=phone`, { headers: SUPA_H })).json() as Array<Record<string, unknown>>
  const hd = await (await fetch(`${SUPA}/rest/v1/hd_directory_optouts?select=phone`, { headers: SUPA_H })).json() as Array<Record<string, unknown>>
  const recorded = new Set([...ld, ...hd].map(r => String(r.phone)))

  const wronglyRecorded = [...new Set(falsePositives.map(m => m.from))].filter(p => recorded.has(p))
  console.log(`\n  OF THOSE, ALREADY WRITTEN INTO THE OPT-OUT TABLES (${wronglyRecorded.length}):\n`)
  for (const p of wronglyRecorded) {
    const msg = falsePositives.find(m => m.from === p)!
    console.log(`    ${p.padEnd(16)} "${msg.body.replace(/\s+/g, ' ').slice(0, 76)}"`)
  }
  console.log(`\n  total rows in the two opt-out tables: ${recorded.size}`)
  console.log(`  of which provably triggered by a false match: ${wronglyRecorded.length}`)

  console.log(`\n${'='.repeat(108)}\n`)
}

main().catch(e => { console.error(e); process.exitCode = 1 })
