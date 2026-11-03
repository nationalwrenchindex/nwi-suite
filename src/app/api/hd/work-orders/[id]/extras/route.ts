// GET /api/hd/work-orders/[id]/extras
// PUT /api/hd/work-orders/[id]/extras   body: { travel_hours, mileage_miles, service_call_fee, dry_run? }
//
// Drive time, mileage, shop supplies and the service call fee on an HD work order.
// Priced by workOrderExtrasUpdate (src/lib/hd/work-order-extras.ts); the preview is the
// invoice the converter would build from the result, through the converter itself, so
// the panel shows the figures the invoice will carry - not a second calculation.
//
// dry_run prices and previews without writing, so the panel can show the totals as the
// tech types. Locked once invoiced, like every other work-order edit.

import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess, reeferStandaloneCan } from '@/lib/hd-access'
import { buildInvoicePayload, type WorkOrderLineRow } from '@/lib/hd/wo-to-invoice'
import { loadLinesAndJobs } from '@/lib/hd/work-order-jobs-load'
import { loadHdShopExtras } from '@/lib/hd/hd-extras-load'
import { workOrderExtrasState, workOrderExtrasUpdate, workOrderExtrasSettings, type ShopExtras } from '@/lib/hd/work-order-extras'
import { isMissingServiceCallColumn, withoutServiceCall } from '@/lib/hd/hd-extras'

export const dynamic = 'force-dynamic'

async function load(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const hasAccess = (await checkHDAccess(user.id)) || (await reeferStandaloneCan(user.id, 'reefer_work_orders'))
  if (!hasAccess) return { res: NextResponse.json({ error: 'HD subscription required' }, { status: 403 }) }

  const { data: wo } = await supabase.from('hd_work_orders').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!wo) return { res: NextResponse.json({ error: 'Work order not found.' }, { status: 404 }) }
  const { lines, jobs, error } = await loadLinesAndJobs(supabase, id)
  if (error) return { res: NextResponse.json({ error: 'Could not read the work order line items.' }, { status: 500 }) }
  const { shop, available } = await loadHdShopExtras(supabase, user.id)
  return { supabase, user, wo: wo as Record<string, unknown>, rows: lines as unknown as WorkOrderLineRow[], jobs, shop, available }
}

/** The invoice the converter would build, and the settings the inputs show under. */
function preview(wo: Record<string, unknown>, rows: WorkOrderLineRow[], jobs: Parameters<typeof buildInvoicePayload>[3], shop: ShopExtras) {
  const { payload, discountError } = buildInvoicePayload(wo, rows, { laborRate: shop.laborRate, taxSettings: shop.taxSettings }, jobs)
  return { invoice: payload, discount_error: discountError }
}

function settingsFor(wo: Record<string, unknown>, shop: ShopExtras, available: boolean) {
  return {
    extras: workOrderExtrasSettings(wo, shop.extras),
    // Shown beside the panel when this work order records no supplies but the shop bills them.
    shop_bills_supplies: shop.extras.billShopSupplies,
    labor_rate: shop.laborRate,
    service_call: { ...shop.serviceCall, available },
    // The panel pre-fills the service call fee only on a work order nobody has priced
    // extras on yet; once anything is recorded, the stored figures are the answer.
    untouched: wo.travel_rate == null && wo.mileage_rate == null && wo.shop_supplies_percent_applied == null && wo.service_call_tax == null,
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const l = await load(id)
  if ('res' in l) return l.res
  return NextResponse.json({
    state: workOrderExtrasState(l.wo),
    settings: settingsFor(l.wo, l.shop, l.available),
    locked: l.wo.status === 'invoiced',
    ...preview(l.wo, l.rows, l.jobs, l.shop),
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const l = await load(id)
  if ('res' in l) return l.res
  const dryRun = body.dry_run === true
  if (l.wo.status === 'invoiced' && !dryRun) {
    return NextResponse.json({
      error: 'This work order has been invoiced, so it is locked. Change these on the invoice.', reason: 'locked',
    }, { status: 409 })
  }

  const n = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v))
  const input = {
    travelHours: n(body.travel_hours),
    mileageMiles: n(body.mileage_miles),
    serviceCallFee: body.service_call_fee === null || body.service_call_fee === undefined || body.service_call_fee === '' ? null : Number(body.service_call_fee),
  }
  if (![input.travelHours, input.mileageMiles].every(Number.isFinite) || (input.serviceCallFee != null && !Number.isFinite(input.serviceCallFee))) {
    return NextResponse.json({ error: 'Drive time, mileage and the service call fee must be numbers.' }, { status: 400 })
  }

  // The fee needs 178's column on the work order itself, not only the settings.
  const available = l.available && 'service_call_fee' in l.wo
  const result = workOrderExtrasUpdate(l.wo, l.rows, input, l.shop, available)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 422 })

  const next = { ...l.wo, ...result.update }
  if (dryRun) {
    return NextResponse.json({ state: workOrderExtrasState(next), settings: settingsFor(next, l.shop, l.available), ...preview(next, l.rows, l.jobs, l.shop) })
  }

  const write = (row: Record<string, unknown>) => (l.supabase as SupabaseClient)
    .from('hd_work_orders').update(row).eq('id', id).eq('user_id', l.user.id).neq('status', 'invoiced').select('*').maybeSingle()
  let { data, error } = await write(result.update)
  if (error && isMissingServiceCallColumn(error)) ({ data, error } = await write(withoutServiceCall(result.update)))
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'This work order was invoiced while you were editing it.' }, { status: error ? 500 : 409 })
  }
  const saved = data as Record<string, unknown>
  return NextResponse.json({ state: workOrderExtrasState(saved), settings: settingsFor(saved, l.shop, l.available), ...preview(saved, l.rows, l.jobs, l.shop) })
}
