import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { setForemanActive } from '@/lib/foreman/activate'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { action?: string; lunch_minutes?: number }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { action, lunch_minutes } = body

  if (action === 'end' && typeof lunch_minutes === 'number' && lunch_minutes > 0) {
    // Find the active in-progress job for this user and add the break time
    const { data: activeJob } = await supabase
      .from('jobs')
      .select('id, lunch_break_minutes')
      .eq('user_id', user.id)
      .eq('status', 'in_progress')
      .not('arrived_at', 'is', null)
      .is('departed_at', null)
      .order('arrived_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (activeJob) {
      const total = (activeJob.lunch_break_minutes ?? 0) + lunch_minutes
      await supabase
        .from('jobs')
        .update({ lunch_break_minutes: total, updated_at: new Date().toISOString() })
        .eq('id', activeJob.id)
        .eq('user_id', user.id)
    }
  }

  // Fire-and-forget: toggle Foreman if auto_job_activation is on
  void (async () => {
    try {
      const svc = createServiceClient()
      const { data: settings } = await svc
        .from('foreman_settings')
        .select('auto_job_activation, foreman_activated_reason')
        .eq('user_id', user.id)
        .single()
      if (!settings?.auto_job_activation) return
      if (action === 'start' && settings.foreman_activated_reason === 'on_job') {
        await setForemanActive(user.id, false, null)
        console.log('[lunch-break] Foreman standby (break started) for', user.id)
      } else if (action === 'end') {
        await setForemanActive(user.id, true, 'on_job')
        console.log('[lunch-break] Foreman reactivated (break ended) for', user.id)
      }
    } catch (err) {
      console.error('[lunch-break] foreman toggle error:', err)
    }
  })()

  return NextResponse.json({ ok: true })
}
