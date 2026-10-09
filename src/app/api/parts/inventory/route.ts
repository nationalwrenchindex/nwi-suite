// GET  /api/parts/inventory   this shop's stock
// POST /api/parts/inventory   set stock, bin, cost or price for one part
//
// Scoped by user_id in the query AND by RLS at the database. Two layers on purpose:
// the filter here is what makes the response correct, and the policy is what makes it
// correct even if this route is ever wrong.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const COLUMNS = 'id, part_id, on_hand, min_qty, bin, location_type, location_name, last_cost, sell_price'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('inventory')
    .select(COLUMNS)
    .eq('user_id', user.id)

  if (error) {
    // The parts search is still useful without stock numbers, so this answers with an
    // empty list and says why rather than failing the screen.
    console.error('[parts/inventory GET]', error)
    return NextResponse.json({ stock: [], error: 'Could not read stock' }, { status: 200 })
  }

  return NextResponse.json({ stock: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { /* handled below */ }

  const partId = typeof body.part_id === 'string' ? body.part_id : null
  if (!partId) return NextResponse.json({ error: 'part_id is required' }, { status: 422 })

  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  // min_qty keeps its three states. An absent key leaves it alone; an explicit null
  // clears it back to "no minimum set"; a 0 is the shop deliberately stocking none.
  const row: Record<string, unknown> = {
    user_id:       user.id,
    part_id:       partId,
    location_type: body.location_type === 'vehicle' ? 'vehicle' : 'shop',
    location_name: typeof body.location_name === 'string' && body.location_name.trim()
      ? body.location_name.trim() : null,
  }
  if ('on_hand'    in body) row.on_hand    = Math.max(0, num(body.on_hand) ?? 0)
  if ('min_qty'    in body) row.min_qty    = num(body.min_qty)
  if ('bin'        in body) row.bin        = typeof body.bin === 'string' && body.bin.trim() ? body.bin.trim() : null
  if ('last_cost'  in body) row.last_cost  = num(body.last_cost)
  if ('sell_price' in body) row.sell_price = num(body.sell_price)

  if (row.location_type === 'vehicle' && !row.location_name) {
    return NextResponse.json(
      { error: 'Name the service vehicle - "on the truck" cannot say which truck.' },
      { status: 422 },
    )
  }

  const { data, error } = await supabase
    .from('inventory')
    .upsert(row, { onConflict: 'user_id,part_id,location_type,location_name' })
    .select(COLUMNS)
    .single()

  if (error) {
    console.error('[parts/inventory POST]', error)
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ stock: data })
}
