// POST /api/hd/quotes/[id]/work-order
//
// The tech's own route from a quote to a work order. The customer's route already
// existed (api/hd/quotes/public/[token]/respond, migration 153); this is the one the
// shop uses when the customer said yes on the phone, or said yes at the link and the
// tech wants to open the job from the quote screen.
//
// WHY A WORK ORDER AND NOT STRAIGHT TO AN INVOICE
//
// The HD quote screen could only Convert to Invoice, which bills a job before anyone
// has done it: no parts pulled, no hours recorded, no chance to add the bolt that
// sheared. The work order is where the job actually happens, and the converter built
// last pass turns it into the invoice afterwards. Billing from the quote is still
// there for the one-line road call it suits.
//
// THE APPROVAL IS THE AUTHORIZATION. This route will not convert a quote nobody
// approved. It returns 422 'not_approved' and the caller can come back with
// record_verbal_approval - which stamps approved_at, approval_method 'verbal' and the
// PO the customer gave over the phone, and THEN converts. That is the same two steps
// the customer's own link performs, with the method recorded truthfully so an invoice
// dispute can tell a tap from a phone call.
//
// CONVERT ONCE, enforced by hd_work_orders_one_per_quote (migration 153) rather than a
// read-then-write check. Call it twice and the second call is handed the first work
// order.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { createWorkOrderFromQuote } from '@/lib/hd/quote-approval'

export const dynamic = 'force-dynamic'

interface Body {
  /** Stamp a verbal approval first. The tech is asserting the customer said yes. */
  record_verbal_approval?: boolean
  /** The PO the customer gave on the phone. Recorded on the quote AND the work order. */
  po_number?: string
  /** Free text: who authorized it, when they called. */
  note?: string
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  let body: Body = {}
  try { body = await req.json() as Body } catch { /* an empty body means "just convert" */ }

  const po = typeof body.po_number === 'string' && body.po_number.trim()
    ? body.po_number.trim().slice(0, 120) : null
  const note = typeof body.note === 'string' && body.note.trim()
    ? body.note.trim().slice(0, 2000) : null

  // '*' because the conversion copies every recorded term off this row, and because a
  // named list would fail until migrations 153 and 155 are both applied. Ownership is
  // the security boundary: another subscriber's quote reads as missing.
  const { data: quote, error: readErr } = await supabase
    .from('hd_quotes')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (readErr || !quote) return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })

  const q = quote as Record<string, unknown>
  const status = String(q.status ?? '')

  if (status === 'declined') {
    return NextResponse.json({
      error:  'This customer declined this quote. Opening a work order on it would be work nobody authorized.',
      reason: 'declined',
    }, { status: 422 })
  }

  // ===========================================================================
  // NOT APPROVED. The caller is asked, not overridden.
  // ===========================================================================
  //
  // 422 with a reason rather than converting anyway. The work order's authorized_at is
  // a copy of the quote's approved_at, so converting an unapproved quote would produce
  // a job with an empty authorization - which is exactly the record that loses an
  // argument about whether the customer agreed to the work.
  if (status !== 'approved' && !body.record_verbal_approval) {
    return NextResponse.json({
      error:  status === 'draft'
        ? 'This quote has not been sent yet, so nobody has approved it.'
        : 'The customer has not approved this quote yet.',
      reason: 'not_approved',
      status,
      can_record_verbal: true,
    }, { status: 422 })
  }

  let workingQuote = q

  // ── Record the verbal approval, then convert ─────────────────────────────
  if (status !== 'approved' && body.record_verbal_approval) {
    const now = new Date().toISOString()

    // Stamped FIRST so approved_at exists before the work order is built from it. The
    // work order's authorized_at is a copy of this value; generating a second timestamp
    // there would leave two records of one act disagreeing.
    //
    // The PO is only written when one was given. `?? null` would blank a PO the quote
    // already carried from the customer's own approval.
    const stamp: Record<string, unknown> = {
      status:          'approved',
      approved_at:     now,
      approval_method: 'verbal',
    }
    if (po)   stamp.customer_po_number     = po
    if (note) stamp.customer_response_note = note

    const { data: stamped, error: stampErr } = await supabase
      .from('hd_quotes')
      .update(stamp)
      .eq('id', id)
      .eq('user_id', user.id)
      .select('*')
      .single()

    if (stampErr || !stamped) {
      // approval_method and approved_at arrive with migration 153. Name it, because a
      // bare 500 here looks like an outage.
      const message = stampErr?.message ?? 'unknown'
      if (/approved_at|approval_method|customer_po_number|schema cache|could not find/i.test(message)) {
        console.error('[hd quote -> wo] approval columns missing - run migration 153:', message)
        return NextResponse.json({
          error: 'Recording an approval is not available on this database yet (migration 153).',
        }, { status: 500 })
      }
      console.error('[hd quote -> wo] could not record the verbal approval:', message)
      return NextResponse.json({ error: 'Could not record the approval.' }, { status: 500 })
    }

    workingQuote = stamped as Record<string, unknown>
  } else if (po && !q.customer_po_number) {
    // Already approved, and the tech is adding the PO the customer gave afterwards.
    // Written to the quote so the work order inherits it by the normal path rather than
    // being special-cased, and only when the quote does not already have one - a PO the
    // customer typed at the approval link is theirs, not the tech's to overwrite.
    const { data: updated } = await supabase
      .from('hd_quotes')
      .update({ customer_po_number: po })
      .eq('id', id)
      .eq('user_id', user.id)
      .select('*')
      .single()
    if (updated) workingQuote = updated as Record<string, unknown>
  }

  const conv = await createWorkOrderFromQuote(workingQuote)

  if (!conv.ok) {
    console.error('[hd quote -> wo] conversion failed:', conv.error)
    // If a verbal approval was just recorded it STANDS. The customer did say yes; the
    // work order failing to build is the shop's problem to retry, not a reason to
    // un-approve a quote.
    return NextResponse.json({
      error: conv.error,
      approval_recorded: status !== 'approved' && Boolean(body.record_verbal_approval),
    }, { status: 500 })
  }

  return NextResponse.json({
    work_order: {
      id:              conv.result.workOrderId,
      number:          conv.result.workOrderNumber,
      created:         conv.result.created,
      already_existed: conv.result.alreadyExisted,
      line_count:      conv.result.lineCount,
      line_error:      conv.result.lineError ?? null,
    },
    approval_method: String(workingQuote.approval_method ?? ''),
    po_number:       (workingQuote.customer_po_number as string | null) ?? null,
  })
}
