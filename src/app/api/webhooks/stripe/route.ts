import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { stripe, TIER_MODULES, getTierFromPriceId, type PlanTier } from '@/lib/stripe'
import { upsertSubscription, getUserIdByStripeSubscription } from '@/lib/subscription'

// Raw body required for Stripe signature verification — do NOT parse JSON
export async function POST(request: NextRequest) {
  const body = await request.text()
  const sig  = request.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('[webhook] STRIPE_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret)
  } catch (err) {
    console.error('[webhook] signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  console.log(`[webhook] ${event.type}`)

  try {
    switch (event.type) {

      // ── Checkout completed → subscription created ──────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode !== 'subscription') break

        const userId = session.metadata?.user_id
        const tier   = session.metadata?.tier as PlanTier | undefined
        if (!userId || !tier) {
          console.error('[webhook] checkout.session.completed: missing metadata', session.metadata)
          break
        }

        const subId = typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id

        await upsertSubscription({
          user_id:                userId,
          stripe_customer_id:     typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
          stripe_subscription_id: subId ?? null,
          status:                 'active',
          tier,
          modules:                TIER_MODULES[tier] ?? [],
          current_period_end:     null,
          cancel_at_period_end:   false,
        })
        break
      }

      // ── Subscription updated (upgrade/downgrade/renewal/status change) ─────
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription

        const userId = sub.metadata?.user_id
          ?? await getUserIdByStripeSubscription(sub.id)
        if (!userId) { console.error('[webhook] subscription.updated: no user_id for', sub.id); break }

        // Determine tier from the price on the subscription
        const priceId = sub.items.data[0]?.price?.id
        const tier    = (sub.metadata?.tier as PlanTier | undefined)
          ?? (priceId ? getTierFromPriceId(priceId) : null)

        await upsertSubscription({
          user_id:                userId,
          stripe_customer_id:     typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
          stripe_subscription_id: sub.id,
          status:                 sub.status === 'active' || sub.status === 'trialing' ? sub.status
                                  : sub.status === 'past_due' ? 'past_due'
                                  : sub.status as string,
          tier:                   tier ?? null,
          modules:                tier ? (TIER_MODULES[tier] ?? []) : [],
          current_period_end:     new Date(sub.current_period_end * 1000).toISOString(),
          cancel_at_period_end:   sub.cancel_at_period_end,
        })
        break
      }

      // ── Subscription deleted (cancelled at end of period) ──────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription

        const userId = sub.metadata?.user_id
          ?? await getUserIdByStripeSubscription(sub.id)
        if (!userId) { console.error('[webhook] subscription.deleted: no user_id for', sub.id); break }

        await upsertSubscription({
          user_id:                userId,
          stripe_customer_id:     typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
          stripe_subscription_id: sub.id,
          status:                 'canceled',
          tier:                   null,
          modules:                [],
          current_period_end:     sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString() : null,
          cancel_at_period_end:   false,
        })
        break
      }

      // ── Invoice paid → keep subscription active ────────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        const subId   = typeof invoice.subscription === 'string'
          ? invoice.subscription : invoice.subscription?.id
        if (!subId) break

        const userId = await getUserIdByStripeSubscription(subId)
        if (!userId) break

        // Refresh subscription object for latest period_end
        const stripeSub = await stripe.subscriptions.retrieve(subId)
        await upsertSubscription({
          user_id:              userId,
          status:               'active',
          current_period_end:   new Date(stripeSub.current_period_end * 1000).toISOString(),
          cancel_at_period_end: stripeSub.cancel_at_period_end,
        } as Parameters<typeof upsertSubscription>[0])
        break
      }

      // ── Invoice payment failed → mark past_due ────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subId   = typeof invoice.subscription === 'string'
          ? invoice.subscription : invoice.subscription?.id
        if (!subId) break

        const userId = await getUserIdByStripeSubscription(subId)
        if (!userId) break

        await upsertSubscription({
          user_id: userId,
          status:  'past_due',
        } as Parameters<typeof upsertSubscription>[0])
        break
      }

      default:
        // Ignore other events
        break
    }
  } catch (err) {
    console.error(`[webhook] error handling ${event.type}:`, err)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
