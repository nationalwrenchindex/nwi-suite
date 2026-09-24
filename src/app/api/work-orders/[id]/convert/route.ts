// POST /api/work-orders/[id]/convert — bill a completed work order.
//
// Creates an in_progress invoice from the work order and locks the work order to
// it, exactly as api/quotes/[id]/convert does for a quote. The invoice numbering is
// the same parse-the-last-number scheme, so work orders and quotes draw from one
// sequence rather than two that can collide.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasWorkOrders } from '@/lib/work-orders'
import { WORK_ORDER_SELECT } from '../../list'

export const dynamic = 'force-dynamic'

const INVOICE_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin)
`

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

  const { data: wo, error: fetchErr } = await supabase
    .from('work_orders')
    .select(WORK_ORDER_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !wo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Billing an unfinished job is almost always a misclick, and the customer gets a
  // bill for work still on the lift.
  if (wo.status !== 'complete') {
    return NextResponse.json(
      { error: 'Only a completed work order can be invoiced.' },
      { status: 400 },
    )
  }

  if (wo.converted_invoice_id) {
    return NextResponse.json(
      { error: 'This work order has already been invoiced.', invoice_id: wo.converted_invoice_id },
      { status: 409 },
    )
  }

  // Same numbering as the quote converter: read recent numbers and continue the
  // sequence, tolerating older invoices whose numbers do not parse.
  const year = new Date().getFullYear()
  const { data: lastInvoices } = await supabase
    .from('invoices')
    .select('invoice_number')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  let nextNum = 1
  for (const inv of lastInvoices ?? []) {
    const parts = String(inv.invoice_number).split('-')
    if (parts.length === 3 && parts[1] === String(year)) {
      const n = parseInt(parts[2], 10)
      if (!isNaN(n) && n >= nextNum) nextNum = n + 1
    }
  }
  const invoice_number = `INV-${year}-${String(nextNum).padStart(4, '0')}`

  const today = new Date().toISOString().slice(0, 10)
  const now   = new Date().toISOString()

  const invoiceInsert = {
    user_id:          user.id,
    invoice_number,
    invoice_date:     today,
    customer_id:      wo.customer_id ?? null,
    vehicle_id:       wo.vehicle_id  ?? null,
    line_items:       wo.line_items  ?? [],
    subtotal:         Number(wo.parts_subtotal ?? 0) * (1 + Number(wo.parts_markup_percent ?? 0) / 100) + Number(wo.labor_subtotal ?? 0),
    tax_rate:         Number(wo.tax_percent ?? 0) / 100,
    tax_amount:       Number(wo.tax_amount  ?? 0),
    discount_amount:  0,
    total:            Number(wo.grand_total ?? 0),
    status:           'draft',
    source:           'work_order',
    // The job description is what the customer authorised; the tech notes are
    // internal and deliberately not carried onto a document the customer reads.
    notes:            wo.job_description ?? null,
    invoice_status:   'in_progress',
    // Everything the work order carried, including the PO the fleet will match the
    // payment against. Retyping it is how invoice and PO stop agreeing.
    po_number:        wo.po_number ?? null,
    job_notes:        null,
    shop_supplies:    [],
    additional_parts: [],
    additional_labor: [],
    started_at:       now,
  }

  const { data: invoice, error: insertErr } = await supabase
    .from('invoices')
    .insert(invoiceInsert)
    .select(INVOICE_SELECT)
    .single()

  if (insertErr || !invoice) {
    console.error('[POST /api/work-orders/[id]/convert] insert invoice', insertErr)
    return NextResponse.json({ error: insertErr?.message ?? 'Failed to create invoice' }, { status: 500 })
  }

  // Lock the work order to the invoice. Done after the insert so a failure here
  // cannot lose the invoice; an unlocked work order can be retried, and the
  // already-invoiced guard above is what stops a duplicate.
  const { error: lockErr } = await supabase
    .from('work_orders')
    .update({ converted_invoice_id: invoice.id, converted_at: now })
    .eq('id', id)
    .eq('user_id', user.id)

  if (lockErr) console.error('[work-orders/convert] lock failed', lockErr)

  return NextResponse.json({ invoice, invoice_id: invoice.id }, { status: 201 })
}
