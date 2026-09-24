// GET    /api/work-orders/[id] — one work order
// PATCH  /api/work-orders/[id] — edit fields (not status; see ./status)
// DELETE /api/work-orders/[id]
//
// Status lives in its own route because changing it can text the customer, and a
// field edit must never do that as a side effect.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasWorkOrders } from '@/lib/work-orders'
import { WORK_ORDER_SELECT } from '../list'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasWorkOrders(supabase, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 403 })
  }

  const [{ data, error }, { data: photos }] = await Promise.all([
    supabase.from('work_orders').select(WORK_ORDER_SELECT).eq('id', id).eq('user_id', user.id).single(),
    supabase.from('work_order_photos').select('id, work_order_id, file_url, caption, created_at')
      .eq('work_order_id', id).eq('user_id', user.id).order('created_at', { ascending: true }),
  ])

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ work_order: { ...data, photos: photos ?? [] } })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
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

  // A completed work order that has already been billed is the customer's record of
  // what they agreed to pay. Editing it after the fact would make the invoice and
  // the work order disagree with no trace of which came first.
  const { data: existing } = await supabase
    .from('work_orders')
    .select('converted_invoice_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (existing?.converted_invoice_id) {
    return NextResponse.json(
      { error: 'This work order has been invoiced and can no longer be edited.' },
      { status: 409 },
    )
  }

  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null
  const num = (v: unknown): number | null =>
    v === null || v === undefined || v === '' ? null : Number(v)

  const updates: Record<string, unknown> = {}
  if ('customer_id'          in body) updates.customer_id          = str(body.customer_id)
  if ('vehicle_id'           in body) updates.vehicle_id           = str(body.vehicle_id)
  if ('unit_label'           in body) updates.unit_label           = str(body.unit_label)
  if ('job_description'      in body) updates.job_description      = str(body.job_description)
  if ('po_number'            in body) updates.po_number            = str(body.po_number)
  if ('tech_notes'           in body) updates.tech_notes           = str(body.tech_notes)
  if ('line_items'           in body) updates.line_items           = Array.isArray(body.line_items) ? body.line_items : []
  if ('labor_hours'          in body) updates.labor_hours          = num(body.labor_hours)
  if ('labor_rate'           in body) updates.labor_rate           = num(body.labor_rate)
  if ('parts_subtotal'       in body) updates.parts_subtotal       = num(body.parts_subtotal)
  if ('parts_markup_percent' in body) updates.parts_markup_percent = num(body.parts_markup_percent)
  if ('labor_subtotal'       in body) updates.labor_subtotal       = num(body.labor_subtotal)
  if ('tax_percent'          in body) updates.tax_percent          = num(body.tax_percent)
  if ('tax_amount'           in body) updates.tax_amount           = num(body.tax_amount)
  if ('grand_total'          in body) updates.grand_total          = num(body.grand_total)

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('work_orders')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(WORK_ORDER_SELECT)
    .single()

  if (error || !data) {
    console.error('[PATCH /api/work-orders/[id]]', error)
    return NextResponse.json({ error: error?.message ?? 'Failed to save' }, { status: 500 })
  }
  return NextResponse.json({ work_order: data })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasWorkOrders(supabase, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 403 })
  }

  const { data: existing } = await supabase
    .from('work_orders')
    .select('converted_invoice_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (existing?.converted_invoice_id) {
    return NextResponse.json(
      { error: 'This work order has been invoiced and cannot be deleted.' },
      { status: 409 },
    )
  }

  const { error } = await supabase.from('work_orders').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
