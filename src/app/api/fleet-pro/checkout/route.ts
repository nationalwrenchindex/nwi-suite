// Sells NWI Fleet Pro ($299/mo) for one fleet account.
//
// This is the MECHANIC's action, not the fleet's — Kurt turns the portal on for a
// customer he already services and the department is billed. So the caller is
// authorised with ownsFleetAccount(), not with a Fleet Pro membership: no member
// exists yet at the moment of purchase, and the gating functions in migration 105
// only start returning the account once this subscription is live.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { stripe } from '@/lib/stripe'
import { ownsFleetAccount } from '@/lib/fleet-pro/access'
import { getFleetProPriceId, FLEET_PRO_PRODUCT_KEY } from '@/lib/fleet-pro/billing'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { fleet_account_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const fleetAccountId = body.fleet_account_id
  if (!fleetAccountId) {
    return NextResponse.json({ error: 'fleet_account_id is required' }, { status: 400 })
  }

  if (!(await ownsFleetAccount(user.id, fleetAccountId))) {
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

  // Re-use the department's customer across cancel/resubscribe cycles so their
  // invoice history stays on one record. Nothing is persisted here — the webhook
  // writes fleet_pro_stripe_customer_id once the payment actually completes.
  let customerId = account.fleet_pro_stripe_customer_id ?? undefined
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
      success_url: `${appUrl}/hd/fleet-accounts/${fleetAccountId}?fleet_pro=success`,
      cancel_url:  `${appUrl}/hd/fleet-accounts/${fleetAccountId}?fleet_pro=canceled`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe checkout session creation failed'
    console.error('[POST /api/fleet-pro/checkout] session create error:', err)
    return NextResponse.json({ error: message }, { status: 502 })
  }

  return NextResponse.json({ url: session.url })
}
