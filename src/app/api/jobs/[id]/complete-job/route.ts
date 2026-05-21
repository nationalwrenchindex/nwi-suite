import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { setForemanActive } from '@/lib/foreman/activate'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch the current job to get arrived_at and lunch_break_minutes
  const { data: existing } = await supabase
    .from('jobs')
    .select('arrived_at, lunch_break_minutes')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  const now        = new Date()
  const nowIso     = now.toISOString()
  const arrivedAt  = existing?.arrived_at ? new Date(existing.arrived_at) : null
  const lunchMins  = existing?.lunch_break_minutes ?? 0
  const actualMins = arrivedAt
    ? Math.max(0, Math.round((now.getTime() - arrivedAt.getTime()) / 60000) - lunchMins)
    : null

  const { data: job, error } = await supabase
    .from('jobs')
    .update({
      departed_at:          nowIso,
      actual_labor_minutes: actualMins,
      status:               'completed',
      completed_at:         nowIso,
      updated_at:           nowIso,
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*, customer:customers(id,first_name,last_name,phone,email), vehicle:vehicles(id,year,make,model,color,license_plate)')
    .single()

  if (error || !job) {
    console.error('[complete-job] update error:', error)
    return NextResponse.json({ error: error?.message ?? 'Job not found' }, { status: 404 })
  }

  // Auto-deactivate Foreman if On-The-Job Coverage is enabled
  void (async () => {
    try {
      const svc = createServiceClient()
      const { data: settings } = await svc
        .from('foreman_settings')
        .select('auto_job_activation, foreman_activated_reason')
        .eq('user_id', user.id)
        .single()
      if (settings?.auto_job_activation && settings.foreman_activated_reason === 'on_job') {
        await setForemanActive(user.id, false, null)
        console.log('[complete-job] Foreman deactivated (on_job cleared) for', user.id)
      }
    } catch (err) {
      console.error('[complete-job] foreman deactivation error:', err)
    }
  })()

  return NextResponse.json({ job, actual_labor_minutes: actualMins })
}
