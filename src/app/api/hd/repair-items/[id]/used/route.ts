import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { hasQuickWrenchAccess } from '@/lib/subscription'

export const dynamic = 'force-dynamic'

// POST /api/hd/repair-items/[id]/used - a picked card went onto a quote.
//
// Counts the use and nothing else: use_count + 1 and last_used_at. Never the hours,
// the name or any other column - fixing a card is the labor cards screen's job, and a
// quote line's hours are that quote's business. The picker orders the tech's own rows
// by this count.
//
// Own rows only (id AND user_id = the signed-in user, and active). An NWI catalog row
// or another shop's row is a 404; RLS (166) refuses either underneath as well.

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!ID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [hdAccess, qwAccess] = await Promise.all([checkHDAccess(user.id), hasQuickWrenchAccess(user.id)])
  if (!hdAccess && !qwAccess) return NextResponse.json({ error: 'HD or QuickWrench subscription required' }, { status: 403 })

  const { data: row, error: readErr } = await supabase
    .from('hd_repair_items')
    .select('id, use_count')
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle()
  if (readErr) {
    console.error('[hd/repair-items/used] read failed', readErr)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('hd_repair_items')
    .update({ use_count: (row.use_count ?? 0) + 1, last_used_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, use_count, last_used_at')
    .maybeSingle()
  if (error) {
    console.error('[hd/repair-items/used] update failed', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ item: data })
}
