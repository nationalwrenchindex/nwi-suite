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
// Requires a PAID (non-trial) active subscription on a reefer-capable tier.
// Trial users — regardless of tier — are locked out of the Reefer Module.
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

  // Deliberately excludes 'trialing' — reefer is locked during free trial
  const paidActive = ['active', 'past_due'].includes(data.status ?? '')
  return paidActive && HD_REEFER_TIERS.includes(data.tier ?? '')
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

  // Deliberately excludes 'trialing' — Foreman is never bundled with trials
  const paidActive = ['active', 'past_due'].includes(data.status ?? '')
  return paidActive && HD_FOREMAN_TIERS.includes(data.tier ?? '')
}
