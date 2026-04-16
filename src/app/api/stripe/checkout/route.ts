import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe, getPriceId, TIER_MODULES, type PlanTier } from '@/lib/stripe'
import { getSubscription } from '@/lib/subscription'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { tier?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const tier = body.tier as PlanTier | undefined
  if (!tier || !['starter', 'pro', 'full_suite'].includes(tier)) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
  }

  let priceId: string
  try { priceId = getPriceId(tier) }
  catch {
    return NextResponse.json(
      { error: 'Stripe prices not configured. Run scripts/stripe-setup.mjs first.' },
      { status: 503 },
    )
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name, business_name')
    .eq('id', user.id)
    .single()

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  // Re-use existing Stripe customer if one exists
  const existingSub = await getSubscription(user.id)
  let customerId = existingSub?.stripe_customer_id ?? undefined

  if (!customerId) {
    const customer = await stripe.customers.create({
      email:    profile?.email ?? user.email!,
      name:     profile?.business_name ?? profile?.full_name ?? undefined,
      metadata: { user_id: user.id },
    })
    customerId = customer.id
  }

  const session = await stripe.checkout.sessions.create({
    customer:             customerId,
    mode:                 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      metadata: { user_id: user.id, tier },
    },
    metadata: { user_id: user.id, tier },
    success_url: `${appUrl}/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${appUrl}/billing?canceled=true`,
    allow_promotion_codes: true,
  })

  return NextResponse.json({ url: session.url })
}
