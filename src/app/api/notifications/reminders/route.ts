import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { dispatchNotification } from '@/lib/notifications'

// ─── POST /api/notifications/reminders ───────────────────────────────────────
// Called daily by Vercel Cron at 8:00 AM UTC (see vercel.json).
// Sends day-before SMS/email to every customer with a job scheduled tomorrow.
//
// Protected by CRON_SECRET env var.
// curl -X POST https://your-domain.com/api/notifications/reminders \
//      -H "x-cron-secret: $CRON_SECRET"
export async function POST(request: NextRequest) {
  const incomingSecret =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace('Bearer ', '')

  const expected = process.env.CRON_SECRET
  if (expected && incomingSecret !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = await createClient()

  // Tomorrow in YYYY-MM-DD (UTC)
  const tomorrow = new Date()
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const tomorrowStr = tomorrow.toISOString().slice(0, 10)

  // All 'scheduled' jobs for tomorrow (across all users)
  // RLS is bypassed for cron—this uses the service role context via the server client.
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, user_id, customer_id')
    .eq('job_date', tomorrowStr)
    .eq('status', 'scheduled')
    .not('customer_id', 'is', null)

  if (error) {
    console.error('[reminders] DB error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ date: tomorrowStr, total: 0, sent: 0, failed: 0 })
  }

  // Fire all reminders in parallel
  const results = await Promise.allSettled(
    jobs.map((job) =>
      dispatchNotification({
        trigger:  'day_before_reminder',
        jobId:    job.id,
        supabase,
      }),
    ),
  )

  const sent   = results.filter(
    (r) => r.status === 'fulfilled' && (r.value as { success: boolean }).success,
  ).length
  const failed = results.length - sent

  console.log(`[reminders] ${tomorrowStr}: total=${results.length} sent=${sent} failed=${failed}`)

  return NextResponse.json({ date: tomorrowStr, total: results.length, sent, failed })
}
