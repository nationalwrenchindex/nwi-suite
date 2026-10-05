// POST /api/work-orders/[id]/segments/[segmentId]/status
//
// The TECH-side status change: authorizing over the phone, declining what the customer
// turned down at the counter, marking work complete. The customer's own approvals come
// through api/work-orders/public/[token]/respond and set the same columns with
// authorization_method='customer_link'.
//
// Separate from PATCH because this writes the audit trail — authorized_at, declined_at,
// authorization_method — and a field edit must never do that as a side effect.

import { NextResponse, type NextRequest } from 'next/server'
import { FOLLOWUP_DAYS } from '@/lib/followups'
import { createClient } from '@/lib/supabase/server'
import { hasWorkOrders } from '@/lib/work-orders'
import { PARENTS } from '@/lib/segments/parent'
import { SEGMENT_SELECT, shapeSegments } from '@/lib/segments/select'
import { syncParentExtrasQuietly } from '@/lib/segments/parent-extras'
import { SEGMENT_STATUSES, type SegmentStatus } from '@/types/segments'

export const dynamic = 'force-dynamic'

const FK = PARENTS.ld.fkColumn

/** How long a declined job waits before it shows on the follow-up list. Long enough
 *  that the customer is not chased the same week they said no. */

export async function POST(
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

  let body: { status?: string; note?: string; method?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const status = body.status as SegmentStatus
  if (!SEGMENT_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${SEGMENT_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  const { data: existing } = await supabase
    .from('work_order_segments')
    .select('id, status, authorized_at, declined_at')
    .eq('id', segmentId)
    .eq(FK, id)
    .eq('user_id', user.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // complete only follows authorized: work cannot be finished before it was agreed to.
  if (status === 'complete' && existing.status !== 'authorized') {
    return NextResponse.json(
      { error: 'Only an authorized segment can be marked complete.' },
      { status: 422 },
    )
  }

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = { status }

  // Stamps are first-write-wins. If the customer authorized this through the link
  // yesterday, a tech touching the status today must not overwrite when — or how —
  // that agreement was given.
  if (status === 'authorized') {
    if (!existing.authorized_at) {
      updates.authorized_at        = now
      updates.authorization_method = body.method ?? 'tech_manual'
    }
    updates.declined_at    = null
    updates.followup_due_on = null
  }

  if (status === 'declined') {
    // Symmetric with the authorized branch above, and for the same reason: whoever
    // made the decision owns the attribution, and only the FIRST decision sets it.
    //
    // This is what made a shop decline read "Declined by the customer". A segment the
    // customer approved through the link carries authorization_method 'customer_link'.
    // When the shop then declined it, authorized_at was cleared but the method was
    // left behind, and the only reader of that field renders 'customer_link' as
    // "by the customer" -- so the record said the customer refused work they had in
    // fact agreed to. The prior authorization is being voided here, so the method
    // that accompanied it has to be replaced, not kept.
    //
    // Guarded on !existing.declined_at so the mistake cannot run the other way: a
    // customer who declined through the link keeps that attribution even if a tech
    // re-saves the same status afterwards.
    if (!existing.declined_at) {
      updates.declined_at          = now
      updates.authorization_method = body.method ?? 'tech_manual'
    }
    updates.authorized_at = null
    // A declined segment is the shop's best follow-up: known truck, known fault, a
    // customer who already said "not today".
    const due = new Date(Date.now() + FOLLOWUP_DAYS * 86_400_000)
    updates.followup_due_on = due.toISOString().slice(0, 10)
  }

  if (status === 'pending') {
    updates.authorized_at        = null
    updates.declined_at          = null
    updates.authorization_method = null
    updates.followup_due_on      = null
  }

  if (typeof body.note === 'string') updates.customer_note = body.note.trim() || null

  const { data, error } = await supabase
    .from('work_order_segments')
    .update(updates)
    .eq('id', segmentId)
    .eq(FK, id)
    .eq('user_id', user.id)
    .select(SEGMENT_SELECT)
    .single()

  if (error || !data) {
    console.error('[POST segment status]', error)
    return NextResponse.json({ error: error?.message ?? 'Failed to update status' }, { status: 500 })
  }
  // A segment changed, so the parent's shop supplies fee has a new parts base.
  // Recomputed and stored on the parent; never allowed to fail this request.
  await syncParentExtrasQuietly(supabase, 'ld', id, user.id)

  return NextResponse.json({ segment: shapeSegments([data])[0] })
}
