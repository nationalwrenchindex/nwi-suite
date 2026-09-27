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
import { normalizeSegmentLines, priceSegment, rollupSegments } from '@/components/shared/segments'

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
  return NextResponse.json({ segments, rollup: rollupSegments(segments) })
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
  const money = priceSegment(lines, Number(body.tax_percent ?? 0))
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

  const { data, error } = await supabase
    .from('work_order_segments')
    .insert({
      user_id:    user.id,
      [FK]:       id,
      sequence,
      complaint:  str(body.complaint),
      cause:      str(body.cause),
      correction: str(body.correction),
      status:     'pending',
      ...money,
    })
    .select(SEGMENT_SELECT)
    .single()

  if (error || !data) {
    console.error('[POST segments]', error)
    return NextResponse.json({ error: error?.message ?? 'Failed to add segment' }, { status: 500 })
  }

  return NextResponse.json({ segment: shapeSegments([data])[0] }, { status: 201 })
}
