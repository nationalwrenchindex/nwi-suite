import Stripe from 'stripe'

// Singleton — re-use across hot reloads in dev
const globalForStripe = globalThis as unknown as { stripe?: Stripe }

export const stripe =
  globalForStripe.stripe ??
  new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-04-30.basil',
    typescript:  true,
  })

if (process.env.NODE_ENV !== 'production') globalForStripe.stripe = stripe

// ─── Plan definitions ─────────────────────────────────────────────────────────

export type PlanTier = 'starter' | 'pro' | 'full_suite'

export const PLANS: {
  tier:     PlanTier
  name:     string
  price:    number           // USD cents
  priceKey: string           // env var suffix
  modules:  string[]
  features: string[]
  badge?:   string
}[] = [
  {
    tier:     'starter',
    name:     'Starter',
    price:    1900,
    priceKey: 'STARTER',
    modules:  ['scheduler'],
    features: [
      'Job scheduling & calendar',
      'Customer booking page',
      'SMS & email notifications',
      'Day-before reminders',
      'On-my-way alerts',
    ],
  },
  {
    tier:     'pro',
    name:     'Pro',
    price:    3400,
    priceKey: 'PRO',
    modules:  ['scheduler', 'intel'],
    badge:    'Most Popular',
    features: [
      'Everything in Starter',
      'Customer & vehicle management',
      'VIN decoder',
      'NHTSA recall lookup',
      'Service due alerts',
    ],
  },
  {
    tier:     'full_suite',
    name:     'Full Suite',
    price:    4900,
    priceKey: 'FULL_SUITE',
    modules:  ['scheduler', 'intel', 'financials'],
    features: [
      'Everything in Pro',
      'Invoicing & line items',
      'Expense tracking',
      'Monthly P&L overview',
      'Revenue & profit metrics',
    ],
  },
]

export const TIER_MODULES: Record<PlanTier, string[]> = {
  starter:    ['scheduler'],
  pro:        ['scheduler', 'intel'],
  full_suite: ['scheduler', 'intel', 'financials'],
}

export const MODULE_LABELS: Record<string, string> = {
  scheduler:  'Scheduler',
  intel:      'Intel Hub',
  financials: 'Financials',
}

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
