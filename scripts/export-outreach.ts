// Export the directory outreach SMS history, and reconcile it against the app's own
// records.
//
// READ ONLY, IN BOTH DIRECTIONS. Every Twilio call is a GET and every Supabase call is a
// SELECT. Nothing is sent, nothing is written to the database. The only things written
// are the two CSV files.
//
// -- WHICH NUMBERS ARE COVERED, AND WHY NOT JUST ONE ------------------------
//
// The brief said "our 10DLC number", singular. The account has four, and the facts do
// not line up with one:
//
//   messaging service MGbc3ba6d2...  A2P campaign CJN9JRM, VERIFIED, LOW_VOLUME
//       +17439016244   257 sent   Apr 2026 .. Oct 2026   <- TWILIO_PHONE_NUMBER
//       +13367294181   456 sent   Aug 2026 .. Oct 2026
//
//   messaging service MGbb0535ab...  NO A2P registration
//       +13362761896  1292 sent   Aug 2026 .. Sep 2026   <- the most traffic by far
//
//   +13365518557   0 sent
//
// So exporting only the registered campaign would leave out 1,292 messages - 64% of all
// outreach - including any opt-out among them. A do-not-contact list that is missing
// two thirds of the people we texted is worse than no list, so ALL THREE senders are
// exported, each row labelled with its sender and whether that sender is on the
// registered 10DLC campaign. Narrowing is then a filter away; un-narrowing would have
// meant another export and another day of sending.

import fs from 'fs'
import path from 'path'
import { loadEnv } from './lib/smoke-session'

loadEnv()
const SID   = process.env.TWILIO_ACCOUNT_SID!
const TOKEN = process.env.TWILIO_AUTH_TOKEN!
const auth  = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64')

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SUPA_H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

const OUT_DIR = path.join('data', 'outreach')

// Senders on the VERIFIED A2P campaign CJN9JRM, read from the messaging service at
// probe time. Recorded here so each exported row can say whether it was sent on a
// registered campaign.
const ON_10DLC = new Set(['+17439016244', '+13367294181'])

// -- opt-out detection ------------------------------------------------------
//
// The standard carrier keywords plus the ones named in the brief. Matched on the whole
// trimmed message, and also as the first word, because "STOP please" and "stop." are
// opt-outs and "I had to stop the unit" is not.
const HARD_KEYWORDS = [
  'stop', 'stopall', 'unsubscribe', 'quit', 'cancel', 'end', 'optout', 'opt-out', 'opt out',
  'revoke', 'remove me', 'take me off', 'no more', 'do not text', "don't text", 'dont text',
  // "No soliciting" is not a carrier keyword, but it is unmistakably a request not to be
  // contacted, and the audit found exactly one. The app caught it only by accident -
  // its 'no' keyword matched - and the corrected rule would have dropped it, which
  // would have been the one change that made this list WORSE. Added on its own merit.
  'no soliciting', 'do not solicit', 'not soliciting', 'no sales calls',
]

// The app's own list (src/lib/directory-agent/reply.ts) also treats a bare "no" as an
// opt-out. A bare "no" to "can we list you?" is a refusal of the offer, not necessarily
// a revocation of consent - but it is counted here anyway and labelled separately,
// because the cost of wrongly including a number is one lost prospect and the cost of
// wrongly excluding one is a TCPA complaint. Conservative in the direction that cannot
// hurt anyone.
const SOFT_KEYWORDS = ['no', 'nope', 'not interested', 'no thanks', 'no thank you']

function normalizeBody(body: string): string {
  return body.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

// A message that QUOTES the opt-out instruction instead of using it.
//
// The first version of this matcher put three numbers on the do-not-contact list for
// replying:
//
//   "Thanks for the message. Configure your number's SMS URL to change this message.
//    Reply HELP for help. Reply STOP to unsubscribe. Msg&Data rates may apply."
//
// That is Twilio's DEFAULT AUTO-RESPONSE from a number whose SMS webhook is not
// configured - a machine, not a person - and it hard-matched because it contains the
// literal word STOP inside "Reply STOP to unsubscribe". Three of the six discrepancies
// I was about to report as opt-outs the app had missed were this.
//
// So: boilerplate is recognised and skipped, and a keyword that appears only as part of
// a quoted instruction ("reply stop to...") does not count either.
const AUTO_REPLY_SIGNATURES = [
  "configure your number's sms url",
  'configure your number s sms url',
  'msg data rates may apply',
  'reply help for help',
]

function isBoilerplate(body: string): boolean {
  const b = normalizeBody(body)
  return AUTO_REPLY_SIGNATURES.some(sig => b.includes(normalizeBody(sig)))
}

// Remove the QUOTED OPT-OUT INSTRUCTION before looking for a keyword.
//
// This is the fix for the worst defect this export had. +14235928088 replied:
//
//     "yes Reply STOP to opt out."
//
// and landed on the do-not-contact list - a prospect who said YES, suppressed, because
// the footer their own system appended contained "opt out". Several others were
// auto-replies ("Thanks for reaching out! One of our agents will get back with
// you soon. Reply STOP to opt out.") classified the same way.
//
// Checking for "reply <keyword>" was not enough, because the keyword sits after "to":
// reply STOP to OPT OUT. So the whole instruction clause is stripped first, and
// whatever the human actually typed is what gets matched. "STOP Reply STOP to
// unsubscribe" still reduces to "stop" and is still an opt-out; "yes Reply STOP to opt
// out" reduces to "yes" and is not.
const INSTRUCTION_CLAUSES: RegExp[] = [
  /\b(reply|text|send|type)\s+\w+\s+to\s+(opt\s*out|unsubscribe|cancel|stop|end|quit)\b/g,
  /\b(reply|text|send|type)\s+(stop|stopall|unsubscribe|quit|cancel|end|help)\b/g,
  /\bto\s+(opt\s*out|unsubscribe)\b/g,
  /\bmsg\s*(and|&)?\s*data\s+rates\s+may\s+apply\b/g,
  /\bstd\s+msg\s*(and|&)?\s*data\s+rates\s+apply\b/g,
]

function stripInstructions(b: string): string {
  let out = b
  for (const re of INSTRUCTION_CLAUSES) out = out.replace(re, ' ')
  return out.replace(/\s+/g, ' ').trim()
}

export type OptOutMatch = {
  kind: 'hard' | 'ambiguous' | 'soft' | 'none'
  keyword: string | null
}

function optOutReason(body: string): OptOutMatch {
  if (isBoilerplate(body)) return { kind: 'none', keyword: null }

  // What the person actually typed, with any quoted instruction footer removed.
  const b = stripInstructions(normalizeBody(body))
  if (!b) return { kind: 'none', keyword: null }

  for (const k of HARD_KEYWORDS) {
    const present = b === k || b.startsWith(`${k} `) || b.endsWith(` ${k}`) || b.includes(` ${k} `)
    if (!present) continue

    // A BARE keyword is the carrier-recognised opt-out: the whole message is the word.
    // A keyword inside a sentence is not necessarily one - "Cancel appointment" from
    // someone who asked for a quote two days earlier is cancelling a job, not revoking
    // consent. Both go on the list, because the cost of being wrong the other way is a
    // TCPA complaint, but they are labelled differently so a person can read the
    // ambiguous ones.
    const bare = b === k || b.replace(k, '').trim().length <= 2
    return { kind: bare ? 'hard' : 'ambiguous', keyword: k }
  }

  for (const k of SOFT_KEYWORDS) {
    if (b === k) return { kind: 'soft', keyword: k }
  }
  return { kind: 'none', keyword: null }
}

// -- helpers ----------------------------------------------------------------
async function twilio(url: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { Authorization: auth } })
    if (res.status === 429) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue }
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return await res.json() as Record<string, unknown>
  }
  throw new Error('Twilio rate limited after 4 attempts')
}

interface Msg {
  sid: string
  direction: string
  from: string
  to: string
  body: string
  status: string
  error_code: string | null
  error_message: string | null
  date: string
}

function toMsg(m: Record<string, unknown>): Msg {
  return {
    sid: String(m.sid),
    direction: String(m.direction),
    from: String(m.from ?? ''),
    to: String(m.to ?? ''),
    body: String(m.body ?? ''),
    status: String(m.status),
    error_code: m.error_code == null ? null : String(m.error_code),
    error_message: m.error_message == null ? null : String(m.error_message),
    date: String(m.date_sent ?? m.date_created ?? ''),
  }
}

/** Every message matching a filter, paged to the end. */
async function allMessages(query: string, label: string): Promise<Msg[]> {
  const out: Msg[] = []
  let url: string | null = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json?${query}&PageSize=1000`
  let pages = 0
  while (url && pages < 60) {
    const page: Record<string, unknown> = await twilio(url)
    const msgs = (page.messages ?? []) as Array<Record<string, unknown>>
    out.push(...msgs.map(toMsg))
    const next = page.next_page_uri as string | null | undefined
    url = next ? `https://api.twilio.com${next}` : null
    pages++
  }
  if (pages >= 60) console.log(`    WARNING: ${label} hit the 60-page cap - the export may be incomplete`)
  return out
}

async function supabase(pathQuery: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SUPA}/rest/v1/${pathQuery}`, {
      headers: { ...SUPA_H, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
    })
    if (!res.ok) {
      console.log(`    ${pathQuery.split('?')[0]}: ${res.status} ${(await res.text()).slice(0, 120)}`)
      return out
    }
    const page = await res.json() as Record<string, unknown>[]
    out.push(...page)
    if (page.length < 1000) return out
  }
}

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csv = (rows: Array<Record<string, unknown>>, columns: string[]): string =>
  [columns.join(','), ...rows.map(r => columns.map(c => csvCell(r[c])).join(','))].join('\n') + '\n'

// ISO date, so a spreadsheet sorts it correctly. Twilio returns RFC 2822.
const iso = (d: string): string => {
  const t = Date.parse(d)
  return Number.isFinite(t) ? new Date(t).toISOString() : d
}

async function main() {
  console.log('\nEXPORT DIRECTORY OUTREACH  (read only; writes two CSV files)')
  console.log('='.repeat(100))

  // ---------------------------------------------------------------- Twilio
  const numbers = ((await twilio(
    `https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json?PageSize=100`,
  )).incoming_phone_numbers as Array<Record<string, unknown>>).map(n => String(n.phone_number))

  console.log(`\n  pulling from ${numbers.length} owned numbers`)

  const outbound: Msg[] = []
  const inbound: Msg[] = []
  for (const num of numbers) {
    const sent = await allMessages(`From=${encodeURIComponent(num)}`, `outbound ${num}`)
    const got  = await allMessages(`To=${encodeURIComponent(num)}`, `inbound ${num}`)
    outbound.push(...sent)
    inbound.push(...got.filter(m => m.direction.startsWith('inbound')))
    console.log(`    ${num.padEnd(16)} ${String(sent.length).padStart(5)} sent  ${String(got.filter(m => m.direction.startsWith('inbound')).length).padStart(4)} received  ${ON_10DLC.has(num) ? '[on campaign CJN9JRM]' : '[NOT on a registered A2P campaign]'}`)
  }

  // ------------------------------------------------------------ messaged.csv
  // One row per number per send, so a number texted three times shows three rows and
  // the history is auditable. A summary of first/last/attempts rides alongside.
  const byNumber = new Map<string, Msg[]>()
  for (const m of outbound) {
    if (!m.to) continue
    byNumber.set(m.to, [...(byNumber.get(m.to) ?? []), m])
  }

  // Test traffic is not a contact. 555 numbers, our own Twilio numbers texting each
  // other, and anything that is not E.164 are MARKED rather than dropped - the row
  // stays auditable, but nobody mistakes it for a prospect to call.
  const OWN_NUMBERS = new Set(numbers)
  function looksLikeTest(phone: string): string {
    const digits = phone.replace(/[^0-9]/g, '').replace(/^1/, '')
    if (OWN_NUMBERS.has(phone)) return 'our-own-number'
    if (/^5{3}5{3}5{4}/.test(digits)) return '555-test-number'
    if (!/^\+[1-9][0-9]{9,14}$/.test(phone)) return 'not-e164'
    return ''
  }

  const messagedRows = [...byNumber.entries()]
    .map(([phone, msgs]) => {
      const sorted = [...msgs].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
      const last = sorted[sorted.length - 1]
      const errored = sorted.filter(m => m.error_code)
      return {
        phone,
        first_sent:   iso(sorted[0].date),
        last_sent:    iso(last.date),
        times_sent:   sorted.length,
        last_status:  last.status,
        last_error_code:    last.error_code ?? '',
        last_error_message: last.error_message ?? '',
        every_error_code:   [...new Set(errored.map(m => m.error_code))].join(' '),
        senders:      [...new Set(sorted.map(m => m.from))].join(' '),
        on_10dlc_campaign: sorted.some(m => ON_10DLC.has(m.from)) ? 'yes' : 'no',
        looks_like_test: looksLikeTest(phone),
      }
    })
    .sort((a, b) => a.phone.localeCompare(b.phone))

  // -------------------------------------------------- do-not-contact.csv
  const dnc = new Map<string, { reasons: Set<string>; evidence: string[]; when: string }>()
  function flag(phone: string, reason: string, evidence: string, when: string) {
    const cur = dnc.get(phone) ?? { reasons: new Set<string>(), evidence: [], when }
    cur.reasons.add(reason)
    cur.evidence.push(evidence)
    if (Date.parse(when) < Date.parse(cur.when)) cur.when = when
    dnc.set(phone, cur)
  }

  // 1. Carrier-level opt-out. 21610 is "message cannot be sent to an unsubscribed
  //    recipient" - Twilio refused the send BECAUSE the number had already opted out.
  for (const m of outbound) {
    if (m.error_code === '21610') {
      flag(m.to, 'twilio_21610_unsubscribed', `${iso(m.date)} send refused: ${m.error_message ?? '21610'}`, iso(m.date))
    }
  }

  // 2. A reply containing an opt-out keyword.
  let boilerplateSkipped = 0
  for (const m of inbound) {
    if (isBoilerplate(m.body)) { boilerplateSkipped++; continue }
    const { kind, keyword } = optOutReason(m.body)
    if (kind === 'none') continue
    const reason =
      kind === 'hard'      ? 'replied_stop_bare_keyword'
      : kind === 'ambiguous' ? 'replied_keyword_in_sentence_READ_THIS'
      : 'replied_no_soft_match'
    flag(
      m.from,
      reason,
      `${iso(m.date)} replied "${m.body.slice(0, 70).replace(/\s+/g, ' ')}" (matched "${keyword}")`,
      iso(m.date),
    )
  }
  console.log(`\n  inbound messages that were Twilio auto-reply boilerplate, not opt-outs: ${boilerplateSkipped}`)

  // --------------------------------------------------------- the app's records
  console.log('\n  THE APP\'S OWN RECORDS')
  const ldOptouts   = await supabase('directory_optouts?select=phone,opted_out_at')
  const hdOptouts   = await supabase('hd_directory_optouts?select=phone,opted_out_at')
  const ldProspects = await supabase('directory_prospects?select=phone,status,contacted_at,responded_at')
  const hdProspects = await supabase('hd_directory_prospects?select=phone,status,contacted_at,responded_at')

  console.log(`    directory_optouts ......... ${ldOptouts.length}`)
  console.log(`    hd_directory_optouts ...... ${hdOptouts.length}`)
  console.log(`    directory_prospects ....... ${ldProspects.length}`)
  console.log(`    hd_directory_prospects .... ${hdProspects.length}`)

  const appOptoutPhones = new Set<string>([
    ...ldOptouts.map(r => String(r.phone)),
    ...hdOptouts.map(r => String(r.phone)),
    ...ldProspects.filter(r => r.status === 'optout').map(r => String(r.phone)),
    ...hdProspects.filter(r => r.status === 'optout').map(r => String(r.phone)),
  ])
  // "Contacted" means contacted_at IS SET, not "status is not pending".
  //
  // The looser test reported 740 numbers as contacted-with-no-send. They are
  // hd_directory_prospects rows with status 'yes' and contacted_at NULL, every one
  // created on 2026-08-11 - never texted at all. Counting a status as evidence of a
  // send turned a seeding artifact into 740 phantom discrepancies. The timestamp is
  // the only field that claims a message went out, so it is the one used.
  const appContactedPhones = new Set<string>([
    ...ldProspects.filter(r => r.contacted_at).map(r => String(r.phone)),
    ...hdProspects.filter(r => r.contacted_at).map(r => String(r.phone)),
  ])
  const markedYesNeverContacted = [
    ...ldProspects.filter(r => r.status === 'yes' && !r.contacted_at).map(r => String(r.phone)),
    ...hdProspects.filter(r => r.status === 'yes' && !r.contacted_at).map(r => String(r.phone)),
  ]

  // 3. Anything the app already considers opted out belongs on the list too.
  for (const phone of appOptoutPhones) {
    const row = [...ldOptouts, ...hdOptouts].find(r => String(r.phone) === phone)
    flag(phone, 'app_database_optout', `recorded in the app${row?.opted_out_at ? ` at ${iso(String(row.opted_out_at))}` : ''}`,
      row?.opted_out_at ? iso(String(row.opted_out_at)) : new Date().toISOString())
  }

  const dncRows = [...dnc.entries()]
    .map(([phone, v]) => ({
      phone,
      opted_out_at: v.when,
      reasons: [...v.reasons].sort().join(' '),
      evidence: v.evidence.join(' | '),
      we_texted_them: byNumber.has(phone) ? 'yes' : 'no',
      times_texted: byNumber.get(phone)?.length ?? 0,
    }))
    .sort((a, b) => a.phone.localeCompare(b.phone))

  // ---------------------------------------------------------------- write
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const messagedPath = path.join(OUT_DIR, 'messaged.csv')
  const dncPath = path.join(OUT_DIR, 'do-not-contact.csv')
  fs.writeFileSync(messagedPath, csv(messagedRows, [
    'phone', 'first_sent', 'last_sent', 'times_sent', 'last_status',
    'last_error_code', 'last_error_message', 'every_error_code', 'senders', 'on_10dlc_campaign',
    'looks_like_test',
  ]))
  fs.writeFileSync(dncPath, csv(dncRows, [
    'phone', 'opted_out_at', 'reasons', 'evidence', 'we_texted_them', 'times_texted',
  ]))

  console.log(`\n  WROTE`)
  console.log(`    ${messagedPath}  ${messagedRows.length} numbers, ${outbound.length} sends`)
  console.log(`    ${dncPath}  ${dncRows.length} numbers`)

  // ------------------------------------------------------------ reconcile
  console.log('\n  STATUS BREAKDOWN (every send)')
  const statuses = new Map<string, number>()
  outbound.forEach(m => statuses.set(m.status, (statuses.get(m.status) ?? 0) + 1))
  for (const [s, n] of [...statuses].sort((a, b) => b[1] - a[1])) console.log(`    ${s.padEnd(14)} ${n}`)

  console.log('\n  ERROR CODES (every send that carried one)')
  const errors = new Map<string, number>()
  outbound.filter(m => m.error_code).forEach(m => errors.set(m.error_code!, (errors.get(m.error_code!) ?? 0) + 1))
  if (!errors.size) console.log('    none')
  for (const [c, n] of [...errors].sort((a, b) => b[1] - a[1])) {
    const sample = outbound.find(m => m.error_code === c)
    console.log(`    ${c.padEnd(8)} ${String(n).padStart(5)}  ${sample?.error_message ?? ''}`)
  }

  console.log('\n  DO THE TWO SOURCES AGREE?')
  const twilioOptouts = new Set(dncRows.filter(r => !r.reasons.includes('app_database_optout')).map(r => r.phone))
  const twilioTexted = new Set(byNumber.keys())

  const inTwilioNotApp = [...dnc.keys()].filter(p => !appOptoutPhones.has(p))
  const inAppNotTwilio = [...appOptoutPhones].filter(p => {
    const v = dnc.get(p)
    if (!v) return true
    // Only app evidence, nothing from Twilio.
    return [...v.reasons].every(r => r === 'app_database_optout')
  })

  console.log(`\n    opt-outs the APP does not know about (${inTwilioNotApp.length}):`)
  if (!inTwilioNotApp.length) console.log('      none - the app has every opt-out Twilio shows')
  for (const p of inTwilioNotApp.sort()) {
    console.log(`      ${p.padEnd(16)} ${[...(dnc.get(p)?.reasons ?? [])].join(' ')}  ${(dnc.get(p)?.evidence[0] ?? '').slice(0, 76)}`)
  }

  console.log(`\n    opt-outs only the APP knows about, with nothing in Twilio (${inAppNotTwilio.length}):`)
  if (!inAppNotTwilio.length) console.log('      none')
  for (const p of inAppNotTwilio.sort()) {
    const texted = twilioTexted.has(p)
    console.log(`      ${p.padEnd(16)} ${texted ? 'we did text this number' : 'NO Twilio record of ever texting it'}`)
  }

  const textedNotInApp = [...twilioTexted].filter(p => !appContactedPhones.has(p))
  console.log(`\n    numbers Twilio says we texted that the app has no prospect row for (${textedNotInApp.length}):`)
  if (!textedNotInApp.length) console.log('      none')
  textedNotInApp.sort().slice(0, 40).forEach(p => {
    const msgs = byNumber.get(p)!
    console.log(`      ${p.padEnd(16)} ${msgs.length} send(s), first ${iso(msgs[0].date).slice(0, 10)}, from ${[...new Set(msgs.map(m => m.from))].join(' ')}`)
  })
  if (textedNotInApp.length > 40) console.log(`      ...and ${textedNotInApp.length - 40} more`)

  const appContactedNotTexted = [...appContactedPhones].filter(p => !twilioTexted.has(p))
  console.log(`\n    numbers the app marks as contacted that Twilio has no send for (${appContactedNotTexted.length}):`)
  if (!appContactedNotTexted.length) console.log('      none')
  appContactedNotTexted.sort().slice(0, 40).forEach(p => console.log(`      ${p}`))
  if (appContactedNotTexted.length > 40) console.log(`      ...and ${appContactedNotTexted.length - 40} more`)

  console.log(`\n    prospects marked 'yes' that were NEVER contacted (${markedYesNeverContacted.length}):`)
  console.log('      contacted_at is NULL on every one, so nothing was ever sent to them.')
  console.log('      Correctly absent from messaged.csv - but the app is reporting them as')
  console.log('      having agreed to be listed with no outreach record behind it.')
  markedYesNeverContacted.slice(0, 10).forEach(p => console.log(`      ${p}`))
  if (markedYesNeverContacted.length > 10) {
    console.log(`      ...and ${markedYesNeverContacted.length - 10} more`)
  }

  console.log(`\n  SUMMARY`)
  console.log(`    numbers ever texted .......................... ${twilioTexted.size}`)
  console.log(`    sends in total ............................... ${outbound.length}`)
  console.log(`    replies received ............................. ${inbound.length}`)
  console.log(`    on the do-not-contact list ................... ${dncRows.length}`)
  console.log(`      from a 21610 refusal ....................... ${dncRows.filter(r => r.reasons.includes('twilio_21610_unsubscribed')).length}`)
  console.log(`      from a keyword reply ....................... ${dncRows.filter(r => r.reasons.includes('replied_stop_bare_keyword')).length}`)
  console.log(`      from a bare "no" ........................... ${dncRows.filter(r => r.reasons.includes('replied_no_soft_match')).length}`)
  console.log(`      keyword inside a sentence, NEEDS A HUMAN READ .. ${dncRows.filter(r => r.reasons.includes('READ_THIS')).length}`)
  console.log(`      from the app's own record .................. ${dncRows.filter(r => r.reasons.includes('app_database_optout')).length}`)
  console.log(`    sent WITHOUT a registered 10DLC campaign ..... ${outbound.filter(m => !ON_10DLC.has(m.from)).length}`)
  void twilioOptouts

  console.log(`\n${'='.repeat(100)}\n`)
}

main().catch(e => { console.error(e); process.exitCode = 1 })
