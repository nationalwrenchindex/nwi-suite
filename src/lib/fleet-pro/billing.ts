// SERVER-ONLY — reads STRIPE_PRICE_FLEET_PRO. Do not import from client components.
//
// Fleet Pro is billed per fleet account, not per user, so it deliberately has no
// entry in PLANS / stripe-plans.ts: that list drives the `subscriptions` table,
// which is one row per user. Kurt already occupies his row there with his own HD+LD
// bundle — a department's $299 seat cannot live alongside it. The subscription state
// instead lives on hd_fleet_accounts.fleet_pro_* (migration 105), which is what the
// fleet_pro_account_ids() RLS helpers gate on.

export const FLEET_PRO_PRICE_CENTS = 29900
export const FLEET_PRO_PRODUCT_NAME = 'NWI Fleet Pro'

// Kept in metadata on both the checkout session and the subscription so the webhook
// can recognise a fleet-pro event without depending on env vars being in sync.
export const FLEET_PRO_PRODUCT_KEY = 'fleet_pro'

/**
 * Mirrors getPriceId() in src/lib/stripe.ts: throws rather than returning null so a
 * missing env var surfaces as one 503 at the checkout boundary instead of a Stripe
 * error with `price: undefined` further down.
 */
export function getFleetProPriceId(): string {
  const id = process.env.STRIPE_PRICE_FLEET_PRO
  if (!id) throw new Error('Missing env var: STRIPE_PRICE_FLEET_PRO')
  return id
}

/**
 * Fallback recogniser for the webhook. Metadata is the primary signal — this only
 * catches a subscription created outside our checkout route (a price applied by hand
 * in the Stripe dashboard, say), which would otherwise fall into the unknown-price
 * path and never activate the portal.
 */
export function isFleetProPriceId(priceId: string): boolean {
  const configured = process.env.STRIPE_PRICE_FLEET_PRO
  return !!configured && configured === priceId
}
