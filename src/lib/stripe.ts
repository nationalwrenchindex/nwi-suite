// SERVER-ONLY — do not import from client components.
// Plan data (client-safe) lives in stripe-plans.ts.

import Stripe from 'stripe'
import { PLANS, type PlanTier } from '@/lib/stripe-plans'

export { PLANS, TIER_MODULES, MODULE_LABELS } from '@/lib/stripe-plans'
export type { PlanTier } from '@/lib/stripe-plans'

// Singleton — re-use across hot reloads in dev
const globalForStripe = globalThis as unknown as { stripe?: Stripe }

export const stripe =
  globalForStripe.stripe ??
  new Stripe(process.env.STRIPE_SECRET_KEY!)

if (process.env.NODE_ENV !== 'production') globalForStripe.stripe = stripe

export function getPriceId(tier: PlanTier): string {
  const key = `STRIPE_PRICE_${tier.toUpperCase()}`
  const id  = process.env[key]
  if (!id) throw new Error(`Missing env var: ${key}`)
  return id
}

export function getTierFromPriceId(priceId: string): PlanTier | null {
  for (const plan of PLANS) {
    const envKey = `STRIPE_PRICE_${plan.priceKey}`
    if (process.env[envKey] === priceId) return plan.tier
  }
  return null
}
