import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ─── GET /api/notifications/logs ─────────────────────────────────────────────
// Query params: limit, offset, trigger_type, channel, status
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = request.nextUrl.searchParams
  const limit       = Number(sp.get('limit')  ?? 50)
  const offset      = Number(sp.get('offset') ?? 0)
  const triggerType = sp.get('trigger_type')
  const channel     = sp.get('channel')
  const status      = sp.get('status')

  let query = supabase
    .from('notification_logs')
    .select('*', { count: 'exact' })
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (triggerType) query = query.eq('trigger_type', triggerType)
  if (channel)     query = query.eq('channel', channel)
  if (status)      query = query.eq('status', status)

  const { data, error, count } = await query

  if (error) {
    console.error('[GET /api/notifications/logs]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ logs: data ?? [], count })
}
