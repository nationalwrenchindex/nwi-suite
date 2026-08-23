// Sells NWI Fleet Pro ($299/mo) for one fleet account.
//
// This is the MECHANIC's action, not the fleet's — Kurt turns the portal on for a
// customer he already services and the department is billed. So the caller is
// authorised by ownership of the fleet account, not with a Fleet Pro membership: no
// member exists yet at the moment of purchase, and the gating functions in migration
// 105 only start returning the account once this subscription is live.
//
// Two different people legitimately own that action. The mechanic who created the
// hd_fleet_accounts row is one (ownsFleetAccount). The partner who RESELLS that
// account is the other (partnerOwnsAccount) — migration 106 made the reseller link a
// separate relationship precisely because it does not imply the mechanic created the
// row, so both are checked and either one is enough.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { stripe } from '@/lib/stripe'
import { ownsFleetAccount } from '@/lib/fleet-pro/access'
import { getPartner, partnerOwnsAccount } from '@/lib/fleet-pro/partner-access'
import { getFleetProPriceId, FLEET_PRO_PRODUCT_KEY } from '@/lib/fleet-pro/billing'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { fleet_account_id?: string; source?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const fleetAccountId = body.fleet_account_id
  if (!fleetAccountId) {
    return NextResponse.json({ error: 'fleet_account_id is required' }, { status: 400 })
  }

  // The partner row is looked up even on the mechanic path: it is needed below for
  // the Stripe customer regardless of which check let the caller through.
  const [isOwner, partner] = await Promise.all([
    ownsFleetAccount(user.id, fleetAccountId),
    getPartner(user.id),
  ])
  const isReseller = !isOwner && !!partner && await partnerOwnsAccount(partner.id, fleetAccountId)

  if (!isOwner && !isReseller) {
    return NextResponse.json({ error: 'Fleet account not found' }, { status: 403 })
  }

  let priceId: string
  try { priceId = getFleetProPriceId() }
  catch {
    console.error('[fleet-pro/checkout] STRIPE_PRICE_FLEET_PRO not set — create the $299/mo Fleet Pro price in Stripe and add the env var')
    return NextResponse.json(
      { error: 'Fleet Pro is not configured for billing yet. Add STRIPE_PRICE_FLEET_PRO.' },
      { status: 503 },
    )
  }

  // Service client: the fleet_pro_* columns are read here for the mechanic, whose
  // own RLS policy already covers this row, but the columns are billing state and
  // are only ever written by the webhook on the service client — read them the same
  // way so the two never diverge on which client sees what.
  const svc = createServiceClient()
  const { data: account } = await svc
    .from('hd_fleet_accounts')
    .select('id, fleet_name, contact_email, fleet_pro_enabled, fleet_pro_status, fleet_pro_stripe_customer_id')
    .eq('id', fleetAccountId)
    .maybeSingle()

  if (!account) return NextResponse.json({ error: 'Fleet account not found' }, { status: 404 })

  if (account.fleet_pro_enabled && ['active', 'trialing', 'past_due'].includes(account.fleet_pro_status ?? '')) {
    return NextResponse.json({ error: 'Fleet Pro is already active for this fleet account' }, { status: 409 })
  }

  // Customer resolution, in order of preference.
  //
  // 1. The department's own customer, when it already has one: re-using it across
  //    cancel/resubscribe cycles keeps that fleet's invoice history on one record.
  //    Nothing is persisted here — the webhook writes fleet_pro_stripe_customer_id
  //    once the payment actually completes.
  let customerId = account.fleet_pro_stripe_customer_id ?? undefined

  // 2. The PARTNER's customer. This is the one that matters at scale: a partner with
  //    nine fleets should be nine subscriptions on ONE customer, so he has one saved
  //    card, one billing portal, and one place to fix a decline. Minting a customer
  //    per fleet instead leaves nine unlinked records in Stripe that nobody can
  //    reconcile against a partner, and nine cards to update when his expires.
  if (!customerId && partner) {
    customerId = partner.stripe_customer_id ?? undefined

    if (!customerId) {
      try {
        const customer = await stripe.customers.create({
          email:    partner.contact_email ?? undefined,
          name:     partner.partner_name,
          metadata: { partner_id: partner.id, product: FLEET_PRO_PRODUCT_KEY, sold_by_user_id: user.id },
        })
        customerId = customer.id
      } catch (err) {
        console.error('[POST /api/fleet-pro/checkout] partner customer create error:', err)
        const message = err instanceof Error ? err.message : 'Stripe customer creation failed'
        return NextResponse.json({ error: message }, { status: 502 })
      }

      // Persisted immediately rather than left to the webhook, which only ever writes
      // hd_fleet_accounts. If it were not written here, nothing would ever record it
      // and the partner's next fleet would create a second orphan customer — the exact
      // thing this branch exists to prevent. An abandoned checkout leaves a customer
      // with no subscription, which is harmless and gets re-used on the next attempt.
      const { error: persistErr } = await svc
        .from('fleet_pro_partners')
        .update({ stripe_customer_id: customerId })
        .eq('id', partner.id)
      if (persistErr) {
        console.error('[POST /api/fleet-pro/checkout] could not persist partner stripe_customer_id:', persistErr.message)
      }
    }
  }

  // 3. Fall back to a per-fleet customer. Only reached when the buyer has no partner
  //    row at all — a mechanic selling Fleet Pro straight from the HD suite.
  if (!customerId) {
    try {
      const customer = await stripe.customers.create({
        email:    account.contact_email ?? undefined,
        name:     account.fleet_name,
        metadata: { fleet_account_id: fleetAccountId, product: FLEET_PRO_PRODUCT_KEY, sold_by_user_id: user.id },
      })
      customerId = customer.id
    } catch (err) {
      console.error('[POST /api/fleet-pro/checkout] customer create error:', err)
      const message = err instanceof Error ? err.message : 'Stripe customer creation failed'
      return NextResponse.json({ error: message }, { status: 502 })
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  // Where Stripe sends the buyer back. A fixed pair of destinations chosen by a flag,
  // never a URL from the request body — that would be an open redirect on a page the
  // user reaches mid-payment.
  const returnBase = body.source === 'partner'
    ? `${appUrl}/fleet-pro/partner/billing`
    : `${appUrl}/hd/fleet-accounts/${fleetAccountId}`

  // The same metadata goes on the session AND the subscription: the session carries
  // it for checkout.session.completed, but every later lifecycle event (renewal,
  // cancellation, failed payment) only ever sees the subscription object.
  const metadata = { fleet_account_id: fleetAccountId, product: FLEET_PRO_PRODUCT_KEY }

  let session
  try {
    session = await stripe.checkout.sessions.create({
      customer:             customerId,
      mode:                 'subscription',
      payment_method_types: ['card'],
      line_items:           [{ price: priceId, quantity: 1 }],
      metadata,
      subscription_data:    { metadata },
      success_url: `${returnBase}?fleet_pro=success`,
      cancel_url:  `${returnBase}?fleet_pro=canceled`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe checkout session creation failed'
    console.error('[POST /api/fleet-pro/checkout] session create error:', err)
    return NextResponse.json({ error: message }, { status: 502 })
  }

  return NextResponse.json({ url: session.url })
}
