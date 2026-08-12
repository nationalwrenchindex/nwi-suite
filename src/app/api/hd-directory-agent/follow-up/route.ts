import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { authorizeAgentRequest } from '@/lib/directory-agent/config'
import { sendAgentSms } from '@/lib/directory-agent/sms'
import {
  HD_FOLLOW_UP_AFTER_DAYS,
  HD_FROM_NUMBER,
  HD_INVITE_BATCH_SIZE,
  HD_NO_VENUES_FILTER,
  hdFollowUpMessage,
} from '@/lib/hd-directory-agent/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── POST /api/hd-directory-agent/follow-up ──────────────────────────────────
// One — and only one — nudge to HD prospects contacted more than
// HD_FOLLOW_UP_AFTER_DAYS ago who never replied.
//
// The "only one" guarantee comes from two conditions, not from the cron
// cadence: status is still 'contacted' (any reply moves it off that value) and
// follow_up_sent_at is null.
export async function POST(request: NextRequest) {
  const denied = await authorizeAgentRequest(request)
  if (denied) return denied

  const supabase = createServiceClient()
  const from     = HD_FROM_NUMBER()
  const cutoff = new Date(Date.now() - HD_FOLLOW_UP_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: prospects, error } = await supabase
    .from('hd_directory_prospects')
    .select('id, phone, business_name')
    .eq('status', 'contacted')
    // Same guard as the invite route — venues are never texted.
    .or(HD_NO_VENUES_FILTER)
    .is('follow_up_sent_at', null)
    .lt('contacted_at', cutoff)
    .order('rating', { ascending: false, nullsFirst: false })
    .limit(HD_INVITE_BATCH_SIZE)

  if (error) {
    console.error('[hd-directory-agent/follow-up] load failed:', error.message)
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
      body: hdFollowUpMessage(businessName),
      from,
    })

    if (!result.success) {
      failed++
      console.error(`[hd-directory-agent/follow-up] SMS failed for ${p.id}: ${result.error}`)
      continue
    }

    const { error: updErr } = await supabase
      .from('hd_directory_prospects')
      .update({ follow_up_sent_at: new Date().toISOString() })
      .eq('id', p.id)

    if (updErr) {
      console.error(`[hd-directory-agent/follow-up] stamp failed for ${p.id}:`, updErr.message)
    }
    sent++
  }

  console.log(`[hd-directory-agent/follow-up] done: sent=${sent} failed=${failed}`)
  return NextResponse.json({ sent, failed })
}

// Vercel cron issues GET.
export async function GET(request: NextRequest) {
  return POST(request)
}
