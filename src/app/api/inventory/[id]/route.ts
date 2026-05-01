import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type RouteContext = { params: Promise<{ id: string }> }

// ─── GET /api/inventory/[id] ──────────────────────────────────────────────────
// Returns product + its usage log (newest-first)
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const [{ data: product, error }, { data: log }] = await Promise.all([
    supabase
      .from('products_inventory')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single(),

    supabase
      .from('product_usage_log')
      .select('id, job_id, service_name, quantity_used, cost_cents_attributed, logged_at')
      .eq('product_inventory_id', id)
      .eq('user_id', user.id)
      .order('logged_at', { ascending: false })
      .limit(50),
  ])

  if (error || !product)
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  return NextResponse.json({ product, usage_log: log ?? [] })
}

// ─── PUT /api/inventory/[id] ──────────────────────────────────────────────────
// Update product. Send action:"restock" to reset uses_remaining to total_uses.
export async function PUT(req: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Restock shortcut: reset uses_remaining = total_uses
  if (body.action === 'restock') {
    const { data: current } = await supabase
      .from('products_inventory')
      .select('total_uses')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()

    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data, error } = await supabase
      .from('products_inventory')
      .update({ uses_remaining: current.total_uses, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('*')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ product: data })
  }

  // Normal update
  const {
    action: _a, id: _id, user_id: _uid, created_at: _ca, global_product_id: _gp,
    ...updateData
  } = body

  const { data, error } = await supabase
    .from('products_inventory')
    .update({ ...updateData, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ product: data })
}

// ─── DELETE /api/inventory/[id] ───────────────────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { error } = await supabase
    .from('products_inventory')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
