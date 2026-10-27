// Reefer Standalone: the reefer-only product at /reefer ($129/mo, 15-day trial).
//
// NOT hd_reefer. hd_reefer is the older $79 diagnostics-only plan sold under /hd; it is
// untouched. reefer_standalone is a separate tier with its OWN module list.
//
// HOW IT IS GATED. It is in none of the existing tier lists - not PAID_TIERS
// (subscription.ts), not HD_TIERS / HD_STARTER_TIERS / HD_REEFER_TIERS / HD_FOREMAN_TIERS
// (hd-access.ts) - so every existing gate refuses it. A route that should admit it says
// so explicitly: `checkHDAccess(id) || reeferStandaloneCan(id, 'reefer_quotes')`. The HD
// gate runs first, unchanged, and the reefer check only passes a reefer_standalone row
// holding that exact module. A route nobody opened stays closed.
//
// WHY EVERY MODULE IS PREFIXED reefer_. The LD gate matches a module as `x` OR `hd_x`
// (hasModuleVariant) and getModuleAccess strips `hd_`. A plain 'financials' or
// 'hd_financials' stored on this row would open LD Financials too. No reefer_ name can
// be read as an LD or HD module.
//
// PURE. No Supabase here, so the gate matrix (scripts/verify-reefer-gates.ts) tests the
// exact rules the app runs.

export const REEFER_STANDALONE_TIER = 'reefer_standalone'
export const REEFER_STANDALONE_PRICE_DOLLARS = 129

export const REEFER_STANDALONE_MODULES = [
  'reefer_dashboard',
  'reefer_scheduler',        // calendar + My Jobs
  'reefer_intel',            // Intel Hub
  'reefer_financials',
  'reefer_quotes',
  'reefer_work_orders',
  'reefer_invoices',
  'reefer_diagnostics',      // QuickWrench reefer AI diagnosis
  'reefer_alarm_codes',      // verified alarm-code lookup
  'reefer_labor_cards',
  'reefer_parts_reference',  // TK / Carrier parts reference + parts lookup
  'reefer_pm',               // PM checklists + PM schedules
  'reefer_units',            // reefer units
  'reefer_customers',        // fleet accounts
  'reefer_epa',              // EPA 608 log
  'reefer_settings',
] as const

export type ReeferModule = typeof REEFER_STANDALONE_MODULES[number]

export interface ReeferGateRow {
  tier:   string | null
  status: string | null
}

/** A live reefer_standalone subscription: paid, trialing or past_due. */
export function isReeferStandaloneRow(row: ReeferGateRow | null | undefined): boolean {
  if (!row) return false
  return row.tier === REEFER_STANDALONE_TIER
    && ['active', 'trialing', 'past_due'].includes(row.status ?? '')
}

/** The whole reefer_standalone rule: a live row of this tier, and a module on its list. */
export function reeferStandaloneAllowed(row: ReeferGateRow | null | undefined, module: string): boolean {
  return isReeferStandaloneRow(row) && (REEFER_STANDALONE_MODULES as readonly string[]).includes(module)
}

// ── The /reefer surface ──────────────────────────────────────────────────────────────
//
// /reefer/X renders the same page as /hd/X. These are the X that exist under /reefer.
// The middleware uses this list twice: a /reefer path not on it goes to the dashboard,
// and a reefer browser following an /hd link inside a reused screen is sent to /reefer/X
// only when X is on it.

export const REEFER_AUTH_PATHS = ['login', 'signup'] as const

/** First path segment (after /reefer) -> allowed. Sub-paths listed in REEFER_BLOCKED_SUBPATHS are refused. */
export const REEFER_SECTIONS = [
  'dashboard', 'scheduler', 'intel', 'financials',
  'quotes', 'work-orders', 'invoices', 'invoicing',
  'quickwrench', 'reefer', 'labor-cards', 'parts',
  'pm-checklist', 'pm-schedules', 'epa-log',
  'fleet-units', 'fleet-accounts', 'settings',
  ...REEFER_AUTH_PATHS,
] as const

/** Paths under an allowed section that are still not part of Reefer. */
export const REEFER_BLOCKED_SUBPATHS = [
  '/fleet-units/categories',  // the nine-category manager (boom, aerial ...)
] as const

/** True when `suffix` (the path after /reefer or /hd, e.g. '/quotes/123') is a reefer screen. */
export function isReeferPath(suffix: string): boolean {
  const s = suffix === '' ? '/' : suffix
  const seg = s.split('/')[1] ?? ''
  if (!(REEFER_SECTIONS as readonly string[]).includes(seg)) return false
  if (REEFER_BLOCKED_SUBPATHS.some(b => s === b || s.startsWith(b + '/'))) return false
  // /fleet-units/<id>/inspections is the inspection history - not reefer.
  if (/^\/fleet-units\/[^/]+\/inspections(\/|$)/.test(s)) return false
  return true
}

/** The cookie the middleware sets while a browser is on the reefer surface. */
export const REEFER_SURFACE_COOKIE = 'nwi_surface'

/** Client-side: is this pathname on the /reefer surface? */
export function isReeferSurfacePath(pathname: string | null | undefined): boolean {
  return !!pathname && (pathname === '/reefer' || pathname.startsWith('/reefer/'))
}

/** An equipment category belongs to Reefer when its name says so ("Reefer Unit"). */
export function isReeferCategoryName(name: string | null | undefined): boolean {
  return /reefer/i.test(name ?? '')
}

/**
 * May this account start a Reefer Standalone checkout? Only when it holds no live
 * subscription of ANY tier. One subscriptions row per account: buying Reefer on top of
 * a live HD or LD plan would leave the old Stripe subscription billing while the row
 * was overwritten, and a live Reefer account has nothing to buy.
 */
export function canStartReeferCheckout(row: ReeferGateRow & { is_comped?: boolean | null } | null | undefined): boolean {
  if (!row) return true
  if (row.is_comped) return false
  return !['active', 'trialing', 'past_due'].includes(row.status ?? '')
}
