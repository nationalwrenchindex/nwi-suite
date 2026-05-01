// GET /api/inbox — fetch 10 most recent notifications for the current user

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, link, read_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    console.error('[GET /api/inbox]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const unread = (data ?? []).filter(n => !n.read_at).length

  return NextResponse.json({ notifications: data ?? [], unread })
}
