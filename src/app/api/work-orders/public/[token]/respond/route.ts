// POST /api/work-orders/public/[token]/respond
//
// The customer approving or declining ONE segment. This is the whole point of
// segments: the PCM gets a yes, the clutch gets a no, and neither answer touches the
// other.
//
// Body: { segment_id, action: 'approve' | 'decline', note?, option_id? }
//
// `option_id` is accepted now and ignored unless the segment actually has that option.
// It is how Good/Better/Best lands later without a new route: the customer's choice of
// tier is recorded alongside their approval, which a status-only model cannot express.

import { NextResponse } from 'next/server'
import { FOLLOWUP_DAYS } from '@/lib/followups'
import { createServiceClient } from '@/lib/supabase/service'
import { PARENTS } from '@/lib/segments/parent'
import { SEGMENT_SELECT, shapeSegments } from '@/lib/segments/select'
import { rollupSegments } from '@/components/shared/segments'

export const dynamic = 'force-dynamic'

const FK = PARENTS.ld.fkColumn

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!token) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { segment_id?: string; action?: string; note?: string; option_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  if (body.action !== 'approve' && body.action !== 'decline') {
    return NextResponse.json({ error: 'action must be "approve" or "decline".' }, { status: 400 })
  }
  if (!body.segment_id) {
    return NextResponse.json({ error: 'segment_id is required.' }, { status: 400 })
  }

  const sc = createServiceClient()

  // The token identifies the work order; the segment must belong to THAT work order.
  // Without this join a valid token plus someone else's segment id would let a customer
  // answer for a job that is not theirs.
  const { data: wo } = await sc
    .from('work_orders')
    .select('id, user_id')
    .eq('public_token', token)
    .single()

  if (!wo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: segment } = await sc
    .from('work_order_segments')
    .select('id, status, sequence, authorized_at, declined_at')
    .eq('id', body.segment_id)
    .eq(FK, wo.id)
    .single()

  if (!segment) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Already answered. Returned as a conflict with the current state rather than
  // silently re-writing it: a double-tap on a phone must not look like a second
  // decision, and a tech who already authorized it by phone keeps that record.
  if (segment.status !== 'pending') {
    return NextResponse.json(
      { error: 'This item has already been answered.', status: segment.status },
      { status: 409 },
    )
  }

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = {
    customer_note:        typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null,
    authorization_method: 'customer_link',
  }

  if (body.action === 'approve') {
    updates.status        = 'authorized'
    updates.authorized_at = now
    updates.declined_at   = null

    // Only honoured when the option genuinely belongs to this segment — the id arrives
    // from a public request and nothing else validates it.
    if (body.option_id) {
      const { data: option } = await sc
        .from('work_order_segment_options')
        .select('id')
        .eq('id', body.option_id)
        .eq('segment_id', segment.id)
        .maybeSingle()
      if (option) updates.selected_option_id = option.id
    }
  } else {
    updates.status      = 'declined'
    updates.declined_at = now
    // Declined work is a lead, not a deletion.
    updates.followup_due_on = new Date(Date.now() + FOLLOWUP_DAYS * 86_400_000)
      .toISOString().slice(0, 10)
  }

  const { error } = await sc
    .from('work_order_segments')
    .update(updates)
    .eq('id', segment.id)
    .eq(FK, wo.id)

  if (error) {
    console.error('[segments respond]', error)
    return NextResponse.json({ error: 'Could not record your response.' }, { status: 500 })
  }

  // Return the whole set so the page re-renders every segment and the running total
  // from one source of truth, rather than patching its own copy.
  const { data: segRows } = await sc
    .from('work_order_segments')
    .select(SEGMENT_SELECT)
    .eq(FK, wo.id)
    .order('sequence', { ascending: true })

  const segments = shapeSegments(segRows)
  return NextResponse.json({ segments, rollup: rollupSegments(segments) })
}
