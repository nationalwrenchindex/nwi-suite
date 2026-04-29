import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET — fetch current user's detailer service pricing
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('detailer_service_pricing')
    .select('*')
    .eq('profile_id', user.id)
    .order('service_name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ pricing: data ?? [] })
}

// PUT — upsert all rows for the current user
// Body: { rows: Array<{ service_name, vehicle_category, base_price, estimated_hours, is_offered }> }
export async function PUT(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const rows = body?.rows
  if (!Array.isArray(rows)) return NextResponse.json({ error: 'rows must be an array' }, { status: 400 })

  const toUpsert = rows.map((r: Record<string, unknown>) => ({
    profile_id:      user.id,
    service_name:    r.service_name,
    vehicle_category: r.vehicle_category,
    base_price:      Number(r.base_price ?? 0),
    estimated_hours: Number(r.estimated_hours ?? 1),
    is_offered:      r.is_offered !== false,
    updated_at:      new Date().toISOString(),
  }))

  const { error } = await supabase
    .from('detailer_service_pricing')
    .upsert(toUpsert, { onConflict: 'profile_id,service_name,vehicle_category' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
