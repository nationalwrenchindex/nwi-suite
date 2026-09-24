// POST /api/work-orders/[id]/status — move a work order through open →
// in_progress → complete, and tell the customer when it crosses the two
// transitions they care about.
//
// Separate from PATCH because a status change has an outward-facing side effect. A
// field edit that could text a customer would be a trap for whoever next adds a
// field to this record.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasWorkOrders } from '@/lib/work-orders'
import { dispatchNotificationFor } from '@/lib/notifications'
import { WORK_ORDER_SELECT } from '../../list'
import {
  WORK_ORDER_STATUSES, unitLabelFor,
  type WorkOrderStatus, type WorkOrder,
} from '@/types/work-orders'

export const dynamic = 'force-dynamic'

/** Which trigger a transition announces. `open` announces nothing — the customer
 *  already knows the job was written up; they authorised it. */
const TRIGGER_FOR: Record<WorkOrderStatus, 'work_started' | 'job_completed' | null> = {
  open:        null,
  in_progress: 'work_started',
  complete:    'job_completed',
}

/** The column that records the send, so a status dragged back and forth cannot text
 *  the same customer twice for one transition. */
const STAMP_FOR: Record<WorkOrderStatus, 'notified_in_progress_at' | 'notified_complete_at' | null> = {
  open:        null,
  in_progress: 'notified_in_progress_at',
  complete:    'notified_complete_at',
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

  let body: { status?: string; notify?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const status = body.status as WorkOrderStatus
  if (!WORK_ORDER_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${WORK_ORDER_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('work_orders')
    .select(WORK_ORDER_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const wo    = existing as unknown as WorkOrder
  const stamp = STAMP_FOR[status]

  const updates: Record<string, unknown> = { status }
  if (status === 'in_progress' && !wo.started_at)   updates.started_at   = new Date().toISOString()
  if (status === 'complete'    && !wo.completed_at) updates.completed_at = new Date().toISOString()

  // ── Customer notice ─────────────────────────────────────────────────────────
  // Sent BEFORE the status write so a send failure does not leave a record claiming
  // the customer was told. The stamp is what makes it once-only; `notify: false`
  // lets a tech fix a misclick silently.
  const trigger = TRIGGER_FOR[status]
  let notified: unknown = null

  const alreadyNotified = stamp ? wo[stamp] != null : true
  if (trigger && stamp && !alreadyNotified && body.notify !== false && wo.customer) {
    notified = await dispatchNotificationFor({
      trigger,
      supabase,
      userId:     user.id,
      customerId: wo.customer_id,
      customer:   { phone: wo.customer.phone, email: wo.customer.email },
      ctx: {
        customer_name: `${wo.customer.first_name} ${wo.customer.last_name}`.trim(),
        first_name:    wo.customer.first_name,
        vehicle:       unitLabelFor(wo),
        // The templates were written for jobs, where {{service_type}} is the work.
        // A work order's equivalent is its description, so the existing wording
        // still reads correctly for a shop that customised the message.
        service_type:  wo.job_description ?? 'service',
      },
    })
    const r = notified as { success?: boolean }
    if (r?.success) updates[stamp] = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('work_orders')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(WORK_ORDER_SELECT)
    .single()

  if (error || !data) {
    console.error('[POST /api/work-orders/[id]/status]', error)
    return NextResponse.json({ error: error?.message ?? 'Failed to update status' }, { status: 500 })
  }

  return NextResponse.json({ work_order: data, notified })
}
