import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { generateSocialPosts } from '@/lib/social/generate'

export const dynamic = 'force-dynamic'

// GET /api/cron/social-generate
// Runs every morning at 6am UTC (see vercel.json).
// Generates today's social posts for all active subscribers.
// Protected by x-cron-secret header.
export async function GET(request: NextRequest) {
  const incomingSecret =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace('Bearer ', '')

  const expected = process.env.CRON_SECRET
  if (expected && incomingSecret !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const supabase = createServiceClient()

  // Fetch all active subscribers
  const { data: subs, error: subsErr } = await supabase
    .from('subscriptions')
    .select('user_id')
    .in('status', ['active', 'trialing'])

  if (subsErr) {
    console.error('[social-cron] DB error:', subsErr.message)
    return NextResponse.json({ error: subsErr.message }, { status: 500 })
  }

  if (!subs || subs.length === 0) {
    return NextResponse.json({ generated: 0, skipped: 0, total: 0 })
  }

  const todayStr = new Date().toISOString().slice(0, 10)
  let generated = 0
  let skipped   = 0
  let failed    = 0

  for (const sub of subs) {
    // Skip users who already have today's posts
    const { data: existing } = await supabase
      .from('social_posts')
      .select('id')
      .eq('user_id', sub.user_id)
      .gte('created_at', `${todayStr}T00:00:00Z`)
      .lt('created_at', `${todayStr}T23:59:59Z`)
      .limit(1)

    if (existing && existing.length > 0) {
      skipped++
      continue
    }

    try {
      const posts = await generateSocialPosts(apiKey)
      if (!posts) { failed++; continue }

      const inserts = posts.map((p) => ({
        user_id:           sub.user_id,
        platform:          p.platform,
        content:           p.content,
        visual_suggestion: p.visual_suggestion,
        theme:             p.theme,
        status:            'pending',
      }))

      const { error: insertErr } = await supabase
        .from('social_posts')
        .insert(inserts)

      if (insertErr) {
        console.error(`[social-cron] insert error for ${sub.user_id}:`, insertErr.message)
        failed++
      } else {
        generated++
      }
    } catch (err) {
      console.error(`[social-cron] error for ${sub.user_id}:`, err)
      failed++
    }
  }

  return NextResponse.json({ generated, skipped, failed, total: subs.length })
}
