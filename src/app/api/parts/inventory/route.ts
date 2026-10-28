// GET /api/parts/inventory   this shop's stock
//
// Scoped by user_id in the query AND by RLS at the database. Two layers on purpose:
// the filter here is what makes the response correct, and the policy is what makes it
// correct even if this route is ever wrong.
//
// READ ONLY. There used to be a POST here that wrote on_hand straight onto the row.
// Migration 151's trigger refuses that (on_hand moves only through a stock_movement),
// and its upsert targeted a unique index 151 had dropped, so it could not work. Nothing
// called it. Every write now goes through /api/parts/stock, which moves on_hand through
// the ledger and edits bin, minimum and sell price directly.

import { NextResponse } from 'next/server'
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
