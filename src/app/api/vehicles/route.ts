import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ─── GET /api/vehicles?limit=N ────────────────────────────────────────────────
// Returns recent vehicles across all of the authenticated user's customers
export async function GET(request: NextRequest) {
  console.log('[GET /api/vehicles] method:', request.method)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = Math.min(parseInt(new URL(request.url).searchParams.get('limit') ?? '10', 10), 50)

  const { data, error } = await supabase
    .from('vehicles')
    .select('id, year, make, model, vin, customers!inner(user_id)')
    .eq('customers.user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[GET /api/vehicles]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ vehicles: data ?? [] })
}

// ─── POST /api/vehicles ───────────────────────────────────────────────────────
// Creates a vehicle linked to one of the authenticated user's customers
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  if (!body.customer_id || typeof body.customer_id !== 'string')
    return NextResponse.json({ error: 'customer_id is required' }, { status: 400 })
  if (!body.make || typeof body.make !== 'string')
    return NextResponse.json({ error: 'make is required' }, { status: 400 })
  if (!body.model || typeof body.model !== 'string')
    return NextResponse.json({ error: 'model is required' }, { status: 400 })

  // Verify the customer belongs to this user (belt-and-suspenders on top of RLS)
  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .select('id')
    .eq('id', body.customer_id)
    .eq('user_id', user.id)
    .single()

  if (custErr || !customer) {
    return NextResponse.json({ error: 'Customer not found or access denied' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      customer_id:   body.customer_id,
      year:          body.year          ?? null,
      make:          (body.make as string).trim(),
      model:         (body.model as string).trim(),
      trim:          body.trim          ?? null,
      vin:           body.vin           ?? null,
      color:         body.color         ?? null,
      mileage:       body.mileage       ?? null,
      license_plate: body.license_plate ?? null,
      engine:        body.engine        ?? null,
      transmission:  body.transmission  ?? null,
      notes:         body.notes         ?? null,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[POST /api/vehicles]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ vehicle: data }, { status: 201 })
}
