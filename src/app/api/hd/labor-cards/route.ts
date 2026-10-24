import { NextResponse, type NextRequest } from 'next/server'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { authedHD, ownsCategory } from './shared'
import {
  LABOR_CARD_COLUMNS, cleanLaborCard, isMissing166Column, MIGRATION_166_MESSAGE, type LaborCard,
} from '@/lib/hd/labor-cards'

export const dynamic = 'force-dynamic'

// /api/hd/labor-cards - the labor card builder's own route (migration 166).
//
//   GET                list the signed-in shop's own active cards, every one
//   POST  { card }     INSERT one new card. Nothing else.
//
// This is deliberately NOT /api/hd/repair-items. That POST merges an entry whose
// description already exists (ignoring case), bumps its use_count and takes the new
// hours, and refuses an entry with no mobile hours - right for the quote modal's
// "Save to my labor library", wrong for authoring: two different jobs can share a
// name ("Replace engine mounts" on an SB-310 and on a Precedent), and a shop-only
// operation has no field time. This route never looks a card up by description, never
// merges, and never touches an existing row. Editing is /api/hd/labor-cards/[id].
//
// Own rows only: user_id = the signed-in user on every read and write, on top of RLS
// (166), which also refuses scope other than 'private', origin other than 'shop', and
// another shop's category. The NWI catalog rows are not listed here - this screen is
// the shop's own cards.

export async function GET() {
  const a = await authedHD()
  if ('error' in a) return a.error
  try {
    const cards = await fetchAllRows<LaborCard>((from, to) =>
      a.supabase
        .from('hd_repair_items')
        .select(LABOR_CARD_COLUMNS)
        .eq('user_id', a.user.id)
        .eq('active', true)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: LaborCard[] | null; error: null }>)
    return NextResponse.json({ cards })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isMissing166Column({ code: '42703', message: msg })) {
      return NextResponse.json({ error: MIGRATION_166_MESSAGE }, { status: 503 })
    }
    console.error('[hd/labor-cards] read failed', msg)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const a = await authedHD()
  if ('error' in a) return a.error

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const clean = cleanLaborCard(body)
  if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 400 })
  if (!(await ownsCategory(a.supabase, a.user.id, clean.row.equipment_category_id))) {
    return NextResponse.json({ error: 'Unknown equipment category.' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const { data, error } = await a.supabase
    .from('hd_repair_items')
    .insert({
      ...clean.row,
      user_id:    a.user.id,
      is_master:  false,
      active:     true,
      applies_to: 'both',
      source:     'manual',
      origin:     'shop',
      scope:      'private',
      use_count:  0,
      created_at: now,
      updated_at: now,
    })
    .select(LABOR_CARD_COLUMNS)
    .single()

  if (error) {
    if (isMissing166Column(error)) return NextResponse.json({ error: MIGRATION_166_MESSAGE }, { status: 503 })
    console.error('[hd/labor-cards] insert failed', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ card: data }, { status: 201 })
}
