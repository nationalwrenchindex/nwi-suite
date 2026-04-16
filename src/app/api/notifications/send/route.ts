import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { dispatchNotification, type NotificationTrigger } from '@/lib/notifications'

const VALID_TRIGGERS: NotificationTrigger[] = [
  'booking_confirmation',
  'day_before_reminder',
  'on_my_way',
  'job_completed',
]

// ─── POST /api/notifications/send ────────────────────────────────────────────
// Body: { trigger, job_id, channel? }
//
// trigger  — one of the four NotificationTrigger values
// job_id   — UUID of the job this notification is about
// channel  — optional override: 'sms' | 'email' | 'both'
//            (defaults to the active template's channel, or 'sms')
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

  const { trigger, job_id, channel } = body as {
    trigger?:  string
    job_id?:   string
    channel?:  string
  }

  if (!trigger || !VALID_TRIGGERS.includes(trigger as NotificationTrigger)) {
    return NextResponse.json(
      { error: `trigger must be one of: ${VALID_TRIGGERS.join(', ')}` },
      { status: 400 },
    )
  }

  if (!job_id || typeof job_id !== 'string') {
    return NextResponse.json({ error: 'job_id is required' }, { status: 400 })
  }

  // Verify the job belongs to this user
  const { data: job } = await supabase
    .from('jobs')
    .select('id')
    .eq('id', job_id)
    .eq('user_id', user.id)
    .single()

  if (!job) {
    return NextResponse.json({ error: 'Job not found or access denied' }, { status: 404 })
  }

  const result = await dispatchNotification({
    trigger:         trigger as NotificationTrigger,
    jobId:           job_id,
    supabase,
    channelOverride: channel,
  })

  const statusCode = result.success ? 200 : 422
  return NextResponse.json({ result }, { status: statusCode })
}
