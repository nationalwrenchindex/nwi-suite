import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDStarterAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD access required' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const month = searchParams.get('month') // YYYY-MM

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Invalid month. Use YYYY-MM.' }, { status: 400 })
  }

  const [year, mon] = month.split('-').map(Number)
  const start = new Date(year, mon - 1, 1).toISOString()
  const end   = new Date(year, mon, 1).toISOString()

  const { data, error } = await supabase
    .from('hd_work_orders')
    .select(`
      id, work_order_number, status, service_type, total_amount, scheduled_at,
      unit:hd_units(unit_number, manufacturer, model),
      fleet_account:hd_fleet_accounts(fleet_name)
    `)
    .eq('user_id', user.id)
    .gte('scheduled_at', start)
    .lt('scheduled_at', end)
    .order('scheduled_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by YYYY-MM-DD
  const byDate: Record<string, unknown[]> = {}
  for (const wo of data ?? []) {
    if (!wo.scheduled_at) continue
    const dateStr = (wo.scheduled_at as string).slice(0, 10)
    if (!byDate[dateStr]) byDate[dateStr] = []
    byDate[dateStr].push(wo)
  }

  return NextResponse.json({ calendar: byDate })
}
