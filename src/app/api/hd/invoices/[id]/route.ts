import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { computeDueDate } from '@/lib/hd/payment-terms'
import { resolveInvoiceFleetLinks } from '@/lib/fleet-pro/invoice-link'
import { costingFromLineItems, isMissingCostingColumn } from '@/lib/hd/invoice-costing'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { data, error } = await supabase
    .from('hd_invoices')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ invoice: data })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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

  const update: Record<string, unknown> = { ...body, updated_at: new Date().toISOString() }
  if (body.status === 'paid' && !body.paid_at) {
    update.paid_at = new Date().toISOString()
  }

  // Re-derive cost of goods whenever the edit rewrites the line items, so a corrected
  // invoice does not keep reporting the margin of the version it replaced. Only when
  // line_items is actually present: a status-only PUT (mark paid, mark sent) carries
  // no items, and recomputing from an absent array would wipe a real cost to zero.
  if ('line_items' in body) {
    const costing = costingFromLineItems(body.line_items, {
      diagnostic_fee: body.diagnostic_fee as number | string | null | undefined,
      road_call_fee:  body.road_call_fee  as number | string | null | undefined,
      subtotal_parts: body.subtotal_parts as number | string | null | undefined,
    })
    update.parts_cost = costing.parts_cost
    update.parts_sell = costing.parts_sell
  }

  // When an invoice is marked SENT, stamp sent_at (once) and compute the due date
  // from its payment terms. Client may pass payment_terms in the same PUT to override.
  if (body.status === 'sent' && !body.sent_at) {
    const { data: existing } = await supabase
      .from('hd_invoices')
      .select('sent_at, payment_terms')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()
    const sentAt = (existing?.sent_at as string | null) ?? new Date().toISOString()
    const terms  = (body.payment_terms as string | undefined) ?? (existing?.payment_terms as string | null)
    update.sent_at  = sentAt
    update.due_date = computeDueDate(sentAt, terms)
  }

  // An invoice corrected after the fact has to land on the right Fleet Pro dashboard,
  // so re-resolve the links whenever the edit touches something they derive from.
  // Fields the PUT left out are read back off the row, so a serial-only edit cannot
  // throw away a link that came from a work order or a hand-set unit_id.
  if ('work_order_id' in body || 'unit_id' in body || 'unit_serial' in body) {
    const { data: current } = await supabase
      .from('hd_invoices')
      .select('work_order_id, unit_id, unit_serial')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    const pick = (key: 'work_order_id' | 'unit_id' | 'unit_serial'): string | null => {
      const value = key in body ? body[key] : (current as Record<string, unknown> | null)?.[key]
      return typeof value === 'string' ? value : null
    }

    const fleetLinks = await resolveInvoiceFleetLinks(supabase, user.id, {
      work_order_id: pick('work_order_id'),
      unit_id:       pick('unit_id'),
      unit_serial:   pick('unit_serial'),
    })
    update.unit_id          = fleetLinks.unit_id
    update.fleet_account_id = fleetLinks.fleet_account_id
  }

  let { data, error } = await supabase
    .from('hd_invoices')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  // Same guard as the POST path: migration 119 is applied by hand, so the deploy can
  // arrive first. An edit must not fail — and a mark-paid PUT must not fail — because
  // a reporting column is not there yet.
  if (error && isMissingCostingColumn(error)) {
    console.error('[hd/invoices/:id] parts_cost/parts_sell missing — run migration 119', error.message)
    delete update.parts_cost
    delete update.parts_sell
    ;({ data, error } = await supabase
      .from('hd_invoices')
      .update(update)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single())
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invoice: data })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { error } = await supabase
    .from('hd_invoices')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
