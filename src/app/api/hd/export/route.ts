import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const uid = user.id

  const [
    { data: fleetAccounts },
    { data: units },
    { data: workOrders },
    { data: pmChecklists },
    { data: dotInspections },
    { data: epaLog },
  ] = await Promise.all([
    supabase.from('hd_fleet_accounts').select('*').eq('user_id', uid),
    supabase.from('hd_units').select('*').eq('user_id', uid),
    supabase.from('hd_work_orders').select('*').eq('user_id', uid),
    supabase.from('hd_pm_checklists').select('*').eq('user_id', uid),
    supabase.from('hd_dot_inspections').select('*').eq('user_id', uid),
    supabase.from('hd_epa_log').select('*').eq('user_id', uid),
  ])

  return NextResponse.json({
    exported_at: new Date().toISOString(),
    fleet_accounts:  fleetAccounts  ?? [],
    units:           units          ?? [],
    work_orders:     workOrders     ?? [],
    pm_checklists:   pmChecklists   ?? [],
    dot_inspections: dotInspections ?? [],
    epa_log:         epaLog         ?? [],
  })
}
