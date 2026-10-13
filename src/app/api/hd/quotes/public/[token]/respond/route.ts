// POST /api/hd/quotes/public/[token]/respond   the customer approves or declines
//
// NO AUTH. Possession of the link is the authorization, exactly as in LD's
// api/quotes/public/[token]/respond.
//
// WHAT AN APPROVAL DOES, IN ORDER
//
//   1. stamps the quote: status, approved_at, approval_method='customer_link', the
//      customer's PO and note
//   2. creates the HD work order, carrying the quote's RECORDED TERMS and the
//      authorization record
//   3. writes the quote's lines into hd_work_order_line_items
//
// Step 2 is idempotent by database constraint - hd_work_orders_one_per_quote, migration
// 153. A customer who opens the link twice, or forwards it to a colleague who clicks at
// the same moment, gets ONE work order. The second request is handed the first one's
// number. That guard is an index, not an if-statement, because every other
// double-convert check in this codebase is a read-then-write with a race window.
//
// A DECLINE writes declined_at and creates nothing - and deliberately does not hide
// the quote. Declined work is follow-up work.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createWorkOrderFromQuote } from '@/lib/hd/quote-approval'

export const dynamic = 'force-dynamic'

/** Everything the conversion needs off the quote. Wider than the public select. */
const CONVERSION_SELECT = '*'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!token || token.length < 16) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { /* an empty body is a missing decision */ }

  const decision = body.decision === 'approve' ? 'approve'
    : body.decision === 'decline' ? 'decline'
    : null
  if (!decision) {
    return NextResponse.json(
      { error: 'Tell us whether you are approving or declining this quote.' },
      { status: 422 },
    )
  }

  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null
  const po = typeof body.po_number === 'string' && body.po_number.trim()
    ? body.po_number.trim().slice(0, 120) : null

  const supabase = createServiceClient()

  const { data: quote, error: readErr } = await supabase
    .from('hd_quotes')
    .select(CONVERSION_SELECT)
    .eq('public_token', token)
    .maybeSingle()

  if (readErr) {
    const missing = /public_token|schema cache|does not exist/i.test(readErr.message)
    if (missing) {
      console.error('[hd quote respond] public_token missing - run migration 153')
      return NextResponse.json(
        { error: 'This link is not ready yet. Please contact the shop.' },
        { status: 503 },
      )
    }
    console.error('[hd quote respond]', readErr)
    return NextResponse.json({ error: 'Could not load this quote' }, { status: 500 })
  }
  if (!quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const q = quote as Record<string, unknown>
  const status = String(q.status ?? '')

  // ALREADY ANSWERED. Not an error to the customer - they probably clicked twice or
  // reopened the email - so an approval that already happened returns the existing work
  // order rather than a scary message.
  if (status === 'approved' || status === 'declined') {
    if (status === 'approved') {
      const conv = await createWorkOrderFromQuote(q)
      if (conv.ok) {
        return NextResponse.json({
          already: true,
          status,
          work_order_number: conv.result.workOrderNumber,
          message: 'This quote was already approved. Thank you.',
        })
      }
    }
    return NextResponse.json({
      already: true,
      status,
      message: status === 'approved'
        ? 'This quote was already approved. Thank you.'
        : 'This quote was already declined.',
    })
  }

  // A quote that was never sent has no business being answered through a link that
  // should not exist yet.
  if (status !== 'sent') {
    return NextResponse.json(
      { error: 'This quote is not currently open for a response.' },
      { status: 409 },
    )
  }

  const now = new Date().toISOString()

  // ── DECLINE ──────────────────────────────────────────────────────────────
  if (decision === 'decline') {
    const { error } = await supabase
      .from('hd_quotes')
      .update({
        status: 'declined',
        declined_at: now,
        approval_method: 'customer_link',
        customer_response_note: note,
      })
      .eq('id', q.id)

    if (error) {
      console.error('[hd quote respond] decline failed:', error)
      return NextResponse.json({ error: 'Could not record your response' }, { status: 500 })
    }

    // Deliberately no work order, and deliberately no deletion or hiding of the quote.
    // A declined quote is follow-up work, not a dead end.
    return NextResponse.json({ status: 'declined', declined_at: now, work_order: null })
  }

  // ── APPROVE ──────────────────────────────────────────────────────────────
  //
  // The quote is stamped FIRST, so that approved_at exists before the work order is
  // built from it - the work order's authorized_at is a copy of this value, and
  // generating a second timestamp there would make two records of one act disagree.
  const { data: stamped, error: stampErr } = await supabase
    .from('hd_quotes')
    .update({
      status: 'approved',
      approved_at: now,
      approval_method: 'customer_link',
      customer_response_note: note,
      customer_po_number: po,
    })
    .eq('id', q.id)
    .eq('status', 'sent')   // only from 'sent'; a concurrent click cannot double-stamp
    .select(CONVERSION_SELECT)
    .maybeSingle()

  if (stampErr) {
    console.error('[hd quote respond] approve failed:', stampErr)
    return NextResponse.json({ error: 'Could not record your approval' }, { status: 500 })
  }

  // Lost the stamp race to a simultaneous click. The other request is creating the work
  // order; re-read and converge on the same one rather than making a second.
  const approvedQuote = stamped ?? (await supabase
    .from('hd_quotes')
    .select(CONVERSION_SELECT)
    .eq('id', q.id)
    .maybeSingle()).data

  if (!approvedQuote) {
    return NextResponse.json({ error: 'Could not record your approval' }, { status: 500 })
  }

  const conv = await createWorkOrderFromQuote(approvedQuote as Record<string, unknown>)
  if (!conv.ok) {
    // The APPROVAL stands. It is the customer's decision and it is recorded; failing to
    // build the work order is the shop's problem to fix, not a reason to tell the
    // customer their approval did not count.
    console.error('[hd quote respond] approved but work order failed:', conv.error)
    return NextResponse.json({
      status: 'approved',
      approved_at: now,
      work_order: null,
      warning: 'Your approval is recorded. The shop will confirm the work order.',
    })
  }

  return NextResponse.json({
    status: 'approved',
    approved_at: now,
    po_number: po,
    work_order: {
      number: conv.result.workOrderNumber,
      created: conv.result.created,
      already_existed: conv.result.alreadyExisted,
      line_count: conv.result.lineCount,
      line_error: conv.result.lineError ?? null,
    },
  })
}
