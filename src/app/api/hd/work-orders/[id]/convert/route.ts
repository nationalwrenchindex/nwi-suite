// GET /api/hd/work-orders/[id]/convert
//
// Assembles the invoice payload for an HD work order: its line items, its recorded
// terms, its identity and the authorization that came off the approved quote.
//
// IT DOES NOT INSERT. The caller POSTs the returned payload to /api/hd/invoices, which
// is the one insert path and already carries the migration 119/140/142 column-tolerance
// retries, already deducts stock through the shared ledger, and already flips the work
// order to 'invoiced'. A second insert here would be two places to keep in step and two
// places for the stock deduction to be forgotten.
//
// WHAT THIS REPLACES: a client-side query string carrying only labor_hours and
// labor_rate, from which the invoice form synthesized one labor line. Every part line a
// technician entered was dropped. See src/lib/hd/wo-to-invoice.ts for the detail.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess, reeferStandaloneCan } from '@/lib/hd-access'
import { buildInvoicePayload, type WorkOrderLineRow } from '@/lib/hd/wo-to-invoice'
import { loadLinesAndJobs } from '@/lib/hd/work-order-jobs-load'
import { TAX_SETTINGS_SELECT, taxSettingsFrom } from '@/lib/tax'
import { unitIdentityFill } from '@/lib/hd/unit-hours'
import { hdLaborRateFrom } from '@/lib/hd/labor-rate'
import { invoiceCarryFromQuote } from '@/lib/hd/document-carry'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = (await checkHDAccess(user.id)) || (await reeferStandaloneCan(user.id, 'reefer_work_orders'))
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  // '*' rather than a column list on purpose: this reads the migration-153 columns
  // (tax_percent, customer_po_number, quote_id) and naming them explicitly would make
  // the whole read fail until 153 is applied - which would block invoicing entirely
  // rather than just losing the tax terms.
  const { data: wo, error } = await supabase
    .from('hd_work_orders')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !wo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const row = wo as Record<string, unknown>

  // THE QUOTE FILLS WHAT THE WORK ORDER DOES NOT CARRY. A work order made before
  // migration 158 has no payment_terms column, and none made before this pass has a
  // fleet link or unit number - but its quote may. A value on the work order always
  // wins; this only fills an absence, from the document the customer approved.
  //
  // THE FEES are filled the same way. A work order made before migration 159 has no
  // fee columns, so the quote's road call and diagnostic fees never reached it - while
  // the quote's tax, which taxed them, did. Reading them back off the quote is what
  // makes that work order's invoice match the quote it was approved from.
  //
  // And the unit year, truck fields and VIN, which reached the work order only from
  // migration 159 on.
  const UNIT_FROM_QUOTE = ['unit_year', 'truck_make', 'truck_model', 'truck_year', 'vin'] as const
  // Read whenever the work order came from a quote: besides these fills, the quote's
  // notes, email and service address reach the invoice below (invoiceCarryFromQuote).
  let sourceQuote: Record<string, unknown> | null = null
  if (row.quote_id) {
    const { data: q } = await supabase
      .from('hd_quotes')
      .select('*')
      .eq('id', String(row.quote_id))
      .eq('user_id', user.id)
      .maybeSingle()
    sourceQuote = (q ?? null) as Record<string, unknown> | null
    const quote = sourceQuote ?? {}
    if (!row.payment_terms && quote.payment_terms)       row.payment_terms    = quote.payment_terms
    if (!row.unit_number && quote.unit_number)           row.unit_number      = quote.unit_number
    if (!row.fleet_account_id && quote.fleet_account_id) row.fleet_account_id = quote.fleet_account_id
    if (row.diagnostic_fee == null && quote.diagnostic_fee != null) row.diagnostic_fee = quote.diagnostic_fee
    if (row.road_call_fee == null && quote.road_call_fee != null)   row.road_call_fee  = quote.road_call_fee
    for (const k of UNIT_FROM_QUOTE) if (!row[k] && quote[k]) row[k] = quote[k]
  }

  // THE LINKED UNIT FILLS WHAT THE WORK ORDER LEFT EMPTY - its number, make, model and
  // serial - so the invoice records the unit the screen showed. Read once, here, and
  // frozen on the invoice from then on; a recorded value always wins.
  if (row.unit_id) {
    const { data: unit } = await supabase.from('hd_units')
      .select('unit_number, manufacturer, model, serial_number').eq('id', String(row.unit_id)).eq('user_id', user.id).maybeSingle()
    Object.assign(row, unitIdentityFill(row, unit as Record<string, unknown> | null))
  }

  // Already billed. Hand back the invoice that exists rather than letting the caller
  // create a second one - and the unique index from migration 154 is the guard that
  // makes this more than a courtesy.
  {
    const { data: existing } = await supabase
      .from('hd_invoices')
      .select('id, invoice_number, status, total')
      .eq('work_order_id', id)
      .limit(1)
      .maybeSingle()
    if (existing?.id) {
      return NextResponse.json({
        already_invoiced: true,
        invoice: existing,
        error: `This work order was already billed as ${existing.invoice_number}.`,
      }, { status: 409 })
    }
  }

  // The lines with their jobs (migration 177), so a multi-job work order bills grouped
  // by job. Read as before when 177 is not applied yet.
  const { lines: lineRows, jobs, error: lineErr } = await loadLinesAndJobs(supabase, id)

  if (lineErr) {
    console.error('[hd convert] could not read line items:', lineErr)
    return NextResponse.json({ error: 'Could not read the work order line items' }, { status: 500 })
  }

  const rows = (lineRows ?? []) as unknown as WorkOrderLineRow[]

  // ===========================================================================
  // REFUSE AN EMPTY WORK ORDER. SERVER-SIDE.
  // ===========================================================================
  //
  // 1,555 of the 1,562 live work orders (99.6%) have no line items at all, and the
  // first version of this route happily returned a payload with line_items: [] and
  // total: 0 for every one of them. The only thing standing between that and a $0.00
  // invoice was a check in the browser - so any direct caller, any future screen, or
  // any automation that did not replicate it got no protection whatever.
  //
  // A bill for nothing is never the right answer, so the refusal lives here.
  if (rows.length === 0) {
    return NextResponse.json({
      error: 'This work order has no line items, so there is nothing to bill. Add the labor and parts to it first.',
      reason: 'no_line_items',
      work_order_number: row.work_order_number ?? null,
    }, { status: 422 })
  }

  // ===========================================================================
  // THE SHOP'S CURRENT SETTINGS, for terms the work order never recorded.
  // ===========================================================================
  //
  // ALL 1,562 live work orders have labor_rate and tax_percent NULL, so without this
  // the converter produced tax of exactly $0.00 - while the invoices these same shops
  // already send carry 7%, 7.25% and 7.75%. That is a silent under-bill and a
  // regression, not caution.
  //
  // A recorded term still wins. This only fills an absence, and the invoice records
  // that it did - see buildInvoicePayload's internal_notes.
  const { data: profile } = await supabase
    .from('profiles')
    .select(`hd_labor_rate, ${TAX_SETTINGS_SELECT}`)
    .eq('id', user.id)
    .single()

  const prof = (profile ?? {}) as Record<string, unknown>
  // hd_labor_rate ONLY (hdLaborRateFrom). LD's default_labor_rate used to stand in
  // when it was unset, which bills an HD job at the light-duty rate; with no HD rate
  // the route now refuses an unpriced labor line below and says to set one.
  const fallbackRate = hdLaborRateFrom(prof)

  const { payload, source: termsSource, discountError } = buildInvoicePayload(row, rows, {
    laborRate: fallbackRate,
    taxSettings: taxSettingsFrom(prof),
  }, jobs)

  // A discount that no longer fits the lines (a flat amount bigger than what is left)
  // is refused with the reason, never dropped: an invoice without it would bill more
  // than the customer was quoted.
  if (discountError) {
    return NextResponse.json({
      error: discountError, reason: 'discount', work_order_number: row.work_order_number ?? null,
    }, { status: 422 })
  }

  // If the work order recorded nothing AND the shop has no setting either, there is no
  // honest number to bill at. Refuse rather than send a zero.
  if (!termsSource.laborRateFromDocument && fallbackRate == null) {
    const laborLines = rows.filter(r => String(r.type ?? '').toLowerCase().startsWith('lab'))
    const unpriced = laborLines.filter(r => r.unit_price == null && r.total == null)
    if (unpriced.length > 0) {
      return NextResponse.json({
        error: 'This work order has no labor rate, and neither do your settings. Set your HD labor rate in Settings, or price the labor lines directly.',
        reason: 'no_labor_rate',
        work_order_number: row.work_order_number ?? null,
      }, { status: 422 })
    }
  }

  // The fields with no column on the work order: the quote's notes and service address,
  // and the email to send to (the fleet account's contact, read now, else the quote's).
  // Only what the payload leaves empty; nothing here is money.
  let fleet: { contact_email?: unknown } | null = null
  if (row.fleet_account_id) {
    const { data: f } = await supabase.from('hd_fleet_accounts')
      .select('contact_email').eq('id', String(row.fleet_account_id)).eq('user_id', user.id).maybeSingle()
    fleet = (f ?? null) as { contact_email?: unknown } | null
  }
  Object.assign(payload, invoiceCarryFromQuote(payload, row, sourceQuote, fleet))

  const partCount  = rows.filter(r => String(r.type ?? '').toLowerCase() === 'part').length
  const laborCount = rows.filter(r => String(r.type ?? '').toLowerCase().startsWith('lab')).length

  return NextResponse.json({
    invoice_payload: payload,
    source: {
      work_order_number: row.work_order_number,
      line_count:        rows.length,
      part_lines:        partCount,
      labor_lines:       laborCount,
      has_lines:         true,
      authorized_at:     row.authorized_at ?? null,
      quote_id:          row.quote_id ?? null,
      // Where the money came from, so the tech can be told rather than guessing.
      terms_from_document: {
        labor_rate: termsSource.laborRateFromDocument,
        tax:        termsSource.taxFromDocument,
      },
      used_settings_for: termsSource.usedFallbackFor,
    },
  })
}
