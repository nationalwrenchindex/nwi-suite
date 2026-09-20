import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

// Every table in this export is paged. PostgREST caps a plain `select('*')` at
// 1,000 rows and still answers 200, so an unpaged export silently hands the tech
// a truncated file — hd_work_orders alone is already past the cap in production.
const PAGE_SIZE = 500

type Row = Record<string, unknown>

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const uid = user.id

  // `.order('id')` is not cosmetic: range paging over an unordered query can
  // repeat or drop rows, because Postgres guarantees no row order without one.
  const allRowsOf = (table: string) =>
    fetchAllRows<Row>(
      (from, to) =>
        supabase
          .from(table)
          .select('*')
          .eq('user_id', uid)
          .order('id', { ascending: true })
          .range(from, to),
      PAGE_SIZE,
    )

  try {
    const [
      fleetAccounts,
      units,
      workOrders,
      pmChecklists,
      dotInspections,
      epaLog,
    ] = await Promise.all([
      allRowsOf('hd_fleet_accounts'),
      allRowsOf('hd_units'),
      allRowsOf('hd_work_orders'),
      allRowsOf('hd_pm_checklists'),
      allRowsOf('hd_dot_inspections'),
      allRowsOf('hd_epa_log'),
    ])

    return NextResponse.json({
      exported_at: new Date().toISOString(),
      fleet_accounts:  fleetAccounts,
      units:           units,
      work_orders:     workOrders,
      pm_checklists:   pmChecklists,
      dot_inspections: dotInspections,
      epa_log:         epaLog,
    })
  } catch (err) {
    // A failed page must not degrade into a short export. Fail the request.
    const message = err instanceof Error ? err.message : 'Export failed'
    console.error('[hd-export] load failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
