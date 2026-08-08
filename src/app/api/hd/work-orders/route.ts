import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'

export const dynamic = 'force-dynamic'

// POST /api/hd/work-orders — book a new job/appointment.
// Inserts into hd_work_orders with scheduled_at set so it appears on the calendar.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ok = await checkHDStarterAccess(user.id)
  if (!ok) return NextResponse.json({ error: 'HD access required' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

  const scheduledDate = str(body.scheduled_date)
  if (!scheduledDate) return NextResponse.json({ error: 'scheduled_date required' }, { status: 400 })
  const scheduledTime = str(body.scheduled_time) ?? '09:00'
  // Store the naive local date+time; the calendar groups on the date portion.
  const scheduled_at = `${scheduledDate}T${scheduledTime}:00`

  const customerName = str(body.customer_name)
  if (!customerName) return NextResponse.json({ error: 'customer_name required' }, { status: 400 })

  // Sequential work-order number, mirroring the invoices/quotes pattern.
  const { count } = await supabase
    .from('hd_work_orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
  const year = new Date().getFullYear()
  const seq  = String((count ?? 0) + 1).padStart(4, '0')
  const work_order_number = `WO-${year}-${seq}`

  const durationRaw = body.estimated_duration_hours
  const estimated_duration_hours =
    typeof durationRaw === 'number' ? durationRaw
    : (typeof durationRaw === 'string' && durationRaw.trim() && !Number.isNaN(Number(durationRaw))) ? Number(durationRaw)
    : null

  const { data, error } = await supabase
    .from('hd_work_orders')
    .insert({
      user_id:                  user.id,
      work_order_number,
      status:                   'open',
      scheduled_at,
      // Optional links to existing fleet records (so the list joins show them).
      unit_id:                  str(body.unit_id),
      fleet_account_id:         str(body.fleet_account_id),
      customer_name:            customerName,
      customer_phone:           str(body.customer_phone),
      unit_manufacturer:        str(body.unit_manufacturer),
      unit_model:               str(body.unit_model),
      unit_serial:              str(body.unit_serial),
      service_type:             str(body.service_type),
      service_requests:         str(body.job_description),
      comments:                 str(body.notes),
      estimated_duration_hours,
    })
    .select('id, work_order_number, scheduled_at')
    .single()

  if (error) {
    console.error('[hd/work-orders POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ work_order: data }, { status: 201 })
}
