// PUT /api/hd/work-orders/[id]/discount   body: { discount: {type, value, scope, reason} | null }
//
// The discount on an HD work order (migration 168). Its own route because the
// work-order PATCH is deliberately money-free; this one prices, through the same
// function the invoice converter uses (workOrderDiscountUpdate), and writes only the
// discount and - when the work order carries its quote's tax - the tax and quoted
// total that the discount moves. null removes it and restores the pre-discount figures.
//
// Locked once invoiced, like every other work-order edit: the invoice is the billed
// document from then on.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess, reeferStandaloneCan } from '@/lib/hd-access'
import { normalizeDiscount } from '@/lib/document-discount'
import { workOrderDiscountUpdate, type WorkOrderLineRow } from '@/lib/hd/wo-to-invoice'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = (await checkHDAccess(user.id)) || (await reeferStandaloneCan(user.id, 'reefer_work_orders'))
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!('discount' in body)) return NextResponse.json({ error: 'discount is required (null removes it).' }, { status: 400 })
  const input = normalizeDiscount(body.discount)

  const { data: wo } = await supabase
    .from('hd_work_orders')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!wo) return NextResponse.json({ error: 'Work order not found.' }, { status: 404 })
  if (wo.status === 'invoiced') {
    return NextResponse.json({
      error: 'This work order has been invoiced, so it is locked. Change the discount on the invoice, or reopen the work order first.',
      reason: 'locked',
    }, { status: 409 })
  }

  const { data: lineRows, error: lineErr } = await supabase
    .from('hd_work_order_line_items')
    .select('id, type, description, part_number, quantity, unit_cost, unit_price, markup_percent, total, sort_order')
    .eq('work_order_id', id)
    .order('sort_order', { ascending: true })
  if (lineErr) return NextResponse.json({ error: 'Could not read the work order line items.' }, { status: 500 })

  // Only for a labor line with no price of its own - the converter's same fallback.
  const { data: profile } = await supabase
    .from('profiles').select('hd_labor_rate, default_labor_rate').eq('id', user.id).maybeSingle()
  const p = (profile ?? {}) as Record<string, unknown>
  const fallbackRate = p.hd_labor_rate != null ? Number(p.hd_labor_rate)
    : p.default_labor_rate != null ? Number(p.default_labor_rate) : null

  const result = workOrderDiscountUpdate(
    wo as Record<string, unknown>, (lineRows ?? []) as unknown as WorkOrderLineRow[], input, fallbackRate)
  if ('error' in result) return NextResponse.json({ error: result.error, reason: 'discount' }, { status: 422 })

  const { data, error } = await supabase
    .from('hd_work_orders')
    .update(result.update)
    .eq('id', id)
    .eq('user_id', user.id)
    .neq('status', 'invoiced')
    .select('*')
    .maybeSingle()
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'This work order was invoiced while you were editing it.' }, { status: error ? 500 : 409 })
  }
  return NextResponse.json({ work_order: data, discount: result.discount, notice: result.notice })
}
