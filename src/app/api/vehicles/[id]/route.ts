import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type RouteContext = { params: Promise<{ id: string }> }

// ─── GET /api/vehicles/[id] ───────────────────────────────────────────────────
// Returns the vehicle with its full service history (newest first)
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  // Verify ownership via the RLS-protected join
  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .select(`
      *,
      customer:customers!inner(id, first_name, last_name, phone, email, user_id),
      service_history(*)
    `)
    .eq('id', id)
    .single()

  if (error || !vehicle) {
    return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 })
  }

  // Enforce user ownership
  const cust = vehicle.customer as { user_id: string } | null
  if (!cust || cust.user_id !== user.id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Sort service history newest-first
  const sorted = {
    ...vehicle,
    service_history: ((vehicle.service_history ?? []) as { service_date: string }[]).sort(
      (a, b) => new Date(b.service_date).getTime() - new Date(a.service_date).getTime(),
    ),
  }

  return NextResponse.json({ vehicle: sorted })
}

// ─── PUT /api/vehicles/[id] ───────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  // Verify ownership first
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id, customer:customers!inner(user_id)')
    .eq('id', id)
    .single()

  const existingCust = (existing?.customer as unknown) as { user_id: string } | null
  if (!existingCust || existingCust.user_id !== user.id) {
    return NextResponse.json({ error: 'Vehicle not found or access denied' }, { status: 404 })
  }

  // Strip immutable fields
  const {
    id: _id, customer_id: _cid, created_at: _ca, updated_at: _ua,
    customer: _c, service_history: _sh, ...updateData
  } = body as Record<string, unknown>

  if (Object.keys(updateData).length === 0)
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })

  const { data, error } = await supabase
    .from('vehicles')
    .update(updateData)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    console.error('[PUT /api/vehicles/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ vehicle: data })
}
