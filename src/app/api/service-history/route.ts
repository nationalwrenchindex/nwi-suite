import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ─── POST /api/service-history ────────────────────────────────────────────────
// Logs a new service visit to a vehicle.
// Ownership is verified via vehicle → customer → user_id chain.
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  if (!body.vehicle_id || typeof body.vehicle_id !== 'string')
    return NextResponse.json({ error: 'vehicle_id is required' }, { status: 400 })
  if (!body.service_date || typeof body.service_date !== 'string')
    return NextResponse.json({ error: 'service_date is required (YYYY-MM-DD)' }, { status: 400 })
  if (!body.service_type || typeof body.service_type !== 'string')
    return NextResponse.json({ error: 'service_type is required' }, { status: 400 })

  // Verify the vehicle belongs to one of this user's customers
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('id, customer:customers!inner(user_id)')
    .eq('id', body.vehicle_id)
    .single()

  const vCust = (vehicle?.customer as unknown) as { user_id: string } | null
  if (!vCust || vCust.user_id !== user.id) {
    return NextResponse.json({ error: 'Vehicle not found or access denied' }, { status: 404 })
  }

  // If mileage_at_service is provided, also update the vehicle's current mileage
  // so the alerts system has the latest reading
  const mileage = body.mileage_at_service ? Number(body.mileage_at_service) : null

  const [{ data, error }] = await Promise.all([
    supabase
      .from('service_history')
      .insert({
        vehicle_id:          body.vehicle_id,
        service_date:        body.service_date,
        service_type:        (body.service_type as string).trim(),
        tech_notes:          body.tech_notes          ?? null,
        mileage_at_service:  mileage,
        amount_charged:      body.amount_charged       ?? null,
        parts_used:          body.parts_used           ?? [],
        next_service_date:   body.next_service_date    ?? null,
        next_service_mileage:body.next_service_mileage ?? null,
      })
      .select('*')
      .single(),
    // Update vehicle mileage if provided
    mileage
      ? supabase.from('vehicles').update({ mileage }).eq('id', body.vehicle_id)
      : Promise.resolve({ data: null, error: null }),
  ])

  if (error) {
    console.error('[POST /api/service-history]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ record: data }, { status: 201 })
}

// ─── GET /api/service-history ─────────────────────────────────────────────────
// Query params: vehicle_id (required)
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const vehicleId = request.nextUrl.searchParams.get('vehicle_id')
  if (!vehicleId) return NextResponse.json({ error: 'vehicle_id is required' }, { status: 400 })

  // Ownership check
  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('id, customer:customers!inner(user_id)')
    .eq('id', vehicleId)
    .single()

  const vCust = (vehicle?.customer as unknown) as { user_id: string } | null
  if (!vCust || vCust.user_id !== user.id) {
    return NextResponse.json({ error: 'Vehicle not found or access denied' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('service_history')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('service_date', { ascending: false })

  if (error) {
    console.error('[GET /api/service-history]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ history: data ?? [] })
}
