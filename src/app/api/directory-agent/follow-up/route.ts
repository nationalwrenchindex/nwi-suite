import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendAgentSms } from '@/lib/directory-agent/sms'
import {
  authorizeAgentRequest,
  FOLLOW_UP_AFTER_DAYS,
  followUpMessage,
  INVITE_BATCH_SIZE,
} from '@/lib/directory-agent/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── POST /api/directory-agent/follow-up ─────────────────────────────────────
// One — and only one — nudge to prospects contacted more than
// FOLLOW_UP_AFTER_DAYS ago who never replied.
//
// The "only one" guarantee comes from two conditions, not from the cron
// cadence: status is still 'contacted' (any reply moves it off that value) and
// follow_up_sent_at is null.
export async function POST(request: NextRequest) {
  const denied = await authorizeAgentRequest(request)
  if (denied) return denied

  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - FOLLOW_UP_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: prospects, error } = await supabase
    .from('directory_prospects')
    .select('id, phone, business_name')
    .eq('status', 'contacted')
    .is('follow_up_sent_at', null)
    .lt('contacted_at', cutoff)
    .order('rating', { ascending: false, nullsFirst: false })
    .limit(INVITE_BATCH_SIZE)

  if (error) {
    console.error('[directory-agent/follow-up] load failed:', error.message)
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
      body: followUpMessage(businessName),
    })

    if (!result.success) {
      failed++
      console.error(`[directory-agent/follow-up] SMS failed for ${p.id}: ${result.error}`)
      continue
    }

    const { error: updErr } = await supabase
      .from('directory_prospects')
      .update({ follow_up_sent_at: new Date().toISOString() })
      .eq('id', p.id)

    if (updErr) {
      console.error(`[directory-agent/follow-up] stamp failed for ${p.id}:`, updErr.message)
    }
    sent++
  }

  console.log(`[directory-agent/follow-up] done: sent=${sent} failed=${failed}`)
  return NextResponse.json({ sent, failed })
}

// Vercel cron issues GET.
export async function GET(request: NextRequest) {
  return POST(request)
}
