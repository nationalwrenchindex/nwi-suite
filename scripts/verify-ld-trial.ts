// npx tsx scripts/verify-ld-trial.ts
//
// The LD Full Suite Plus free trial (src/lib/ld-trial.ts): who gets it, that a card is
// always taken, that nobody gets it twice, that a trialing subscriber gets in, and that
// the billing page says so. Fixtures are shaped from real rows: the subscriptions row
// shapes below are the five shapes in the live table (read 2026-10-20), and the
// Checkout params are the ones /api/stripe/checkout sends.

import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  LD_TRIAL_DAYS, buildLdCheckoutParams, isReturningCustomer,
  returningReason, trialDaysFor, trialNotice, type TrialHistory,
} from '../src/lib/ld-trial'
import { subscriptionGrantsModule } from '../src/lib/subscription'
import { PLANS, TIER_MODULES, type PlanTier } from '../src/lib/stripe-plans'

// TrialBanner.tsx is compiled with the classic JSX transform here.
;(globalThis as unknown as { React: typeof React }).React = React

let failures = 0
let passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++
  else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}

const NEW: TrialHistory = { subscriptionRow: null, stripeSubscriptionsOnCustomer: 0, stripeSubscriptionsOnSameEmail: 0 }
const ALL_LD_TIERS: PlanTier[] = ['starter', 'pro', 'full_suite', 'full_suite_plus', 'elite', 'foreman_standalone', 'quickwrench', 'detailer']

function params(tier: PlanTier, trialDays: number | null) {
  return buildLdCheckoutParams({
    customerId: 'cus_test', priceId: 'price_test', userId: 'user-1', tier,
    resolvedModules: tier === 'starter' ? ['scheduler'] : undefined, trialDays,
    successUrl: 'https://x/onboarding?session_id={CHECKOUT_SESSION_ID}', cancelUrl: 'https://x/billing?canceled=true',
    hasPromo: false,
  })
}

async function main(): Promise<void> {
  console.log('\n1. A new Full Suite Plus signup gets a 15-day trial and cannot finish without a card')
  const fspDays = trialDaysFor('full_suite_plus', NEW)
  check('new Full Suite Plus customer -> 15 days', fspDays === 15 && LD_TRIAL_DAYS === 15, String(fspDays))
  const fsp = params('full_suite_plus', fspDays)
  check('trial_period_days = 15 on the subscription', fsp.subscription_data?.trial_period_days === 15)
  check("payment_method_collection = 'always' (Stripe takes a card even on a $0 first invoice)",
    fsp.payment_method_collection === 'always')
  check('card is the payment method type', JSON.stringify(fsp.payment_method_types) === '["card"]')
  check('a trial that ends with no card cancels, never runs on unpaid',
    fsp.subscription_data?.trial_settings?.end_behavior?.missing_payment_method === 'cancel')
  check('subscription mode, one Full Suite Plus price line', fsp.mode === 'subscription' && fsp.line_items?.length === 1)
  check('user_id and tier stamped on the session and the subscription (provisioning reads them)',
    fsp.metadata?.user_id === 'user-1' && fsp.subscription_data?.metadata?.user_id === 'user-1' && fsp.metadata?.tier === 'full_suite_plus')

  console.log('\n2. A new signup on any other tier gets NO trial')
  for (const t of ALL_LD_TIERS.filter(t => t !== 'full_suite_plus')) {
    const d = trialDaysFor(t, NEW)
    const p = params(t, d)
    check(`${t}: no trial, card still always collected`,
      d === null && p.subscription_data?.trial_period_days === undefined && p.subscription_data?.trial_settings === undefined
        && p.payment_method_collection === 'always', `days ${d}`)
  }
  check('a price that maps to no tier gets no trial', trialDaysFor(null, NEW) === null)
  check('HD tiers are not LD tiers: an hd_ tier name gets no trial',
    trialDaysFor('hd_pro' as PlanTier, NEW) === null && trialDaysFor('hd_elite' as PlanTier, NEW) === null)
  check('no plan in PLANS carries its own trialDays', PLANS.every(p => p.trialDays === 0))

  console.log('\n3. A returning customer gets no trial on Full Suite Plus')
  const returning: Array<[string, TrialHistory]> = [
    ['cancelled before (live row shape: canceled, has sub)',
      { ...NEW, subscriptionRow: { stripe_subscription_id: 'sub_old', status: 'canceled', tier: null, is_comped: false } }],
    ['currently active on another tier',
      { ...NEW, subscriptionRow: { stripe_subscription_id: 'sub_x', status: 'active', tier: 'full_suite', is_comped: false } }],
    ['comped account (live row shape: active, elite, no sub, comped)',
      { ...NEW, subscriptionRow: { stripe_subscription_id: null, status: 'active', tier: 'elite', is_comped: true } }],
    ['row with a tier but no Stripe sub', { ...NEW, subscriptionRow: { stripe_subscription_id: null, status: 'inactive', tier: 'pro' } }],
    ['row status canceled, nothing else', { ...NEW, subscriptionRow: { stripe_subscription_id: null, status: 'canceled', tier: null } }],
    ['Stripe customer has a past subscription', { ...NEW, stripeSubscriptionsOnCustomer: 1 }],
    ['same email had a subscription on another customer (new NWI account)', { ...NEW, stripeSubscriptionsOnSameEmail: 1 }],
    ['Stripe customer history unreadable -> treated as returning', { ...NEW, stripeSubscriptionsOnCustomer: null }],
    ['same-email history unreadable -> treated as returning', { ...NEW, stripeSubscriptionsOnSameEmail: null }],
  ]
  for (const [name, h] of returning) {
    check(`${name}: no trial`, isReturningCustomer(h) && trialDaysFor('full_suite_plus', h) === null, returningReason(h) ?? 'NOT returning')
  }
  check('a never-subscribed account (no row, no Stripe history) is not returning',
    !isReturningCustomer(NEW) && !isReturningCustomer({ ...NEW, subscriptionRow: { stripe_subscription_id: null, status: 'inactive', tier: null } }))

  console.log('\n4. A trialing Full Suite Plus subscriber can access Full Suite Plus modules')
  const fspModules = TIER_MODULES.full_suite_plus
  const trialing = { status: 'trialing', tier: 'full_suite_plus', modules: fspModules, is_comped: false }
  for (const m of fspModules) check(`trialing -> ${m}`, subscriptionGrantsModule(trialing, m))
  check('trialing Full Suite Plus does NOT get Foreman (an Elite module)', !subscriptionGrantsModule(trialing, 'foreman'))
  check('a cancelled ex-trial gets nothing', !subscriptionGrantsModule({ ...trialing, status: 'canceled' }, 'quickwrench'))
  check('an incomplete_expired (trial never paid) gets nothing', !subscriptionGrantsModule({ ...trialing, status: 'incomplete_expired' }, 'quickwrench'))

  console.log('\n5. An existing active subscriber is unchanged')
  // The live table's light-duty shapes, as they are today.
  const active = { status: 'active', tier: 'full_suite_plus', modules: fspModules, is_comped: false }
  for (const m of fspModules) check(`active Full Suite Plus -> ${m}`, subscriptionGrantsModule(active, m))
  check('active row with a null tier keeps what its modules grant',
    subscriptionGrantsModule({ status: 'active', tier: null, modules: ['scheduler'], is_comped: false }, 'scheduler'))
  check('past_due still gets in (unchanged)', subscriptionGrantsModule({ ...active, status: 'past_due' }, 'intel'))
  check('active and trialing grant exactly the same modules',
    ['scheduler', 'intel', 'financials', 'quickwrench', 'torquewrench', 'foreman', 'reefer'].every(m =>
      subscriptionGrantsModule(active, m) === subscriptionGrantsModule(trialing, m)))
  check('no billing notice for an active subscriber',
    trialNotice({ status: 'active', trialEnd: '2026-11-04T15:00:00Z', amountCents: 9900, currency: 'usd', planName: 'NWI Full Suite Plus', planPriceCents: 9900 }) === null)

  console.log('\n6. The billing page shows the trial and its end date')
  const { default: TrialBanner } = await import('../src/components/billing/TrialBanner')
  const now = new Date('2026-10-20T15:00:00Z')
  const n = trialNotice({ status: 'trialing', trialEnd: '2026-11-04T15:00:00Z', amountCents: 9900, currency: 'usd',
    planName: 'NWI Full Suite Plus', planPriceCents: 9900, now, timeZone: 'UTC' })
  check('notice: 15 days left, ends November 4, 2026, charges $99.00',
    !!n && n.title === 'Free trial - 15 days left' && n.endDate === 'November 4, 2026' && n.amount === '$99.00', JSON.stringify(n))
  const html = renderToStaticMarkup(React.createElement(TrialBanner, {
    status: 'trialing', currentPeriodEnd: '2026-11-04T15:00:00Z',
    trialBilling: { amountCents: 9900, currency: 'usd', trialEnd: '2026-11-04T15:00:00Z' },
    planName: 'NWI Full Suite Plus', planPriceCents: 9900, onCancel: () => {},
  }))
  check('rendered: the banner is on the page', html.includes('data-testid="trial-banner"'))
  check('rendered: says it is a free trial', html.includes('Free trial'))
  check('rendered: shows the end date', /data-testid="trial-end">November [34], 2026</.test(html), html.match(/trial-end">([^<]+)/)?.[1] ?? 'missing')
  check('rendered: shows what it will bill', html.includes('data-testid="trial-amount">$99.00<'), html.match(/trial-amount">([^<]+)/)?.[1] ?? 'missing')
  check('rendered: names the plan', html.includes('NWI Full Suite Plus'))
  check('rendered: offers to cancel', html.includes('Cancel trial'))
  const fallback = renderToStaticMarkup(React.createElement(TrialBanner, {
    status: 'trialing', currentPeriodEnd: '2026-11-04T15:00:00Z', trialBilling: null,
    planName: 'NWI Full Suite Plus', planPriceCents: 9900, onCancel: () => {},
  }))
  check('Stripe unreadable: falls back to the trial end on record and labels $99 as the plan price',
    /trial-end">November [34], 2026</.test(fallback) && fallback.includes('plan price of $99.00/month'))
  const none = renderToStaticMarkup(React.createElement(TrialBanner, {
    status: 'active', currentPeriodEnd: '2026-11-04T15:00:00Z', trialBilling: null,
    planName: 'NWI Full Suite Plus', planPriceCents: 9900, onCancel: () => {},
  }))
  check('rendered: nothing for an active subscriber', none === '')
  check('a $0 next charge reads $0.00, not "unknown"',
    trialNotice({ status: 'trialing', trialEnd: '2026-11-04T15:00:00Z', amountCents: 0, currency: 'usd', planName: 'P', planPriceCents: 9900, timeZone: 'UTC' })?.amount === '$0.00')

  console.log(`\n${passes} passed, ${failures} failed`)
  if (failures) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
