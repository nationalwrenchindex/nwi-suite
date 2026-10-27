import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { getHdTierFromPriceId } from '@/lib/hd-plans'
import { getSubscription } from '@/lib/subscription'
import { checkoutTrialParams, reeferTrialDaysFor, returningReason, type TrialHistory } from '@/lib/ld-trial'
import { countStripeSubscriptions, countSameEmailSubscriptions } from '@/lib/trial-history'
import { canStartReeferCheckout } from '@/lib/reefer-standalone'

// Reefer Standalone checkout: ONE price, $129/mo, 15-day trial (card required, once per
// customer). The same steps as /api/hd/checkout - which is not edited - for this one
// product: reuse the account's Stripe customer, read the trial history BEFORE creating a
// customer, card always, cancel if the trial ends with no card.
//
// The price ID comes ONLY from STRIPE_PRICE_REEFER_STANDALONE. With it unset there is
// nothing to sell, so this refuses (503) instead of sending the buyer anywhere: a
// reefer account with no subscription would only be bounced back to signup.
//
// Recording the subscription is the existing HD path: the webhook and the dashboard's
// session_id provisioning both resolve the price through getHdTierFromPriceId, which
// maps this price to 'reefer_standalone' (src/lib/hd-plans.ts).
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const priceId = process.env.STRIPE_PRICE_REEFER_STANDALONE
  console.log(`[reefer/checkout] priceId=${priceId ?? 'UNSET'}`)
  if (!priceId) {
    return NextResponse.json({ error: 'Reefer Standalone is not available for checkout yet.' }, { status: 503 })
  }
  const tier = getHdTierFromPriceId(priceId)
  if (tier !== 'reefer_standalone') {
    console.error(`[reefer/checkout] STRIPE_PRICE_REEFER_STANDALONE resolves to tier ${tier ?? 'none'} - refusing`)
    return NextResponse.json({ error: 'Reefer Standalone price is misconfigured.' }, { status: 503 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name, business_name')
    .eq('id', user.id)
    .single()

  const existingSub = await getSubscription(user.id)
  // An account with a live subscription of any tier does not buy this on top of it.
  if (!canStartReeferCheckout(existingSub)) {
    return NextResponse.json({ error: 'This account already has an active subscription. Manage it from Billing.' }, { status: 409 })
  }
  let customerId = existingSub?.stripe_customer_id ?? undefined

  // ── Free trial, never a second time - read before any new customer exists ──
  const email = profile?.email ?? user.email ?? null
  const history: TrialHistory = {
    subscriptionRow:                existingSub,
    stripeSubscriptionsOnCustomer:  await countStripeSubscriptions(customerId ? [customerId] : []),
    stripeSubscriptionsOnSameEmail: await countSameEmailSubscriptions(email, customerId),
  }
  const trialDays = reeferTrialDaysFor({ priceId, reeferPriceId: priceId, verifiedTier: tier, history })
  console.log('[reefer/checkout] trial for user=' + user.id + ': ' +
    (trialDays ? String(trialDays) + ' days' : 'none (' + String(returningReason(history)) + ')'))

  if (!customerId) {
    const customer = await stripe.customers.create({
      email:    email ?? undefined,
      name:     profile?.business_name ?? profile?.full_name ?? undefined,
      metadata: { user_id: user.id },
    })
    customerId = customer.id
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const trial = checkoutTrialParams(trialDays)

  const session = await stripe.checkout.sessions.create({
    mode:                      'subscription',
    payment_method_types:      ['card'],
    payment_method_collection: trial.payment_method_collection,
    line_items:                [{ price: priceId, quantity: 1 }],
    customer:                  customerId,
    metadata:                  { user_id: user.id, vertical: 'heavy_duty', product: 'reefer_standalone', tier },
    success_url:               `${baseUrl}/reefer/dashboard?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:                `${baseUrl}/reefer/signup`,
    subscription_data: {
      ...trial.subscription_data,
      metadata: { user_id: user.id, vertical: 'heavy_duty', tier },
    },
    allow_promotion_codes: false,
  })

  return NextResponse.json({ url: session.url })
}
