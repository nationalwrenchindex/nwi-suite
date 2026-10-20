// Decides whether /api/stripe/provision-session may write a subscription row.
//
// PURE, so every refusal has a test (scripts/verify-provision-session.ts). The route
// runs before the webhook to give access the moment the buyer lands back in the app;
// that is only safe when Stripe itself confirms a paid or trialing subscription.
// Anything less - an open (unpaid) session, a session with no subscription, a
// subscription that is incomplete - grants NOTHING. The webhook still provisions
// normally when the payment really completes. It used to write 'trialing' when it
// could not find a subscription, which handed out access with nothing behind it.

import { TIER_MODULES, type PlanTier } from '@/lib/stripe-plans'

/** The subscription statuses this route may record. Anything else waits for the webhook. */
export const PROVISIONABLE_STATUSES = ['active', 'trialing'] as const

export interface SessionFacts {
  mode:     string | null
  status:   string | null
  metadata: Record<string, string> | null
  customer: string | { id: string } | null
  /** Expanded subscription object, a bare id string, or null. */
  subscription: string | { id: string; status: string; current_period_end: number; cancel_at_period_end: boolean } | null
}

export type ProvisionDecision =
  | {
      ok: true
      row: {
        stripe_customer_id:     string
        stripe_subscription_id: string
        status:                 string
        tier:                   PlanTier
        modules:                string[]
        current_period_end:     string
        cancel_at_period_end:   boolean
      }
    }
  | { ok: false; httpStatus: number; error: string; reason: string }

export function decideProvision(session: SessionFacts, userId: string): ProvisionDecision {
  const refuse = (httpStatus: number, error: string, reason: string): ProvisionDecision => ({ ok: false, httpStatus, error, reason })

  if (session.metadata?.user_id !== userId) return refuse(403, 'Session mismatch', 'session user_id does not match the signed-in user')
  const tier = session.metadata?.tier as PlanTier | undefined
  if (!tier || !TIER_MODULES[tier]) return refuse(400, 'Unknown tier in session', `unknown tier ${String(tier)}`)

  const NOT_CONFIRMED = 'Subscription not confirmed in Stripe'
  if (session.mode !== 'subscription') return refuse(409, NOT_CONFIRMED, `session mode is ${String(session.mode)}`)
  if (session.status !== 'complete') return refuse(409, NOT_CONFIRMED, `session status is ${String(session.status)} (checkout not completed)`)
  const sub = session.subscription
  if (!sub || typeof sub !== 'object') return refuse(409, NOT_CONFIRMED, 'session carries no subscription')
  if (!(PROVISIONABLE_STATUSES as readonly string[]).includes(sub.status)) {
    return refuse(409, NOT_CONFIRMED, `subscription ${sub.id} status is ${sub.status}`)
  }
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null
  if (!customerId) return refuse(409, NOT_CONFIRMED, 'session carries no customer')

  // Use user-selected modules if present in metadata, otherwise fall back to tier defaults
  const selected = session.metadata?.selected_modules
  const modules = selected ? selected.split(',').filter(Boolean) : TIER_MODULES[tier]

  return {
    ok: true,
    row: {
      stripe_customer_id:     customerId,
      stripe_subscription_id: sub.id,
      status:                 sub.status,
      tier,
      modules,
      current_period_end:     new Date(sub.current_period_end * 1000).toISOString(),
      cancel_at_period_end:   sub.cancel_at_period_end,
    },
  }
}
