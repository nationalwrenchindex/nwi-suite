// POST /api/stripe/upgrade
// Modifies an existing subscription to a new tier (upgrade/downgrade).
// Used by the QuickWrench upsell modal for subscribers who already have a plan.
// Stripe handles proration automatically.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe, getPriceId, TIER_MODULES, type PlanTier } from '@/lib/stripe'
import { getSubscription, upsertSubscription } from '@/lib/subscription'

const VALID_TIERS: PlanTier[] = ['starter', 'pro', 'full_suite', 'quickwrench', 'elite']

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { tier?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const tier = body.tier as PlanTier | undefined
  if (!tier || !VALID_TIERS.includes(tier)) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
  }

  const existingSub = await getSubscription(user.id)
  if (!existingSub?.stripe_subscription_id) {
    // No active subscription — caller should fall back to checkout
    return NextResponse.json({ error: 'no_subscription', redirect_to_checkout: true }, { status: 404 })
  }

  let priceId: string
  try { priceId = getPriceId(tier) }
  catch {
    return NextResponse.json({ error: 'Stripe prices not configured.' }, { status: 503 })
  }

  // Retrieve current Stripe subscription to get the item ID
  const stripeSub = await stripe.subscriptions.retrieve(existingSub.stripe_subscription_id)
  const itemId = stripeSub.items.data[0]?.id
  if (!itemId) return NextResponse.json({ error: 'Subscription item not found.' }, { status: 500 })

  // Modify the subscription — Stripe prorates automatically
  const updated = await stripe.subscriptions.update(existingSub.stripe_subscription_id, {
    items: [{ id: itemId, price: priceId }],
    metadata: { user_id: user.id, tier },
    proration_behavior: 'create_prorations',
  })

  // Immediately sync DB (webhook will also fire but this is faster for the UI)
  await upsertSubscription({
    user_id:                user.id,
    stripe_customer_id:     typeof updated.customer === 'string' ? updated.customer : updated.customer.id,
    stripe_subscription_id: updated.id,
    status:                 updated.status as string,
    tier,
    modules:                TIER_MODULES[tier] ?? [],
    current_period_end:     new Date(updated.current_period_end * 1000).toISOString(),
    cancel_at_period_end:   updated.cancel_at_period_end,
  })

  return NextResponse.json({ success: true, tier })
}
