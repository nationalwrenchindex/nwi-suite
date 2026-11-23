// SERVER-ONLY. Who is a fleet manager, and of which fleet.
//
// ─── WHY THIS IS NOT fleet_pro_members ───────────────────────────────────────
// Migration 105 gives an active Fleet Pro member SELECT on WHOLE ROWS of
// hd_work_orders, hd_invoices and hd_units for their fleet. Probed live on Nov 23,
// 2026 with a throwaway VIEWER (the least-privileged role): the member's own token
// read labor_rate, total, tax_amount, parts_cost, parts_markup_percent,
// internal_notes, customer_email, line_items (with unit cost and markup) and
// hd_units.estimated_value straight from PostgREST. A fleet manager must never see
// money, so his access cannot ride on a row those policies match.
//
// ─── THE GRANT ───────────────────────────────────────────────────────────────
// It lives on the auth user, in app_metadata.fleet_manager:
//   { fleet_account_id, shop_user_id, granted_at }
// app_metadata is written only with the service role - the user cannot edit it (that
// is user_metadata). No table row exists for him, so no RLS policy anywhere matches
// him: his own session token reads NOTHING from hd_* directly. Every read he gets
// goes through lib/fleet-view/unit-history, on the service client, scoped to the
// grant, through a column whitelist. The smoke flow Fm proves the direct reads empty.
//
// getUser() returns app_metadata fresh from the auth server, so revoking (clearing
// the key) ends access on the next request.

import type { User } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'

/** What every fleet-facing read is scoped to. A later caller (the QR page) builds one too. */
export interface FleetScope {
  /** The shop (mechanic) that owns the fleet account and every document read. */
  shopUserId: string
  fleetAccountId: string
}

export interface FleetManagerGrant {
  fleet_account_id: string
  shop_user_id: string
  granted_at: string
}

export const FLEET_MANAGER_KEY = 'fleet_manager'

/** The grant as stored, or null. Shape-checked: a malformed value grants nothing. */
export function grantOf(user: Pick<User, 'app_metadata'> | null | undefined): FleetManagerGrant | null {
  const g = (user?.app_metadata as Record<string, unknown> | undefined)?.[FLEET_MANAGER_KEY] as Record<string, unknown> | undefined
  if (!g || typeof g !== 'object') return null
  const fleet = typeof g.fleet_account_id === 'string' ? g.fleet_account_id : ''
  const shop = typeof g.shop_user_id === 'string' ? g.shop_user_id : ''
  if (!fleet || !shop) return null
  return { fleet_account_id: fleet, shop_user_id: shop, granted_at: typeof g.granted_at === 'string' ? g.granted_at : '' }
}

export interface FleetManagerAccess extends FleetScope {
  fleetName: string
}

/**
 * The signed-in user's fleet, or null. The fleet account must still exist AND still
 * belong to the shop named in the grant - a deleted account, or a grant pointing at
 * another shop's account, grants nothing.
 */
export async function resolveFleetManager(user: User | null): Promise<FleetManagerAccess | null> {
  const g = grantOf(user)
  if (!g) return null
  const svc = createServiceClient()
  const { data } = await svc
    .from('hd_fleet_accounts')
    .select('id, fleet_name')
    .eq('id', g.fleet_account_id)
    .eq('user_id', g.shop_user_id)
    .maybeSingle()
  if (!data) return null
  return { shopUserId: g.shop_user_id, fleetAccountId: g.fleet_account_id, fleetName: String(data.fleet_name ?? '') }
}

/**
 * May this fleet manager see one record (a PM or DOT sheet) of this shop's? The record
 * must be the grant's shop's, and on the grant's fleet - by its own fleet_account_id,
 * or, when it carries none, by its unit's.
 */
export async function fleetManagerMaySee(
  user: User | null,
  record: { shopUserId: string | null; fleetAccountId?: string | null; unitId?: string | null },
): Promise<boolean> {
  const access = await resolveFleetManager(user)
  if (!access || record.shopUserId !== access.shopUserId) return false
  if (record.fleetAccountId) return record.fleetAccountId === access.fleetAccountId
  if (!record.unitId) return false
  const svc = createServiceClient()
  const { data } = await svc
    .from('hd_units')
    .select('fleet_account_id')
    .eq('id', record.unitId)
    .eq('user_id', access.shopUserId)
    .maybeSingle()
  return data?.fleet_account_id === access.fleetAccountId
}
