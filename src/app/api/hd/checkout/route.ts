import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { HD_ELITE_BUNDLE_PRICE_ID, getHdTierFromPriceId } from '@/lib/hd-plans'

const HD_PRICE_MAP: Record<string, string | undefined> = {
  hd_reefer: process.env.STRIPE_PRICE_HD_REEFER,
  starter:   process.env.STRIPE_PRICE_HD_STARTER,
  pro:       process.env.STRIPE_PRICE_HD_PRO,
  elite:     process.env.STRIPE_PRICE_HD_ELITE,
  // HD Elite + light-duty suite on a single subscription. Its price is a literal
  // default rather than an env var so the bundle sells without any env setup.
  elite_bundle: HD_ELITE_BUNDLE_PRICE_ID,
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { plan?: string; promotionCodeId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const plan    = body.plan ?? 'pro'
  const priceId = HD_PRICE_MAP[plan]
  // Plan key -> price ID, logged at the point of resolution. Paired with the
  // slug -> plan line /hd/signup logs, the whole chain is visible when a marketing
  // link sells the wrong tier.
  console.log(`[hd/checkout] plan=${plan} -> priceId=${priceId ?? 'UNSET'}`)
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
  // NEXT_PUBLIC_APP_URL (the app host, tools.nationalwrenchindex.com) — NOT
  // NEXT_PUBLIC_BASE_URL, which is set nowhere and fell back to the marketing
  // domain, sending success_url off-app so the session_id round-trip that
  // provisions HD access never ran. Matches every other checkout route,
  // localhost fallback included: in dev that fails visibly instead of
  // silently bouncing a developer into production.
  const baseUrl  = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  // Resolved from the price so the recorded tier can never disagree with what was
  // actually charged. Carried in metadata purely for logging and support lookups —
  // both the webhook and the dashboard re-derive it from the price themselves.
  const tier = getHdTierFromPriceId(priceId)

  const session = await stripe.checkout.sessions.create({
    mode:           'subscription',
    line_items:     [{ price: priceId, quantity: 1 }],
    customer_email: profile?.email ?? user.email ?? undefined,
    metadata:       { user_id: user.id, vertical: 'heavy_duty', product: 'hd_suite', plan, ...(tier ? { tier } : {}) },
    // session_id lets the dashboard provision access on arrival instead of waiting
    // on the webhook, which can land after the user is already looking at the page.
    success_url:    `${baseUrl}/hd/dashboard?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:     `${baseUrl}/hd/signup`,
    subscription_data: {
      metadata:  { user_id: user.id, vertical: 'heavy_duty', ...(tier ? { tier } : {}) },
    },
    // allow_promotion_codes omitted when promotionCodeId is pre-validated
    ...(hasPromo ? {} : { allow_promotion_codes: false }),
  })

  return NextResponse.json({ url: session.url })
}
