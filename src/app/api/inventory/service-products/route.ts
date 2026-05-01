import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ─── GET /api/inventory/service-products ──────────────────────────────────────
// Returns all service→product mappings for the current user (with product details)
export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('service_products')
    .select('*, product:products_inventory(*)')
    .eq('user_id', user.id)
    .order('service_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ mappings: data ?? [] })
}

// ─── POST /api/inventory/service-products ─────────────────────────────────────
// Creates a service→product mapping
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { service_name, product_inventory_id, quantity_used } = body

  if (!service_name || !product_inventory_id)
    return NextResponse.json({ error: 'service_name and product_inventory_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('service_products')
    .insert({
      user_id:              user.id,
      service_name:         String(service_name),
      product_inventory_id: String(product_inventory_id),
      quantity_used:        quantity_used ? Number(quantity_used) : 1.0,
    })
    .select('*, product:products_inventory(*)')
    .single()

  if (error) {
    if (error.code === '23505') // unique violation
      return NextResponse.json({ error: 'That product is already mapped to this service.' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ mapping: data }, { status: 201 })
}
