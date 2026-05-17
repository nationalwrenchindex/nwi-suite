import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateSocialPosts } from '@/lib/social/generate'

// POST /api/social/generate
// Generates today's social posts for the authenticated user.
// Returns cached posts if already generated today.
// Body: { force?: boolean } — force=true skips cache and regenerates.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const force = body?.force === true

  const today    = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  // Return cached posts unless force-regenerating
  if (!force) {
    const { data: existing } = await supabase
      .from('social_posts')
      .select('id, platform, content, visual_suggestion, theme, status, created_at, posted_at')
      .eq('user_id', user.id)
      .gte('created_at', `${todayStr}T00:00:00Z`)
      .lt('created_at', `${todayStr}T23:59:59Z`)
      .order('created_at', { ascending: true })

    if (existing && existing.length >= 5) {
      return NextResponse.json({ posts: existing, cached: true })
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const generated = await generateSocialPosts(apiKey)
  if (!generated) {
    return NextResponse.json({ error: 'AI generation failed' }, { status: 502 })
  }

  // Delete today's existing posts before inserting fresh ones (handles force-regen)
  if (force) {
    await supabase
      .from('social_posts')
      .delete()
      .eq('user_id', user.id)
      .gte('created_at', `${todayStr}T00:00:00Z`)
      .lt('created_at', `${todayStr}T23:59:59Z`)
  }

  const inserts = generated.map((p) => ({
    user_id:           user.id,
    platform:          p.platform,
    content:           p.content,
    visual_suggestion: p.visual_suggestion,
    theme:             p.theme,
    status:            'pending',
  }))

  const { data: stored, error: insertErr } = await supabase
    .from('social_posts')
    .insert(inserts)
    .select('id, platform, content, visual_suggestion, theme, status, created_at, posted_at')

  if (insertErr) {
    console.error('[social/generate] insert error:', insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({ posts: stored, cached: false })
}
