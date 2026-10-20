// npx tsx scripts/verify-provision-session.ts
//
// /api/stripe/provision-session grants only what Stripe confirms
// (src/lib/provision-session.ts). Session shapes follow what
// stripe.checkout.sessions.retrieve(id, { expand: ['subscription'] }) returns: an open
// (unpaid) session has status 'open' and subscription null; a completed one has status
// 'complete' and the expanded subscription object.

import { decideProvision, type SessionFacts } from '../src/lib/provision-session'
import { subscriptionGrantsModule } from '../src/lib/subscription'

let failures = 0
let passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++
  else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}

const USER = 'user-1'
const SUB = { id: 'sub_1', status: 'active', current_period_end: 1_793_000_000, cancel_at_period_end: false }
const complete: SessionFacts = {
  mode: 'subscription', status: 'complete', customer: 'cus_1',
  metadata: { user_id: USER, tier: 'elite' }, subscription: SUB,
}

/** What the route would leave the user with: the row it writes, or nothing. */
function accessAfter(s: SessionFacts, module = 'scheduler'): boolean {
  const d = decideProvision(s, USER)
  return d.ok && subscriptionGrantsModule({ ...d.row, is_comped: false }, module)
}

console.log('\nAn unprovisionable session gets no access and no row')
const refusals: Array<[string, SessionFacts, number]> = [
  ['open checkout, never paid (the free-access path)', { ...complete, status: 'open', subscription: null }, 409],
  ['expired checkout', { ...complete, status: 'expired', subscription: null }, 409],
  ['complete but no subscription on it', { ...complete, subscription: null }, 409],
  ['complete but subscription only an id, not confirmed', { ...complete, subscription: 'sub_1' }, 409],
  ['subscription incomplete (first payment not made)', { ...complete, subscription: { ...SUB, status: 'incomplete' } }, 409],
  ['subscription incomplete_expired', { ...complete, subscription: { ...SUB, status: 'incomplete_expired' } }, 409],
  ['subscription canceled', { ...complete, subscription: { ...SUB, status: 'canceled' } }, 409],
  ['subscription past_due (left to the webhook)', { ...complete, subscription: { ...SUB, status: 'past_due' } }, 409],
  ['payment-mode session', { ...complete, mode: 'payment' }, 409],
  ['no customer', { ...complete, customer: null }, 409],
  ["another user's session", { ...complete, metadata: { user_id: 'someone-else', tier: 'elite' } }, 403],
  ['Payment Link session (no metadata)', { ...complete, metadata: null }, 403],
  ['unknown tier', { ...complete, metadata: { user_id: USER, tier: 'platinum' } }, 400],
]
for (const [name, s, code] of refusals) {
  const d = decideProvision(s, USER)
  check(`${name}: refused ${code}, nothing written, no access`,
    !d.ok && d.httpStatus === code && !accessAfter(s), d.ok ? 'GRANTED' : d.reason)
}
check("refusals never fall back to 'trialing'",
  refusals.every(([, s]) => { const d = decideProvision(s, USER); return !d.ok }))

console.log('\nA confirmed subscription still provisions immediately')
const ok = decideProvision(complete, USER)
check('complete + active: provisions with Stripe\'s status and subscription id',
  ok.ok && ok.row.status === 'active' && ok.row.stripe_subscription_id === 'sub_1' && ok.row.stripe_customer_id === 'cus_1', JSON.stringify(ok))
check('complete + active: access granted', accessAfter(complete))
const trial = { ...complete, metadata: { user_id: USER, tier: 'full_suite_plus' }, subscription: { ...SUB, status: 'trialing' } }
const t = decideProvision(trial, USER)
check('complete + trialing (Full Suite Plus trial): provisions as trialing', t.ok && t.row.status === 'trialing' && t.row.tier === 'full_suite_plus')
check('complete + trialing: access granted', accessAfter(trial, 'quickwrench'))
check('expanded customer object is accepted', decideProvision({ ...complete, customer: { id: 'cus_2' } }, USER).ok)
const picked = decideProvision({ ...complete, metadata: { user_id: USER, tier: 'starter', selected_modules: 'intel' } }, USER)
check('selected modules still honoured', picked.ok && JSON.stringify(picked.row.modules) === '["intel"]')

console.log(`\n${passes} passed, ${failures} failed`)
if (failures) process.exit(1)
