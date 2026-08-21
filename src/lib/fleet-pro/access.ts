// SERVER-ONLY. Fleet Pro membership resolution and route gating.
//
// Deliberately mirrors the shape of src/lib/hd-access.ts — a bare `userId: string`
// in, a decision out — so it reads like the rest of the codebase. The difference is
// that HD access answers "does this mechanic own a subscription", while this answers
// "which fleet does this person belong to, and at what level".

import { createServiceClient } from '@/lib/supabase/service'
import type { FleetProMembership, FleetProRole } from '@/types/fleet-pro'

// A membership only counts while the department's own subscription is live.
const LIVE_FLEET_STATUSES = ['active', 'trialing', 'past_due']

/**
 * Resolve the caller's Fleet Pro membership, or null if they have none.
 *
 * Uses the service client rather than the session client on purpose: the RLS
 * helper fleet_pro_account_ids() reads fleet_pro_members, and having the app
 * read that same table through a policy that depends on it is a recursion
 * hazard. The user id is supplied by the caller after getUser(), and every
 * query below is explicitly scoped to it.
 */
export async function getFleetProMembership(userId: string): Promise<FleetProMembership | null> {
  const svc = createServiceClient()

  const { data, error } = await svc
    .from('fleet_pro_members')
    .select(`
      id, email, full_name, role, status, fleet_account_id,
      hd_fleet_accounts!inner ( id, fleet_name, fleet_pro_enabled, fleet_pro_status )
    `)
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  const account = (data as Record<string, unknown>).hd_fleet_accounts as {
    id: string; fleet_name: string; fleet_pro_enabled: boolean; fleet_pro_status: string | null
  } | null

  if (!account) return null
  if (!account.fleet_pro_enabled) return null
  if (!LIVE_FLEET_STATUSES.includes(account.fleet_pro_status ?? '')) return null

  return {
    member_id:        data.id as string,
    fleet_account_id: data.fleet_account_id as string,
    fleet_name:       account.fleet_name,
    role:             data.role as FleetProRole,
    status:           'active',
    email:            data.email as string,
    full_name:        (data.full_name as string | null) ?? null,
  }
}

/**
 * True when the user is the mechanic who owns this fleet account. Kurt reaches
 * the same data through the HD Suite, but the Fleet Pro admin endpoints (invite,
 * enable billing) are his to drive, so he needs a way through them too.
 */
export async function ownsFleetAccount(userId: string, fleetAccountId: string): Promise<boolean> {
  const svc = createServiceClient()
  const { data } = await svc
    .from('hd_fleet_accounts')
    .select('id')
    .eq('id', fleetAccountId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}

/**
 * Gate for the portal's own API routes. Returns the membership, or an explanation
 * of why not — callers map that to a 401/403.
 */
export async function requireFleetProMember(
  userId: string | null,
): Promise<{ ok: true; membership: FleetProMembership } | { ok: false; status: number; error: string }> {
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' }

  const membership = await getFleetProMembership(userId)
  if (!membership) {
    return { ok: false, status: 403, error: 'No active Fleet Pro membership' }
  }
  return { ok: true, membership }
}

/** Manager-only gate, layered on top of requireFleetProMember. */
export async function requireFleetProManager(
  userId: string | null,
): Promise<{ ok: true; membership: FleetProMembership } | { ok: false; status: number; error: string }> {
  const result = await requireFleetProMember(userId)
  if (!result.ok) return result
  if (result.membership.role !== 'manager') {
    return { ok: false, status: 403, error: 'Fleet manager role required' }
  }
  return result
}
