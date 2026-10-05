// POST /api/invoices/[id]/reopen — put a finalized invoice back into editing.
//
// THE MIRROR OF finalize, and deliberately not a full undo.
//
// finalize sets invoice_status, finalized_at, public_token, payment_terms and due_date.
// This resets only the first two. The rest stay, and each for its own reason:
//
//   public_token   the customer may already hold the link. Rotating it would break a
//                  bookmarked invoice and, worse, a link already sent in a text.
//   payment_terms  the terms the customer was told. Reopening to fix a line item is not
//                  a renegotiation of when they have to pay.
//   due_date       same, and finalize itself refuses to recompute one that exists.
//
// So reopening is a return to editing, not a pretence the invoice never existed.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** Only these can go back to editing. */
const REOPENABLE = ['finalized', 'awaiting_payment'] as const

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_status, paid_at, total')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const status = String(invoice.invoice_status ?? '')

  if (status === 'in_progress') {
    return NextResponse.json(
      { error: 'This invoice is already open for editing.' },
      { status: 409 },
    )
  }

  // A PAID INVOICE IS NOT REOPENED HERE, and that is a deliberate refusal rather than a
  // missing feature. Money has changed hands and a payment record points at this
  // document; quietly moving it back to a draft leaves the shop's books claiming a
  // payment against an invoice whose figures can then change underneath it. Voiding and
  // reissuing is the honest path, and it is a different action with different
  // consequences. If this shop wants paid invoices reopened, that is a decision to make
  // explicitly, not something to inherit from a convenience here.
  if (status === 'paid' || invoice.paid_at) {
    return NextResponse.json(
      {
        error: 'This invoice has been paid, so it cannot be reopened. Void it and issue a ' +
               'corrected invoice instead, so the payment record still points at something true.',
      },
      { status: 409 },
    )
  }

  if (status === 'void') {
    return NextResponse.json(
      { error: 'This invoice has been voided and cannot be reopened.' },
      { status: 409 },
    )
  }

  if (!(REOPENABLE as readonly string[]).includes(status)) {
    return NextResponse.json(
      { error: `An invoice with status "${status || 'unknown'}" cannot be reopened.` },
      { status: 409 },
    )
  }

  const { data: updated, error: updateErr } = await supabase
    .from('invoices')
    .update({
      invoice_status: 'in_progress',
      // Cleared because it is the record of WHEN this was finalized, and it is about to
      // be finalized again. The token, terms and due date are deliberately untouched -
      // see the note at the top.
      finalized_at:   null,
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, invoice_number, invoice_status')
    .single()

  if (updateErr || !updated) {
    console.error('[reopen invoice]', updateErr)
    return NextResponse.json(
      { error: updateErr?.message ?? 'Could not reopen this invoice.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ invoice: updated })
}
