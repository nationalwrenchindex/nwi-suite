import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { CalendarData } from '@/types/jobs'

// ─── GET /api/jobs/calendar ───────────────────────────────────────────────────
// Query params:
//   month=YYYY-MM  (default: current month)
//   from_date + to_date  (overrides month)
//   include_cancelled=true  (default: false — excludes cancelled jobs)
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = request.nextUrl.searchParams
  let fromDate: string
  let toDate: string

  const explicitFrom = sp.get('from_date')
  const explicitTo   = sp.get('to_date')

  if (explicitFrom && explicitTo) {
    fromDate = explicitFrom
    toDate   = explicitTo
  } else {
    const monthParam = sp.get('month') // YYYY-MM
    let year: number
    let month: number // 1-based

    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      ;[year, month] = monthParam.split('-').map(Number)
    } else {
      const now = new Date()
      year  = now.getFullYear()
      month = now.getMonth() + 1
    }

    const lastDay = new Date(year, month, 0).getDate()
    fromDate = `${year}-${String(month).padStart(2, '0')}-01`
    toDate   = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  }

  const includesCancelled = sp.get('include_cancelled') === 'true'

  let query = supabase
    .from('jobs')
    .select(`
      *,
      customer:customers(id, first_name, last_name, phone, email),
      vehicle:vehicles(id, year, make, model, color, license_plate)
    `)
    .eq('user_id', user.id)
    .gte('job_date', fromDate)
    .lte('job_date', toDate)
    .order('job_time', { ascending: true, nullsFirst: true })

  if (!includesCancelled) {
    query = query.neq('status', 'cancelled')
  }

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/jobs/calendar]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Group jobs by date string (YYYY-MM-DD)
  const calendar: CalendarData = {}
  for (const job of data ?? []) {
    const key = job.job_date as string
    if (!calendar[key]) calendar[key] = []
    calendar[key].push(job)
  }

  return NextResponse.json({ calendar, from_date: fromDate, to_date: toDate })
}
