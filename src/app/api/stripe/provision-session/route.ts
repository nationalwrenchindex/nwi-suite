// POST /api/stripe/provision-session
// Called immediately after Stripe checkout redirect (before webhook fires).
// Retrieves the checkout session and upserts a provisional subscription record,
// so module access is available the moment the user lands back in the app.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe, TIER_MODULES, type PlanTier } from '@/lib/stripe'
import { upsertSubscription } from '@/lib/subscription'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { session_id?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { session_id } = body
  if (!session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription'],
    })

    if (session.metadata?.user_id !== user.id) {
      return NextResponse.json({ error: 'Session mismatch' }, { status: 403 })
    }

    const tier = session.metadata?.tier as PlanTier | undefined
    if (!tier || !TIER_MODULES[tier]) {
      return NextResponse.json({ error: 'Unknown tier in session' }, { status: 400 })
    }

    const customerId = typeof session.customer === 'string'
      ? session.customer
      : (session.customer as { id: string } | null)?.id ?? ''

    const sub = session.subscription && typeof session.subscription === 'object'
      ? session.subscription as { id: string; status: string; current_period_end: number; cancel_at_period_end: boolean }
      : null

    await upsertSubscription({
      user_id:                user.id,
      stripe_customer_id:     customerId,
      stripe_subscription_id: sub?.id ?? null,
      status:                 sub?.status ?? 'trialing',
      tier,
      modules:                TIER_MODULES[tier],
      current_period_end:     sub ? new Date(sub.current_period_end * 1000).toISOString() : null,
      cancel_at_period_end:   sub?.cancel_at_period_end ?? false,
    })

    return NextResponse.json({ ok: true, tier })
  } catch (err) {
    console.error('[provision-session]', err)
    return NextResponse.json({ error: 'Failed to provision subscription' }, { status: 500 })
  }
}
