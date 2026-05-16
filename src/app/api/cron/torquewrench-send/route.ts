import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendSmsResult } from '@/lib/twilio'
import { getSmsBody } from '@/lib/torquewrench/sms-templates'

export const dynamic = 'force-dynamic'

// ─── GET /api/cron/torquewrench-send ─────────────────────────────────────────
// Runs every 5 minutes (see vercel.json).
// Sends pending review-request SMS once the mechanic's send delay has elapsed.
// Protected by x-cron-secret header (same CRON_SECRET used by /api/notifications/reminders).
export async function GET(request: NextRequest) {
  const incomingSecret =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace('Bearer ', '')

  const expected = process.env.CRON_SECRET
  if (expected && incomingSecret !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServiceClient()
  const appUrl   = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const now      = Date.now()

  // All pending reviews not yet sent, under retry limit
  const { data: reviews, error: reviewsErr } = await supabase
    .from('torquewrench_reviews')
    .select('*')
    .eq('status', 'pending')
    .is('send_attempted_at', null)
    .lt('send_attempts', 3)

  if (reviewsErr) {
    console.error('[tw-cron] DB error:', reviewsErr.message)
    return NextResponse.json({ error: reviewsErr.message }, { status: 500 })
  }

  if (!reviews || reviews.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0, skipped: 0, failed: 0 })
  }

  // Batch-load settings for all unique mechanics
  const userIds = [...new Set(reviews.map((r) => r.user_id as string))]
  const { data: settingsList } = await supabase
    .from('torquewrench_settings')
    .select('*')
    .in('user_id', userIds)

  const settingsMap = new Map(
    (settingsList ?? []).map((s) => [s.user_id as string, s]),
  )

  let sent = 0, skipped = 0, failed = 0

  for (const review of reviews) {
    const settings = settingsMap.get(review.user_id as string)

    if (!settings || !settings.is_enabled) {
      skipped++
      continue
    }

    // Respect per-mechanic send delay
    const delayMs  = ((settings.send_delay_minutes as number) ?? 10) * 60 * 1000
    const createdAt = new Date(review.created_at as string).getTime()
    if (createdAt + delayMs > now) {
      skipped++
      continue
    }

    // Never send if google_place_id is missing — the link would be broken
    if (!settings.google_place_id) {
      console.warn(
        `[tw-cron] Skipping review ${review.id} — mechanic ${review.user_id} has no google_place_id`,
      )
      skipped++
      continue
    }

    if (!review.customer_phone) {
      console.warn(`[tw-cron] Skipping review ${review.id} — no customer_phone`)
      skipped++
      continue
    }

    const reviewLink   = `${appUrl}/api/torquewrench/click/${review.id}`
    const firstName    = ((review.customer_name as string) ?? '').split(' ')[0] || 'there'
    const businessName = (settings.business_name_override as string) || 'our shop'
    const body         = getSmsBody(review.service_type as string | null, {
      customer_first_name: firstName,
      business_name:       businessName,
      review_link:         reviewLink,
    })

    const result   = await sendSmsResult({ to: review.customer_phone as string, body })
    const attempts = ((review.send_attempts as number) ?? 0) + 1

    if (result.success) {
      await supabase
        .from('torquewrench_reviews')
        .update({ status: 'sent', send_attempted_at: new Date().toISOString(), send_attempts: attempts })
        .eq('id', review.id)

      console.log(`[tw-cron] Sent review SMS for ${review.id}`)
      sent++
    } else {
      // Don't update send_attempted_at — allows retry next cron run
      const newStatus = attempts >= 3 ? 'failed' : 'pending'
      await supabase
        .from('torquewrench_reviews')
        .update({ send_attempts: attempts, ...(newStatus === 'failed' ? { status: 'failed' } : {}) })
        .eq('id', review.id)

      console.error(
        `[tw-cron] SMS failed for review ${review.id} (attempt ${attempts}/3): ${result.error}`,
      )
      failed++
    }
  }

  console.log(`[tw-cron] done: processed=${reviews.length} sent=${sent} skipped=${skipped} failed=${failed}`)
  return NextResponse.json({ processed: reviews.length, sent, skipped, failed })
}
