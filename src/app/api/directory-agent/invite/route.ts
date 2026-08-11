import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendAgentSms } from '@/lib/directory-agent/sms'
import {
  authorizeAgentRequest,
  INVITE_BATCH_SIZE,
  inviteMessage,
} from '@/lib/directory-agent/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── POST /api/directory-agent/invite ────────────────────────────────────────
// Sends the permission SMS to the highest-rated pending prospects, capped at
// INVITE_BATCH_SIZE per run (the daily 9am ET cron). Best-rated first so the
// directory fills with credible shops before the long tail.
//
// A prospect is only marked contacted when Twilio accepted the message — a
// failed send leaves it pending so tomorrow's batch retries it.
export async function POST(request: NextRequest) {
  const denied = await authorizeAgentRequest(request)
  if (denied) return denied

  const supabase = createServiceClient()

  const { data: prospects, error } = await supabase
    .from('directory_prospects')
    .select('id, phone, business_name')
    .eq('status', 'pending')
    .order('rating', { ascending: false, nullsFirst: false })
    .limit(INVITE_BATCH_SIZE)

  if (error) {
    console.error('[directory-agent/invite] load failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!prospects || prospects.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0 })
  }

  let sent = 0
  let failed = 0

  for (const p of prospects) {
    const businessName = (p.business_name as string) || 'there'
    const result = await sendAgentSms({
      to:   p.phone as string,
      body: inviteMessage(businessName),
    })

    if (!result.success) {
      failed++
      console.error(`[directory-agent/invite] SMS failed for ${p.id}: ${result.error}`)
      continue
    }

    const { error: updErr } = await supabase
      .from('directory_prospects')
      .update({ status: 'contacted', contacted_at: new Date().toISOString() })
      .eq('id', p.id)

    if (updErr) {
      // The text went out — log loudly rather than resend tomorrow.
      console.error(`[directory-agent/invite] status update failed for ${p.id}:`, updErr.message)
    }
    sent++
  }

  console.log(`[directory-agent/invite] done: sent=${sent} failed=${failed}`)
  return NextResponse.json({ sent, failed })
}

// Vercel cron issues GET.
export async function GET(request: NextRequest) {
  return POST(request)
}
