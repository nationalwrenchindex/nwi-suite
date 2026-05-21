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

  const now = new Date().toISOString()

  const { data: job, error } = await supabase
    .from('jobs')
    .update({
      arrived_at: now,
      status:     'in_progress',
      updated_at: now,
    })
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
