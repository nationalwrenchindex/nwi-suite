// GET /api/fleet-pro/partner/billing — what the partner is being charged, per fleet.
//
// Reads hd_fleet_accounts.fleet_pro_*, never fleet_pro_reseller_accounts: migration
// 106 deliberately left the subscription columns off the reseller table so there is
// exactly one place billing state can live, and the Stripe webhook writes that place.
// A second copy here would drift the first time a payment failed.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { stripe } from '@/lib/stripe'
import { requirePartner, getPartnerFleetIds } from '@/lib/fleet-pro/partner-access'
import { FLEET_PRO_MONTHLY_CENTS } from '@/types/fleet-pro-partner'
import type { PartnerBillingSummary, PartnerSubscriptionRow } from '@/types/fleet-pro-partner'

export const dynamic = 'force-dynamic'

// Same three statuses the migration 105 gating functions treat as live, so the count
// on this page always matches the number of portals the partner's customers can open.
const LIVE_STATUSES = ['active', 'trialing', 'past_due']

// A partner reselling more than this many fleets is not a case we have, and each id
// past it would be another serial Stripe round-trip on a page load. Above the cap the
// DB values stand on their own — they are written by the webhook and already correct.
const STRIPE_ENRICH_LIMIT = 40

interface AccountRecord {
  id:                               string
  fleet_name:                       string | null
  fleet_pro_enabled:                boolean | null
  fleet_pro_status:                 string | null
  fleet_pro_stripe_subscription_id: string | null
  fleet_pro_current_period_end:     string | null
}

/**
 * True period ends, straight from Stripe, keyed by subscription id.
 *
 * Enrichment only — hd_fleet_accounts.fleet_pro_current_period_end is written on every
 * lifecycle event and is what renders when this returns nothing. A Stripe outage, a
 * revoked key, or a subscription deleted out from under us must show a slightly stale
 * renewal date, never a 500 on the page that tells the partner what he owes.
 */
async function stripePeriodEnds(subIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()

  const results = await Promise.allSettled(
    subIds.map(id => stripe.subscriptions.retrieve(id)),
  )

  for (const result of results) {
    if (result.status !== 'fulfilled') {
      console.error('[fleet-pro/partner/billing] subscription retrieve failed:', result.reason)
      continue
    }
    const sub = result.value
    if (sub.current_period_end) {
      out.set(sub.id, new Date(sub.current_period_end * 1000).toISOString())
    }
  }

  return out
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requirePartner(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { partner } = gate

  // STRIPE_PRICE_FLEET_PRO is not set yet — the $299/mo price does not exist in
  // Stripe. Everything below has to render anyway, so this flag is reported rather
  // than thrown on: the page uses it to explain the state and disable the buy button.
  const priceConfigured = !!process.env.STRIPE_PRICE_FLEET_PRO

  const fleetIds = await getPartnerFleetIds(partner.id)

  // No fleets is a valid answer for a partner who has not added a customer yet.
  let accounts: AccountRecord[] = []
  if (fleetIds.length > 0) {
    // Service client: the partner's RLS policy in 106 would let him read these rows,
    // but the fleet_pro_* columns are billing state that only ever moves through the
    // service role in the webhook. Reading them the same way keeps the two in step.
    const svc = createServiceClient()
    const { data, error } = await svc
      .from('hd_fleet_accounts')
      .select(`
        id, fleet_name, fleet_pro_enabled, fleet_pro_status,
        fleet_pro_stripe_subscription_id, fleet_pro_current_period_end
      `)
      // Scoped to the ids getPartnerFleetIds returned and nothing from the request —
      // this is the only thing separating one partner's book from another's.
      .in('id', fleetIds)

    if (error) {
      console.error('[fleet-pro/partner/billing]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    accounts = (data ?? []) as AccountRecord[]
  }

  const subIds = accounts
    .map(a => a.fleet_pro_stripe_subscription_id)
    .filter((id): id is string => !!id)
    .slice(0, STRIPE_ENRICH_LIMIT)

  // Skipped entirely when the price is unset: with no Fleet Pro price in Stripe there
  // is no live Fleet Pro subscription to look up, so this would only burn round-trips.
  const periodEnds = priceConfigured && subIds.length > 0
    ? await stripePeriodEnds(subIds)
    : new Map<string, string>()

  const subscriptions: PartnerSubscriptionRow[] = accounts.map(a => ({
    fleet_account_id:       a.id,
    fleet_name:             a.fleet_name ?? '(unnamed fleet)',
    status:                 a.fleet_pro_status ?? null,
    enabled:                a.fleet_pro_enabled === true,
    stripe_subscription_id: a.fleet_pro_stripe_subscription_id ?? null,
    current_period_end:     (a.fleet_pro_stripe_subscription_id
                              ? periodEnds.get(a.fleet_pro_stripe_subscription_id)
                              : undefined)
                            ?? a.fleet_pro_current_period_end
                            ?? null,
    monthly_cents:          FLEET_PRO_MONTHLY_CENTS,
  }))

  subscriptions.sort((a, b) => a.fleet_name.localeCompare(b.fleet_name, 'en', { numeric: true }))

  // past_due counts as billable: Stripe is still retrying that invoice and the portal
  // is still open, so dropping it from the total would understate what the partner owes.
  const activeCount = subscriptions.filter(s => LIVE_STATUSES.includes(s.status ?? '')).length

  const summary: PartnerBillingSummary = {
    partner_name:        partner.partner_name,
    stripe_customer_id:  partner.stripe_customer_id,
    subscriptions,
    active_count:        activeCount,
    monthly_total_cents: activeCount * FLEET_PRO_MONTHLY_CENTS,
    price_configured:    priceConfigured,
  }

  return NextResponse.json({ summary })
}
