import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { upsertSubscription } from '@/lib/subscription'
import { revalidatePath } from 'next/cache'

const FOUNDER_ID  = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
const COMP_MODULES = ['scheduler', 'intel', 'financials', 'quickwrench']

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || user.id !== FOUNDER_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null
  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 })
  }

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
    tier:                   'elite',
    modules:                COMP_MODULES,
    current_period_end:     null,
    cancel_at_period_end:   false,
    is_comped:              true,
  })

  revalidatePath('/admin')

  return NextResponse.json({
    ok:    true,
    name:  profile.full_name ?? email,
    email: profile.email ?? email,
  })
}
