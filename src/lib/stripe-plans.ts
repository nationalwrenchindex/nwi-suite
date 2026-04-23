// ─── Client-safe plan definitions ────────────────────────────────────────────
// NO Stripe SDK import here — safe to import from client components.

export type PlanTier = 'starter' | 'pro' | 'full_suite' | 'quickwrench' | 'elite'

export const PLANS: {
  tier:     PlanTier
  name:     string
  price:    number           // USD cents
  priceKey: string           // STRIPE_PRICE_<priceKey> env var suffix
  modules:  string[]
  features: string[]
  badge?:   string
  promo?:   string
}[] = [
  {
    tier:     'starter',
    name:     'NWI Starter',
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
    name:     'NWI Pro',
    price:    3400,
    priceKey: 'PRO',
    badge:    'Most Popular',
    modules:  ['scheduler', 'intel'],
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
    name:     'NWI Full Suite',
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
  {
    tier:     'quickwrench',
    name:     'NWI QuickWrench',
    price:    6900,
    priceKey: 'QUICKWRENCH',
    badge:    'Standalone',
    modules:  ['quickwrench'],
    features: [
      'VIN scan in 2 seconds',
      'AI-powered tech guide',
      'Torque specs & procedures',
      'Multi-supplier parts pricing',
      'Customer-facing quotes',
      'Multi-job support',
      'Per-job profit tracking',
    ],
  },
  {
    tier:     'elite',
    name:     'NWI Elite',
    price:    9900,
    priceKey: 'ELITE',
    badge:    'Best Value',
    modules:  ['scheduler', 'intel', 'financials', 'quickwrench'],
    features: [
      'Everything in Full Suite',
      'Everything in QuickWrench',
      'Per-job P&L with fuel tracking',
      'Auto-financial breakdown',
      'Priority support',
    ],
    promo: '🔥 LAUNCH PRICING: First 100 subscribers lock in $99/mo for life. After subscriber #100, Elite increases to $129/mo.',
  },
]

export const TIER_MODULES: Record<PlanTier, string[]> = {
  starter:     ['scheduler'],
  pro:         ['scheduler', 'intel'],
  full_suite:  ['scheduler', 'intel', 'financials'],
  quickwrench: ['quickwrench'],
  elite:       ['scheduler', 'intel', 'financials', 'quickwrench'],
}

export const MODULE_LABELS: Record<string, string> = {
  scheduler:   'Scheduler',
  intel:       'Intel Hub',
  financials:  'Financials',
  quickwrench: 'QuickWrench',
}
