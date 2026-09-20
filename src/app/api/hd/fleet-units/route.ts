import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FLEET_UNIT_LIST_SELECT, FLEET_UNIT_PAGE_SIZE } from './list'

export const dynamic = 'force-dynamic'

// GET /api/hd/fleet-units?fleet_account_id=&limit=&offset= — one page of the units list.
//
// Gated on authentication only, deliberately: /hd/fleet-units itself has no tier
// check, so requiring one here would let a tech see the first page of their own
// units and then fail to load the second.
//
// PostgREST silently caps any response at 1,000 rows, so the list pages instead
// of loading every unit; `count` is its own exact/head query carrying the same
// filters, so the header total stays truthful however few rows are loaded.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp             = req.nextUrl.searchParams
  const fleetAccountId = sp.get('fleet_account_id')
  const limit          = Math.min(Number(sp.get('limit') ?? FLEET_UNIT_PAGE_SIZE), 200)
  const offset         = Number(sp.get('offset') ?? 0)

  let rowsQuery = supabase
    .from('hd_units')
    .select(FLEET_UNIT_LIST_SELECT)
    .eq('user_id', user.id)
  let countQuery = supabase
    .from('hd_units')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  // Filter on the raw id, exactly as the page does: combined with the user_id
  // scope, a foreign or bogus id simply returns nothing.
  if (fleetAccountId) {
    rowsQuery  = rowsQuery.eq('fleet_account_id', fleetAccountId)
    countQuery = countQuery.eq('fleet_account_id', fleetAccountId)
  }

  const [{ data, error }, { count }] = await Promise.all([
    // unit_number is not unique, and offset paging over a non-deterministic order
    // drops and repeats rows between pages. id breaks every tie.
    rowsQuery.order('unit_number').order('id').range(offset, offset + limit - 1),
    countQuery,
  ])

  if (error) {
    console.error('[hd/fleet-units GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ units: data ?? [], count: count ?? 0 })
}
