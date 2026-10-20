// POST /api/stripe/provision-session
// Called immediately after Stripe checkout redirect (before webhook fires).
// Retrieves the checkout session and upserts a provisional subscription record,
// so module access is available the moment the user lands back in the app.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'
import { upsertSubscription } from '@/lib/subscription'
import { decideProvision, type SessionFacts } from '@/lib/provision-session'

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

    // Grants only what Stripe confirms: a completed checkout with an active or trialing
    // subscription. Anything else writes NOTHING and is logged - the webhook provisions
    // when the payment really completes. See src/lib/provision-session.ts.
    const decision = decideProvision({
      mode:         session.mode ?? null,
      status:       session.status ?? null,
      metadata:     session.metadata ?? null,
      customer:     session.customer as SessionFacts['customer'],
      subscription: session.subscription as SessionFacts['subscription'],
    }, user.id)

    if (!decision.ok) {
      console.warn(`[provision-session] REFUSED user=${user.id} session=${session_id}: ${decision.reason}`)
      return NextResponse.json({ error: decision.error }, { status: decision.httpStatus })
    }

    await upsertSubscription({ user_id: user.id, ...decision.row })

    return NextResponse.json({ ok: true, tier: decision.row.tier })
  } catch (err) {
    console.error('[provision-session]', err)
    return NextResponse.json({ error: 'Failed to provision subscription' }, { status: 500 })
  }
}
