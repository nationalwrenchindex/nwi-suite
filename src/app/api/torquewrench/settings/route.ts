import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasTorqueWrenchAccess } from '@/lib/subscription'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasTorqueWrenchAccess(user.id)) {
    return NextResponse.json({ error: 'TorqueWrench access required.' }, { status: 403 })
  }

  const { data } = await supabase
    .from('torquewrench_settings')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json({ settings: data ?? null })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasTorqueWrenchAccess(user.id)) {
    return NextResponse.json({ error: 'TorqueWrench access required.' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const ALLOWED = [
    'is_enabled', 'google_place_id', 'google_review_url', 'business_name_override',
    'send_delay_minutes', 'service_recovery_enabled', 'service_recovery_phone',
  ]

  const payload: Record<string, unknown> = {
    user_id:    user.id,
    updated_at: new Date().toISOString(),
  }
  for (const key of ALLOWED) {
    if (key in body) payload[key] = body[key]
  }

  const { error } = await supabase
    .from('torquewrench_settings')
    .upsert(payload, { onConflict: 'user_id' })

  if (error) {
    console.error('[POST /api/torquewrench/settings]', error)
    return NextResponse.json({ error: 'Failed to save settings.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
