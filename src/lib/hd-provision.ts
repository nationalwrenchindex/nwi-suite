// Provisions an HD subscription straight from a completed Stripe Checkout session.
//
// The webhook is the source of truth, but it fires asynchronously — a user
// redirected back from Stripe can easily beat it to the dashboard and find
// themselves locked out of what they just paid for. This closes that window by
// reading the session on arrival and writing the same row the webhook would.
//
// Safe to run alongside the webhook: upsertSubscription is keyed on user_id, and
// both paths derive the tier from the price ID, so whichever lands second writes
// identical values.

import { stripe } from '@/lib/stripe'
import { upsertSubscription } from '@/lib/subscription'
import { getHdTierFromPriceId, HD_TIER_MODULES, type HdTier } from '@/lib/hd-plans'

type Result =
  | { ok: true;  tier: HdTier }
  | { ok: false; reason: string }

export async function provisionHdFromCheckoutSession(
  userId:    string,
  sessionId: string,
): Promise<Result> {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    })

    // The session must belong to the caller. Without this check a user could
    // provision their account from somebody else's checkout id.
    if (session.metadata?.user_id !== userId) {
      return { ok: false, reason: 'session does not belong to this user' }
    }
    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return { ok: false, reason: 'checkout not completed' }
    }

    const sub = session.subscription && typeof session.subscription === 'object'
      ? session.subscription as {
          id: string; status: string
          current_period_end: number; cancel_at_period_end: boolean
          items: { data: Array<{ price?: { id?: string } }> }
        }
      : null

    // Price ID is authoritative — never trust a tier passed through metadata.
    const priceId = sub?.items?.data?.[0]?.price?.id ?? null
    const tier    = priceId ? getHdTierFromPriceId(priceId) : null
    if (!tier) return { ok: false, reason: `unrecognised price_id ${priceId ?? 'none'}` }

    await upsertSubscription({
      user_id:                userId,
      stripe_customer_id:     typeof session.customer === 'string'
        ? session.customer
        : (session.customer as { id: string } | null)?.id ?? null,
      stripe_subscription_id: sub?.id ?? null,
      status:                 sub?.status === 'trialing' ? 'trialing' : 'active',
      tier,
      modules:                HD_TIER_MODULES[tier],
      current_period_end:     sub ? new Date(sub.current_period_end * 1000).toISOString() : null,
      cancel_at_period_end:   sub?.cancel_at_period_end ?? false,
      vertical:               'heavy_duty',
    })

    return { ok: true, tier }
  } catch (err) {
    console.error('[hd-provision]', err)
    return { ok: false, reason: err instanceof Error ? err.message : 'unknown error' }
  }
}
