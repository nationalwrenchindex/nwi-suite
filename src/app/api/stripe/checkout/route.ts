// FREE TRIAL: 15 days, card required, NWI Full Suite Plus ONLY, one per customer.
// The rules live in src/lib/ld-trial.ts. Every other tier is billed at checkout.
// The published /terms page says nothing about trials; the DRAFT clause 8.2 in
// docs/tos-draft-clauses.md ("We do not offer free trials") must change before it is
// adopted, or it will contradict this.
// ─── Stripe promo code setup (run once in Stripe dashboard) ──────────────────
// 1. Coupons → Create coupon:
//      Name: NWI Free Trial 90 Days
//      Discount: 100% off
//      Duration: Forever (the trial_period_days controls billing; coupon is for tracking)
//      Leave "Applies to" blank
// 2. Promotion codes → Create a code from that coupon:
//      Code: choose e.g. NWI-BROCK-001
//      Max redemptions: 1
//      Expiry: set if desired
//    Create one unique code per prospect. Distribute only via direct message.
// 3. When a valid code is submitted here, the checkout session gets trial_period_days: 90
//    instead of the default 14. The promotion code is NOT applied as a discount to the
//    subscription — it is used only to validate the code and then discarded server-side.
//    This means Stripe's max_redemptions counter does NOT decrement. If you want single-use
//    enforcement, mark codes as inactive in Stripe after sharing, or track redemptions in your DB.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe, getPriceId, getTierFromPriceId, TIER_MODULES, type PlanTier } from '@/lib/stripe'
import { getSubscription } from '@/lib/subscription'
import { sendFounderAlert } from '@/lib/email-alerts'
import { buildLdCheckoutParams, returningReason, trialDaysFor, LD_TRIAL_TIER, type TrialHistory } from '@/lib/ld-trial'
import { countStripeSubscriptions, countSameEmailSubscriptions } from '@/lib/trial-history'

const VALID_TIERS: PlanTier[] = ['starter', 'pro', 'full_suite', 'full_suite_plus', 'elite', 'foreman_standalone', 'quickwrench', 'detailer']
// Tiers that never show Stripe's promo-code field when a code was pre-validated.
// Unrelated to the free trial, which is decided in src/lib/ld-trial.ts.
const NO_TRIAL_TIERS: PlanTier[] = ['elite', 'foreman_standalone']

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { tier?: string; source?: string; selectedModules?: string[]; promotionCodeId?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const tier = body.tier as PlanTier | undefined
  if (!tier || !VALID_TIERS.includes(tier)) {
    return NextResponse.json({ error: 'Invalid tier' }, { status: 400 })
  }

  // Validate selectedModules for Starter/Pro
  const ALLOWED_SELECTABLE = ['scheduler', 'intel', 'financials']
  const PICK_COUNT: Partial<Record<PlanTier, number>> = { starter: 1, pro: 2 }
  const required = PICK_COUNT[tier]
  let resolvedModules: string[] | undefined

  if (required !== undefined) {
    const sel = body.selectedModules ?? []
    if (
      sel.length !== required ||
      sel.some((m: string) => !ALLOWED_SELECTABLE.includes(m))
    ) {
      return NextResponse.json(
        { error: `${tier} requires exactly ${required} module(s) from: ${ALLOWED_SELECTABLE.join(', ')}` },
        { status: 400 },
      )
    }
    resolvedModules = sel
  }

  let priceId: string
  try { priceId = getPriceId(tier) }
  catch {
    return NextResponse.json(
      { error: 'Stripe prices not configured. Add STRIPE_PRICE_* env vars.' },
      { status: 503 },
    )
  }

  // Tier -> price ID, logged at the point of resolution. Paired with the slug -> tier
  // line the signup page logs, this makes the whole chain visible: a link that sells
  // the wrong plan shows up as a mismatch between the two, rather than as a customer
  // discovering it on their receipt.
  console.log(`[stripe/checkout] tier=${tier} -> priceId=${priceId} (source=${body.source ?? 'unknown'})`)

  // Verify the price ID round-trips back to the correct tier via env var mapping
  const verifiedTier = getTierFromPriceId(priceId)
  console.log(`[checkout] price_id=${priceId} → tier=${verifiedTier ?? 'UNKNOWN — check STRIPE_PRICE_* env vars'}`)
  if (!verifiedTier) {
    console.error(`[checkout] STRIPE_PRICE_* misconfiguration: price_id ${priceId} does not map to any known tier`)
    return NextResponse.json({ error: 'Stripe price configuration error' }, { status: 503 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name, business_name')
    .eq('id', user.id)
    .single()

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  // Use /onboarding as success destination for new sign-ups, billing for existing users
  const successPath = body.source === 'signup' ? '/onboarding' : '/billing?success=true'

  // Re-use existing Stripe customer if one exists
  const existingSub = await getSubscription(user.id)
  let customerId = existingSub?.stripe_customer_id ?? undefined

  // ── Free trial: Full Suite Plus only, never a second time ──
  // Read BEFORE a new Stripe customer is created, so the brand-new customer cannot be
  // mistaken for the history. Only looked up for the trial price - other tiers never
  // trial, so they pay no extra Stripe calls.
  let trialDays: number | null = null
  if (verifiedTier === LD_TRIAL_TIER) {
    const email = profile?.email ?? user.email ?? null
    const history: TrialHistory = {
      subscriptionRow:                existingSub,
      stripeSubscriptionsOnCustomer:  await countStripeSubscriptions(customerId ? [customerId] : []),
      stripeSubscriptionsOnSameEmail: await countSameEmailSubscriptions(email, customerId),
    }
    trialDays = trialDaysFor(verifiedTier, history)
    console.log(`[stripe/checkout] trial for user=${user.id}: ${trialDays ? `${trialDays} days` : `none (${returningReason(history)})`}`)
  }

  if (!customerId) {
    const customer = await stripe.customers.create({
      email:    profile?.email ?? user.email!,
      name:     profile?.business_name ?? profile?.full_name ?? undefined,
      metadata: { user_id: user.id },
    })
    customerId = customer.id
  }

  // Only Full Suite Plus trials; everything else is billed at checkout. hasPromo
  // controls whether Stripe's promo-code field is shown.
  const hasPromo = !!body.promotionCodeId && !NO_TRIAL_TIERS.includes(tier)
  // Built by buildLdCheckoutParams (src/lib/ld-trial.ts) so the exact params sent to
  // Stripe are under test: card always collected, trial only when trialDays is set.
  let session
  try {
    session = await stripe.checkout.sessions.create(buildLdCheckoutParams({
      customerId,
      priceId,
      userId:     user.id,
      tier,
      resolvedModules,
      trialDays,
      successUrl: `${appUrl}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl:  `${appUrl}/billing?canceled=true`,
      hasPromo,
    }))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe checkout session creation failed'
    console.error('[POST /api/stripe/checkout] session create error:', err)
    return NextResponse.json({ error: message }, { status: 502 })
  }

  if (body.source === 'signup') {
    const name  = profile?.full_name ?? user.email ?? user.id
    const email = profile?.email ?? user.email ?? '—'
    void sendFounderAlert({
      subject: `New signup: ${name} (${tier})`,
      html: `
        <p><strong>${name}</strong> just signed up for <strong>${tier}</strong>.</p>
        <p>Email: ${email}</p>
        <p>User ID: ${user.id}</p>
      `,
    })
  }

  return NextResponse.json({ url: session.url })
}

// countStripeSubscriptions / countSameEmailSubscriptions: src/lib/trial-history.ts,
// shared with /api/hd/checkout.
