import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// PATCH /api/social/[id]
// Updates status ('posted' | 'skipped') or content for a social post.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const updates: Record<string, unknown> = {}

  if (body.status !== undefined) {
    const allowed = ['pending', 'posted', 'skipped']
    if (!allowed.includes(body.status as string)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    updates.status = body.status
    if (body.status === 'posted') {
      updates.posted_at = new Date().toISOString()
    }
  }

  if (body.content !== undefined) {
    if (typeof body.content !== 'string' || !body.content.trim()) {
      return NextResponse.json({ error: 'content must be a non-empty string' }, { status: 400 })
    }
    updates.content = body.content.trim()
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('social_posts')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, platform, content, visual_suggestion, image_prompt, image_url, theme, status, created_at, posted_at')
    .single()

  if (error) {
    console.error('[PATCH /api/social/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }

  return NextResponse.json({ post: data })
}
