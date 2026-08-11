import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { authorizeAgentRequest } from '@/lib/directory-agent/config'
import { sendAgentSms } from '@/lib/directory-agent/sms'
import {
  HD_FROM_NUMBER,
  HD_INVITE_BATCH_SIZE,
  hdInviteMessage,
} from '@/lib/hd-directory-agent/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── POST /api/hd-directory-agent/invite ─────────────────────────────────────
// Sends the permission SMS to the highest-rated pending HD prospects, capped at
// HD_INVITE_BATCH_SIZE per run (the daily 10am ET cron). Copy is selected per
// service category — a reefer tech and a towing operator get different pitches.
//
// A prospect is only marked contacted when Twilio accepted the message, so a
// failed send stays pending for tomorrow's batch.
export async function POST(request: NextRequest) {
  const denied = await authorizeAgentRequest(request)
  if (denied) return denied

  const supabase = createServiceClient()
  const from     = HD_FROM_NUMBER()

  const { data: prospects, error } = await supabase
    .from('hd_directory_prospects')
    .select('id, phone, business_name, service_category')
    .eq('status', 'pending')
    // Truck stops are bulk-imported straight to the directory by
    // src/scripts/import-truck-stops.ts and must never be texted an invite —
    // they never opted into anything and are already listed.
    //
    // Written as an explicit or-null rather than .neq(): in SQL,
    // NULL != 'truck_stop' evaluates to NULL, not true, so a bare .neq() would
    // silently drop every prospect whose category was never set.
    .or('service_category.is.null,service_category.neq.truck_stop')
    .order('rating', { ascending: false, nullsFirst: false })
    .limit(HD_INVITE_BATCH_SIZE)

  if (error) {
    console.error('[hd-directory-agent/invite] load failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!prospects || prospects.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0 })
  }

  let sent = 0
  let failed = 0

  for (const p of prospects) {
    const businessName = (p.business_name as string) || 'there'
    const category     = (p.service_category as string | null) ?? null

    const result = await sendAgentSms({
      to:   p.phone as string,
      body: hdInviteMessage(businessName, category),
      from,
    })

    if (!result.success) {
      failed++
      console.error(`[hd-directory-agent/invite] SMS failed for ${p.id}: ${result.error}`)
      continue
    }

    const { error: updErr } = await supabase
      .from('hd_directory_prospects')
      .update({ status: 'contacted', contacted_at: new Date().toISOString() })
      .eq('id', p.id)

    if (updErr) {
      // The text went out — log loudly rather than resend tomorrow.
      console.error(`[hd-directory-agent/invite] status update failed for ${p.id}:`, updErr.message)
    }
    sent++
  }

  console.log(`[hd-directory-agent/invite] done: sent=${sent} failed=${failed}`)
  return NextResponse.json({ sent, failed })
}

// Vercel cron issues GET.
export async function GET(request: NextRequest) {
  return POST(request)
}
