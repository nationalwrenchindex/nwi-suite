import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { dispatchNotification } from '@/lib/notifications'

const JOB_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, color, license_plate)
`

// ─── GET /api/jobs ────────────────────────────────────────────────────────────
// Query params: date, status, service_type, from_date, to_date, limit, offset
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = request.nextUrl.searchParams
  const date        = sp.get('date')
  const status      = sp.get('status')
  const serviceType = sp.get('service_type')
  const fromDate    = sp.get('from_date')
  const toDate      = sp.get('to_date')
  const limit       = Number(sp.get('limit') ?? 100)
  const offset      = Number(sp.get('offset') ?? 0)

  let query = supabase
    .from('jobs')
    .select(JOB_SELECT)
    .eq('user_id', user.id)
    .order('job_date', { ascending: true })
    .order('job_time', { ascending: true, nullsFirst: true })
    .range(offset, offset + limit - 1)

  if (date)        query = query.eq('job_date', date)
  if (status)      query = query.eq('status', status)
  if (serviceType) query = query.ilike('service_type', `%${serviceType}%`)
  if (fromDate)    query = query.gte('job_date', fromDate)
  if (toDate)      query = query.lte('job_date', toDate)

  const { data, error, count } = await query

  if (error) {
    console.error('[GET /api/jobs]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ jobs: data ?? [], count })
}

// ─── POST /api/jobs ───────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.job_date || typeof body.job_date !== 'string') {
    return NextResponse.json({ error: 'job_date is required (YYYY-MM-DD)' }, { status: 400 })
  }
  if (!body.service_type || typeof body.service_type !== 'string') {
    return NextResponse.json({ error: 'service_type is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('jobs')
    .insert({
      user_id:                    user.id,
      job_date:                   body.job_date,
      job_time:                   body.job_time   ?? null,
      service_type:               body.service_type,
      customer_id:                body.customer_id ?? null,
      vehicle_id:                 body.vehicle_id  ?? null,
      status:                     body.status      ?? 'scheduled',
      location_address:           body.location_address           ?? null,
      location_lat:               body.location_lat               ?? null,
      location_lng:               body.location_lng               ?? null,
      estimated_duration_minutes: body.estimated_duration_minutes ?? null,
      notes:                      body.notes                      ?? null,
      internal_notes:             body.internal_notes             ?? null,
    })
    .select(JOB_SELECT)
    .single()

  if (error) {
    console.error('[POST /api/jobs]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Auto-send booking confirmation if job has a customer with contact info
  if (data.customer_id) {
    dispatchNotification({
      trigger:  'booking_confirmation',
      jobId:    data.id,
      supabase,
    }).catch((err) => console.error('[POST /api/jobs] notification error:', err))
  }

  return NextResponse.json({ job: data }, { status: 201 })
}
