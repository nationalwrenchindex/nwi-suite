import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'

const HD_PRICE_MAP: Record<string, string | undefined> = {
  hd_reefer: process.env.STRIPE_PRICE_HD_REEFER,
  starter:   process.env.STRIPE_PRICE_HD_STARTER,
  pro:       process.env.STRIPE_PRICE_HD_PRO,
  elite:     process.env.STRIPE_PRICE_HD_ELITE,
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { plan?: string; promotionCodeId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const plan    = body.plan ?? 'pro'
  const priceId = HD_PRICE_MAP[plan]
  if (!priceId) {
    // No Stripe price configured yet — redirect to dashboard directly
    return NextResponse.json({ url: '/hd/dashboard' })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', user.id)
    .single()

  const hasPromo = !!body.promotionCodeId
  const baseUrl  = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://nationalwrenchindex.com'

  const session = await stripe.checkout.sessions.create({
    mode:           'subscription',
    line_items:     [{ price: priceId, quantity: 1 }],
    customer_email: profile?.email ?? user.email ?? undefined,
    metadata:       { user_id: user.id, vertical: 'heavy_duty', product: 'hd_suite', plan },
    success_url:    `${baseUrl}/hd/dashboard?upgraded=1`,
    cancel_url:     `${baseUrl}/hd/signup`,
    subscription_data: {
      metadata:  { user_id: user.id, vertical: 'heavy_duty' },
      ...(hasPromo ? { trial_period_days: 90 } : {}),
    },
    // allow_promotion_codes omitted when promotionCodeId is pre-validated
    ...(hasPromo ? {} : { allow_promotion_codes: false }),
  })

  return NextResponse.json({ url: session.url })
}
