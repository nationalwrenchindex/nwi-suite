// ─── Client-safe plan definitions ────────────────────────────────────────────
// NO Stripe SDK import here — safe to import from client components.

export type PlanTier =
  | 'starter'
  | 'pro'
  | 'full_suite'
  | 'full_suite_plus'
  | 'elite'
  | 'foreman_standalone'
  | 'quickwrench'

export const PLANS: {
  tier:      PlanTier
  name:      string
  price:     number           // USD cents
  priceKey:  string           // STRIPE_PRICE_<priceKey> env var suffix
  priceId?:  string           // Actual Stripe price ID (used for highlight logic)
  modules:   string[]
  features:  string[]
  badge?:    string
  trialDays: number
}[] = [
  {
    tier:      'starter',
    name:      'NWI Starter',
    price:     1900,
    priceKey:  'STARTER',
    modules:   [],
    trialDays: 14,
    features: [
      'Choose 1 module: Scheduler, Intel Hub, or Financials',
      'Public booking page',
      '14-day free trial',
      'Cancel anytime',
    ],
  },
  {
    tier:      'pro',
    name:      'NWI Pro',
    price:     3400,
    priceKey:  'PRO',
    modules:   [],
    trialDays: 14,
    badge:     'Most Popular',
    features: [
      'Choose any 2: Scheduler, Intel Hub, or Financials',
      'Public booking page',
      '14-day free trial',
      'Cancel anytime',
    ],
  },
  {
    tier:      'full_suite',
    name:      'NWI Full Suite',
    price:     4900,
    priceKey:  'FULL_SUITE',
    modules:   ['scheduler', 'intel', 'financials'],
    trialDays: 14,
    features: [
      'Scheduler — booking, calendar, SMS reminders',
      'Intel Hub — customer profiles, VIN decoder, service alerts',
      'Financials — invoicing, expenses, P&L reports',
      '14-day free trial',
      'Cancel anytime',
    ],
  },
  {
    tier:      'full_suite_plus',
    name:      'NWI Full Suite Plus',
    price:     9900,
    priceKey:  'FULL_SUITE_PLUS',
    priceId:   'price_1TPTFEBalq9wt09kKvpgwyfR',
    modules:   ['scheduler', 'intel', 'financials', 'quickwrench', 'torquewrench'],
    trialDays: 14,
    badge:     'RECOMMENDED',
    features: [
      'Everything in Full Suite',
      'QuickWrench — VIN scan, AI tech guide, parts pricing',
      'TorqueWrench — automated review requests & follow-up',
      '14-day free trial',
      'Cancel anytime',
    ],
  },
  {
    tier:      'elite',
    name:      'NWI Elite',
    price:     15900,
    priceKey:  'ELITE',
    modules:   ['scheduler', 'intel', 'financials', 'quickwrench', 'torquewrench', 'foreman'],
    trialDays: 0,
    badge:     'All-In-One',
    features: [
      'Everything in Full Suite Plus',
      'Foreman AI receptionist',
      'Up to 150 free minutes / month',
      'Billed immediately · No free trial',
    ],
  },
  {
    tier:      'foreman_standalone',
    name:      'NWI Foreman Standalone',
    price:     5900,
    priceKey:  'FOREMAN',
    modules:   ['scheduler', 'foreman'],
    trialDays: 0,
    features: [
      'AI call answering & smart receptionist',
      'Free Scheduler module included',
      'Up to 150 free minutes / month',
      'Billed immediately · No free trial',
    ],
  },
  {
    tier:      'quickwrench',
    name:      'NWI QuickWrench',
    price:     6900,
    priceKey:  'QUICKWRENCH',
    modules:   ['quickwrench'],
    trialDays: 14,
    badge:     'STANDALONE',
    features: [
      'VIN camera scanner — point and shoot',
      'AI torque specs and repair sequence',
      'DTC fault code lookup and diagnosis',
      'Open recall check via NHTSA database',
      'Fluid specifications by vehicle',
      'Live parts pricing from multiple suppliers',
      'Quote builder — text to customer instantly',
      'VIN to quote in under 2 minutes',
      'No full Suite required',
    ],
  },
]

export const TIER_MODULES: Record<PlanTier, string[]> = {
  starter:            [],
  pro:                [],
  full_suite:         ['scheduler', 'intel', 'financials'],
  full_suite_plus:    ['scheduler', 'intel', 'financials', 'quickwrench', 'torquewrench'],
  elite:              ['scheduler', 'intel', 'financials', 'quickwrench', 'torquewrench', 'foreman'],
  foreman_standalone: ['scheduler', 'foreman'],
  quickwrench:        ['quickwrench'],
}

export const MODULE_LABELS: Record<string, string> = {
  scheduler:    'Scheduler',
  intel:        'Intel Hub',
  financials:   'Financials',
  quickwrench:  'QuickWrench',
  torquewrench: 'TorqueWrench',
  foreman:      'Foreman',
}

// The 3 modules a Starter or Pro subscriber chooses from
export const SELECTABLE_MODULES = ['scheduler', 'intel', 'financials'] as const
export type SelectableModule = typeof SELECTABLE_MODULES[number]

export const MODULE_DESCRIPTIONS: Record<SelectableModule, string> = {
  scheduler:  'Booking page, calendar, job management, automatic SMS reminders',
  intel:      'Customer profiles, vehicle history, VIN decoder, service alerts',
  financials: 'Professional invoicing, expense tracking, revenue and profit reports',
}

// How many modules each choosable tier lets the user pick
export const MODULE_PICK_COUNT: Partial<Record<PlanTier, number>> = {
  starter: 1,
  pro:     2,
}
