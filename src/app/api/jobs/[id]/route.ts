import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { dispatchNotification } from '@/lib/notifications'

const JOB_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, color, license_plate)
`

type RouteContext = { params: Promise<{ id: string }> }

// ─── GET /api/jobs/[id] ───────────────────────────────────────────────────────
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  return NextResponse.json({ job: data })
}

// ─── PUT /api/jobs/[id] ───────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Strip server-managed and relation fields before updating
  const {
    id: _id,
    user_id: _uid,
    created_at: _ca,
    updated_at: _ua,
    customer: _c,
    vehicle: _v,
    ...updateData
  } = body as Record<string, unknown>

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('jobs')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(JOB_SELECT)
    .single()

  if (error) {
    console.error('[PUT /api/jobs/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Job not found or access denied' }, { status: 404 })
  }

  // Auto-send job_completed notification when tech marks the job done
  if (updateData.status === 'completed' && data.customer_id) {
    dispatchNotification({
      trigger:  'job_completed',
      jobId:    id,
      supabase,
    }).catch((err) => console.error('[PUT /api/jobs/[id]] notification error:', err))
  }

  return NextResponse.json({ job: data })
}

// ─── DELETE /api/jobs/[id] ────────────────────────────────────────────────────
// Soft-delete: sets status → 'cancelled', preserves the record for history
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const { data, error } = await supabase
    .from('jobs')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, status')
    .single()

  if (error) {
    console.error('[DELETE /api/jobs/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Job not found or access denied' }, { status: 404 })
  }

  return NextResponse.json({ success: true, job: data })
}
