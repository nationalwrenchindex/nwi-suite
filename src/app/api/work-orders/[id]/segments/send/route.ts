// POST /api/work-orders/[id]/segments/send
//
// Sends the customer a link to approve or decline each segment individually. Mints the
// work order's public_token on first send and reuses it after, exactly as the quote
// send route does — a customer who bookmarked the link must not find it dead because
// the shop pressed send twice.
//
// Only PENDING segments are worth sending for. A work order with none is a no-op that
// says so rather than texting the customer a page with nothing to decide.

import { NextResponse, type NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { hasWorkOrders } from '@/lib/work-orders'
import { PARENTS } from '@/lib/segments/parent'
import { sendSmsResult } from '@/lib/twilio'
import { sendCustomerEmail } from '@/lib/shared/customer-email'
import { getContactSuppression } from '@/lib/customer-contact'
import { money } from '@/lib/format'
import { rollupSegments } from '@/components/shared/segments'
import { shapeSegments, SEGMENT_SELECT } from '@/lib/segments/select'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tools.nationalwrenchindex.com'
const FK = PARENTS.ld.fkColumn

function genToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export async function POST(
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

  const [{ data: wo }, { data: segRows }, { data: profile }] = await Promise.all([
    supabase
      .from('work_orders')
      .select('id, work_order_number, public_token, segments_times_sent, segments_sent_at, customer_id, customer:customers(first_name, last_name, phone, email)')
      .eq('id', id)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('work_order_segments')
      .select(SEGMENT_SELECT)
      .eq(FK, id)
      .eq('user_id', user.id)
      .order('sequence', { ascending: true }),
    supabase
      .from('profiles')
      .select('business_name, full_name')
      .eq('id', user.id)
      .single(),
  ])

  if (!wo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const segments = shapeSegments(segRows)
  const pending  = segments.filter(s => s.status === 'pending')

  if (pending.length === 0) {
    return NextResponse.json(
      { error: 'No pending segments to send. Add a segment, or set one back to pending first.' },
      { status: 422 },
    )
  }

  const customer = wo.customer as unknown as
    { first_name: string; last_name: string; phone: string | null; email: string | null } | null

  if (!customer) {
    return NextResponse.json({ error: 'This work order has no customer to send to.' }, { status: 422 })
  }

  const token = (wo.public_token as string | null) ?? genToken()
  const url   = `${APP_URL}/work-order/${token}`
  const now   = new Date().toISOString()

  const bizName  = (profile?.business_name as string | null) ?? 'your shop'
  const techName = (profile?.full_name as string | null) ?? bizName
  const rollup   = rollupSegments(pending)

  // Suppression is honoured; a customer who asked not to be contacted is not chased
  // for an authorization.
  const suppression = await getContactSuppression(supabase, wo.customer_id as string | null)

  const label = pending.length === 1 ? '1 item' : `${pending.length} items`
  const smsBody =
    `Hi ${customer.first_name}, ${bizName} needs your OK on ${label} for work order ` +
    `${wo.work_order_number} (${money(rollup.pendingTotal)} total). ` +
    `Approve or decline each one here: ${url}`

  const emailText = [
    `Hi ${customer.first_name},`,
    '',
    `${bizName} has ${label} on work order ${wo.work_order_number} waiting for your approval.`,
    `You can approve or decline each one separately — you are not agreeing to all of it.`,
    '',
    ...pending.map(s => `  Segment ${s.sequence}: ${s.complaint ?? 'Additional work'} — ${money(s.grand_total)}`),
    '',
    `Total if you approve everything: ${money(rollup.pendingTotal)}`,
    '',
    `Review and respond: ${url}`,
    '',
    `Thanks,`,
    techName,
    bizName,
  ].join('\n')

  let smsSent = false, emailSent = false
  let smsError: string | undefined, emailError: string | undefined

  if (customer.phone && !suppression.no_sms) {
    const r = await sendSmsResult({ to: customer.phone, body: smsBody })
    smsSent  = r.success
    smsError = r.error
  } else if (suppression.no_sms) {
    smsError = 'Customer is flagged do-not-SMS'
  }

  if (customer.email && !suppression.no_email) {
    const r = await sendCustomerEmail(
      customer.email,
      `${bizName} — approval needed on work order ${wo.work_order_number}`,
      emailText,
    )
    emailSent  = r.success
    emailError = r.error
  } else if (suppression.no_email) {
    emailError = 'Customer is flagged do-not-email'
  }

  // The token is persisted even when both channels fail, so the tech can read the link
  // off the screen and pass it on by hand rather than being stuck behind a send error.
  const { error: updErr } = await supabase
    .from('work_orders')
    .update({
      public_token:        token,
      segments_sent_at:    (wo.segments_sent_at as string | null) ?? now,
      segments_times_sent: Number(wo.segments_times_sent ?? 0) + 1,
    })
    .eq('id', id)
    .eq('user_id', user.id)

  if (updErr) console.error('[segments/send] token write failed:', updErr.message)

  return NextResponse.json({
    ok: smsSent || emailSent,
    url,
    sent: { sms: smsSent, email: emailSent },
    errors: { sms: smsError, email: emailError },
    pending_count: pending.length,
  })
}
