// Heavy-duty plan definitions.
//
// HD is sold separately from the light-duty PLANS in stripe-plans.ts, through
// /api/hd/checkout and the STRIPE_PRICE_HD_* env vars. Those price IDs were never
// represented here, so getTierFromPriceId() — which only walks PLANS — returned
// null for every HD checkout and the webhook refused to activate the subscription.
// This module is what lets the webhook recognise an HD purchase.
//
// The module lists are the same entitlements /api/admin/comp-account grants by
// hand; both now read from here so a comped HD account and a paying one cannot
// drift apart.

import { TIER_MODULES } from '@/lib/stripe-plans'

export type HdTier = 'hd_starter' | 'hd_pro' | 'hd_elite' | 'hd_reefer'

/** env var suffix → tier. STRIPE_PRICE_<suffix> holds the Stripe price ID. */
const HD_PRICE_KEYS: Record<HdTier, string> = {
  hd_starter: 'HD_STARTER',
  hd_pro:     'HD_PRO',
  hd_elite:   'HD_ELITE',
  hd_reefer:  'HD_REEFER',
}

// Reefer Standalone — reefer diagnostics only, no suite features.
const HD_REEFER_MODULES  = ['hd_quickwrench', 'hd_reefer', 'hd_epa']
// Starter — quoting, invoicing, parts, fleet, work orders, PM, truck diagnostics.
const HD_STARTER_MODULES = ['hd_quotes', 'hd_invoices', 'hd_parts', 'hd_fleet', 'hd_pm', 'hd_work_orders', 'hd_quickwrench']
// Pro — Starter + DOT inspections, EPA 608, financials.
const HD_PRO_MODULES     = [...HD_STARTER_MODULES, 'hd_dot', 'hd_epa', 'hd_financials']
// Elite — Pro + Reefer Module + Foreman AI (both require an active paid sub).
const HD_ELITE_MODULES   = [...HD_PRO_MODULES, 'hd_reefer', 'hd_foreman']

export const HD_TIER_MODULES: Record<HdTier, string[]> = {
  hd_reefer:  HD_REEFER_MODULES,
  hd_starter: HD_STARTER_MODULES,
  hd_pro:     HD_PRO_MODULES,
  // Elite is the one HD tier that also carries the light-duty suite, so an Elite
  // subscriber gets both verticals from a single subscription row.
  hd_elite:   [...HD_ELITE_MODULES, ...TIER_MODULES.elite],
}

/**
 * Resolve an HD tier from a Stripe price ID, or null when the price is not one of
 * ours. Mirrors getTierFromPriceId() for the light-duty side.
 */
export function getHdTierFromPriceId(priceId: string): HdTier | null {
  for (const [tier, key] of Object.entries(HD_PRICE_KEYS) as [HdTier, string][]) {
    const configured = process.env[`STRIPE_PRICE_${key}`]
    if (configured && configured === priceId) return tier
  }
  return null
}
