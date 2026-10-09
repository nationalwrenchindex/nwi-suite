// Which of the four numbers is the 10DLC outreach sender?
//
// READ ONLY. The account has four SMS-capable numbers and three messaging services, and
// the newest message on the account was sent from a number that is NOT
// TWILIO_PHONE_NUMBER. Assuming one sender would quietly drop whole campaigns from the
// export - and from the do-not-contact list, which is the half that matters.
//
// A 10DLC campaign is attached to a messaging service, so this reads the senders of
// each service and then counts outbound traffic per number.

import { loadEnv } from './lib/smoke-session'

loadEnv()
const SID   = process.env.TWILIO_ACCOUNT_SID!
const TOKEN = process.env.TWILIO_AUTH_TOKEN!
const auth  = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64')

async function get(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Authorization: auth } })
  if (!res.ok) return { __status: res.status, __body: (await res.text()).slice(0, 200) }
  return await res.json() as Record<string, unknown>
}

async function main() {
  console.log('\nWHICH NUMBER IS THE 10DLC OUTREACH SENDER?  (read only)')
  console.log('='.repeat(100))

  const svcs = await get('https://messaging.twilio.com/v1/Services?PageSize=50')
  const services = (svcs.services ?? []) as Array<Record<string, unknown>>

  console.log('\n  MESSAGING SERVICES AND THEIR SENDERS')
  for (const s of services) {
    console.log(`\n    ${s.sid}  ${s.friendly_name}`)
    const senders = await get(`https://messaging.twilio.com/v1/Services/${s.sid}/PhoneNumbers?PageSize=50`)
    const nums = (senders.phone_numbers ?? []) as Array<Record<string, unknown>>
    if (!nums.length) console.log('      (no phone numbers attached)')
    for (const n of nums) console.log(`      ${n.phone_number}`)

    // The A2P registration tells us which service carries the 10DLC campaign.
    const us = await get(`https://messaging.twilio.com/v1/Services/${s.sid}/Compliance/Usa2p?PageSize=20`)
    const regs = (us.compliance ?? us.us_app_to_person ?? []) as Array<Record<string, unknown>>
    if (Array.isArray(regs) && regs.length) {
      for (const r of regs) {
        console.log(`      A2P: campaign ${r.campaign_id ?? r.sid} status ${r.campaign_status ?? '?'} use case ${r.us_app_to_person_usecase ?? '?'}`)
      }
    } else if (us.__status) {
      console.log(`      A2P: could not read (${us.__status})`)
    } else {
      console.log('      A2P: no registration on this service')
    }
  }

  // Outbound traffic per number, and the date span. Counted by paging, because the
  // Messages list resource does not return a total.
  console.log('\n  OUTBOUND TRAFFIC PER NUMBER')
  const numsRes = await get(`https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json?PageSize=100`)
  const owned = ((numsRes.incoming_phone_numbers ?? []) as Array<Record<string, unknown>>)
    .map(n => String(n.phone_number))

  for (const num of owned) {
    let count = 0
    let oldest: string | null = null
    let newest: string | null = null
    let url: string | null = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json?From=${encodeURIComponent(num)}&PageSize=1000`
    let pages = 0
    while (url && pages < 30) {
      const page: Record<string, unknown> = await get(url)
      const msgs = (page.messages ?? []) as Array<Record<string, unknown>>
      for (const m of msgs) {
        count++
        const d = String(m.date_sent ?? m.date_created)
        if (!newest) newest = d
        oldest = d
      }
      const next = page.next_page_uri as string | null | undefined
      url = next ? `https://api.twilio.com${next}` : null
      pages++
    }
    console.log(`    ${num.padEnd(16)} ${String(count).padStart(5)} sent   ${oldest ?? '-'}  ..  ${newest ?? '-'}`)
  }

  console.log(`\n${'='.repeat(100)}\n`)
}

main().catch(e => { console.error(e); process.exitCode = 1 })
