// ─── Client-safe plan definitions ────────────────────────────────────────────
// NO Stripe SDK import here — safe to import from client components.

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
