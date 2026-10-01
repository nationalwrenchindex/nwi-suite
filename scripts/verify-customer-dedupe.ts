// Verification for the POST /api/customers dedupe.
//
// Exercises the REAL matcher against production. It creates a few tagged customers to
// match against and deletes every one of them, pass or fail.
//
//   npx tsx scripts/verify-customer-dedupe.ts

import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { findDuplicateCustomer } from '../src/lib/customers/dedupe'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) pass++; else fail++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`)
}

async function main() {
  const { data: prof } = await supabase.from('profiles').select('id').limit(2)
  const userA = prof![0].id as string
  const userB = (prof![1]?.id ?? prof![0].id) as string
  const TAG = `zzdedupe${Date.now()}`
  const made: string[] = []

  async function seed(row: Record<string, unknown>) {
    const { data, error } = await supabase.from('customers').insert(row).select('id').single()
    if (error) throw new Error(error.message)
    made.push(data!.id as string)
    return data!.id as string
  }

  try {
    console.log('='.repeat(78))
    console.log('Seeding customers to match against')
    console.log('='.repeat(78))

    const withPhone = await seed({
      user_id: userA, first_name: TAG, last_name: 'Phone',
      phone: '(863) 555-0100', email: null,
    })
    const withEmail = await seed({
      user_id: userA, first_name: TAG, last_name: 'Email',
      phone: null, email: `${TAG}@Example.COM`,
    })
    const noContact = await seed({
      user_id: userA, first_name: TAG, last_name: 'Bare',
      phone: null, email: null,
    })
    console.log(`  phone row ${withPhone.slice(0, 8)}  email row ${withEmail.slice(0, 8)}  bare row ${noContact.slice(0, 8)}`)

    console.log('\n' + '='.repeat(78))
    console.log('Matching')
    console.log('='.repeat(78))

    // Phone, differently formatted — the case exact equality missed.
    let hit = await findDuplicateCustomer(supabase, userA, { first_name: 'Someone', last_name: 'Else', phone: '+1 863 555 0100' })
    ok(hit?.id === withPhone && hit?.reason === 'phone', `"+1 863 555 0100" matches "(863) 555-0100" on the trailing ten digits`)

    // Email, different case.
    hit = await findDuplicateCustomer(supabase, userA, { first_name: 'Someone', last_name: 'Else', email: `${TAG}@example.com` })
    ok(hit?.id === withEmail && hit?.reason === 'email', 'email matches case-insensitively')

    // Same name, neither side has contact details — the Josh Johnston case.
    hit = await findDuplicateCustomer(supabase, userA, { first_name: TAG, last_name: 'Bare' })
    ok(hit?.id === noContact && hit?.reason === 'name_no_contact', 'same name with no contact details on either side matches')

    // ── The cases that must NOT match ──
    hit = await findDuplicateCustomer(supabase, userA, { first_name: TAG, last_name: 'Bare', phone: '863-555-9999' })
    ok(hit === null, 'same name but a NEW phone does not match the contactless row — plausibly a different person')

    hit = await findDuplicateCustomer(supabase, userA, { first_name: TAG, last_name: 'Phone', phone: '863-555-0101' })
    ok(hit === null, 'a different phone number does not match')

    hit = await findDuplicateCustomer(supabase, userA, { first_name: 'Totally', last_name: 'Unknown' })
    ok(hit === null, 'an unknown name with no contact details does not match anything')

    // Cross-shop isolation: the whole reason three shops can each hold Brock Fleeman.
    if (userB !== userA) {
      hit = await findDuplicateCustomer(supabase, userB, { first_name: TAG, last_name: 'Phone', phone: '(863) 555-0100' })
      ok(hit === null, "another shop's identical customer is NOT a duplicate — customers are per-shop")
    } else {
      console.log('  (only one profile available; cross-shop isolation not exercised)')
    }

    // LIKE metacharacter guard.
    const underscore = await seed({
      user_id: userA, first_name: TAG, last_name: 'Underscore',
      phone: null, email: `a_b${TAG}@example.com`,
    })
    hit = await findDuplicateCustomer(supabase, userA, { first_name: 'x', last_name: 'y', email: `aXb${TAG}@example.com` })
    ok(hit === null, '"a_b@..." does not match "aXb@..." — the LIKE wildcard is escaped')
    hit = await findDuplicateCustomer(supabase, userA, { first_name: 'x', last_name: 'y', email: `a_b${TAG}@example.com` })
    ok(hit?.id === underscore, 'the literal underscore address still matches itself')

    ok(made.length === 4, `4 rows seeded (guards a vacuous pass: ${made.length})`)
  } finally {
    for (const id of made) {
      await supabase.from('customers').delete().eq('id', id)
    }
    const { data: left } = await supabase.from('customers').select('id').in('id', made.length ? made : ['00000000-0000-0000-0000-000000000000'])
    ok((left ?? []).length === 0, `all ${made.length} seeded rows deleted from production`)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
}

main().catch(e => { console.error('FAILED:', e.message); process.exitCode = 1 })
