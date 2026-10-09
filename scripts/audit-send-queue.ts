// What was queued to be texted, and what the retry loop would have done next.
//
// READ ONLY. SELECTs and Twilio GETs. Nothing is written, nothing is deleted - the
// records ARE the defence if a complaint ever lands, so this only counts them.
//
// There is no queue table. The QUEUE IS THE PROSPECT LIST: the invite cron selected
// status='pending' every day at 13:00 UTC and texted the top 25 by rating. So "what is
// queued" means "how many rows would that query have returned tomorrow".

import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const SID   = process.env.TWILIO_ACCOUNT_SID!
const TOKEN = process.env.TWILIO_AUTH_TOKEN!
const auth  = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64')

async function all(q: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${S}/rest/v1/${q}`, { headers: { ...H, Range: `${f}-${f + 999}`, 'Range-Unit': 'items' } })
    if (!r.ok) { console.log(`    SELECT FAILED ${r.status}: ${(await r.text()).slice(0, 140)}`); return out }
    const p = await r.json() as Record<string, unknown>[]
    out.push(...p)
    if (p.length < 1000) return out
  }
}

async function main() {
  console.log('\nWHAT WAS QUEUED TO SEND  (read only - nothing is written or deleted)')
  console.log('='.repeat(100))

  for (const [label, table, batch] of [
    ['LD', 'directory_prospects', 25],
    ['HD', 'hd_directory_prospects', 25],
  ] as const) {
    const rows = await all(`${table}?select=phone,status,contacted_at,follow_up_sent_at,responded_at,rating`)
    const pending = rows.filter(r => r.status === 'pending')
    const contactedNoReply = rows.filter(r => r.status === 'contacted' && !r.responded_at && !r.follow_up_sent_at)

    console.log(`\n  ${label}  ${table}`)
    console.log(`    total rows ............................................ ${rows.length}`)
    console.log(`    status='pending'  <- THE INVITE QUEUE .................. ${pending.length}`)
    console.log(`    would have gone out on the next daily cron (top ${batch}) .. ${Math.min(batch, pending.length)}`)
    console.log(`    status='contacted', no reply, no follow-up yet`)
    console.log(`      <- THE FOLLOW-UP QUEUE .............................. ${contactedNoReply.length}`)
    const days = Math.ceil(pending.length / batch)
    console.log(`    at ${batch}/day the pending queue would have run for ....... ${days} more day(s)`)
  }

  // How many of the queued numbers had ALREADY been texted and failed? Those are the
  // retry loop: a permanent failure left pending, re-selected every day.
  console.log('\n  THE RETRY LOOP, MEASURED')
  const owned = ((await (await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json?PageSize=100`,
    { headers: { Authorization: auth } })).json()) as { incoming_phone_numbers: Array<Record<string, unknown>> })
    .incoming_phone_numbers.map(n => String(n.phone_number))

  const sendsPer = new Map<string, { total: number; errors: string[]; firstDate: string; lastDate: string }>()
  for (const num of owned) {
    let url: string | null = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json?From=${encodeURIComponent(num)}&PageSize=1000`
    let pages = 0
    while (url && pages < 30) {
      const page = await (await fetch(url, { headers: { Authorization: auth } })).json() as Record<string, unknown>
      for (const m of (page.messages ?? []) as Array<Record<string, unknown>>) {
        const to = String(m.to)
        const cur = sendsPer.get(to) ?? { total: 0, errors: [], firstDate: '', lastDate: String(m.date_sent ?? '') }
        cur.total++
        if (m.error_code) cur.errors.push(String(m.error_code))
        cur.firstDate = String(m.date_sent ?? m.date_created ?? '')
        sendsPer.set(to, cur)
      }
      const next = page.next_page_uri as string | null | undefined
      url = next ? `https://api.twilio.com${next}` : null
      pages++
    }
  }

  const repeat = [...sendsPer.entries()]
    .filter(([, v]) => v.total >= 5)
    .sort((a, b) => b[1].total - a[1].total)

  console.log(`\n    numbers texted 5 or more times (${repeat.length}):\n`)
  console.log(`      ${'number'.padEnd(16)} ${'sends'.padStart(5)}  error codes seen`)
  for (const [phone, v] of repeat.slice(0, 20)) {
    const codes = [...new Set(v.errors)].join(' ') || '(none)'
    console.log(`      ${phone.padEnd(16)} ${String(v.total).padStart(5)}  ${codes}`)
  }

  // Of those, how many were still 'pending' - i.e. still in tomorrow's batch?
  const ld = await all('directory_prospects?select=phone,status')
  const hd = await all('hd_directory_prospects?select=phone,status')
  const stillPending = new Set([...ld, ...hd].filter(r => r.status === 'pending').map(r => String(r.phone)))
  const loopVictims = repeat.filter(([p]) => stillPending.has(p))

  console.log(`\n    of those, STILL status='pending' and so still in the next batch: ${loopVictims.length}`)
  loopVictims.slice(0, 20).forEach(([p, v]) =>
    console.log(`      ${p.padEnd(16)} ${String(v.total).padStart(4)} sends, codes ${[...new Set(v.errors)].join(' ') || '(none)'}`))

  // And the clearest proof of the missing opt-out check: numbers with a 21610.
  const refused = [...sendsPer.entries()].filter(([, v]) => v.errors.includes('21610'))
  console.log(`\n    numbers Twilio REFUSED with 21610 (already unsubscribed): ${refused.length}`)
  refused.sort((a, b) => b[1].total - a[1].total).slice(0, 12).forEach(([p, v]) => {
    const n21610 = v.errors.filter(c => c === '21610').length
    console.log(`      ${p.padEnd(16)} ${String(v.total).padStart(3)} sends total, ${n21610} refused after the opt-out`)
  })

  console.log('\n  NOTHING IN THIS SCRIPT WROTE OR DELETED ANYTHING.')
  console.log(`\n${'='.repeat(100)}\n`)
}

main().catch(e => { console.error(e); process.exitCode = 1 })
