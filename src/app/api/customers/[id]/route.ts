import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type RouteContext = { params: Promise<{ id: string }> }

const CUSTOMER_FULL_SELECT = `
  *,
  vehicles(
    *,
    service_history(*)
  )
`

// ─── GET /api/customers/[id] ──────────────────────────────────────────────────
// Returns customer with all vehicles + full service history, ordered by date desc
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data, error } = await supabase
    .from('customers')
    .select(CUSTOMER_FULL_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
  }

  // Sort service history newest-first per vehicle
  if (data.vehicles) {
    data.vehicles = data.vehicles.map((v: { service_history?: { service_date: string }[] }) => ({
      ...v,
      service_history: (v.service_history ?? []).sort(
        (a: { service_date: string }, b: { service_date: string }) =>
          new Date(b.service_date).getTime() - new Date(a.service_date).getTime(),
      ),
    }))
  }

  return NextResponse.json({ customer: data })
}

// ─── PUT /api/customers/[id] ──────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  // Strip server-managed fields
  const { id: _id, user_id: _uid, created_at: _ca, updated_at: _ua, vehicles: _v, ...updateData } =
    body as Record<string, unknown>

  if (Object.keys(updateData).length === 0)
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })

  const { data, error } = await supabase
    .from('customers')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) {
    console.error('[PUT /api/customers/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  return NextResponse.json({ customer: data })
}

// ─── DELETE /api/customers/[id] ───────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await supabase
    .from('customers')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    console.error('[DELETE /api/customers/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
