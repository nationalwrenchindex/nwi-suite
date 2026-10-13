import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { logHDCustomer } from '@/lib/hd/customer-logging'
import { isMissingTaxBreakdownColumn, withoutTaxBreakdown } from '@/lib/tax'
import { missingMigration142Column, withoutMigration142Columns } from '@/lib/migration-142'
import { addressFrom } from '@/lib/address'
import { resolveInvoiceFleetLinks } from '@/lib/fleet-pro/invoice-link'
import { costingFromLineItems, isMissingCostingColumn } from '@/lib/hd/invoice-costing'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { HD_INVOICE_LIST_SELECT, HD_INVOICE_DEFAULT_LIMIT, applyHDInvoiceListFilter } from './list'

import { deductForInvoice, releaseAllocations } from '@/lib/inventory/ledger'

export const dynamic = 'force-dynamic'

// GET /api/hd/invoices?filter=&limit=&offset= — one page of the invoice list.
//
// This used to return a flat .limit(200), which meant an invoice numbered past
// the 200th simply did not exist as far as any caller was concerned; PostgREST
// would have silently capped it at 1,000 regardless. `count` is its own exact/head
// query carrying the same filter, so the header total is the real total no matter
// how few rows the caller has actually loaded.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const sp     = req.nextUrl.searchParams
  const filter = sp.get('filter')
  const limit  = Math.min(Number(sp.get('limit') ?? HD_INVOICE_DEFAULT_LIMIT), 200)
  const offset = Number(sp.get('offset') ?? 0)

  // ?totals=1 — money figures over EVERY matching invoice, not just the page.
  // HDFinancialsClient used to call this endpoint bare and reduce whatever came
  // back into its Outstanding/Collected tiles, so those figures were a sum of at
  // most `HD_INVOICE_DEFAULT_LIMIT` invoices presented as the whole book. Opt-in
  // because it reads every matching row: the list page must not pay for it.
  const wantTotals = sp.get('totals') === '1'

  const rowsQuery = applyHDInvoiceListFilter(
    supabase.from('hd_invoices').select(HD_INVOICE_LIST_SELECT).eq('user_id', user.id),
    filter,
  )
  const countQuery = applyHDInvoiceListFilter(
    supabase.from('hd_invoices').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    filter,
  )

  const [{ data, error }, { count }] = await Promise.all([
    rowsQuery
      // created_at is not unique, and offset paging over a non-deterministic order
      // drops and repeats rows between pages. id breaks every tie.
      .order('created_at', { ascending: false })
      .order('id',         { ascending: false })
      .range(offset, offset + limit - 1),
    countQuery,
  ])

  if (error) {
    console.error('[hd/invoices GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // A totals failure must not take the list down with it, and must not fall back to
  // summing the page either — that is the bug being fixed, wearing a disguise. The
  // caller simply gets no `totals` key and renders a dash instead of a plausible lie.
  let totals: Record<string, number> | undefined
  if (wantTotals) {
    try {
      // Only (status, total) — the narrowest row that can carry the sum.
      const rows = await fetchAllRows<{ status: string; total: number | null }>((from, to) =>
        applyHDInvoiceListFilter(
          supabase.from('hd_invoices').select('status, total').eq('user_id', user.id),
          filter,
        )
          .order('id', { ascending: true })
          .range(from, to),
      )
      totals = {}
      for (const r of rows) {
        totals[r.status] = (totals[r.status] ?? 0) + Number(r.total ?? 0)
      }
      totals.invoice_count = rows.length
    } catch (err) {
      console.error('[hd/invoices GET totals]', err)
      totals = undefined
    }
  }

  return NextResponse.json({ invoices: data ?? [], count: count ?? 0, ...(totals ? { totals } : {}) })
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

  // Same window, migration 140. tax_breakdown records WHAT was taxed for the
  // customer copy; the invoice itself, including tax_amount and total, is complete
  // without it. Losing the invoice over a display field would be the wrong trade.
  if (error && isMissingTaxBreakdownColumn(error)) {
    console.error('[hd/invoices] tax_breakdown missing — run migration 140', error.message)
    ;({ data, error } = await supabase
      .from('hd_invoices')
      .insert(withoutTaxBreakdown(insertRow))
      .select()
      .single())
  }

  // Same window again, migration 142 — unit_number, internal_notes, the billable
  // extras and the markup in force. Every one of them is metadata; the money on
  // this invoice is complete without them, so the invoice saves and the tech is
  // not told to come back after a migration they cannot run.
  if (error && missingMigration142Column(error)) {
    console.error('[hd/invoices] a migration 142 column is missing — run migration 142', error.message)
    ;({ data, error } = await supabase
      .from('hd_invoices')
      .insert(withoutMigration142Columns(withoutTaxBreakdown(insertRow)))
      .select()
      .single())
  }

  // Migration 157: hd_invoices.customer_po_number.
  //
  // THIS RETRY IS NOT PRECAUTIONARY. hd_invoices has no PO column at all today -
  // neither po_number nor customer_po_number, verified with
  // scripts/probe-hd-invoice-po.ts - and the work-order converter puts the key on
  // every payload it builds, null or not. Without this, EVERY HD work-order
  // conversion fails the insert until 157 is applied by hand. Not only the ones
  // carrying a PO: the key is always there.
  //
  // The invoice is complete without it. Every figure is correct; what is lost is the
  // reference the fleet reconciles against, which they can be told. Losing the
  // invoice the tech just billed would be the wrong trade.
  if (error && /customer_po_number/i.test(error.message ?? '')) {
    console.error('[hd/invoices] customer_po_number missing - run migration 157', error.message)
    // ONLY the PO is removed. Reusing the 140/142 strippers here would have thrown
    // away tax_breakdown and the billable-extras columns on a database that has them,
    // which is every database - a retry must repair the one thing that failed.
    const { customer_po_number: _dropPo, ...stripped } = insertRow as Record<string, unknown>
    void _dropPo
    ;({ data, error } = await supabase
      .from('hd_invoices')
      .insert(stripped)
      .select()
      .single())
  }

  // THE MIGRATION-154 GUARD REFUSING A SECOND INVOICE for the same work order.
  //
  // 23505 on hd_invoices_one_per_work_order means this work order is already billed. A
  // 500 would read as a server fault and invite a retry; a 409 carrying the existing
  // invoice lets the caller send the technician to the bill that already exists.
  //
  // This is the guard the route handler did NOT have. WO-2026-1538 was billed twice,
  // three days apart, for 183.18 and 1286.60, because nothing at the database stopped
  // it and the only check was client-side.
  if (error && error.code === '23505' && /one_per_work_order/.test(error.message ?? '')) {
    const woId = (insertRow as Record<string, unknown>).work_order_id
    const { data: existing } = await supabase
      .from('hd_invoices')
      .select('id, invoice_number, status, total')
      .eq('work_order_id', woId as string)
      .limit(1)
      .maybeSingle()
    console.error('[hd/invoices] refused a duplicate invoice for work order', woId)
    return NextResponse.json({
      error: existing
        ? `This work order was already billed as ${existing.invoice_number}.`
        : 'This work order has already been billed.',
      invoice: existing ?? null,
      already_invoiced: true,
    }, { status: 409 })
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
    // Carry the address onto the customer so the NEXT document for this customer
    // prefills it. Without this the prefill has nothing to read.
    address:       addressFrom(body),
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

  // ---------------------------------------------------------------- STOCK
  //
  // THE SAME SHARED FUNCTION THE LD PATH USES. Not a second implementation - two
  // deductions is how the two products end up disagreeing about what is on the shelf.
  //
  // HD has no finalize step: hd_invoices go straight to unpaid/sent/paid, so CREATION
  // is the committed event here, where LD uses finalize. Both are idempotent through
  // the same unique index, so an invoice edited later cannot deduct a second time.
  //
  // Best-effort after the insert, like the work-order status flip above: a stock
  // problem must never cost the technician the invoice they just typed.
  let stock: Awaited<ReturnType<typeof deductForInvoice>> | null = null
  try {
    const row = data as Record<string, unknown>
    stock = await deductForInvoice({
      userId:      user.id,
      invoiceKind: 'hd',
      invoiceId:   String(row.id),
      invoiceRef:  (row.invoice_number as string | null) ?? null,
      lineItems:   row.line_items,
      createdBy:   user.id,
    })
    if (typeof body.work_order_id === 'string' && body.work_order_id) {
      await releaseAllocations(user.id, 'hd', body.work_order_id, 'invoiced')
    }
    if (stock.unmatched.length) {
      console.warn(`[hd/invoices] not in the parts catalog, no stock moved: ${stock.unmatched.join(', ')}`)
    }
    if (stock.errors.length) console.error('[hd/invoices] stock errors', stock.errors)
  } catch (err: unknown) {
    console.error('[hd/invoices] stock deduction threw, invoice still created:',
      err instanceof Error ? err.message : String(err))
  }

  return NextResponse.json({ invoice: { ...data, customer_id }, customer_id, stock }, { status: 201 })
}
