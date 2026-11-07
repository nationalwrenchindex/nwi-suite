import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess, reeferStandaloneCan } from '@/lib/hd-access'
import { insertWithWorkOrderNumber } from '@/lib/work-order-number'
import { loadHdShopExtras } from '@/lib/hd/hd-extras-load'
import { workOrderDefaultColumns } from '@/lib/hd/work-order-extras'
import { isMissingReadingColumn, readingsFromBody, unitIdentityFill, withoutMissingReadings } from '@/lib/hd/unit-hours'
import { isMissingServiceCallColumn, withoutServiceCall } from '@/lib/hd/hd-extras'
import { WORK_ORDER_LIST_SELECT, WORK_ORDER_PAGE_SIZE } from './list'

export const dynamic = 'force-dynamic'

// GET /api/hd/work-orders?limit=&offset= — one page of the work-order list.
// PostgREST silently truncates at 1,000 rows, so the list pages instead of
// loading everything; `count` comes from its own exact/head query so the header
// total stays truthful no matter how few rows the caller has loaded.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ok = (await checkHDStarterAccess(user.id)) || (await reeferStandaloneCan(user.id, 'reefer_work_orders'))
  if (!ok) return NextResponse.json({ error: 'HD access required' }, { status: 403 })

  const sp     = req.nextUrl.searchParams
  const limit  = Math.min(Number(sp.get('limit') ?? WORK_ORDER_PAGE_SIZE), 200)
  const offset = Number(sp.get('offset') ?? 0)

  const [{ data, error }, { count }] = await Promise.all([
    supabase
      .from('hd_work_orders')
      .select(WORK_ORDER_LIST_SELECT)
      .eq('user_id', user.id)
      // created_at alone is not unique, and offset paging over a non-deterministic
      // order drops and repeats rows between pages. id breaks every tie.
      .order('created_at', { ascending: false })
      .order('id',         { ascending: false })
      .range(offset, offset + limit - 1),
    supabase
      .from('hd_work_orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ])

  if (error) {
    console.error('[hd/work-orders GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ work_orders: data ?? [], count: count ?? 0 })
}

// POST /api/hd/work-orders — book a new job/appointment.
// Inserts into hd_work_orders with scheduled_at set so it appears on the calendar.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ok = (await checkHDStarterAccess(user.id)) || (await reeferStandaloneCan(user.id, 'reefer_work_orders'))
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

  // THE LINKS MUST BE THIS SHOP'S. unit_id and fleet_account_id were inserted as sent,
  // and a foreign key does not apply RLS - so an id lifted from another shop's unit or
  // fleet account attached it to this work order. Checked the same way the work order
  // PATCH checks unit_id. NewWorkOrderForm and the calendar only ever offer the shop's
  // own units and accounts, so a legitimate request always passes.
  const unitId  = str(body.unit_id)
  let linkedUnit: Record<string, unknown> | null = null
  const fleetId = str(body.fleet_account_id)
  if (unitId) {
    const { data: unit } = await supabase
      .from('hd_units').select('id, unit_number, manufacturer, model, serial_number').eq('id', unitId).eq('user_id', user.id).maybeSingle()
    if (!unit) return NextResponse.json({ error: 'That unit was not found in your units.' }, { status: 400 })
    linkedUnit = unit as Record<string, unknown>
  }
  if (fleetId) {
    const { data: acct } = await supabase
      .from('hd_fleet_accounts').select('id').eq('id', fleetId).eq('user_id', user.id).maybeSingle()
    if (!acct) return NextResponse.json({ error: 'That fleet account was not found in your accounts.' }, { status: 400 })
  }

  // The readings at the time of service (179 hours, 183 odometer), sent by a
  // QuickWrench push. Only the keys sent; an unparseable value is refused.
  const readings = readingsFromBody(body)
  if ('error' in readings) return NextResponse.json({ error: readings.error }, { status: 400 })

  const durationRaw = body.estimated_duration_hours
  const estimated_duration_hours =
    typeof durationRaw === 'number' ? durationRaw
    : (typeof durationRaw === 'string' && durationRaw.trim() && !Number.isNaN(Number(durationRaw))) ? Number(durationRaw)
    : null

  // Drive time, mileage, shop supplies and the service call fee the shop bills, recorded
  // on the work order now so a later change to Settings never re-prices it.
  const { shop, available } = await loadHdShopExtras(supabase, user.id)
  const defaults = workOrderDefaultColumns(shop, available)

  // The highest existing number plus one, retried on a collision (lib/work-order-number).
  const { data, error } = await insertWithWorkOrderNumber(supabase, 'hd_work_orders', user.id, async work_order_number => {
    const row: Record<string, unknown> = {
      user_id:                  user.id,
      work_order_number,
      status:                   'open',
      scheduled_at,
      // Optional links to existing fleet records (so the list joins show them).
      unit_id:                  unitId,
      fleet_account_id:         fleetId,
      customer_name:            customerName,
      customer_phone:           str(body.customer_phone),
      unit_number:              str(body.unit_number),
      unit_manufacturer:        str(body.unit_manufacturer),
      unit_model:               str(body.unit_model),
      unit_serial:              str(body.unit_serial),
      service_type:             str(body.service_type),
      service_requests:         str(body.job_description),
      comments:                 str(body.notes),
      // Structured service address (migration 120). Kept separate from the free-text
      // `location` column, which holds gate codes and yard directions — those are not
      // a mailing address. These fields are what the "Create Invoice" handoff can
      // prefill into the invoice form's individual address inputs.
      address_line1:            str(body.address_line1),
      address_line2:            str(body.address_line2),
      city:                     str(body.city),
      state:                    str(body.state),
      zip:                      str(body.zip),
      estimated_duration_hours,
      ...defaults,
      ...readings.update,
    }
    // The linked unit's number, make, model and serial, recorded on the work order
    // where the form sent none - frozen there, never read live off the unit later.
    Object.assign(row, unitIdentityFill(row, linkedUnit))
    const insert = (r: Record<string, unknown>) => supabase.from('hd_work_orders').insert(r).select('id, work_order_number, scheduled_at').single()
    let first = row
    let res = await insert(first)
    // A reading column the database lacks: a reading that was sent is refused, never
    // dropped silently; an unsent one is simply left off.
    if (res.error && isMissingReadingColumn(res.error)) {
      const r = withoutMissingReadings(first, res.error)
      if ('error' in r) return { data: null, error: { message: r.error, code: 'READING_COLUMN' } } as unknown as typeof res
      first = r.row
      res = await insert(first)
    }
    // Before migration 178 the work order has no service call columns.
    return res.error && isMissingServiceCallColumn(res.error) ? insert(withoutServiceCall(first)) : res
  })

  if (error) {
    console.error('[hd/work-orders POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ work_order: data }, { status: 201 })
}
