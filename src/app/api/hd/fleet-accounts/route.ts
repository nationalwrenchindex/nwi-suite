import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import { FLEET_ACCOUNT_LIST_SELECT, FLEET_ACCOUNT_PAGE_SIZE } from './list'

export const dynamic = 'force-dynamic'

// GET /api/hd/fleet-accounts?limit=&offset= — one page of the fleet-account list.
// PostgREST silently caps any response at 1,000 rows, so the list pages rather
// than loading every account; `count` is its own exact/head query so the header
// total stays truthful however few rows the caller has loaded.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ok = await checkHDStarterAccess(user.id)
  if (!ok) return NextResponse.json({ error: 'HD access required' }, { status: 403 })

  const sp     = req.nextUrl.searchParams
  const limit  = Math.min(Number(sp.get('limit') ?? FLEET_ACCOUNT_PAGE_SIZE), 200)
  const offset = Number(sp.get('offset') ?? 0)

  const [{ data, error }, { count }] = await Promise.all([
    supabase
      .from('hd_fleet_accounts')
      .select(FLEET_ACCOUNT_LIST_SELECT)
      .eq('user_id', user.id)
      // Two fleets can share a name, and offset paging over a non-deterministic
      // order drops and repeats rows between pages. id breaks every tie.
      .order('fleet_name')
      .order('id')
      .range(offset, offset + limit - 1),
    supabase
      .from('hd_fleet_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ])

  if (error) {
    console.error('[hd/fleet-accounts GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ fleet_accounts: data ?? [], count: count ?? 0 })
}
