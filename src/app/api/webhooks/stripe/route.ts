import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { stripe, TIER_MODULES, getTierFromPriceId, type PlanTier } from '@/lib/stripe'
import { upsertSubscription, getUserIdByStripeSubscription, getUserIdByForemanSubscription } from '@/lib/subscription'
import { sendFounderAlert } from '@/lib/email-alerts'
import { createServiceClient } from '@/lib/supabase/service'
import { provisionForemanNumber } from '@/lib/foreman/provision'
import { isForemanAvailable } from '@/lib/foreman/cap'
import { FOREMAN_GRACE_PERIOD_DAYS, FOREMAN_WORKING_HOURS_DEFAULT } from '@/lib/foreman/config'

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

        const userId  = session.metadata?.user_id
        const product = session.metadata?.product
        const tier    = session.metadata?.tier as PlanTier | undefined

        if (!userId) {
          console.error('[webhook] checkout.session.completed: missing user_id', session.metadata)
          break
        }

        const subId = typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id

        // ── Foreman add-on checkout ──
        if (product === 'foreman_addon') {
          const svc = createServiceClient()

          // Soft-launch cap check — cancel + alert if exceeded
          const capAvailable = await isForemanAvailable()
          if (!capAvailable) {
            console.warn('[foreman-automation] cap exceeded — cancelling subscription', subId)
            if (subId) {
              try { await stripe.subscriptions.cancel(subId) } catch (e) {
                console.error('[foreman-automation] failed to cancel over-cap sub:', e)
              }
            }
            await sendFounderAlert({
              subject: 'Foreman cap exceeded — manual refund needed',
              html: `<p>User <strong>${userId}</strong> subscribed to Foreman but the 50-slot cap is full.</p><p>Subscription <strong>${subId}</strong> has been cancelled. Please issue a manual refund in Stripe.</p>`,
            })
            break
          }

          // Activate
          await svc.from('profiles').update({
            foreman_addon_active:           true,
            foreman_stripe_subscription_id: subId ?? null,
          }).eq('id', userId)

          // Fetch profile for defaults
          const { data: profile } = await svc
            .from('profiles')
            .select('full_name, email, business_name, phone')
            .eq('id', userId)
            .single()

          const firstName = profile?.full_name
            ? profile.full_name.trim().split(/\s+/)[0]
            : null

          // Seed foreman_settings with sensible defaults so the user lands
          // on a partially-configured Foreman (phone is added by provision)
          await svc.from('foreman_settings').upsert({
            user_id:              userId,
            is_enabled:           true,
            business_name:        profile?.business_name ?? null,
            mechanic_first_name:  firstName,
            mechanic_phone:       profile?.phone ?? null,
            working_hours_start:  FOREMAN_WORKING_HOURS_DEFAULT.start,
            working_hours_end:    FOREMAN_WORKING_HOURS_DEFAULT.end,
            working_days:         [...FOREMAN_WORKING_HOURS_DEFAULT.days],
            after_hours_message:  'Sorry we missed you — please call back during business hours.',
            updated_at:           new Date().toISOString(),
          }, { onConflict: 'user_id' })

          console.log('[foreman-automation] defaults set for', userId)

          // Auto-provision Twilio + Vapi number (fire-and-forget)
          void provisionForemanNumber(userId).then(result => {
            if (!result.ok) {
              console.error('[foreman-automation] provision failed:', result.error)
              void sendFounderAlert({
                subject: `Foreman provisioning failed — ${profile?.full_name ?? userId}`,
                html: `<p>Foreman was activated for <strong>${profile?.full_name ?? userId}</strong> (${profile?.email ?? '—'}) but phone provisioning failed.</p><p>Error: ${result.error}</p><p>User ID: ${userId}</p><p>Manual intervention needed.</p>`,
              })
            } else if (result.already_provisioned) {
              console.log('[foreman-automation] number already provisioned for', userId)
            } else {
              console.log('[foreman-automation] number provisioned:', result.phone_number)
            }
          }).catch(e => console.error('[foreman-automation] provision error:', e))

          void (async () => {
            try {
              await sendFounderAlert({
                subject: `Foreman add-on activated: ${profile?.full_name ?? userId}`,
                html: `<p><strong>${profile?.full_name ?? userId}</strong> just subscribed to Foreman ($59/mo).</p><p>Email: ${profile?.email ?? '—'}</p><p>User ID: ${userId}</p>`,
              })
            } catch { /* non-critical */ }
          })()
          break
        }

        // ── Base tier checkout ──
        if (!tier) {
          console.error('[webhook] checkout.session.completed: missing tier', session.metadata)
          break
        }

        // Use user-selected modules if present, otherwise fall back to tier defaults
        const selectedModulesStr = session.metadata?.selected_modules
        const modules = selectedModulesStr
          ? selectedModulesStr.split(',').filter(Boolean)
          : (TIER_MODULES[tier] ?? [])

        await upsertSubscription({
          user_id:                userId,
          stripe_customer_id:     typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
          stripe_subscription_id: subId ?? null,
          status:                 'active',
          tier,
          modules,
          current_period_end:     null,
          cancel_at_period_end:   false,
        })

        // Fire-and-forget — alert failure must not fail the webhook
        void (async () => {
          try {
            const svc = createServiceClient()
            const { data: profile } = await svc
              .from('profiles')
              .select('full_name, email')
              .eq('id', userId)
              .single()
            const name  = profile?.full_name ?? userId
            const email = profile?.email ?? '—'
            await sendFounderAlert({
              subject: `New paying customer: ${name} (${tier})`,
              html: `
                <p><strong>${name}</strong> just completed checkout for <strong>${tier}</strong>.</p>
                <p>Email: ${email}</p>
                <p>User ID: ${userId}</p>
              `,
            })
          } catch { /* non-critical */ }
        })()

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

        // Preserve user-selected modules stored in subscription metadata
        const updatedModulesStr = sub.metadata?.selected_modules
        const updatedModules = updatedModulesStr
          ? updatedModulesStr.split(',').filter(Boolean)
          : (tier ? (TIER_MODULES[tier] ?? []) : [])

        await upsertSubscription({
          user_id:                userId,
          stripe_customer_id:     typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
          stripe_subscription_id: sub.id,
          status:                 sub.status === 'active' || sub.status === 'trialing' ? sub.status
                                  : sub.status === 'past_due' ? 'past_due'
                                  : sub.status as string,
          tier:                   tier ?? null,
          modules:                updatedModules,
          current_period_end:     sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString() : null,
          cancel_at_period_end:   sub.cancel_at_period_end,
        })
        break
      }

      // ── Subscription deleted (cancelled at end of period) ──────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription

        // Check if this is a Foreman add-on subscription first
        const foremanUserId = await getUserIdByForemanSubscription(sub.id)
        if (foremanUserId) {
          const svc = createServiceClient()

          // Fetch phone details for grace period before deactivating
          const { data: fSettings } = await svc
            .from('foreman_settings')
            .select('phone_number, vapi_phone_number_id')
            .eq('user_id', foremanUserId)
            .single()

          // Deactivate access immediately
          await svc.from('profiles').update({
            foreman_addon_active:           false,
            foreman_stripe_subscription_id: null,
          }).eq('id', foremanUserId)

          // Schedule number release after grace period (do NOT release now)
          if (fSettings?.phone_number) {
            const releaseAt = new Date()
            releaseAt.setDate(releaseAt.getDate() + FOREMAN_GRACE_PERIOD_DAYS)
            await svc.from('foreman_grace_period').insert({
              user_id:              foremanUserId,
              phone_number:         fSettings.phone_number,
              vapi_phone_number_id: fSettings.vapi_phone_number_id ?? null,
              release_scheduled_for: releaseAt.toISOString(),
            })
            console.log('[foreman-automation] grace period scheduled for', foremanUserId, 'until', releaseAt.toISOString())
          }

          console.log('[foreman-automation] Foreman add-on cancelled for', foremanUserId)
          break
        }

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
