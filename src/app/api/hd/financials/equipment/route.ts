import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess, reeferStandaloneCan } from '@/lib/hd-access'
import { isReeferCategoryName } from '@/lib/reefer-standalone'
import { shopTimeZone } from '@/lib/shop-time'
import { ensureEquipmentCategories } from '@/lib/hd/equipment-categories'
import { loadRollupInput } from '@/lib/hd/equipment-rollup-load'
import { jobsFor, rollupByCategory, rollupByUnit } from '@/lib/hd/equipment-rollup'
import { parseRange } from '@/lib/hd/by-equipment-view'

export const dynamic = 'force-dynamic'

// ─── GET /api/hd/financials/equipment ─────────────────────────────────────────
// Query params:
//   from + to (YYYY-MM-DD, inclusive, shop-local) - both or neither. Neither means
//   January 1 to today in the shop's time zone (profiles.state, see shop-time.ts).
//
// The Financials "By Equipment" view (spec section 5). Every figure is from
// equipment-rollup.ts - this route only reads the rows and hands them over, so the
// screen and the audit exports cannot disagree.
//
//   401  no signed-in user
//   403  no HD Starter-and-above access - the same gate as /hd/financials itself, so an
//        LD-only subscriber gets a refusal, never an empty table
//   400  malformed date, from after to, only one of the two, or a span over 3 years
//   500  a read failed (fetchAllRows throws rather than returning a truncated list)
//
// Scoping: the loader is handed the SIGNED-IN client, so RLS applies to every read, and
// every query also filters on user_id. Never a service client here.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hdAccess  = await checkHDStarterAccess(user.id)
  const hasAccess = hdAccess || (await reeferStandaloneCan(user.id, 'reefer_financials'))
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { data: profile } = await supabase.from('profiles').select('state').eq('id', user.id).maybeSingle()
  const timeZone = shopTimeZone((profile as { state?: string | null } | null)?.state)

  const sp = request.nextUrl.searchParams
  const parsed = parseRange(sp.get('from'), sp.get('to'), timeZone)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const range = parsed.range

  try {
    // A shop opening this view before it has any category gets the nine defaults (and
    // its units mapped from unit_type) first. Never throws; the rollup still runs.
    await ensureEquipmentCategories(supabase)
    const loaded = await loadRollupInput(supabase, user.id, range, timeZone)
    // Reefer Standalone: its reefer categories only - never a Boom, Aerial or Truck row.
    // Totals are untouched: a unit outside them falls into the rollup's Uncategorized.
    const input = hdAccess ? loaded : { ...loaded, categories: loaded.categories.filter(c => isReeferCategoryName(c.name)) }
    const jobs = jobsFor(input)
    const categories = rollupByCategory(input, jobs)
    const units = rollupByUnit(input, jobs)

    // Fleets for the filter: only those a unit row in the range belongs to.
    const inUse = new Set(units.map(u => u.fleetAccountId).filter((x): x is string => !!x))
    const fleets = input.fleets
      .filter(f => inUse.has(f.id))
      .map(f => ({ id: f.id, name: f.fleet_name ?? 'Unnamed fleet' }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

    return NextResponse.json({
      range,
      timeZone,
      categories,
      units,
      fleets,
      jobsCount: jobs.length,
      jobsFromInvoices: jobs.filter(j => j.source === 'invoice').length,
      jobsFromWorkOrders: jobs.filter(j => j.source === 'work_order').length,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[hd financials equipment] rollup failed:', message)
    return NextResponse.json({ error: 'Could not load the equipment rollup', detail: message }, { status: 500 })
  }
}
