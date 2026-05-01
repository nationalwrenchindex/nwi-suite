import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ─── GET /api/inventory/low-stock ─────────────────────────────────────────────
// Returns count of products at or below their low_stock_threshold.
// Inventory datasets are small (< 100 products typically), so a full fetch + JS filter is fine.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ count: 0 })

  const { data } = await supabase
    .from('products_inventory')
    .select('uses_remaining, low_stock_threshold')
    .eq('user_id', user.id)

  const count = (data ?? []).filter(p => p.uses_remaining <= p.low_stock_threshold).length
  return NextResponse.json({ count })
}
