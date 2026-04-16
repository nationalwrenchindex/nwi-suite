import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ─── GET /api/notifications ───────────────────────────────────────────────────
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('notification_templates')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[GET /api/notifications]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ templates: data ?? [] })
}

// ─── POST /api/notifications ──────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.template_type) return NextResponse.json({ error: 'template_type is required' }, { status: 400 })
  if (!body.name)          return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!body.message_content) return NextResponse.json({ error: 'message_content is required' }, { status: 400 })
  if (!body.channel)       return NextResponse.json({ error: 'channel is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('notification_templates')
    .insert({
      user_id:         user.id,
      template_type:   body.template_type,
      name:            body.name,
      subject:         body.subject         ?? null,
      message_content: body.message_content,
      channel:         body.channel,
      is_active:       body.is_active       ?? true,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[POST /api/notifications]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ template: data }, { status: 201 })
}

// ─── PATCH /api/notifications ─────────────────────────────────────────────────
// Toggle is_active on a template (body: { id, is_active })
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { id?: string; is_active?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('notification_templates')
    .update({ is_active: body.is_active })
    .eq('id', body.id)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ template: data })
}
