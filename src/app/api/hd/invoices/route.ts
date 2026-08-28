import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { logHDCustomer } from '@/lib/hd/customer-logging'
import { resolveInvoiceFleetLinks } from '@/lib/fleet-pro/invoice-link'
import { costingFromLineItems, isMissingCostingColumn } from '@/lib/hd/invoice-costing'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { data, error } = await supabase
    .from('hd_invoices')
    .select('id, invoice_number, customer_name, unit_manufacturer, unit_model, total, status, payment_terms, created_at, paid_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invoices: data })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!body.customer_name) {
    return NextResponse.json({ error: 'customer_name required' }, { status: 400 })
  }

  // company_name is a customers-table field, not an hd_invoices column.
  const { company_name, ...invoiceBody } = body

  const { count } = await supabase
    .from('hd_invoices')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const year = new Date().getFullYear()
  const seq = String((count ?? 0) + 1).padStart(4, '0')
  const invoice_number = `INV-${year}-${seq}`

  // Fleet Pro reads invoices by unit_id / fleet_account_id, so they have to be on the
  // row from the start — an invoice saved without them never surfaces on the customer's
  // dashboard and nothing reports the omission. Resolved values override anything the
  // client sent, because the resolver is the only thing that verifies ownership.
  const fleetLinks = await resolveInvoiceFleetLinks(supabase, user.id, {
    work_order_id: typeof body.work_order_id === 'string' ? body.work_order_id : null,
    unit_id:       typeof body.unit_id       === 'string' ? body.unit_id       : null,
    unit_serial:   typeof body.unit_serial   === 'string' ? body.unit_serial   : null,
  })

  // Cost of goods, lifted out of line_items and onto real columns at write time.
  // The tech's cost only ever existed inside the line_items JSONB, so a dashboard
  // wanting gross margin had to re-parse every invoice. Computing it here means the
  // number is fixed at the moment of billing, exactly as the tech entered it, and
  // cannot shift later if the costing rules change. parts_cost comes back null when
  // any parts line has no recorded cost — that null is the point, see migration 119.
  const costing = costingFromLineItems(body.line_items, {
    diagnostic_fee: body.diagnostic_fee as number | string | null | undefined,
    road_call_fee:  body.road_call_fee  as number | string | null | undefined,
    subtotal_parts: body.subtotal_parts as number | string | null | undefined,
  })

  const baseRow   = { ...invoiceBody, user_id: user.id, invoice_number, ...fleetLinks }
  const insertRow = { ...baseRow, parts_cost: costing.parts_cost, parts_sell: costing.parts_sell }

  let { data, error } = await supabase
    .from('hd_invoices')
    .insert(insertRow)
    .select()
    .single()

  // Migrations here are applied by hand, so the deploy can land before 119 does.
  // In that window the costing columns do not exist and the insert fails — which
  // would cost the tech the invoice they just typed over a reporting field. Retry
  // without them: degraded margin reporting is recoverable, a lost invoice is not.
  if (error && isMissingCostingColumn(error)) {
    console.error('[hd/invoices] parts_cost/parts_sell missing — run migration 119', error.message)
    ;({ data, error } = await supabase
      .from('hd_invoices')
      .insert(baseRow)
      .select()
      .single())
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Billing a work order closes it out. Done here rather than via the status route
  // because that route only allows completed → invoiced, and a tech can invoice a
  // job that is still open or in progress. Best-effort after the insert so a failed
  // status write can never cost us the invoice itself; scoped to the caller's own
  // rows, and cancelled work orders are left alone.
  if (typeof body.work_order_id === 'string' && body.work_order_id) {
    const { error: woError } = await supabase
      .from('hd_work_orders')
      .update({ status: 'invoiced' })
      .eq('id', body.work_order_id)
      .eq('user_id', user.id)
      .neq('status', 'cancelled')
    if (woError) console.error('[hd/invoices] work order status flip failed', woError)
  }

  // Auto-log the customer into the tech's contacts (best-effort, never blocks).
  const customer_id = await logHDCustomer({
    userId:        user.id,
    customerName:  typeof body.customer_name  === 'string' ? body.customer_name  : null,
    customerPhone: typeof body.customer_phone === 'string' ? body.customer_phone : null,
    customerEmail: typeof body.customer_email === 'string' ? body.customer_email : null,
    companyName:   typeof company_name        === 'string' ? company_name        : null,
  })

  // Persist the link. It was previously resolved here and returned to the client but
  // never written, which left every HD invoice with no route back to a customers row —
  // and therefore no way for the send paths to read that customer's no_sms / no_email
  // flags. Best-effort after the insert, like the work-order flip above: failing to
  // record the link must not cost us the invoice.
  if (customer_id) {
    const { error: linkError } = await supabase
      .from('hd_invoices')
      .update({ customer_id })
      .eq('id', data.id)
      .eq('user_id', user.id)
    if (linkError) console.error('[hd/invoices] customer link failed', linkError)
  }

  return NextResponse.json({ invoice: { ...data, customer_id }, customer_id }, { status: 201 })
}
