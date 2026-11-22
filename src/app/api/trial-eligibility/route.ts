import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getHdTierFromPriceId } from '@/lib/hd-plans'
import { getSubscription } from '@/lib/subscription'
import { reeferTrialDaysFor, type TrialHistory } from '@/lib/ld-trial'
import { countStripeSubscriptions, countSameEmailSubscriptions } from '@/lib/trial-history'

// Will THIS signed-in account get the Reefer Standalone trial at checkout? Asked by
// /reefer/signup so a returning customer is shown "Billing starts today" instead of trial
// wording they will not get (Brock, Nov 22, 2026).
//
// The SAME decision /api/reefer/checkout makes: the same history facts and the same pure
// function (reeferTrialDaysFor, src/lib/ld-trial.ts). Checkout still decides the trial;
// this only reports it ahead of time. Display only.
//
// Reefer only: /reefer/signup is the one signup page a signed-in account can reach (the
// middleware sends a signed-in visitor on /hd/signup or /signup elsewhere).
//
// Signed in only. It reports on the caller's own account and nothing else, so no email's
// history can be probed from outside.
//
// GET /api/trial-eligibility -> { eligible: boolean }
//   eligible false when history cannot be read, exactly as checkout refuses the trial then.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const priceId = process.env.STRIPE_PRICE_REEFER_STANDALONE
  if (!priceId) return NextResponse.json({ eligible: false })

  const { data: profile } = await supabase.from('profiles').select('email').eq('id', user.id).single()
  const existingSub = await getSubscription(user.id)
  const customerId  = existingSub?.stripe_customer_id ?? undefined
  const history: TrialHistory = {
    subscriptionRow:                existingSub,
    stripeSubscriptionsOnCustomer:  await countStripeSubscriptions(customerId ? [customerId] : []),
    stripeSubscriptionsOnSameEmail: await countSameEmailSubscriptions(profile?.email ?? user.email ?? null, customerId),
  }
  const days = reeferTrialDaysFor({ priceId, reeferPriceId: priceId, verifiedTier: getHdTierFromPriceId(priceId), history })
  return NextResponse.json({ eligible: days !== null })
}
