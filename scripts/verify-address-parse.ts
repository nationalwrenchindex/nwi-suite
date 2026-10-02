// Phase 2c: the address parser left the city in line 1.
//
// Exercises the REAL parser against the five shapes that were specified plus every
// address actually stored in production. Read-only.
//
//   npx tsx scripts/verify-address-parse.ts

import fs from 'fs'
import { parseAddress } from '../src/lib/hd/address-parse'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const U = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) pass++; else fail++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}
const show = (p: ReturnType<typeof parseAddress>) =>
  `L1="${p.address_line1 ?? ''}" L2="${p.address_line2 ?? ''}" city="${p.city ?? ''}" ${p.state ?? ''} ${p.zip ?? ''}`

async function main() {
  console.log('='.repeat(78))
  console.log('The five specified shapes')
  console.log('='.repeat(78))

  const cases: Array<{ input: string; want: Partial<ReturnType<typeof parseAddress>>; why: string }> = [
    {
      input: '2140 Fiddlers Ct, Apt B, Winston-Salem, NC 27107',
      want: { address_line1: '2140 Fiddlers Ct', address_line2: 'Apt B', city: 'Winston-Salem', state: 'NC', zip: '27107' },
      why: 'fully comma separated',
    },
    {
      input: '2140 Fiddlers Ct Apt B Winston-Salem NC 27107',
      want: { address_line1: '2140 Fiddlers Ct', address_line2: 'Apt B', city: 'Winston-Salem', state: 'NC', zip: '27107' },
      why: 'no commas at all — the shape that broke',
    },
    {
      input: '1234 Main St',
      want: { address_line1: '1234 Main St', city: null, state: null, zip: null },
      why: 'no state or zip — nothing is guessed',
    },
    {
      input: 'Winston-Salem, NC 27107',
      want: { address_line1: null, city: 'Winston-Salem', state: 'NC', zip: '27107' },
      why: 'no street — the city must NOT land in line 1',
    },
    {
      input: '6174 Haywood St, Clemmons, NC 2701',
      want: { address_line1: '6174 Haywood St, Clemmons, NC 2701', city: null, state: null, zip: null },
      why: 'four-digit zip — do not guess, hand it all back',
    },
    {
      // The actual production string.
      input: '2140 Fiddlers CT. APT B. Winston-Salem, NC 27107',
      want: { city: 'Winston-Salem', state: 'NC', zip: '27107' },
      why: 'period separated, as really typed by a tech',
    },
  ]

  for (const c of cases) {
    const got = parseAddress(c.input)
    console.log(`\n  "${c.input}"`)
    console.log(`    ${show(got)}`)
    for (const [k, v] of Object.entries(c.want)) {
      const actual = (got as unknown as Record<string, unknown>)[k]
      ok(actual === v, `${c.why} → ${k} = ${JSON.stringify(actual)} (wanted ${JSON.stringify(v)})`)
    }
    // The rule that matters most: a city must never be left sitting inside line 1.
    if (got.city) {
      ok(!String(got.address_line1 ?? '').toLowerCase().includes(String(got.city).toLowerCase()),
        `${c.why} → the city is not duplicated inside line 1`)
    }
  }

  console.log('\n' + '='.repeat(78))
  console.log('Every address stored in production, re-parsed from its own one-line form')
  console.log('='.repeat(78))
  const H = { apikey: K, Authorization: `Bearer ${K}` }
  const rows = await (await fetch(
    `${U}/rest/v1/customers?select=first_name,last_name,address_line1,address_line2,city,state,zip&address_line1=not.is.null`,
    { headers: H },
  )).json()

  let duplicatedCity = 0
  for (const r of rows) {
    // PARSE WHAT THE TECH ACTUALLY TYPED. Where address_line1 already contains its own
    // state and zip, that line IS the raw paste -- the parse never ran on it, or ran
    // and gave up. Reconstructing a one-line from the stored fields in that case
    // produces a doubled address nobody ever typed, which is a fabricated input.
    const line1HasOwnStateZip = /\b[A-Za-z]{2}\s+\d{5}(-\d{4})?\s*$/.test(String(r.address_line1 ?? ''))
    const oneLine = line1HasOwnStateZip
      ? String(r.address_line1)
      : [r.address_line1, r.address_line2, r.city, [r.state, r.zip].filter(Boolean).join(' ')]
          .filter(Boolean).join(', ')
    const got = parseAddress(oneLine)
    const storedCityInLine1 = r.city && String(r.address_line1 ?? '').toLowerCase().includes(String(r.city).toLowerCase())
    if (storedCityInLine1) duplicatedCity++
    console.log(`\n  ${(r.first_name + ' ' + r.last_name).trim()}`)
    console.log(`    stored : L1="${r.address_line1 ?? ''}" city="${r.city ?? ''}" ${r.state ?? ''} ${r.zip ?? ''}${storedCityInLine1 ? '   <-- city ALSO sitting in line 1' : ''}`)
    console.log(`    parsed : ${show(got)}`)
    if (got.city) {
      ok(!String(got.address_line1 ?? '').toLowerCase().includes(String(got.city).toLowerCase()),
        `${(r.first_name + ' ' + r.last_name).trim()}: re-parse does not leave the city in line 1`)
    }
  }
  console.log(`\n  stored rows that currently have the city duplicated into line 1: ${duplicatedCity} of ${rows.length}`)
  ok(rows.length > 0, `production had addresses to test against (${rows.length}) — guards a vacuous pass`)

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
