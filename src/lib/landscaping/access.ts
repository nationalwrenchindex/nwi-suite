import { createClient } from '@/lib/supabase/server'

// Tiers that carry Landscaping vertical access.
export const LAWN_TIERS = ['lawn_starter', 'lawn_pro', 'lawn_elite']

// Module slug gating Field Assist (AI plant/lawn/pest diagnosis + estimates).
export const FIELD_ASSIST_MODULE = 'field_assist'

const ACTIVE_STATUSES = ['active', 'trialing', 'past_due']

// ── Field Assist access ────────────────────────────────────────────────────────
// Passes when any one of the following holds on an active subscription:
//   1. is_comped = true  — comped accounts bypass regardless of vertical, so a
//      manually inserted comp row does not need a landscaping-specific tier.
//      (hd-access.ts scopes its comp bypass to vertical = 'heavy_duty'; we
//      deliberately do not, since comps are provisioned by hand.)
//   2. tier is a landscaping tier
//   3. modules array explicitly grants field_assist
//
// Reads subscriptions.user_id — the same column every other gate uses.
export async function checkFieldAssistAccess(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('subscriptions')
    .select('tier, status, modules, is_comped, vertical')
    .eq('user_id', userId)
    .single()

  if (!data) return false
  if (!ACTIVE_STATUSES.includes(data.status ?? '')) return false
  if (data.is_comped) return true
  if (LAWN_TIERS.includes(data.tier ?? '')) return true
  return ((data.modules as string[] | null) ?? []).includes(FIELD_ASSIST_MODULE)
}
