import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendSmsResult } from '@/lib/twilio'
import { getSmsBody } from '@/lib/torquewrench/sms-templates'
import { getContactSuppressionByPhone } from '@/lib/customer-contact'
import { authorizeCron } from '@/lib/cron-auth'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

export const dynamic = 'force-dynamic'

// Paging multiplies this sweep's round trips — a tenant past the 1,000-row cap now
// costs several sequential requests per table where it used to cost one. The default
// function timeout is short enough that a large fleet could be cut off mid-sweep, which
// would reintroduce the skipped-rows bug through the back door. 60s matches the other
// long-running crons (see api/directory-agent/*).
export const maxDuration = 60

// PostgREST stops at 1,000 rows and still returns 200, so a backlog past the cap
// would never be sent — the cron would report success having skipped the tail.
const PAGE_SIZE = 500

// `.in()` lists ride in the URL, so the mechanic list goes out in batches now
// that the review load is unbounded.
const IN_CHUNK = 200

type Row = Record<string, unknown>

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// ─── GET /api/cron/torquewrench-send ─────────────────────────────────────────
// Runs every 5 minutes (see vercel.json).
// Sends pending review-request SMS once the mechanic's send delay has elapsed.
// Protected by x-cron-secret header (same CRON_SECRET used by /api/notifications/reminders).
export async function GET(request: NextRequest) {
  const denied = authorizeCron(request)
  if (denied) return denied

  const supabase = createServiceClient()
  const appUrl   = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const now      = Date.now()

  // All pending reviews not yet sent, under retry limit. Ordered oldest-first so
  // the range paging has a stable order to walk — without one, Postgres is free
  // to hand back the same row twice and drop another entirely.
  let reviews: Row[]
  try {
    reviews = await fetchAllRows<Row>(
      (from, to) => supabase
        .from('torquewrench_reviews')
        .select('*')
        .eq('status', 'pending')
        .is('send_attempted_at', null)
        .lt('send_attempts', 3)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
      PAGE_SIZE,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'review load failed'
    console.error('[tw-cron] DB error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (reviews.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0, skipped: 0, failed: 0 })
  }

  // Batch-load settings for all unique mechanics. A failure here would otherwise
  // mark every review 'skipped' and report a clean run, so it fails the cron.
  const userIds = [...new Set(reviews.map((r) => r.user_id as string))]
  const settingsMap = new Map<string, Row>()
  try {
    for (const ids of chunk(userIds, IN_CHUNK)) {
      const settingsList = await fetchAllRows<Row>(
        (from, to) => supabase
          .from('torquewrench_settings')
          .select('*')
          .in('user_id', ids)
          .order('id', { ascending: true })
          .range(from, to),
        PAGE_SIZE,
      )
      for (const s of settingsList) settingsMap.set(s.user_id as string, s)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'settings load failed'
    console.error('[tw-cron] settings load failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

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

    // A customer marked do-not-SMS must not receive a review request. Keyed on the
    // phone because torquewrench_reviews carries no customer_id and its job_id is
    // frequently null, so there is no other handle on who this is. Marked 'skipped'
    // rather than left pending, or the cron would retry it every five minutes forever.
    const suppression = await getContactSuppressionByPhone(
      supabase,
      review.user_id as string | null,
      review.customer_phone as string | null,
    )
    if (suppression.no_sms) {
      await supabase
        .from('torquewrench_reviews')
        .update({ status: 'skipped', send_attempted_at: new Date().toISOString() })
        .eq('id', review.id)
      console.log(`[tw-cron] Suppressed review ${review.id} — customer opted out of SMS`)
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
