// GET  /api/work-orders?status=&limit=&offset=  — one page of the list
// POST /api/work-orders                         — create (blank or from a source)
//
// Gated by profiles.work_orders_enabled. A business without the flag gets 403 from
// both verbs, not an empty list: an empty list would imply the feature exists here.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasWorkOrders } from '@/lib/work-orders'
import { WORK_ORDER_STATUSES, type WorkOrderStatus } from '@/types/work-orders'
import { WORK_ORDER_SELECT, WORK_ORDER_PAGE_SIZE } from './list'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await hasWorkOrders(supabase, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 403 })
  }

  const sp     = request.nextUrl.searchParams
  const status = sp.get('status')
  const limit  = Math.min(Number(sp.get('limit') ?? WORK_ORDER_PAGE_SIZE), 100)
  const offset = Number(sp.get('offset') ?? 0)

  let rows  = supabase.from('work_orders').select(WORK_ORDER_SELECT).eq('user_id', user.id)
  let count = supabase.from('work_orders').select('id', { count: 'exact', head: true }).eq('user_id', user.id)

  if (status && WORK_ORDER_STATUSES.includes(status as WorkOrderStatus)) {
    rows  = rows.eq('status', status)
    count = count.eq('status', status)
  }

  const [{ data, error }, { count: total }] = await Promise.all([
    rows
      // created_at is not unique, so offset paging over it alone repeats and drops
      // rows between pages. id breaks every tie.
      .order('created_at', { ascending: false })
      .order('id',         { ascending: false })
      .range(offset, offset + limit - 1),
    count,
  ])

  if (error) {
    console.error('[GET /api/work-orders]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ work_orders: data ?? [], count: total ?? 0 })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await hasWorkOrders(supabase, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // WO-YYYY-NNNN, same shape as the HD invoice numbering. Derived from a count, so
  // it can collide if two tabs submit in the same instant; the UNIQUE constraint on
  // (user_id, work_order_number) is what actually guarantees uniqueness, and a
  // collision surfaces as a save error rather than two work orders sharing a number.
  const { count } = await supabase
    .from('work_orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const year = new Date().getFullYear()
  const seq  = String((count ?? 0) + 1).padStart(4, '0')

  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null
  const num = (v: unknown): number | null =>
    v === null || v === undefined || v === '' ? null : Number(v)

  const insert = {
    user_id:              user.id,
    work_order_number:    `WO-${year}-${seq}`,
    status:               'open' as const,
    customer_id:          str(body.customer_id),
    vehicle_id:           str(body.vehicle_id),
    unit_label:           str(body.unit_label),
    job_description:      str(body.job_description),
    po_number:            str(body.po_number),
    line_items:           Array.isArray(body.line_items) ? body.line_items : [],
    labor_hours:          num(body.labor_hours),
    labor_rate:           num(body.labor_rate),
    parts_subtotal:       num(body.parts_subtotal),
    parts_markup_percent: num(body.parts_markup_percent),
    labor_subtotal:       num(body.labor_subtotal),
    tax_percent:          num(body.tax_percent),
    tax_amount:           num(body.tax_amount),
    grand_total:          num(body.grand_total),
    tech_notes:           str(body.tech_notes),
    source:               str(body.source) ?? 'manual',
    source_quote_id:      str(body.source_quote_id),
  }

  const { data, error } = await supabase
    .from('work_orders')
    .insert(insert)
    .select(WORK_ORDER_SELECT)
    .single()

  if (error || !data) {
    console.error('[POST /api/work-orders]', error)
    return NextResponse.json({ error: error?.message ?? 'Failed to create work order' }, { status: 500 })
  }

  return NextResponse.json({ work_order: data }, { status: 201 })
}
