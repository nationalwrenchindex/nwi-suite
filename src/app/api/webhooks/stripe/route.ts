import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { stripe, TIER_MODULES, getTierFromPriceId, type PlanTier } from '@/lib/stripe'
import { getHdTierFromPriceId, HD_TIER_MODULES } from '@/lib/hd-plans'
import { upsertSubscription, getUserIdByStripeSubscription, getUserIdByForemanSubscription } from '@/lib/subscription'
import { sendFounderAlert, sendNewSubscriberAlert } from '@/lib/email-alerts'
import { PLANS } from '@/lib/stripe-plans'
import { createServiceClient } from '@/lib/supabase/service'
import { provisionForemanNumber } from '@/lib/foreman/provision'
import { isForemanAvailable } from '@/lib/foreman/cap'
import { FOREMAN_GRACE_PERIOD_DAYS, FOREMAN_WORKING_HOURS_DEFAULT } from '@/lib/foreman/config'
import { sendSubscriberSms } from '@/lib/twilio'
import { isFleetProPriceId } from '@/lib/fleet-pro/billing'

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

// ── Fleet Pro billing helpers ────────────────────────────────────────────────
// Fleet Pro is sold per fleet account, so its subscription state lives on
// hd_fleet_accounts.fleet_pro_*, never on `subscriptions` (UNIQUE on user_id — the
// mechanic already owns that row for his own plan). These columns ARE the gate:
// fleet_pro_account_ids() requires fleet_pro_enabled = true and a live status, so
// writing them here is what opens and closes the department's portal.

async function activateFleetPro(args: {
  fleetAccountId:   string
  customerId:       string | null
  subscriptionId:   string | null
  currentPeriodEnd: string | null
}) {
  const svc = createServiceClient()
  const { error } = await svc
    .from('hd_fleet_accounts')
    .update({
      fleet_pro_enabled:                true,
      fleet_pro_status:                 'active',
      fleet_pro_stripe_customer_id:     args.customerId,
      fleet_pro_stripe_subscription_id: args.subscriptionId,
      fleet_pro_activated_at:           new Date().toISOString(),
      fleet_pro_current_period_end:     args.currentPeriodEnd,
    })
    .eq('id', args.fleetAccountId)

  if (error) console.error('[webhook] fleet_pro: activation failed for', args.fleetAccountId, error)
  else       console.log('[webhook] fleet_pro: activated fleet account', args.fleetAccountId)
}

// The subscription id is the only handle a lifecycle event carries back to a fleet
// account. Null when the event belongs to an ordinary per-user subscription.
async function findFleetProAccountId(subscriptionId: string): Promise<string | null> {
  const svc = createServiceClient()
  const { data } = await svc
    .from('hd_fleet_accounts')
    .select('id')
    .eq('fleet_pro_stripe_subscription_id', subscriptionId)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

// A lifecycle event can beat checkout.session.completed to the row, in which case
// no fleet account carries this subscription id yet — fall back to the metadata the
// checkout route stamped on the subscription itself.
async function resolveFleetProAccountId(sub: Stripe.Subscription): Promise<string | null> {
  const byId = await findFleetProAccountId(sub.id)
  if (byId) return byId
  if (sub.metadata?.product !== 'fleet_pro') return null
  return sub.metadata?.fleet_account_id ?? null
}

// Returns false when nothing matched, so the caller can fall through to the normal
// per-user handling instead of swallowing the event.
async function updateFleetProAccount(
  accountId: string | null,
  patch: Record<string, unknown>,
): Promise<boolean> {
  if (!accountId) return false

  const svc = createServiceClient()
  const { error } = await svc.from('hd_fleet_accounts').update(patch).eq('id', accountId)
  if (error) console.error('[webhook] fleet_pro: update failed for', accountId, error)
  else       console.log('[webhook] fleet_pro: fleet account', accountId, '→', patch.fleet_pro_status)
  return true
}

// Stripe has more statuses than the migration 105 CHECK constraint allows; anything
// that is not live collapses to 'inactive'.
function toFleetProStatus(status: string): string {
  if (status === 'active' || status === 'trialing' || status === 'past_due' || status === 'canceled') return status
  return 'inactive'
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

        // ── Fleet Pro checkout ──
        // Runs before the user_id guard on purpose: this session has no user_id
        // because a department, not a user, is the customer. Nothing here may reach
        // upsertSubscription() or a user's tier/modules.
        if (product === 'fleet_pro') {
          const fleetAccountId = session.metadata?.fleet_account_id
          if (!fleetAccountId) {
            console.error('[webhook] fleet_pro checkout: missing fleet_account_id', session.metadata)
            break
          }

          const fpSubId = typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id

          let fpPeriodEnd: string | null = null
          if (fpSubId) {
            const fpSub = await stripe.subscriptions.retrieve(fpSubId)
            fpPeriodEnd = fpSub.current_period_end
              ? new Date(fpSub.current_period_end * 1000).toISOString() : null
          }

          await activateFleetPro({
            fleetAccountId,
            customerId:       typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
            subscriptionId:   fpSubId ?? null,
            currentPeriodEnd: fpPeriodEnd,
          })
          break
        }

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

        // ── Fleet Pro fallback ──
        // A Fleet Pro subscription started outside /api/fleet-pro/checkout (created
        // by hand in the Stripe dashboard, say) carries no product metadata. Without
        // this it would fall past both tier maps into the "unrecognised price_id"
        // path and the department would pay without ever getting the portal.
        if (priceId && isFleetProPriceId(priceId)) {
          const fleetAccountId = session.metadata?.fleet_account_id ?? stripeSub.metadata?.fleet_account_id
          if (!fleetAccountId) {
            console.error('[webhook] fleet_pro price on subscription', subId, 'with no fleet_account_id metadata — not activated')
            break
          }
          await activateFleetPro({
            fleetAccountId,
            customerId:       typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
            subscriptionId:   subId,
            currentPeriodEnd: stripeSub.current_period_end
              ? new Date(stripeSub.current_period_end * 1000).toISOString() : null,
          })
          break
        }

        // ── Heavy-duty checkout ──
        // HD is sold through /api/hd/checkout on its own STRIPE_PRICE_HD_* prices,
        // which are absent from PLANS — so getTierFromPriceId returns null for them
        // and every paying HD customer used to fall through unactivated.
        const hdTier = priceId ? getHdTierFromPriceId(priceId) : null
        if (hdTier) {
          console.log(`[webhook] checkout.session.completed: price_id=${priceId} → hd tier=${hdTier}`)
          await upsertSubscription({
            user_id:                userId,
            stripe_customer_id:     typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
            stripe_subscription_id: subId,
            status:                 'active',
            tier:                   hdTier,
            modules:                HD_TIER_MODULES[hdTier],
            current_period_end:     null,
            cancel_at_period_end:   false,
            vertical:               'heavy_duty',
          })

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
              await sendNewSubscriberAlert({ name, email, planName: hdTier, tier: hdTier, amountDollars: null })
              const brockPhone = process.env.BROCK_PHONE_NUMBER
              if (brockPhone) {
                const ts = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
                await sendSubscriberSms({
                  to:   brockPhone,
                  body: `New NWI HD Subscriber! Name: ${name} Email: ${email} Plan: ${hdTier} Time: ${ts}`,
                })
              }
            } catch { /* non-critical */ }
          })()
          break
        }

        const tier = priceId ? getTierFromPriceId(priceId) : null

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

        // ── Fleet Pro ──
        // Checked first: this subscription id is not in `subscriptions`, so the
        // lookup below would log a spurious "no user_id" and drop the event.
        const fpUpdStatus = toFleetProStatus(sub.status)
        const fpUpdated = await updateFleetProAccount(await resolveFleetProAccountId(sub), {
          fleet_pro_status:                 fpUpdStatus,
          fleet_pro_stripe_subscription_id: sub.id,
          // past_due keeps the portal open — the gating functions allow it, matching
          // how the rest of the app treats a missed payment.
          fleet_pro_enabled: ['active', 'trialing', 'past_due'].includes(fpUpdStatus),
          fleet_pro_current_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString() : null,
        })
        if (fpUpdated) break

        const userId = sub.metadata?.user_id
          ?? await getUserIdByStripeSubscription(sub.id)
        if (!userId) { console.error('[webhook] subscription.updated: no user_id for', sub.id); break }
        if (await isComped(userId)) { console.log('[webhook] subscription.updated: skipping comped account', userId); break }

        // Determine tier from the price ID only — never trust metadata
        const priceId = sub.items.data[0]?.price?.id ?? null

        // HD subscriptions resolve through their own price map. Without this an HD
        // renewal or status change would resolve to tier null and silently strip the
        // subscriber's access on the next update event.
        const hdTierUpd = priceId ? getHdTierFromPriceId(priceId) : null
        if (hdTierUpd) {
          console.log(`[webhook] customer.subscription.updated: price_id=${priceId} → hd tier=${hdTierUpd}`)
          await upsertSubscription({
            user_id:                userId,
            stripe_customer_id:     typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
            stripe_subscription_id: sub.id,
            status:                 sub.status === 'active' || sub.status === 'trialing' ? sub.status
                                    : sub.status === 'past_due' ? 'past_due'
                                    : sub.status as string,
            tier:                   hdTierUpd,
            modules:                HD_TIER_MODULES[hdTierUpd],
            current_period_end:     sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString() : null,
            cancel_at_period_end:   sub.cancel_at_period_end,
            vertical:               'heavy_duty',
          })
          break
        }

        const tier = priceId ? getTierFromPriceId(priceId) : null

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

        // ── Fleet Pro ──
        // Placed after the admin SMS (a $299 cancellation is worth the alert) but
        // before every per-user path below. This is what revokes the whole
        // department's portal access.
        const fpDeleted = await updateFleetProAccount(await resolveFleetProAccountId(sub), {
          fleet_pro_status:  'canceled',
          fleet_pro_enabled: false,
          fleet_pro_current_period_end: sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString() : null,
        })
        if (fpDeleted) break

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

        // ── Fleet Pro ── renewal paid: re-open the portal and refresh the period.
        // The account lookup comes first so an ordinary renewal does not pay for an
        // extra Stripe round-trip.
        const fpPaidAccountId = await findFleetProAccountId(subId)
        if (fpPaidAccountId) {
          const fpPaidSub = await stripe.subscriptions.retrieve(subId)
          await updateFleetProAccount(fpPaidAccountId, {
            fleet_pro_status:  'active',
            fleet_pro_enabled: true,
            fleet_pro_current_period_end: fpPaidSub.current_period_end
              ? new Date(fpPaidSub.current_period_end * 1000).toISOString() : null,
          })
          break
        }

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

        // ── Fleet Pro ── stays enabled: the gating functions treat past_due as live,
        // so the department keeps the portal through Stripe's retry window.
        const fpFailed = await updateFleetProAccount(await findFleetProAccountId(subId), { fleet_pro_status: 'past_due' })
        if (fpFailed) break

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
