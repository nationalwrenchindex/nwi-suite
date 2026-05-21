import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasForemanAccess } from '@/lib/subscription'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasForemanAccess(user.id)) {
    return NextResponse.json({ error: 'Foreman access required.' }, { status: 403 })
  }

  const { data } = await supabase
    .from('foreman_settings')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({ settings: data ?? null })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasForemanAccess(user.id)) {
    return NextResponse.json({ error: 'Foreman access required.' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const ALLOWED = [
    'is_enabled', 'business_name', 'mechanic_first_name', 'mechanic_phone',
    'greeting_name', 'working_hours_start', 'working_hours_end',
    'working_days', 'after_hours_message',
    'auto_job_activation', 'auto_hours_activation', 'business_hours',
  ]

  const payload: Record<string, unknown> = {
    user_id:    user.id,
    updated_at: new Date().toISOString(),
  }
  for (const key of ALLOWED) {
    if (key in body) payload[key] = body[key]
  }

  const { error } = await supabase
    .from('foreman_settings')
    .upsert(payload, { onConflict: 'user_id' })

  if (error) {
    console.error('[POST /api/foreman/settings]', error)
    return NextResponse.json({ error: 'Failed to save settings.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
