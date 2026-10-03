import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { writeToleratingMigration142 } from '@/lib/migration-142'

// ─── GET /api/vehicles?limit=N ────────────────────────────────────────────────
// Returns recent vehicles across all of the authenticated user's customers
export async function GET(request: NextRequest) {
  console.log('[GET /api/vehicles] method:', request.method)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp         = new URL(request.url).searchParams
  const limit      = Math.min(parseInt(sp.get('limit') ?? '10', 10), 50)
  const customerId = sp.get('customer_id')

  let query = supabase
    .from('vehicles')
    .select('id, unit_number, year, make, model, vin, customers!inner(user_id)')
    .eq('customers.user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (customerId) query = query.eq('customer_id', customerId)

  const { data, error } = await query

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

  const { data, error } = await writeToleratingMigration142(
    {
      customer_id:   body.customer_id,
      // The fleet's own identifier. Captured once here and every future document
      // for this unit prefills it.
      unit_number:   body.unit_number   ?? null,
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
    } as Record<string, unknown>,
    // Migration 142 is applied by hand; losing a vehicle a tech just typed over a
    // column that does not exist yet would be the wrong trade.
    row => supabase.from('vehicles').insert(row).select('*').single(),
  )

  if (error) {
    console.error('[POST /api/vehicles]', error)
    const msg = (error as { message?: string }).message
    return NextResponse.json({ error: msg ?? 'Could not add vehicle' }, { status: 500 })
  }

  return NextResponse.json({ vehicle: data }, { status: 201 })
}
