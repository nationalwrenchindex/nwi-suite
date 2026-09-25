import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkHDAccess } from '@/lib/hd-access'
import { dispatchNotificationFor, type NotificationTrigger } from '@/lib/notifications'
import { sendSmsResult } from '@/lib/twilio'

// An outbound SMS now happens inside this request, so it needs a budget of its own.
export const maxDuration = 30

const VALID_TRANSITIONS: Record<string, string[]> = {
  open:        ['on_the_way', 'in_progress', 'cancelled'],
  on_the_way:  ['in_progress', 'open', 'cancelled'],
  in_progress: ['completed', 'open', 'cancelled'],
  completed:   ['invoiced'],
  // Invoiced is no longer terminal: voiding an invoice has to be able to release the
  // job so it can be re-billed. It reverts to completed rather than open, because the
  // work itself was still finished — only the billing was undone.
  invoiced:    ['completed'],
  cancelled:   ['open'],
}

// ─── Customer notifications ──────────────────────────────────────────────────
// Which transitions the customer hears about, and the column that records having
// told them. The stamp — not the status, and not the cron-style timestamps
// on_the_way_at / completed_at — is what makes this once-only: a job dragged
// on_the_way -> open -> on_the_way must not text twice, and a tech correcting a
// misclick is not an event the customer should hear about again.
const NOTIFY: Record<string, { trigger: NotificationTrigger; stamp: 'on_my_way_sent_at' | 'completed_notified_at' }> = {
  on_the_way: { trigger: 'on_my_way',     stamp: 'on_my_way_sent_at' },
  completed:  { trigger: 'job_completed', stamp: 'completed_notified_at' },
}

/** What the customer should hear their unit called. Prefers make + model, falls
 *  back to the serial, then to something generic — never an empty string, which
 *  would render as "your  is ready". */
function unitLabel(wo: Record<string, unknown>): string {
  const make  = (wo.unit_manufacturer as string | null)?.trim()
  const model = (wo.unit_model as string | null)?.trim()
  const pair  = [make, model].filter(Boolean).join(' ')
  if (pair) return pair
  const serial = (wo.unit_serial as string | null)?.trim()
  return serial ? `unit ${serial}` : 'your unit'
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { id } = await params

  let body: { status?: string; labor_minutes?: number; notify?: boolean }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { status: newStatus, labor_minutes } = body
  if (!newStatus) return NextResponse.json({ error: 'status required' }, { status: 400 })

  const svc = createServiceClient()

  // Migrations here are applied by hand, so a deploy can land before 136 does. In
  // that window sms_consent and the two stamps do not exist and this select fails —
  // which would break every HD status change, not just the new notification. Retry
  // without them and skip notifying: a status change that works and stays quiet is
  // recoverable, a scheduler whose buttons all 422 is not. Same shape as the
  // parts_cost retry in api/hd/invoices (see isMissingCostingColumn).
  const NOTIFY_COLUMNS = 'sms_consent, on_my_way_sent_at, completed_notified_at'
  const BASE_COLUMNS   =
    'id, status, completed_at, customer_name, customer_phone, service_type, tech_name, ' +
    'unit_manufacturer, unit_model, unit_serial'

  let notifyColumnsMissing = false
  let wo: Record<string, unknown> | null = null

  const full = await svc
    .from('hd_work_orders')
    .select(`${BASE_COLUMNS}, ${NOTIFY_COLUMNS}`)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (full.data) {
    wo = full.data as unknown as Record<string, unknown>
  } else {
    const retry = await svc
      .from('hd_work_orders')
      .select(BASE_COLUMNS)
      .eq('id', id)
      .eq('user_id', user.id)
      .single()
    if (retry.data) {
      wo = retry.data as unknown as Record<string, unknown>
      notifyColumnsMissing = true
      console.error('[work-orders/status] notification columns absent — run migration 136')
    }
  }

  if (!wo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const currentStatus = String(wo.status)
  const allowed = VALID_TRANSITIONS[currentStatus] ?? []
  if (!allowed.includes(newStatus)) {
    return NextResponse.json({ error: `Cannot transition from ${currentStatus} to ${newStatus}` }, { status: 422 })
  }

  const updates: Record<string, unknown> = { status: newStatus }
  if (newStatus === 'on_the_way')  updates.on_the_way_at  = new Date().toISOString()
  if (newStatus === 'in_progress') updates.arrived_at     = new Date().toISOString()
  if (newStatus === 'completed') {
    // Reverting invoiced → completed must not restamp the original completion time,
    // so only fill this when the job has never been completed before.
    if (!wo.completed_at) updates.completed_at = new Date().toISOString()
    if (labor_minutes !== undefined) updates.labor_minutes = labor_minutes
  }

  // The status write goes first, deliberately. It is what the tech tapped, and it
  // must not wait on — or be lost to — a slow Twilio call. The cost is that a
  // failed stamp below could allow one duplicate text on a re-flip, which is why
  // that failure is logged loudly rather than swallowed.
  const { data: updated, error } = await svc
    .from('hd_work_orders')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, status')
    .single()

  if (error) {
    console.error('[work-orders/status]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // ── Tell the customer ───────────────────────────────────────────────────────
  const plan = NOTIFY[newStatus]
  let notified: { attempted: boolean; sent?: boolean; reason?: string } = { attempted: false }

  if (plan && !notifyColumnsMissing && wo[plan.stamp] == null && body.notify !== false) {
    try {
      const { data: profile } = await svc
        .from('profiles')
        .select('business_name, full_name, hd_tech_name')
        .eq('id', user.id)
        .single()

      const customerName = (wo.customer_name as string | null)?.trim() ?? ''

      const result = await dispatchNotificationFor({
        trigger:    plan.trigger,
        supabase:   svc,
        userId:     user.id,
        // hd_work_orders has no customers link, so there is no row for the
        // do-not-contact flag to be read from. getContactSuppression treats a null
        // id as "not suppressed"; the per-record sms_consent below is the only
        // gate HD has. Threading a customer_id through is the proper fix.
        customerId: null,
        customer:   { phone: wo.customer_phone as string | null, email: null },
        smsConsent: wo.sms_consent !== false,
        // Routes HD through the registered Messaging Service rather than the bare
        // From number lib/notifications would otherwise use.
        sendSmsVia: (to, bodyText) => sendSmsResult({ to, body: bodyText }),
        logLabel:   `hd work order ${id}`,
        ctx: {
          customer_name: customerName,
          first_name:    customerName.split(/\s+/)[0] ?? '',
          vehicle:       unitLabel(wo),
          // The templates were written for LD jobs, where {{service_type}} is the
          // work being done. An HD work order's equivalent is its service_type, so
          // a shop that customised the copy still reads correctly.
          service_type:  (wo.service_type as string | null)?.trim() || 'service',
          business_name: (profile?.business_name as string | null) ?? '',
          tech_name:     (wo.tech_name as string | null)
                         ?? (profile?.hd_tech_name as string | null)
                         ?? (profile?.full_name as string | null)
                         ?? '',
        },
      })

      notified = { attempted: true, sent: result.success, reason: result.sms?.error }

      if (result.success) {
        const { error: stampErr } = await svc
          .from('hd_work_orders')
          .update({ [plan.stamp]: new Date().toISOString() })
          .eq('id', id)
          .eq('user_id', user.id)
        // The text went out. If this fails the customer could be told twice after a
        // re-flip, so it is logged loudly rather than retried.
        if (stampErr) console.error(`[work-orders/status] ${plan.stamp} write failed for ${id}:`, stampErr.message)
      }
    } catch (err) {
      // A notification failure must never fail the status change — the work is
      // still on the way, or still done.
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[work-orders/status] notify failed for ${id}:`, msg)
      notified = { attempted: true, sent: false, reason: msg }
    }
  } else if (plan && wo[plan.stamp] != null) {
    notified = { attempted: false, reason: 'Customer already notified for this transition' }
  }

  return NextResponse.json({ ok: true, id: updated.id, status: updated.status, notified })
}
