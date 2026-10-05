// GET  /api/work-orders/[id]/segments — every segment on this work order + the rollup
// POST /api/work-orders/[id]/segments — add one
//
// LD. The HD phase adds the same two handlers under api/hd/work-orders/[id]/segments,
// differing only in the product passed to the shared helpers.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasWorkOrders } from '@/lib/work-orders'
import { guardCanAddSegment, parentExists, PARENTS } from '@/lib/segments/parent'
import { SEGMENT_SELECT, shapeSegments } from '@/lib/segments/select'
import { syncParentExtrasQuietly } from '@/lib/segments/parent-extras'
import { extrasDisplayRows, extrasFromDocument } from '@/lib/billable-extras'
import { normalizeSegmentLines, priceSegment, rollupSegments } from '@/components/shared/segments'
import { loadTaxSettings } from '@/lib/tax-settings.server'
import { isMissingTaxBreakdownColumn, withoutTaxBreakdown } from '@/lib/tax'

export const dynamic = 'force-dynamic'

const FK = PARENTS.ld.fkColumn

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
  if (!await parentExists(supabase, 'ld', id, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('work_order_segments')
    .select(SEGMENT_SELECT)
    .eq(FK, id)
    .eq('user_id', user.id)
    .order('sequence', { ascending: true })

  if (error) {
    console.error('[GET segments]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const segments = shapeSegments(data)

  // The parent's extras, so the segment list can show travel, mileage and the
  // shop-supplies fee beside the rollup. Read from the PARENT ROW the mutation
  // routes just synced, not recomputed here: the number on screen is then the same
  // number that will be billed, by construction rather than by two calculations
  // agreeing. A missing migration 142 leaves these null and yields no rows.
  const { data: parentRow } = await supabase
    .from('work_orders')
    .select('travel_hours, travel_rate, travel_amount, mileage_miles, mileage_rate, mileage_amount, shop_supplies_percent_applied, shop_supplies_cap_applied, shop_supplies_fee')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  const extras = extrasDisplayRows(
    extrasFromDocument((parentRow ?? null) as Record<string, unknown> | null),
  )

  return NextResponse.json({ segments, rollup: rollupSegments(segments), extras })
}

export async function POST(
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

  // PARENT-PRICED OR SEGMENT-PRICED, NEVER BOTH. 409 with a sentence the tech can act
  // on, rather than letting a record end up carrying two totals.
  const guard = await guardCanAddSegment(supabase, 'ld', id, user.id)
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason ?? 'Cannot add a segment.' }, { status: 409 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // Next sequence. Derived from MAX rather than COUNT so a deleted segment 2 leaves a
  // gap instead of letting a new segment reuse a number the customer already saw.
  const { data: last } = await supabase
    .from('work_order_segments')
    .select('sequence')
    .eq(FK, id)
    .eq('user_id', user.id)
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle()

  const sequence = Number(last?.sequence ?? 0) + 1

  const lines = normalizeSegmentLines(body.line_items)
  // Priced with the shop's parts/labor settings, on the server, so the split the
  // customer approves is the split that was actually stored.
  const taxSettings = await loadTaxSettings(supabase, user.id)
  const money = priceSegment(lines, Number(body.tax_percent ?? 0), taxSettings)
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

  // SEGMENT 1 INHERITS THE JOB DESCRIPTION as its complaint. The tech already typed
  // what is wrong with the truck when they opened the work order; making them retype
  // it as segment 1 is the same sentence entered twice.
  //
  // Only the FIRST segment, and only when the caller sent nothing: segment 2 is a
  // different complaint by definition, and an explicit value always wins. Prefilled
  // server-side so the client cannot hold a different idea of the default — and it
  // lands as a normal editable value, never a locked one.
  let complaint = str(body.complaint)
  if (!complaint && sequence === 1) {
    const { data: parent } = await supabase
      .from('work_orders')
      .select('job_description')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()
    complaint = str(parent?.job_description)
  }

  const row = {
    user_id:    user.id,
    [FK]:       id,
    sequence,
    complaint,
    cause:      str(body.cause),
    correction: str(body.correction),
    status:     'pending' as const,
    ...money,
  }

  let { data, error } = await supabase
    .from('work_order_segments')
    .insert(row)
    .select(SEGMENT_SELECT)
    .single()

  // Migration 140 is applied by hand. Retry without the display column rather than
  // cost the tech the segment they just typed.
  if (error && isMissingTaxBreakdownColumn(error)) {
    console.error('[POST segments] tax_breakdown missing — run migration 140', error.message)
    ;({ data, error } = await supabase
      .from('work_order_segments')
      .insert(withoutTaxBreakdown(row))
      .select(SEGMENT_SELECT)
      .single())
  }

  if (error || !data) {
    console.error('[POST segments]', error)
    return NextResponse.json({ error: error?.message ?? 'Failed to add segment' }, { status: 500 })
  }

  // A segment changed, so the parent's shop supplies fee has a new parts base.
  // Recomputed and stored on the parent; never allowed to fail this request.
  await syncParentExtrasQuietly(supabase, 'ld', id, user.id)

  return NextResponse.json({ segment: shapeSegments([data])[0] }, { status: 201 })
}
