// POST /api/admin/work-orders-flag — turn the Work Orders feature on or off for
// one business. Founder-only, matching api/admin/comp-account: this app has no
// admin role, the check is an id comparison, and that is the whole gate.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { revalidatePath } from 'next/cache'

const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || user.id !== FOUNDER_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { user_id?: string; enabled?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const userId = typeof body.user_id === 'string' ? body.user_id : ''
  if (!userId) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 })
  }

  // Service client: this writes to a profile that is not the caller's, which RLS
  // exists to prevent. The founder check above is what authorises it.
  const svc = createServiceClient()
  const { error } = await svc
    .from('profiles')
    .update({ work_orders_enabled: !!body.enabled })
    .eq('id', userId)

  if (error) {
    console.error('[admin/work-orders-flag]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  revalidatePath('/admin')
  return NextResponse.json({ ok: true, user_id: userId, enabled: !!body.enabled })
}
