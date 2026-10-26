import { createClient } from '@/lib/supabase/server'

// Tiers that carry any HD Suite access
const HD_TIERS         = ['hd_starter', 'hd_pro', 'hd_elite', 'hd_reefer']

// Tiers that unlock the Scheduler, Work Orders, Fleet Accounts, Financials, DOT, etc.
// hd_reefer is a standalone reefer-only product — it does not include the full suite.
const HD_STARTER_TIERS = ['hd_starter', 'hd_pro', 'hd_elite']

// Tiers that unlock the Reefer Module (alarm codes, reefer diagnostics).
// Also requires an ACTIVE paid subscription — trial users are locked out.
const HD_REEFER_TIERS  = ['hd_reefer', 'hd_elite']

// Tiers that unlock Foreman AI.
// Also requires an ACTIVE paid subscription — trial users are locked out.
const HD_FOREMAN_TIERS = ['hd_elite']

// ── Base HD access ─────────────────────────────────────────────────────────────
// Passes for any active/trialing HD subscriber regardless of tier.
// Used by: layout, QuickWrench (truck tab), PM Checklist, Quotes, Invoices, Parts.
export async function checkHDAccess(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('subscriptions')
    .select('tier, status, is_comped, vertical')
    .eq('user_id', userId)
    .single()

  if (!data) return false
  if (data.is_comped && data.vertical === 'heavy_duty') return true

  const active = ['active', 'trialing', 'past_due'].includes(data.status ?? '')
  return active && HD_TIERS.includes(data.tier ?? '')
}

// ── Starter-and-above access ───────────────────────────────────────────────────
// Passes for Starter / Pro / Elite (active or trialing). Excludes reefer standalone.
// Used by: Scheduler, Work Orders, Fleet Accounts, Financials, DOT Inspections, Import.
export async function checkHDStarterAccess(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('subscriptions')
    .select('tier, status, is_comped, vertical')
    .eq('user_id', userId)
    .single()

  if (!data) return false
  if (data.is_comped && data.vertical === 'heavy_duty') return true

  const active = ['active', 'trialing', 'past_due'].includes(data.status ?? '')
  return active && HD_STARTER_TIERS.includes(data.tier ?? '')
}

// ── Reefer Module access ───────────────────────────────────────────────────────
// A paid subscription on a reefer-capable tier, or an HD Elite free trial.
// Used by: /hd/reefer page, /api/hd/alarm-codes.
export async function checkHDReeferAccess(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('subscriptions')
    .select('tier, status, is_comped, vertical')
    .eq('user_id', userId)
    .single()

  if (!data) return false
  if (data.is_comped && data.vertical === 'heavy_duty') return true

  // REEFER IS OPEN DURING THE HD ELITE TRIAL (Brock, Oct 26). It is the one thing in
  // the product nobody else has, and a trial that hides it proves nothing to the
  // customer it was built for. So: a paid subscription on a Reefer tier, OR an HD Elite
  // trial. Reefer Standalone (hd_reefer) still needs a paid subscription - no trial is
  // offered on it, so a trialing hd_reefer row is not one this product created.
  //
  // Foreman is the opposite and stays paid-only on a trial: see checkHDForemanAccess.
  // The trial itself (15 days, card, once per customer) is decided in src/lib/ld-trial.ts.
  return reeferAllowed(data)
}

type GateRow = { tier: string | null; status: string | null; is_comped: boolean | null; vertical: string | null }

/** checkHDReeferAccess's rule on a row already read. Pure, so the trial check tests it. */
export function reeferAllowed(data: GateRow): boolean {
  if (data.is_comped && data.vertical === 'heavy_duty') return true
  const paidActive = ['active', 'past_due'].includes(data.status ?? '')
  const eliteTrial = data.status === 'trialing' && data.tier === 'hd_elite'
  return (paidActive || eliteTrial) && HD_REEFER_TIERS.includes(data.tier ?? '')
}

// ── Foreman AI access ──────────────────────────────────────────────────────────
// Requires a PAID (non-trial) active Elite subscription.
// Trial users are locked out of Foreman AI.
// Used by: /hd/foreman page.
export async function checkHDForemanAccess(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('subscriptions')
    .select('tier, status, is_comped, vertical')
    .eq('user_id', userId)
    .single()

  if (!data) return false
  if (data.is_comped && data.vertical === 'heavy_duty') return true

  return hdForemanAllowed(data)
}

/** checkHDForemanAccess's rule on a row already read. Pure, so the trial check tests it. */
export function hdForemanAllowed(data: GateRow): boolean {
  if (data.is_comped && data.vertical === 'heavy_duty') return true
  // Deliberately excludes 'trialing' — Foreman is never included in a trial
  const paidActive = ['active', 'past_due'].includes(data.status ?? '')
  return paidActive && HD_FOREMAN_TIERS.includes(data.tier ?? '')
}
