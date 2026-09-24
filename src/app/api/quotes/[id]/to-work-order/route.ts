// POST /api/quotes/[id]/to-work-order — open a work order from an approved quote.
//
// Server-side on purpose: the money comes off the quote row, not off the request,
// so a client cannot open a work order for a total the customer never approved.
//
// The quote is NOT marked 'converted' here. That status means "billed", and it is
// what api/quotes/[id]/convert sets when an invoice is created. A quote that became
// a work order is still awaiting billing, and the invoice will come from the work
// order once the job is done — flipping it now would lose that distinction and make
// the quote look paid.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasWorkOrders } from '@/lib/work-orders'
import { WORK_ORDER_SELECT } from '@/app/api/work-orders/list'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Same gate as everything else under the feature. Without this, the button being
  // hidden would be the only thing stopping a disabled business from using it.
  if (!await hasWorkOrders(supabase, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 403 })
  }

  const { data: quote, error: fetchErr } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !quote) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Deliberately NOT approved-only. The quote list offers this on approved quotes,
  // but QuickWrench offers it on a result the tech just built, which is still a
  // draft — they are standing at the truck about to start. What must be blocked is
  // a quote the customer turned down, and one already billed.
  if (quote.status === 'declined' || quote.status === 'converted') {
    return NextResponse.json(
      { error: `A ${quote.status} quote cannot become a work order.` },
      { status: 400 },
    )
  }

  // One work order per quote. Without this a double-click opens two, each of which
  // can be invoiced separately — the customer gets billed twice for one job.
  const { data: already } = await supabase
    .from('work_orders')
    .select('id')
    .eq('user_id', user.id)
    .eq('source_quote_id', id)
    .maybeSingle()

  if (already) {
    return NextResponse.json(
      { error: 'A work order already exists for this quote.', work_order_id: already.id },
      { status: 409 },
    )
  }

  const { count } = await supabase
    .from('work_orders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const year = new Date().getFullYear()
  const seq  = String((count ?? 0) + 1).padStart(4, '0')

  const { data: wo, error: insertErr } = await supabase
    .from('work_orders')
    .insert({
      user_id:              user.id,
      work_order_number:    `WO-${year}-${seq}`,
      status:               'open',
      customer_id:          quote.customer_id ?? null,
      vehicle_id:           quote.vehicle_id  ?? null,
      // The quote's notes are what the customer agreed to, so they become the job
      // description rather than the internal tech notes.
      job_description:      quote.notes ?? null,
      po_number:            quote.po_number ?? null,
      line_items:           quote.line_items ?? [],
      labor_hours:          quote.labor_hours,
      labor_rate:           quote.labor_rate,
      parts_subtotal:       quote.parts_subtotal,
      parts_markup_percent: quote.parts_markup_percent,
      labor_subtotal:       quote.labor_subtotal,
      tax_percent:          quote.tax_percent,
      tax_amount:           quote.tax_amount,
      grand_total:          quote.grand_total,
      source:               'quote',
      source_quote_id:      quote.id,
    })
    .select(WORK_ORDER_SELECT)
    .single()

  if (insertErr || !wo) {
    console.error('[POST /api/quotes/[id]/to-work-order]', insertErr)
    return NextResponse.json({ error: insertErr?.message ?? 'Failed to create work order' }, { status: 500 })
  }

  return NextResponse.json({ work_order: wo, work_order_id: wo.id }, { status: 201 })
}
