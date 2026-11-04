import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { generateSocialPosts, generatePostImage } from '@/lib/social/generate'
import type { SocialPlatform } from '@/lib/social/generate'
import { isGeminiConfigured } from '@/lib/gemini/client'
import { authorizeCron } from '@/lib/cron-auth'
import { SOCIAL_OWNER_ID } from '@/lib/social/owner'

export const dynamic = 'force-dynamic'

// GET /api/cron/social-generate
// NO LONGER SCHEDULED: its vercel.json entry was removed on Nov 4, 2026.
// It generated a batch of NWI's OWN marketing posts for every active or trialing
// subscriber, which put them into subscriber accounts. Run by hand, it now writes for
// the founder account only (lib/social/owner) and never for anyone else.
// Protected by x-cron-secret header.
export async function GET(request: NextRequest) {
  const denied = authorizeCron(request)
  if (denied) return denied

  const openAiKey = process.env.OPENAI_API_KEY

  if (!isGeminiConfigured()) {
    return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 })
  }

  const supabase = createServiceClient()

  // The founder account only - never the subscriber list.
  const subs = [{ user_id: SOCIAL_OWNER_ID }]

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
      const posts = await generateSocialPosts()
      if (!posts) { failed++; continue }

      const inserts = posts.map((p) => ({
        user_id:           sub.user_id,
        platform:          p.platform,
        content:           p.content,
        visual_suggestion: p.visual_suggestion,
        image_prompt:      p.image_prompt,
        theme:             p.theme,
        status:            'pending',
      }))

      const { data: inserted, error: insertErr } = await supabase
        .from('social_posts')
        .insert(inserts)
        .select('id, platform')

      if (insertErr) {
        console.error(`[social-cron] insert error for ${sub.user_id}:`, insertErr.message)
        failed++
        continue
      }

      generated++

      // Generate DALL-E 3 images in parallel; failures are non-fatal
      if (openAiKey && inserted && inserted.length > 0) {
        await Promise.all(
          inserted.map(async (row) => {
            const draft = posts.find((d) => d.platform === row.platform)
            if (!draft?.image_prompt) return
            const imageUrl = await generatePostImage(draft.image_prompt, row.platform as SocialPlatform, openAiKey)
            if (!imageUrl) return
            await supabase
              .from('social_posts')
              .update({ image_url: imageUrl })
              .eq('id', row.id)
          })
        )
      }
    } catch (err) {
      console.error(`[social-cron] error for ${sub.user_id}:`, err)
      failed++
    }
  }

  return NextResponse.json({ generated, skipped, failed, total: subs.length })
}
