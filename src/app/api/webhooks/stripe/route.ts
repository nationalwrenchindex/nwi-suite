import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { stripe, TIER_MODULES, getTierFromPriceId, type PlanTier } from '@/lib/stripe'
import { upsertSubscription, getUserIdByStripeSubscription, getUserIdByForemanSubscription } from '@/lib/subscription'
import { sendFounderAlert, sendNewSubscriberAlert } from '@/lib/email-alerts'
import { PLANS } from '@/lib/stripe-plans'
import { createServiceClient } from '@/lib/supabase/service'
import { provisionForemanNumber } from '@/lib/foreman/provision'
import { isForemanAvailable } from '@/lib/foreman/cap'
import { FOREMAN_GRACE_PERIOD_DAYS, FOREMAN_WORKING_HOURS_DEFAULT } from '@/lib/foreman/config'
import { sendSubscriberSms } from '@/lib/twilio'

// Returns true when a subscription row is flagged as a founder comp account.
// Webhook mutations must never overwrite comped accounts.
async function isComped(userId: string): Promise<boolean> {
  const svc = createServiceClient()
  const { data } = await svc
    .from('subscriptions')
    .select('is_comped')
    .eq('user_id', userId)
    .maybeSingle()
  return data?.is_comped === true
}

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
              const alertName  = profile?.full_name ?? userId
              const alertEmail = profile?.email ?? '—'
              await sendNewSubscriberAlert({
                name: alertName, email: alertEmail,
                planName: 'Foreman Add-on', tier: 'foreman_addon', amountDollars: 59,
              })
              const brockPhone = process.env.BROCK_PHONE_NUMBER
              if (brockPhone) {
                const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
                await sendSubscriberSms({
                  to:   brockPhone,
                  body: `New NWI Subscriber! Name: ${alertName} Email: ${alertEmail} Plan: Foreman Add-on Amount: $59/mo Time: ${ts}`,
                })
              }
            } catch { /* non-critical */ }
          })()
          break
        }

        // ── Base tier checkout — always derive tier from price ID ──
        if (!subId) {
          console.error('[webhook] checkout.session.completed: missing subscription id for base tier checkout')
          break
        }

        const stripeSub = await stripe.subscriptions.retrieve(subId)
        const priceId   = stripeSub.items.data[0]?.price?.id ?? null
        const tier      = priceId ? getTierFromPriceId(priceId) : null

        console.log(`[webhook] checkout.session.completed: price_id=${priceId ?? 'none'} → tier=${tier ?? 'unknown'}`)

        if (!tier) {
          console.error(`[webhook] checkout.session.completed: unrecognised price_id "${priceId ?? 'none'}" — subscription not activated, check STRIPE_PRICE_* env vars`)
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
          vertical:               session.metadata?.vertical ?? 'light_duty',
        })

        // ── Activate Foreman for Elite and Foreman Standalone ──
        if (tier === 'elite' || tier === 'foreman_standalone') {
          const svc = createServiceClient()
          const capAvailable = await isForemanAvailable()

          if (!capAvailable) {
            await sendFounderAlert({
              subject: `Foreman cap exceeded — ${tier} subscriber (${userId})`,
              html: `<p>User <strong>${userId}</strong> subscribed to <strong>${tier}</strong> but Foreman cap is full. Manual action needed.</p>`,
            })
          } else {
            const { data: fProfile } = await svc
              .from('profiles')
              .select('full_name, email, business_name, phone')
              .eq('id', userId)
              .single()

            const firstName = fProfile?.full_name
              ? fProfile.full_name.trim().split(/\s+/)[0]
              : null

            // Activate Foreman — do NOT set foreman_stripe_subscription_id so
            // getUserIdByForemanSubscription won't intercept this tier's cancellation
            await svc.from('profiles').update({
              foreman_addon_active: true,
            }).eq('id', userId)

            await svc.from('foreman_settings').upsert({
              user_id:             userId,
              is_enabled:          true,
              business_name:       fProfile?.business_name ?? null,
              mechanic_first_name: firstName,
              mechanic_phone:      fProfile?.phone ?? null,
              working_hours_start: FOREMAN_WORKING_HOURS_DEFAULT.start,
              working_hours_end:   FOREMAN_WORKING_HOURS_DEFAULT.end,
              working_days:        [...FOREMAN_WORKING_HOURS_DEFAULT.days],
              after_hours_message: 'Sorry we missed you — please call back during business hours.',
              updated_at:          new Date().toISOString(),
            }, { onConflict: 'user_id' })

            void provisionForemanNumber(userId).then(result => {
              if (!result.ok) {
                console.error('[foreman-automation] provision failed:', result.error)
                void sendFounderAlert({
                  subject: `Foreman provisioning failed — ${tier} — ${fProfile?.full_name ?? userId}`,
                  html: `<p>Foreman was activated for <strong>${fProfile?.full_name ?? userId}</strong> (${fProfile?.email ?? '—'}) via ${tier} but phone provisioning failed.</p><p>Error: ${result.error}</p>`,
                })
              } else {
                console.log('[foreman-automation] number provisioned for', tier, ':', result.phone_number)
              }
            }).catch(e => console.error('[foreman-automation] provision error:', e))
          }
        }

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
            const plan  = PLANS.find(p => p.tier === tier)
            const planName      = plan?.name ?? tier
            const amountDollars = plan ? plan.price / 100 : null
            await sendNewSubscriberAlert({ name, email, planName, tier, amountDollars })
            const brockPhone = process.env.BROCK_PHONE_NUMBER
            if (brockPhone) {
              const ts     = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
              const amount = amountDollars != null ? `$${amountDollars}/mo` : '—'
              await sendSubscriberSms({
                to:   brockPhone,
                body: `New NWI Subscriber! Name: ${name} Email: ${email} Plan: ${planName} Amount: ${amount} Time: ${ts}`,
              })
            }
          } catch { /* non-critical */ }
        })()

        break
      }

      // ── Subscription created → admin SMS notification ─────────────────────
      case 'customer.subscription.created': {
        const sub        = event.data.object as Stripe.Subscription
        const adminPhone = process.env.ADMIN_PHONE_NUMBER
        if (adminPhone) {
          void (async () => {
            try {
              const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
              const customer   = await stripe.customers.retrieve(customerId)
              const name       = !customer.deleted ? (customer.name ?? '—') : '—'
              const email      = !customer.deleted ? (customer.email ?? '—') : '—'
              const priceId    = sub.items.data[0]?.price?.id ?? null
              const tier       = priceId ? getTierFromPriceId(priceId) : null
              const plan       = tier ? PLANS.find(p => p.tier === tier) : null
              const planName   = plan?.name ?? tier ?? '—'
              const ts         = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
              await sendSubscriberSms({
                to:   adminPhone,
                body: `NEW NWI SUBSCRIBER - Name: ${name} - Email: ${email} - Plan: ${planName} - Time: ${ts}`,
              })
            } catch { /* non-critical */ }
          })()
        }
        break
      }

      // ── Subscription updated (upgrade/downgrade/renewal/status change) ─────
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription

        const userId = sub.metadata?.user_id
          ?? await getUserIdByStripeSubscription(sub.id)
        if (!userId) { console.error('[webhook] subscription.updated: no user_id for', sub.id); break }
        if (await isComped(userId)) { console.log('[webhook] subscription.updated: skipping comped account', userId); break }

        // Determine tier from the price ID only — never trust metadata
        const priceId = sub.items.data[0]?.price?.id ?? null
        const tier    = priceId ? getTierFromPriceId(priceId) : null

        console.log(`[webhook] customer.subscription.updated: price_id=${priceId ?? 'none'} → tier=${tier ?? 'unknown'}`)

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
        const sub      = event.data.object as Stripe.Subscription
        const tierMeta = sub.metadata?.tier as PlanTier | undefined

        // Admin SMS — fire-and-forget, runs for every cancellation type
        const adminPhoneDel = process.env.ADMIN_PHONE_NUMBER
        if (adminPhoneDel) {
          void (async () => {
            try {
              const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
              const customer   = await stripe.customers.retrieve(customerId)
              const name       = !customer.deleted ? (customer.name ?? '—') : '—'
              const email      = !customer.deleted ? (customer.email ?? '—') : '—'
              const priceId    = sub.items.data[0]?.price?.id ?? null
              const tier       = priceId ? getTierFromPriceId(priceId) : null
              const plan       = tier ? PLANS.find(p => p.tier === tier) : null
              const planName   = plan?.name ?? (typeof tierMeta === 'string' ? tierMeta : '—')
              const ts         = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
              await sendSubscriberSms({
                to:   adminPhoneDel,
                body: `NWI CANCELLATION - Name: ${name} - Email: ${email} - Plan: ${planName} - Time: ${ts}`,
              })
            } catch { /* non-critical */ }
          })()
        }

        // Check if this is a Foreman add-on subscription first.
        // Elite and Foreman Standalone tiers have tier metadata, so skip the
        // foreman-only lookup for them — they go through the base tier path below.
        const foremanUserId = tierMeta ? null : await getUserIdByForemanSubscription(sub.id)
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
        if (await isComped(userId)) { console.log('[webhook] subscription.deleted: skipping comped account', userId); break }

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

        // Deactivate Foreman for tiers that bundle it
        if (tierMeta === 'elite' || tierMeta === 'foreman_standalone') {
          const svc = createServiceClient()
          const { data: fSettings } = await svc
            .from('foreman_settings')
            .select('phone_number, vapi_phone_number_id')
            .eq('user_id', userId)
            .single()

          await svc.from('profiles').update({
            foreman_addon_active: false,
          }).eq('id', userId)

          if (fSettings?.phone_number) {
            const releaseAt = new Date()
            releaseAt.setDate(releaseAt.getDate() + FOREMAN_GRACE_PERIOD_DAYS)
            await svc.from('foreman_grace_period').insert({
              user_id:               userId,
              phone_number:          fSettings.phone_number,
              vapi_phone_number_id:  fSettings.vapi_phone_number_id ?? null,
              release_scheduled_for: releaseAt.toISOString(),
            })
            console.log('[foreman-automation] grace period scheduled for', userId, 'tier', tierMeta)
          }
        }

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
        if (await isComped(userId)) { console.log('[webhook] invoice.payment_succeeded: skipping comped account', userId); break }

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
        if (await isComped(userId)) { console.log('[webhook] invoice.payment_failed: skipping comped account', userId); break }

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
