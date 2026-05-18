import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generatePostImage } from '@/lib/social/generate'
import type { SocialPlatform } from '@/lib/social/generate'

export const maxDuration = 300

// POST /api/social/generate-images
// Phase 2 of social post generation — generates DALL-E 3 images for a batch of posts.
// Called by the client immediately after /api/social/generate returns.
// Body: { postIds: string[] }
// Returns: { results: { id, image_url | null }[] }
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const openAiKey = process.env.OPENAI_API_KEY
  if (!openAiKey) {
    console.error('[social/generate-images] OPENAI_API_KEY is not set — cannot generate images')
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 })
  }
  console.log('[social/generate-images] OPENAI_API_KEY present, length:', openAiKey.length)

  const body = await request.json().catch(() => ({}))
  const postIds: string[] = Array.isArray(body?.postIds) ? body.postIds : []
  if (postIds.length === 0) {
    return NextResponse.json({ error: 'postIds array required' }, { status: 400 })
  }
  console.log(`[social/generate-images] requested for ${postIds.length} posts:`, postIds)

  // Fetch the posts to verify ownership and get image_prompt + platform
  const { data: posts, error: fetchErr } = await supabase
    .from('social_posts')
    .select('id, platform, image_prompt')
    .eq('user_id', user.id)
    .in('id', postIds)

  if (fetchErr) {
    console.error('[social/generate-images] DB fetch error:', fetchErr)
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }
  if (!posts || posts.length === 0) {
    console.error('[social/generate-images] no posts found for ids:', postIds)
    return NextResponse.json({ error: 'No posts found' }, { status: 404 })
  }
  console.log(`[social/generate-images] found ${posts.length} posts to process`)

  // Generate all images in parallel — individual failures are non-fatal
  const results = await Promise.all(
    posts.map(async (post) => {
      if (!post.image_prompt) {
        console.warn(`[social/generate-images] post ${post.id} (${post.platform}) has no image_prompt — skipping`)
        return { id: post.id, image_url: null }
      }

      console.log(`[social/generate-images] generating DALL-E image for ${post.platform} (${post.id})...`)
      const imageUrl = await generatePostImage(
        post.image_prompt,
        post.platform as SocialPlatform,
        openAiKey,
      )

      if (!imageUrl) {
        console.error(`[social/generate-images] DALL-E returned no URL for ${post.platform} (${post.id})`)
        return { id: post.id, image_url: null }
      }

      console.log(`[social/generate-images] DALL-E success for ${post.platform} — updating DB`)
      const { error: updateErr } = await supabase
        .from('social_posts')
        .update({ image_url: imageUrl })
        .eq('id', post.id)
        .eq('user_id', user.id)

      if (updateErr) {
        console.error(`[social/generate-images] DB update error for ${post.id}:`, updateErr)
      }

      return { id: post.id, image_url: imageUrl }
    })
  )

  const succeeded = results.filter((r) => r.image_url !== null).length
  console.log(`[social/generate-images] done — ${succeeded}/${results.length} images generated successfully`)

  return NextResponse.json({ results })
}
