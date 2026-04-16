import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const CUSTOMER_LIST_SELECT = `
  id, first_name, last_name, phone, email,
  vehicles(id)
`

// ─── GET /api/customers ───────────────────────────────────────────────────────
// Query params: search, limit, offset
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp     = request.nextUrl.searchParams
  const search = sp.get('search')?.trim()
  const limit  = Math.min(Number(sp.get('limit') ?? 100), 200)
  const offset = Number(sp.get('offset') ?? 0)

  let query = supabase
    .from('customers')
    .select(CUSTOMER_LIST_SELECT)
    .eq('user_id', user.id)
    .order('last_name', { ascending: true })
    .range(offset, offset + limit - 1)

  if (search) {
    // Search across name, phone, email
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`,
    )
  }

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/customers]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ customers: data ?? [] })
}

// ─── POST /api/customers ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  if (!body.first_name || typeof body.first_name !== 'string')
    return NextResponse.json({ error: 'first_name is required' }, { status: 400 })
  if (!body.last_name || typeof body.last_name !== 'string')
    return NextResponse.json({ error: 'last_name is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('customers')
    .insert({
      user_id:      user.id,
      first_name:   (body.first_name as string).trim(),
      last_name:    (body.last_name as string).trim(),
      phone:        body.phone        ?? null,
      email:        body.email        ?? null,
      address_line1:body.address_line1 ?? null,
      address_line2:body.address_line2 ?? null,
      city:         body.city         ?? null,
      state:        body.state        ?? null,
      zip:          body.zip          ?? null,
      notes:        body.notes        ?? null,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[POST /api/customers]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ customer: data }, { status: 201 })
}
