import { NextResponse, type NextRequest } from 'next/server'
import { parseBreakdown } from '@/lib/tax'
import { createClient } from '@/lib/supabase/server'
import { writeToleratingMigration142 } from '@/lib/migration-142'

const INVOICE_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin),
  source_quote:quotes!invoices_source_quote_id_fkey(id, quote_number, line_items, jobs, labor_hours, labor_rate, parts_subtotal, parts_markup_percent, labor_subtotal, tax_percent, tax_amount, grand_total)
`

// ─── POST /api/quotes/[id]/convert ───────────────────────────────────────────
// Converts an approved quote into an Invoice in Progress.
// Locks the quote (status → 'converted') and creates the new invoice record.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  // Fetch the quote to validate state
  const { data: quote, error: quoteErr } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (quoteErr || !quote) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
  }

  if (quote.status !== 'approved') {
    return NextResponse.json({ error: 'Only approved quotes can be converted to invoices' }, { status: 400 })
  }

  // Duplicate protection: already converted
  if (quote.converted_invoice_id) {
    return NextResponse.json(
      { error: 'This quote has already been converted', invoice_id: quote.converted_invoice_id },
      { status: 409 }
    )
  }

  // Generate sequential invoice number: INV-YYYY-NNNN
  const year = new Date().getFullYear()
  const { data: lastInvoices } = await supabase
    .from('invoices')
    .select('invoice_number')
    .eq('user_id', user.id)
    .like('invoice_number', `INV-${year}-%`)
    .order('created_at', { ascending: false })
    .limit(10)

  let nextNum = 1
  if (lastInvoices && lastInvoices.length > 0) {
    // Parse the last sequential number (may have random-suffix old invoices mixed in)
    for (const inv of lastInvoices) {
      const parts = inv.invoice_number.split('-')
      if (parts.length === 3 && parts[1] === String(year)) {
        const n = parseInt(parts[2], 10)
        if (!isNaN(n) && n >= nextNum) nextNum = n + 1
      }
    }
  }
  const invoice_number = `INV-${year}-${String(nextNum).padStart(4, '0')}`

  const today = new Date().toISOString().slice(0, 10)
  const now   = new Date().toISOString()

  // Build invoice row from quote data
  const q = quote as Record<string, unknown>
  const invoiceInsert = {
    user_id:         user.id,
    invoice_number,
    invoice_date:    today,
    customer_id:     quote.customer_id ?? null,
    vehicle_id:      quote.vehicle_id  ?? null,
    job_id:          quote.job_id      ?? null,
    job_category:    quote.job_category ?? null,
    job_subtype:     quote.job_subtype  ?? null,
    line_items:      quote.line_items   ?? [],
    subtotal:        Number(quote.parts_subtotal ?? 0) * (1 + Number(quote.parts_markup_percent ?? 0) / 100) + Number(quote.labor_subtotal ?? 0),
    tax_rate:        Number(quote.tax_percent ?? 0) / 100,
    tax_amount:      Number(quote.tax_amount   ?? 0),

    // ── THE PRICING TERMS THE CUSTOMER AGREED TO ────────────────────────────
    // These six columns had no home on `invoices` until migration 142, so every
    // reader that needed them reached back through source_quote_id to the quote.
    // That works until there is no source quote — a work-order conversion or a
    // from-scratch invoice — at which point the markup silently reads 0 and
    // calcBreakdown reports parts revenue equal to parts cost.
    //
    // Copied, not re-derived. The quote is the agreement; the invoice records
    // what the agreement was. NULL is preserved as NULL so an unrecorded markup
    // stays unrecorded rather than becoming a claim of 0%.
    parts_markup_percent: quote.parts_markup_percent ?? null,
    parts_subtotal:       quote.parts_subtotal       ?? null,
    parts_cost_total:     quote.parts_cost_total     ?? null,
    labor_subtotal:       quote.labor_subtotal       ?? null,
    labor_hours:          quote.labor_hours          ?? null,
    labor_rate:           quote.labor_rate           ?? null,

    // The fleet's own identifier for the equipment. Without it a customer
    // cannot match this invoice to their own records.
    unit_number:     quote.unit_number ?? null,

    // Shop-only, and it must stay that way: nothing customer-facing reads this.
    internal_notes:  quote.internal_notes ?? null,

    // ── Billable extras, carried at the rate that was quoted ────────────────
    // Each one keeps the rate in force on the quote rather than re-pricing from
    // today's Settings, for the same reason as the markup above.
    travel_hours:                  quote.travel_hours   ?? 0,
    travel_rate:                   quote.travel_rate    ?? null,
    travel_amount:                 quote.travel_amount  ?? 0,
    mileage_miles:                 quote.mileage_miles  ?? 0,
    mileage_rate:                  quote.mileage_rate   ?? null,
    mileage_amount:                quote.mileage_amount ?? 0,
    shop_supplies_percent_applied: quote.shop_supplies_percent_applied ?? null,
    shop_supplies_cap_applied:     quote.shop_supplies_cap_applied     ?? null,
    shop_supplies_fee:             quote.shop_supplies_fee             ?? 0,
    // The customer approved this split on the quote; the invoice bills the same one.
    tax_breakdown:   parseBreakdown((quote as { tax_breakdown?: unknown }).tax_breakdown),
    discount_amount: 0,
    total:           Number(quote.grand_total  ?? 0),
    status:          'draft',
    source:          'quote',
    notes:           quote.notes       ?? null,
    // Phase 3 fields
    invoice_status:  'in_progress',
    // The PO is the customer's own reference. It has to survive the conversion or
    // the shop has to retype it, and a fleet that cannot match invoice to PO does
    // not pay it.
    po_number:       quote.po_number ?? null,
    source_quote_id: quote.id,
    job_notes:       null,
    shop_supplies:   [],
    additional_parts: [],
    additional_labor: [],
    started_at:      now,
    // Phase 8: copy multi-job data from quote
    jobs:            quote.jobs ?? [],
    // Detailer model: carry service_lines and adjustments forward
    service_lines:   Array.isArray(q.service_lines) ? q.service_lines : [],
    adjustments:     Array.isArray(q.adjustments)   ? q.adjustments   : [],
  }

  // Migration 142 is applied by hand and this code can deploy before it. Without
  // the retry the converter 500s for every quote until the SQL is run, which
  // would be a worse outage than the problem it fixes.
  const { data: newInvoice, error: insertErr } = await writeToleratingMigration142<
    Record<string, unknown>,
    { id: string }
  >(
    invoiceInsert as unknown as Record<string, unknown>,
    row => supabase.from('invoices').insert(row).select(INVOICE_SELECT).single(),
  )

  if (insertErr || !newInvoice) {
    console.error('[POST /api/quotes/[id]/convert] insert invoice', insertErr)
    const msg = (insertErr as { message?: string } | null)?.message
    return NextResponse.json({ error: msg ?? 'Failed to create invoice' }, { status: 500 })
  }

  // Lock the quote: status → 'converted', record converted_invoice_id and converted_at
  const { error: updateErr } = await supabase
    .from('quotes')
    .update({
      status:               'converted',
      converted_invoice_id: newInvoice.id,
      converted_at:         now,
    })
    .eq('id', id)
    .eq('user_id', user.id)

  if (updateErr) {
    console.error('[POST /api/quotes/[id]/convert] update quote', updateErr)
    // Invoice was created; try to return it anyway but log the error
  }

  return NextResponse.json({ invoice: newInvoice }, { status: 201 })
}
