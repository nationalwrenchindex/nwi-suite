import { NextResponse, type NextRequest } from 'next/server'
import {
  LABOR_CARD_COLUMNS, cleanLaborCard, isMissing166Column, MIGRATION_166_MESSAGE, isMissing167Column, MIGRATION_167_MESSAGE,
} from '@/lib/hd/labor-cards'
import { authedHD, ownsCategory } from '../shared'

export const dynamic = 'force-dynamic'

// /api/hd/labor-cards/[id]
//
//   PATCH  { card }   replace THIS card's fields. By id, nothing else - never a lookup
//                      by description, never another row.
//   DELETE            soft delete: active = false. The row stays; every reader of the
//                      library already filters on active, so it disappears from the
//                      screen, the quote modal and QuickWrench alike.
//
// Both are scoped to id AND user_id = the signed-in user, so a card from another shop
// or an NWI catalog row is a 404 here, and RLS (166) refuses it underneath as well.

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!ID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const a = await authedHD()
  if ('error' in a) return a.error

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const clean = cleanLaborCard(body)
  if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 400 })
  if (!(await ownsCategory(a.supabase, a.user.id, clean.row.equipment_category_id))) {
    return NextResponse.json({ error: 'Unknown equipment category.' }, { status: 400 })
  }

  const { data, error } = await a.supabase
    .from('hd_repair_items')
    .update({ ...clean.row, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', a.user.id)
    .eq('active', true)
    .select(LABOR_CARD_COLUMNS)
    .maybeSingle()

  if (error) {
    if (isMissing166Column(error)) return NextResponse.json({ error: MIGRATION_166_MESSAGE }, { status: 503 })
    if (isMissing167Column(error)) return NextResponse.json({ error: MIGRATION_167_MESSAGE }, { status: 503 })
    console.error('[hd/labor-cards] update failed', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ card: data })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!ID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const a = await authedHD()
  if ('error' in a) return a.error

  const { data, error } = await a.supabase
    .from('hd_repair_items')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', a.user.id)
    .eq('active', true)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[hd/labor-cards] delete failed', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, id })
}
