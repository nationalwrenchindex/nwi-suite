import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { upsertSubscription } from '@/lib/subscription'
import { HD_TIER_MODULES } from '@/lib/hd-plans'
import { revalidatePath } from 'next/cache'

const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

const TIER_CONFIG: Record<string, { modules: string[]; vertical: string }> = {
  starter:         { modules: ['scheduler', 'intel'],                                    vertical: 'light_duty' },
  pro:             { modules: ['scheduler', 'intel', 'financials'],                      vertical: 'light_duty' },
  full_suite:      { modules: ['scheduler', 'intel', 'financials', 'quickwrench'],       vertical: 'light_duty' },
  full_suite_plus: { modules: ['scheduler', 'intel', 'financials', 'quickwrench'],       vertical: 'light_duty' },
  elite:           { modules: ['scheduler', 'intel', 'financials', 'quickwrench'],       vertical: 'light_duty' },
  // HD entitlements come from the shared plan map the Stripe webhook also uses, so
  // a comped HD account and a paying one always grant exactly the same modules.
  hd_reefer:  { modules: HD_TIER_MODULES.hd_reefer,  vertical: 'heavy_duty' },
  hd_starter: { modules: HD_TIER_MODULES.hd_starter, vertical: 'heavy_duty' },
  hd_pro:     { modules: HD_TIER_MODULES.hd_pro,     vertical: 'heavy_duty' },
  hd_elite:   { modules: HD_TIER_MODULES.hd_elite,   vertical: 'heavy_duty' },
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || user.id !== FOUNDER_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body  = await request.json()
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null
  const tier  = typeof body?.tier  === 'string' ? body.tier  : 'elite'

  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

  const config = TIER_CONFIG[tier]
  if (!config) return NextResponse.json({ error: `Unknown tier: ${tier}` }, { status: 400 })

  const svc = createServiceClient()
  const { data: profile } = await svc
    .from('profiles')
    .select('id, full_name, email')
    .eq('email', email)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'No account found with that email' }, { status: 404 })
  }

  await upsertSubscription({
    user_id:                profile.id,
    stripe_customer_id:     null,
    stripe_subscription_id: null,
    status:                 'active',
    tier,
    modules:                config.modules,
    vertical:               config.vertical,
    current_period_end:     null,
    cancel_at_period_end:   false,
    is_comped:              true,
  })

  revalidatePath('/admin')

  return NextResponse.json({
    ok:    true,
    name:  profile.full_name ?? email,
    email: profile.email ?? email,
    tier,
  })
}
