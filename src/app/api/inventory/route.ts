import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ─── GET /api/inventory ───────────────────────────────────────────────────────
// Returns user's inventory products, sorted by name
export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('products_inventory')
    .select('*')
    .eq('user_id', user.id)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const products = data ?? []
  const low_stock_count = products.filter(p => p.uses_remaining <= p.low_stock_threshold).length

  return NextResponse.json({ products, low_stock_count })
}

// ─── POST /api/inventory ──────────────────────────────────────────────────────
// Creates a new inventory product
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { name, cost_cents, total_uses, global_product_id } = body

  if (!name || typeof name !== 'string')
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const uses = Number(total_uses) || 1
  const cost = Number(cost_cents) || 0

  const { data, error } = await supabase
    .from('products_inventory')
    .insert({
      user_id:           user.id,
      global_product_id: global_product_id ?? null,
      name:              String(name),
      cost_cents:        cost,
      total_uses:        uses,
      uses_remaining:    uses,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ product: data }, { status: 201 })
}
