// GET  /api/detailer-adjustments  — list adjustment presets for current user
// PUT  /api/detailer-adjustments  — replace all presets (bulk)

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: presets, error } = await supabase
    .from('detailer_adjustment_presets')
    .select('id, name, price_cents, sort_order, created_at')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[GET /api/detailer-adjustments]', error)
    return NextResponse.json({ error: 'Failed to load presets.' }, { status: 500 })
  }

  return NextResponse.json({ presets: presets ?? [] })
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { presets: Array<{ name: string; price_cents: number; sort_order: number }> }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!Array.isArray(body.presets)) {
    return NextResponse.json({ error: 'presets must be an array' }, { status: 400 })
  }

  // Replace all — delete then insert
  const { error: delErr } = await supabase
    .from('detailer_adjustment_presets')
    .delete()
    .eq('user_id', user.id)

  if (delErr) {
    console.error('[PUT /api/detailer-adjustments] delete', delErr)
    return NextResponse.json({ error: 'Failed to update presets.' }, { status: 500 })
  }

  if (body.presets.length > 0) {
    const rows = body.presets.map((p, i) => ({
      user_id:     user.id,
      name:        String(p.name ?? '').trim(),
      price_cents: Math.max(0, Math.round(Number(p.price_cents) || 0)),
      sort_order:  i,
    })).filter(r => r.name.length > 0)

    const { error: insErr } = await supabase
      .from('detailer_adjustment_presets')
      .insert(rows)

    if (insErr) {
      console.error('[PUT /api/detailer-adjustments] insert', insErr)
      return NextResponse.json({ error: 'Failed to update presets.' }, { status: 500 })
    }
  }

  const { data: updated } = await supabase
    .from('detailer_adjustment_presets')
    .select('id, name, price_cents, sort_order, created_at')
    .eq('user_id', user.id)
    .order('sort_order', { ascending: true })

  return NextResponse.json({ presets: updated ?? [] })
}
