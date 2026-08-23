// SERVER-ONLY. Partner (reseller) resolution for the Fleet Pro layer.
//
// Sits above src/lib/fleet-pro/access.ts: that answers "which fleet is this person a
// member of", this answers "which fleets does this person resell". The two are
// disjoint by design — a partner is not a member of his customers' fleets, which is
// what keeps his cost basis out of their portal and their staff out of his billing.

import { createServiceClient } from '@/lib/supabase/service'
import type { FleetProPartner, FleetBranding } from '@/types/fleet-pro-partner'

/** Resolve the caller's partner record, or null if they do not resell anything. */
export async function getPartner(userId: string): Promise<FleetProPartner | null> {
  const svc = createServiceClient()
  const { data } = await svc
    .from('fleet_pro_partners')
    .select('id, user_id, partner_name, contact_email, default_logo_url, stripe_customer_id, active')
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle()

  if (!data) return null
  return {
    id:                 data.id as string,
    user_id:            data.user_id as string,
    partner_name:       data.partner_name as string,
    contact_email:      (data.contact_email as string | null) ?? null,
    default_logo_url:   (data.default_logo_url as string | null) ?? null,
    stripe_customer_id: (data.stripe_customer_id as string | null) ?? null,
  }
}

/**
 * Get or create the partner row. Creating on first visit rather than requiring a
 * signup step: any mechanic with HD access who opens the partner dashboard is, by
 * definition, about to resell. Falls back through business_name -> full_name.
 */
export async function ensurePartner(userId: string): Promise<FleetProPartner | null> {
  const existing = await getPartner(userId)
  if (existing) return existing

  const svc = createServiceClient()
  const { data: profile } = await svc
    .from('profiles')
    .select('business_name, full_name, email, business_logo_url')
    .eq('id', userId)
    .maybeSingle()

  const { error } = await svc.from('fleet_pro_partners').insert({
    user_id:          userId,
    partner_name:     (profile?.business_name as string | null)
                      ?? (profile?.full_name as string | null)
                      ?? 'NWI Partner',
    contact_email:    (profile?.email as string | null) ?? null,
    default_logo_url: (profile?.business_logo_url as string | null) ?? null,
  })
  if (error && error.code !== '23505') {
    console.error('[partner-access] could not create partner row:', error.message)
    return null
  }
  return getPartner(userId)
}

/** The fleet account ids this partner resells. Empty array is a valid answer. */
export async function getPartnerFleetIds(partnerId: string): Promise<string[]> {
  const svc = createServiceClient()
  const { data } = await svc
    .from('fleet_pro_reseller_accounts')
    .select('fleet_account_id')
    .eq('partner_id', partnerId)
  return (data ?? []).map(r => r.fleet_account_id as string)
}

/**
 * True when this partner resells this fleet account. Every partner route that takes
 * an accountId from the URL must call this before reading anything — it is the only
 * thing standing between one partner and another partner's customers.
 */
export async function partnerOwnsAccount(partnerId: string, fleetAccountId: string): Promise<boolean> {
  const svc = createServiceClient()
  const { data } = await svc
    .from('fleet_pro_reseller_accounts')
    .select('id')
    .eq('partner_id', partnerId)
    .eq('fleet_account_id', fleetAccountId)
    .maybeSingle()
  return !!data
}

/** Gate for partner API routes. */
export async function requirePartner(
  userId: string | null,
): Promise<{ ok: true; partner: FleetProPartner } | { ok: false; status: number; error: string }> {
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' }
  const partner = await getPartner(userId)
  if (!partner) return { ok: false, status: 403, error: 'No active Fleet Pro partner account' }
  return { ok: true, partner }
}

/**
 * White-label settings for one fleet account, with sensible fallbacks so a fleet
 * that was never branded still renders a name rather than an empty header.
 */
export async function getFleetBranding(fleetAccountId: string): Promise<FleetBranding> {
  const svc = createServiceClient()
  const [{ data: reseller }, { data: account }] = await Promise.all([
    svc.from('fleet_pro_reseller_accounts')
      .select('brand_name, brand_logo_url, brand_accent_color')
      .eq('fleet_account_id', fleetAccountId)
      .maybeSingle(),
    svc.from('hd_fleet_accounts')
      .select('fleet_name')
      .eq('id', fleetAccountId)
      .maybeSingle(),
  ])

  return {
    brand_name:         (reseller?.brand_name as string | null)
                        ?? (account?.fleet_name as string | null)
                        ?? 'Fleet Pro',
    brand_logo_url:     (reseller?.brand_logo_url as string | null) ?? null,
    brand_accent_color: (reseller?.brand_accent_color as string | null) ?? null,
  }
}
