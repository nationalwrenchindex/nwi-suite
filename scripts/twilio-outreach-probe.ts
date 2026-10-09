// What is actually in the Twilio account, before exporting anything.
//
// READ ONLY. Every request below is a GET. Nothing is sent, nothing is deleted.
//
// Run first because the export depends on facts I should not assume: whether the
// credentials work, which numbers the account owns, which of them is the 10DLC
// outreach number, and how many messages there are to page through.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const SID   = process.env.TWILIO_ACCOUNT_SID
const TOKEN = process.env.TWILIO_AUTH_TOKEN
const FROM  = process.env.TWILIO_PHONE_NUMBER

const auth = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64')
const API = 'https://api.twilio.com/2010-04-01'

async function get(path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(path.startsWith('http') ? path : `${API}/Accounts/${SID}${path}`, {
    headers: { Authorization: auth },
  })
  const json = await res.json().catch(() => ({})) as Record<string, unknown>
  return { status: res.status, json }
}

async function main() {
  console.log('\nTWILIO OUTREACH PROBE  (read only)')
  console.log('='.repeat(96))

  if (!SID || !TOKEN) {
    console.log('  TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN are not both set. Stopping.')
    process.exitCode = 1
    return
  }
  console.log(`  account sid ......... ${SID.slice(0, 6)}...${SID.slice(-4)}`)
  console.log(`  TWILIO_PHONE_NUMBER . ${FROM ?? '(not set)'}`)

  const acct = await get('.json')
  if (acct.status !== 200) {
    console.log(`\n  AUTH FAILED -> ${acct.status} ${JSON.stringify(acct.json).slice(0, 200)}`)
    process.exitCode = 1
    return
  }
  console.log(`  account status ...... ${acct.json.status} (${acct.json.type})`)
  console.log(`  friendly name ....... ${acct.json.friendly_name}`)

  // Which numbers does the account own? The export must cover the right one, and
  // "our 10DLC number" may not be the only one the account has sent from.
  const nums = await get('/IncomingPhoneNumbers.json?PageSize=100')
  const list = (nums.json.incoming_phone_numbers ?? []) as Array<Record<string, unknown>>
  console.log(`\n  PHONE NUMBERS ON THE ACCOUNT (${list.length})`)
  for (const n of list) {
    const cap = n.capabilities as Record<string, unknown> | undefined
    console.log(`    ${String(n.phone_number).padEnd(16)} ${String(n.friendly_name ?? '').slice(0, 34).padEnd(34)} sms=${cap?.sms ? 'y' : 'n'}`)
  }
  if (FROM && !list.some(n => n.phone_number === FROM)) {
    console.log(`    NOTE: ${FROM} is not in this list. It may be a messaging-service sender or released.`)
  }

  // Messaging services and their senders - a 10DLC campaign usually sends through one,
  // in which case messages carry a messaging_service_sid rather than just a From.
  const svcs = await get('https://messaging.twilio.com/v1/Services?PageSize=50')
  const services = (svcs.json.services ?? []) as Array<Record<string, unknown>>
  console.log(`\n  MESSAGING SERVICES (${services.length})`)
  for (const s of services) {
    console.log(`    ${String(s.sid)}  ${String(s.friendly_name ?? '')}`)
  }

  // How much history is there? PageSize=1 returns the first page cheaply; the total is
  // not in the response, so this counts by paging in the export instead. Here we just
  // look at the newest and oldest to know the span.
  const newest = await get('/Messages.json?PageSize=1')
  const firstPage = (newest.json.messages ?? []) as Array<Record<string, unknown>>
  console.log(`\n  MESSAGE HISTORY`)
  if (!firstPage.length) {
    console.log('    no messages on the account at all')
  } else {
    const m = firstPage[0]
    console.log(`    newest: ${m.date_sent ?? m.date_created}  ${m.direction}  from ${m.from} to ${m.to}  status ${m.status}`)
  }

  // Sent FROM our number specifically.
  if (FROM) {
    const out = await get(`/Messages.json?From=${encodeURIComponent(FROM)}&PageSize=1`)
    const o = ((out.json.messages ?? []) as Array<Record<string, unknown>>)[0]
    console.log(`    newest sent FROM ${FROM}: ${o ? `${o.date_sent ?? o.date_created} to ${o.to} (${o.status})` : 'none'}`)

    const inb = await get(`/Messages.json?To=${encodeURIComponent(FROM)}&PageSize=1`)
    const i = ((inb.json.messages ?? []) as Array<Record<string, unknown>>)[0]
    console.log(`    newest received TO ${FROM}: ${i ? `${i.date_sent ?? i.date_created} from ${i.from}: "${String(i.body).slice(0, 40)}"` : 'none'}`)
  }

  console.log(`\n${'='.repeat(96)}\n`)
}

main().catch(e => { console.error(e); process.exitCode = 1 })
