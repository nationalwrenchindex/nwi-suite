import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { getSubscription } from '@/lib/subscription'

export async function POST(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const priceId = process.env.STRIPE_PRICE_FOREMAN
  if (!priceId) {
    return NextResponse.json({ error: 'Foreman pricing not configured.' }, { status: 503 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name, business_name')
    .eq('id', user.id)
    .single()

  // Re-use existing Stripe customer from base subscription if present
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  let session
  try {
    session = await stripe.checkout.sessions.create({
      customer:             customerId,
      mode:                 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: { user_id: user.id, product: 'foreman_addon' },
      },
      metadata: { user_id: user.id, product: 'foreman_addon' },
      success_url: `${appUrl}/foreman/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${appUrl}/settings/foreman?canceled=true`,
      allow_promotion_codes: true,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe checkout session creation failed'
    console.error('[POST /api/stripe/foreman/checkout]', err)
    return NextResponse.json({ error: message }, { status: 502 })
  }

  return NextResponse.json({ url: session.url })
}
