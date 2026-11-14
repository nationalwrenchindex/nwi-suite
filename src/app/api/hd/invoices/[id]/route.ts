import { NextResponse, type NextRequest } from 'next/server'
import { isMissingTaxBreakdownColumn } from '@/lib/tax'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess, reeferStandaloneCan } from '@/lib/hd-access'
import { computeDueDate } from '@/lib/hd/payment-terms'
import { resolveInvoiceFleetLinks } from '@/lib/fleet-pro/invoice-link'
import { costingFromLineItems, isMissingCostingColumn } from '@/lib/hd/invoice-costing'
import { checkDiscountWrite } from '@/lib/hd/hd-discount'
import { recordTermsSnapshot } from '@/lib/document-terms'
import { READING_COLUMNS, readingsFromBody, withoutMissingReadings } from '@/lib/hd/unit-hours'
import { isInvoiceLocked, lockedMessage, changedAfterSendFields } from '@/lib/hd/invoice-lock'
import { serverPricedUpdate } from '@/lib/hd/invoice-edit-server'
import { loadHdShopExtras } from '@/lib/hd/hd-extras-load'
import { hdLaborRateFrom } from '@/lib/hd/labor-rate'
import { HD_INVOICE_STATUSES } from '../list'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = (await checkHDAccess(user.id)) || (await reeferStandaloneCan(user.id, 'reefer_invoices'))
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

  const hasAccess = (await checkHDAccess(user.id)) || (await reeferStandaloneCan(user.id, 'reefer_invoices'))
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // The terms are recorded once, when the invoice is sent - never set by an edit.
  delete body.terms_snapshot
  // A discount (migration 168) is stored only as a well-formed record whose parts add up.
  const discountError = checkDiscountWrite(body)
  if (discountError) return NextResponse.json({ error: discountError }, { status: 400 })

  // The readings (179 hours, 183 odometer) are parsed, never stored raw: "123,000" is
  // 123000 miles, and an unparseable value is refused rather than stored as blank.
  const readings = readingsFromBody(body)
  if ('error' in readings) return NextResponse.json({ error: readings.error }, { status: 400 })
  for (const k of READING_COLUMNS) delete body[k]

  // ---------------------------------------------------------------- THE GATE
  //
  // The stored row, read once: its status decides whether this PUT may run at all, and
  // it is what the money is priced from. Before Nov 14 there was no read here - the
  // body was spread onto the row at any status, so a paid invoice could be rewritten
  // through the API with whatever totals the caller chose.
  const { data: storedRow } = await supabase
    .from('hd_invoices')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!storedRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const stored = storedRow as Record<string, unknown>

  // PAID, PARTIAL, VOID: refused. The one exception is a partially paid invoice being
  // marked paid in full - a status change that rewrites nothing the customer agreed to.
  if (isInvoiceLocked(stored.status)) {
    const keys = Object.keys(body)
    const finishingPartial = String(stored.status) === 'partial' && body.status === 'paid'
      && keys.every(k => k === 'status' || k === 'paid_at')
    if (!finishingPartial) {
      return NextResponse.json({ error: lockedMessage(stored), reason: 'locked', status: stored.status }, { status: 409 })
    }
  }
  if ('status' in body && !(HD_INVOICE_STATUSES as readonly string[]).includes(String(body.status))) {
    return NextResponse.json({ error: `Unknown invoice status: ${String(body.status)}` }, { status: 400 })
  }

  // ---------------------------------------------------------------- THE MONEY
  //
  // Priced HERE from the lines and the invoice's recorded terms. Any total in the body
  // is dropped (lib/hd/invoice-edit-server).
  const { data: rateProfile } = await supabase.from('profiles').select('hd_labor_rate').eq('id', user.id).maybeSingle()
  const { shop } = await loadHdShopExtras(supabase, user.id)
  const priced = serverPricedUpdate(stored, body, {
    laborRate: hdLaborRateFrom(rateProfile as Record<string, unknown> | null),
    extras: shop.extras,
    serviceCallTax: shop.serviceCall.tax,
  })
  if (!priced.ok) return NextResponse.json({ error: priced.error }, { status: priced.status })
  if (priced.ignoredTotals.length) {
    console.warn(`[hd/invoices/:id] ignored browser totals on ${String(stored.invoice_number)}: ${priced.ignoredTotals.join(', ')}`)
  }

  const update: Record<string, unknown> = { ...priced.update, ...readings.update, updated_at: new Date().toISOString() }
  if (body.status === 'paid' && !body.paid_at) {
    update.paid_at = new Date().toISOString()
  }

  // Re-derive cost of goods whenever the edit rewrites the line items, so a corrected
  // invoice does not keep reporting the margin of the version it replaced. Only when
  // the priced update carries line_items: a status-only PUT (mark paid, mark sent)
  // carries none, and recomputing from an absent array would wipe a real cost to zero.
  if ('line_items' in update) {
    const costing = costingFromLineItems(update.line_items, {
      diagnostic_fee: (update.diagnostic_fee ?? stored.diagnostic_fee) as number | string | null | undefined,
      road_call_fee:  (update.road_call_fee  ?? stored.road_call_fee)  as number | string | null | undefined,
      subtotal_parts: (update.subtotal_parts ?? stored.subtotal_parts) as number | string | null | undefined,
    })
    update.parts_cost = costing.parts_cost
    update.parts_sell = costing.parts_sell
  }

  // SENT BUT UNPAID: the edit stands, and the invoice records that the customer now
  // holds an older copy (migration 188's stamp when applied, a dated note always).
  Object.assign(update, changedAfterSendFields(stored, update, 'edit'))

  // When an invoice is marked SENT, stamp sent_at (once) and compute the due date
  // from its payment terms. Client may pass payment_terms in the same PUT to override.
  if (body.status === 'sent' && !body.sent_at) {
    const sentAt = (stored.sent_at as string | null) ?? new Date().toISOString()
    const terms  = (body.payment_terms as string | undefined) ?? (stored.payment_terms as string | null)
    update.sent_at  = sentAt
    // No recognised terms, no due date - and a stored one is kept, never cleared.
    const due = computeDueDate(sentAt, terms)
    if (due) update.due_date = due
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

  // And the same again for migration 140. A tech marking an invoice paid must not be
  // blocked because a display column has not been created yet.
  if (error && isMissingTaxBreakdownColumn(error)) {
    console.error('[hd/invoices/:id] tax_breakdown missing — run migration 140', error.message)
    delete update.tax_breakdown
    ;({ data, error } = await supabase
      .from('hd_invoices')
      .update(update)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single())
  }

  // A reading column the database lacks: refused when the edit carries a reading for
  // it (never dropped silently), otherwise retried without it.
  if (error && READING_COLUMNS.some(k => k in update && String(error?.message ?? '').includes(k))) {
    const r = withoutMissingReadings(update, error)
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 409 })
    ;({ data, error } = await supabase
      .from('hd_invoices')
      .update(r.row)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single())
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Marked sent: the shop's terms are recorded on it now, unless it already carries
  // its quote's. Never fails the save.
  if (body.status === 'sent') await recordTermsSnapshot(supabase, 'hd_invoices', id, user.id)
  return NextResponse.json({ invoice: data })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = (await checkHDAccess(user.id)) || (await reeferStandaloneCan(user.id, 'reefer_invoices'))
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { error } = await supabase
    .from('hd_invoices')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
