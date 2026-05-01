import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

// ─── GET /api/inventory/global?barcode=xxx ────────────────────────────────────
// Looks up a product in the crowdsourced global DB by barcode
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const barcode = req.nextUrl.searchParams.get('barcode')
  if (!barcode) return NextResponse.json({ error: 'barcode param required' }, { status: 400 })

  const { data, error } = await supabase
    .from('products_global')
    .select('*')
    .eq('barcode', barcode)
    .single()

  if (error && error.code !== 'PGRST116') // PGRST116 = not found
    return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ hit: !!data, product: data ?? null })
}

// ─── POST /api/inventory/global ───────────────────────────────────────────────
// Seeds a new product into the global DB, or increments confirmed_count on barcode collision
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { barcode, name, brand, container_size, default_cost_cents, default_uses_per_container, category } = body

  if (!name || typeof name !== 'string')
    return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const svc = createServiceClient()

  // If barcode provided and already exists: increment confirmed_count
  if (barcode && typeof barcode === 'string') {
    const { data: existing } = await svc
      .from('products_global')
      .select('id, confirmed_count')
      .eq('barcode', barcode)
      .single()

    if (existing) {
      const { data: updated } = await svc
        .from('products_global')
        .update({ confirmed_count: existing.confirmed_count + 1 })
        .eq('id', existing.id)
        .select('*')
        .single()
      return NextResponse.json({ product: updated, was_existing: true })
    }
  }

  // Insert new global product
  const { data, error } = await svc
    .from('products_global')
    .insert({
      barcode:                    barcode    ? String(barcode)    : null,
      name:                       String(name),
      brand:                      brand           ? String(brand)           : null,
      container_size:             container_size  ? String(container_size)  : null,
      default_cost_cents:         default_cost_cents         ? Number(default_cost_cents)         : null,
      default_uses_per_container: default_uses_per_container ? Number(default_uses_per_container) : null,
      category:                   category   ? String(category)   : null,
      first_added_by:             user.id,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ product: data, was_existing: false }, { status: 201 })
}
