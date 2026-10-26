// The LD free trial: 15 days, card required, NWI Full Suite Plus ONLY, once per customer.
//
// PURE. No Stripe, no Supabase - the checkout route gathers the facts and these
// functions decide. Kept apart so every rule below has a test (scripts/verify-ld-trial.ts).
//
// WHICH PRICE GETS IT. Decided from the Stripe PRICE ID, not the tier the browser sent:
// the checkout route resolves tier -> price through STRIPE_PRICE_* and then maps the
// price back with getTierFromPriceId. Only a price that round-trips to
// 'full_suite_plus' (env STRIPE_PRICE_FULL_SUITE_PLUS) is trial-eligible. HD has its own
// checkout and price map (/api/hd/checkout, STRIPE_PRICE_HD_*) and never reaches this.
//
// ONE TRIAL EVER. A customer who has ever held a subscription - current or cancelled,
// on this account or on a Stripe customer with the same email - gets no trial. When the
// history cannot be read, no trial: an unknown history is never treated as a clean one.
//
// CARD ALWAYS. payment_method_collection 'always' makes Checkout take a card even when
// the first invoice is $0, which a trial's first invoice is. Stripe's alternative,
// 'if_required', is exactly the setting that lets a $0 trial finish with no card. As a
// second lock, a trial that somehow ends with no payment method cancels instead of
// running on unpaid.

import type Stripe from 'stripe'
import type { PlanTier } from '@/lib/stripe-plans'

export const LD_TRIAL_TIER: PlanTier = 'full_suite_plus'
export const LD_TRIAL_DAYS = 15

// THE HD TRIAL (Oct 26): 15 days of HD Elite, the same rules - card always, once per
// customer, cancel if the trial ends with no card. HD Elite ONLY: the HD Elite + LD
// bundle resolves to the same hd_elite tier but does not trial, so eligibility is
// decided by the PRICE (STRIPE_PRICE_HD_ELITE), never by the tier alone.
export const HD_TRIAL_TIER = 'hd_elite'
export const HD_TRIAL_DAYS = 15

/** What the checkout route knows about the buyer's history. */
export interface TrialHistory {
  /** The buyer's subscriptions row, if any. */
  subscriptionRow: { stripe_subscription_id: string | null; status: string | null; tier: string | null; is_comped?: boolean | null } | null
  /** Subscriptions (any status) on the buyer's Stripe customer. null = could not read. */
  stripeSubscriptionsOnCustomer: number | null
  /** Subscriptions (any status) on OTHER Stripe customers with the same email. null = could not read. */
  stripeSubscriptionsOnSameEmail: number | null
}

/** Why a returning customer is returning - for the log line, not for the buyer. */
export function returningReason(h: TrialHistory): string | null {
  const row = h.subscriptionRow
  if (row?.stripe_subscription_id) return 'account has a Stripe subscription on record'
  if (row?.is_comped) return 'account is comped'
  if (row?.tier) return `account already holds tier ${row.tier}`
  if (row?.status && row.status !== 'inactive') return `account subscription status is ${row.status}`
  if (h.stripeSubscriptionsOnCustomer === null) return 'Stripe customer history could not be read'
  if (h.stripeSubscriptionsOnCustomer > 0) return 'Stripe customer has a past or current subscription'
  if (h.stripeSubscriptionsOnSameEmail === null) return 'same-email history could not be read'
  if (h.stripeSubscriptionsOnSameEmail > 0) return 'another Stripe customer with this email has had a subscription'
  return null
}

export function isReturningCustomer(h: TrialHistory): boolean {
  return returningReason(h) !== null
}

/** Trial days for this checkout, or null for none. verifiedTier is the tier the PRICE ID maps to. */
export function trialDaysFor(verifiedTier: PlanTier | null, history: TrialHistory): number | null {
  if (verifiedTier !== LD_TRIAL_TIER) return null
  if (isReturningCustomer(history)) return null
  return LD_TRIAL_DAYS
}

/**
 * Trial days for an HD checkout, or null for none. priceId is the price being sold,
 * elitePriceId the HD Elite price (STRIPE_PRICE_HD_ELITE) and verifiedTier the tier
 * that price maps to. The bundle price - same tier, different price - never trials.
 */
export function hdTrialDaysFor(input: {
  priceId:      string
  elitePriceId: string | undefined
  verifiedTier: string | null
  history:      TrialHistory
}): number | null {
  if (!input.elitePriceId || input.priceId !== input.elitePriceId) return null
  if (input.verifiedTier !== HD_TRIAL_TIER) return null
  if (isReturningCustomer(input.history)) return null
  return HD_TRIAL_DAYS
}

/**
 * The trial-related part of the Checkout Session params. Every LD checkout gets
 * payment_method_collection 'always'; only a trial adds trial days and the
 * cancel-if-no-card rule.
 */
export function checkoutTrialParams(trialDays: number | null): {
  payment_method_collection: 'always'
  subscription_data: {
    trial_period_days?: number
    trial_settings?: { end_behavior: { missing_payment_method: 'cancel' } }
  }
} {
  return {
    payment_method_collection: 'always',
    subscription_data: trialDays
      ? { trial_period_days: trialDays, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } }
      : {},
  }
}

/**
 * The complete Checkout Session params for an LD subscription checkout - exactly what
 * /api/stripe/checkout sends to Stripe.
 *
 * payment_method_collection is 'always' on every LD checkout, trial or not: card is the
 * only payment method type and a trial's first invoice is $0, the one case where
 * Stripe would otherwise let Checkout complete without one.
 */
export function buildLdCheckoutParams(input: {
  customerId:      string
  priceId:         string
  userId:          string
  tier:            PlanTier
  resolvedModules: string[] | undefined
  trialDays:       number | null
  successUrl:      string
  cancelUrl:       string
  hasPromo:        boolean
}): Stripe.Checkout.SessionCreateParams {
  const trial = checkoutTrialParams(input.trialDays)
  const metadata: Record<string, string> = {
    user_id: input.userId,
    tier:    input.tier,
    ...(input.resolvedModules ? { selected_modules: input.resolvedModules.join(',') } : {}),
  }
  return {
    customer:                  input.customerId,
    mode:                      'subscription',
    payment_method_types:      ['card'],
    payment_method_collection: trial.payment_method_collection,
    line_items:                [{ price: input.priceId, quantity: 1 }],
    subscription_data:         { ...trial.subscription_data, metadata },
    metadata,
    success_url:               input.successUrl,
    cancel_url:                input.cancelUrl,
    // When a promo code was pre-validated on our side, hide Stripe's promo field to avoid confusion
    ...(input.hasPromo ? {} : { allow_promotion_codes: true }),
  }
}

/**
 * The billing page's trial notice. null unless the subscription is trialing with a
 * known end date. amountCents null means the next charge could not be read - the notice
 * then names the plan price as the plan price, never as a figure Stripe confirmed.
 */
export function trialNotice(input: {
  status: string
  trialEnd: string | null
  amountCents: number | null
  currency: string | null
  planName: string | null
  planPriceCents: number | null
  now?: Date
  /** Omitted on the page, so the date reads in the viewer's own zone; tests pass 'UTC'. */
  timeZone?: string
}): { title: string; detail: string; endDate: string; amount: string | null } | null {
  if (input.status !== 'trialing' || !input.trialEnd) return null
  const end = new Date(input.trialEnd)
  if (Number.isNaN(end.getTime())) return null
  const now = input.now ?? new Date()
  const days = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000))
  const endDate = end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: input.timeZone })
  const money = (cents: number, cur: string | null) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: (cur ?? 'usd').toUpperCase() }).format(cents / 100)
  const plan = input.planName ?? 'your plan'

  let amount: string | null = null
  let detail: string
  if (input.amountCents !== null) {
    amount = money(input.amountCents, input.currency)
    detail = `Your trial ends on ${endDate}. Your card will then be charged ${amount} for ${plan}, and monthly after that unless you cancel before then.`
  } else if (input.planPriceCents !== null) {
    amount = `${money(input.planPriceCents, 'usd')}/month`
    detail = `Your trial ends on ${endDate}. ${plan} then bills at the plan price of ${amount} unless you cancel before then.`
  } else {
    detail = `Your trial ends on ${endDate}. ${plan} then bills monthly unless you cancel before then.`
  }
  return { title: `Free trial - ${days} day${days !== 1 ? 's' : ''} left`, detail, endDate, amount }
}
