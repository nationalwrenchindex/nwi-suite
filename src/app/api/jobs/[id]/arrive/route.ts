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

  // Fetch current job to compute drive_minutes from drive_started_at
  const { data: existing } = await supabase
    .from('jobs')
    .select('drive_started_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  const now            = new Date()
  const nowIso         = now.toISOString()
  const driveStartedAt = existing?.drive_started_at ? new Date(existing.drive_started_at) : null
  const driveMinutes   = driveStartedAt
    ? Math.round((now.getTime() - driveStartedAt.getTime()) / 60000)
    : null

  const updatePayload: Record<string, unknown> = {
    arrived_at:    nowIso,
    drive_ended_at: nowIso,
    status:        'in_progress',
    updated_at:    nowIso,
  }
  if (driveMinutes != null) updatePayload.drive_minutes = driveMinutes

  const { data: job, error } = await supabase
    .from('jobs')
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*, customer:customers(id,first_name,last_name,phone,email), vehicle:vehicles(id,year,make,model,color,license_plate)')
    .single()

  if (error || !job) {
    console.error('[arrive] update error:', error)
    return NextResponse.json({ error: error?.message ?? 'Job not found' }, { status: 404 })
  }

  // Auto-activate Foreman if On-The-Job Coverage is enabled
  void (async () => {
    try {
      const svc = createServiceClient()
      const { data: settings } = await svc
        .from('foreman_settings')
        .select('auto_job_activation')
        .eq('user_id', user.id)
        .single()
      if (settings?.auto_job_activation) {
        await setForemanActive(user.id, true, 'on_job')
        console.log('[arrive] Foreman auto-activated (on_job) for', user.id)
      }
    } catch (err) {
      console.error('[arrive] foreman activation error:', err)
    }
  })()

  return NextResponse.json({ job })
}
