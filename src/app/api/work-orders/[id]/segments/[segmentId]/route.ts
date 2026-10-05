// PATCH  /api/work-orders/[id]/segments/[segmentId] — edit one segment
// DELETE /api/work-orders/[id]/segments/[segmentId]
//
// Status lives in ./status, because moving a segment to authorized or declined is a
// customer-facing decision with its own audit columns. A field edit must never set
// those as a side effect.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasWorkOrders } from '@/lib/work-orders'
import { PARENTS } from '@/lib/segments/parent'
import { SEGMENT_SELECT, shapeSegments } from '@/lib/segments/select'
import { syncParentExtrasQuietly } from '@/lib/segments/parent-extras'
import { normalizeSegmentLines, priceSegment } from '@/components/shared/segments'
import { loadTaxSettings } from '@/lib/tax-settings.server'
import { isMissingTaxBreakdownColumn } from '@/lib/tax'

export const dynamic = 'force-dynamic'

const FK = PARENTS.ld.fkColumn

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; segmentId: string }> },
) {
  const { id, segmentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasWorkOrders(supabase, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 403 })
  }

  const { data: existing } = await supabase
    .from('work_order_segments')
    .select('id, status, tax_percent, line_items')
    .eq('id', segmentId)
    .eq(FK, id)
    .eq('user_id', user.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // An authorized segment is what the customer agreed to pay. Repricing it after the
  // fact would make the approval they gave describe a different amount, with no trace
  // of the change. Declining first, or adding a new segment, is the honest path.
  if (existing.status === 'authorized' || existing.status === 'complete') {
    return NextResponse.json(
      { error: 'This segment has been authorized and can no longer be repriced. Add a new segment for extra work.' },
      { status: 409 },
    )
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const updates: Record<string, unknown> = {}

  if ('complaint'  in body) updates.complaint  = str(body.complaint)
  if ('cause'      in body) updates.cause      = str(body.cause)
  if ('correction' in body) updates.correction = str(body.correction)

  // Closing out a follow-up. Not a status change — the segment stays declined, which
  // is the historical fact; this only takes it off the worklist. Sending false puts it
  // back, for a shop that closed one by mistake.
  if ('followup_closed' in body) {
    updates.followup_closed_at = body.followup_closed ? new Date().toISOString() : null
  }

  // Money is only ever recomputed, never copied from the request. A total that arrived
  // in a body is a number nobody verified.
  if ('line_items' in body || 'tax_percent' in body) {
    const lines = 'line_items' in body
      ? normalizeSegmentLines(body.line_items)
      : normalizeSegmentLines(existing.line_items)
    const taxPct = 'tax_percent' in body
      ? Number(body.tax_percent ?? 0)
      : Number(existing.tax_percent ?? 0)
    Object.assign(updates, priceSegment(lines, taxPct, await loadTaxSettings(supabase, user.id)))
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('work_order_segments')
    .update(updates)
    .eq('id', segmentId)
    .eq(FK, id)
    .eq('user_id', user.id)
    .select(SEGMENT_SELECT)
    .single()

  if (error || !data) {
    console.error('[PATCH segment]', error)
    return NextResponse.json({ error: error?.message ?? 'Failed to save' }, { status: 500 })
  }
  // A segment changed, so the parent's shop supplies fee has a new parts base.
  // Recomputed and stored on the parent; never allowed to fail this request.
  await syncParentExtrasQuietly(supabase, 'ld', id, user.id)

  return NextResponse.json({ segment: shapeSegments([data])[0] })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; segmentId: string }> },
) {
  const { id, segmentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasWorkOrders(supabase, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 403 })
  }

  const { data: existing } = await supabase
    .from('work_order_segments')
    .select('id, status')
    .eq('id', segmentId)
    .eq(FK, id)
    .eq('user_id', user.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Deleting authorized work erases the record of what the customer agreed to. A
  // declined segment is deliberately still deletable: it carries no agreement, and a
  // shop that does not want it on the follow-up list should be able to drop it.
  if (existing.status === 'authorized' || existing.status === 'complete') {
    return NextResponse.json(
      { error: 'This segment has been authorized and cannot be deleted. Decline it instead, which keeps the record.' },
      { status: 409 },
    )
  }

  const { error } = await supabase
    .from('work_order_segments')
    .delete()
    .eq('id', segmentId)
    .eq(FK, id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // A segment changed, so the parent's shop supplies fee has a new parts base.
  // Recomputed and stored on the parent; never allowed to fail this request.
  await syncParentExtrasQuietly(supabase, 'ld', id, user.id)

  return NextResponse.json({ ok: true })
}
