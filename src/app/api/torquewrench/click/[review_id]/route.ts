import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { buildGoogleReviewUrl } from '@/lib/torquewrench/review-url'

// ─── GET /api/torquewrench/click/[review_id] ─────────────────────────────────
// Click-tracking redirect. Records first click then sends the customer straight
// to the mechanic's Google review page.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ review_id: string }> },
) {
  const { review_id } = await params

  const supabase = createServiceClient()

  const { data: review } = await supabase
    .from('torquewrench_reviews')
    .select('user_id, clicked_at')
    .eq('id', review_id)
    .single()

  if (!review) {
    return NextResponse.redirect('https://www.google.com')
  }

  // Record first click only — idempotent
  if (!review.clicked_at) {
    await supabase
      .from('torquewrench_reviews')
      .update({ clicked_at: new Date().toISOString() })
      .eq('id', review_id)
  }

  // Get mechanic's google_place_id
  const { data: settings } = await supabase
    .from('torquewrench_settings')
    .select('google_place_id')
    .eq('user_id', review.user_id)
    .single()

  if (!settings?.google_place_id) {
    return NextResponse.redirect('https://www.google.com')
  }

  const googleUrl = buildGoogleReviewUrl(settings.google_place_id as string)
  return NextResponse.redirect(googleUrl, { status: 302 })
}
