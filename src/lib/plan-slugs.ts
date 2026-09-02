// URL slugs for plan preselection: /signup?plan=<slug> and /hd/signup?plan=<slug>.
//
// These are the PUBLIC names — what goes in a marketing link, an email, or a pricing
// card href. They are deliberately separate from the internal tier keys, for two
// reasons. The internal keys use underscores (`full_suite_plus`) which read badly in a
// URL, and the HD keys are ambiguous out of context (`starter` and `pro` mean the HD
// tiers on /hd/signup but the LD tiers on /signup). A slug like `hd-pro` says which
// vertical it belongs to on its own, so a link cannot be pasted into the wrong funnel
// and silently sell the wrong product.
//
// SAFE BY DEFAULT: an unrecognized slug resolves to null and the caller falls back to
// the normal plan picker. A bad link therefore costs a click, never a wrong charge.
//
// No env access here — this module is imported by client components. The slug maps to a
// TIER; the tier is resolved to a Stripe price ID server-side (getPriceId() for LD,
// HD_PRICE_MAP for HD), which is where the price is logged.

import type { PlanTier } from './stripe-plans'

/** Light-duty: /signup?plan=<slug> */
export const LD_PLAN_SLUGS: Readonly<Record<string, PlanTier>> = {
  'starter':          'starter',
  'pro':              'pro',
  'full-suite':       'full_suite',
  'full-suite-plus':  'full_suite_plus',
  'elite':            'elite',
}

/**
 * Heavy-duty: /hd/signup?plan=<slug>.
 *
 * Values are the plan keys used by the HD signup page's PLANS array and by
 * HD_PRICE_MAP in /api/hd/checkout — NOT the HdTier values from hd-plans.ts, which
 * differ (`hd_starter` vs `starter`). Getting this wrong sends a valid-looking slug
 * into a price lookup that returns undefined and 400s at checkout.
 */
export const HD_PLAN_SLUGS: Readonly<Record<string, string>> = {
  'reefer-standalone': 'hd_reefer',
  'hd-starter':        'starter',
  'hd-pro':            'pro',
  'hd-elite':          'elite',
  'hd-ld-bundle':      'elite_bundle',
}

/** Resolve an LD slug, or null when absent/unknown. Case- and space-insensitive. */
export function resolveLdSlug(slug: string | null | undefined): PlanTier | null {
  if (!slug) return null
  return LD_PLAN_SLUGS[slug.trim().toLowerCase()] ?? null
}

/** Resolve an HD slug, or null when absent/unknown. */
export function resolveHdSlug(slug: string | null | undefined): string | null {
  if (!slug) return null
  return HD_PLAN_SLUGS[slug.trim().toLowerCase()] ?? null
}

/**
 * Light-duty tiers whose checkout requires module picks, and how many.
 *
 * This is why preselection cannot skip the whole second step for every plan. Starter
 * and Pro let the subscriber choose which modules they get, and
 * /api/stripe/checkout REJECTS the request with a 400 unless exactly this many valid
 * modules are sent. Skipping the step for these two would create the account and then
 * fail at the payment boundary — the worst possible place to fail, because the user
 * has already handed over their details.
 *
 * Mirrors MODULE_PICK_COUNT in stripe-plans.ts and the PICK_COUNT constant inside the
 * checkout route. If any of the three changes, all three must.
 */
export const SLUG_REQUIRES_MODULE_PICK: Readonly<Partial<Record<PlanTier, number>>> = {
  starter: 1,
  pro:     2,
}

/** True when a preselected LD tier still needs the module picker shown. */
export function ldSlugNeedsModulePick(tier: PlanTier | null): boolean {
  return tier !== null && SLUG_REQUIRES_MODULE_PICK[tier] !== undefined
}

/** One-line log string, so a slug/tier mismatch is greppable in the client console. */
export function describeSlugResolution(
  vertical: 'ld' | 'hd',
  slug: string | null | undefined,
  resolved: string | null,
): string {
  if (!slug) return `[${vertical}-signup] no plan slug — showing the plan picker`
  if (!resolved) {
    return `[${vertical}-signup] plan slug "${slug}" is not recognized — falling back to the plan picker`
  }
  return `[${vertical}-signup] plan slug "${slug}" -> ${resolved}`
}
