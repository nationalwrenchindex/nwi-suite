import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { setForemanActive, shouldForemanBeActiveForHours, type BusinessHours } from '@/lib/foreman/activate'

// Vercel Cron: runs every 5 minutes.
// For each user with auto_hours_activation = true, checks current time against
// their business_hours and activates/deactivates Foreman accordingly.
// Never overrides an active on_job reason.
export async function GET() {
  const svc = createServiceClient()

  const { data: rows, error } = await svc
    .from('foreman_settings')
    .select('user_id, is_enabled, auto_hours_activation, business_hours, foreman_activated_reason')
    .eq('auto_hours_activation', true)

  if (error) {
    console.error('[foreman-hours] query error:', error)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ checked: 0, activated: 0, deactivated: 0 })
  }

  let activated   = 0
  let deactivated = 0

  for (const row of rows) {
    // Never override on_job activation — that's controlled by the arrive/complete-job routes
    if (row.foreman_activated_reason === 'on_job') continue

    const outsideHours = shouldForemanBeActiveForHours(row.business_hours as BusinessHours | null)

    try {
      if (outsideHours && !row.is_enabled) {
        await setForemanActive(row.user_id, true, 'after_hours')
        activated++
      } else if (!outsideHours && row.is_enabled && row.foreman_activated_reason === 'after_hours') {
        await setForemanActive(row.user_id, false, null)
        deactivated++
      }
    } catch (err) {
      console.error('[foreman-hours] failed for user', row.user_id, ':', err)
    }
  }

  console.log(`[foreman-hours] checked=${rows.length} activated=${activated} deactivated=${deactivated}`)
  return NextResponse.json({ checked: rows.length, activated, deactivated })
}
