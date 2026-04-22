import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
  const invoiceInsert = {
    user_id:         user.id,
    invoice_number,
    invoice_date:    today,
    customer_id:     quote.customer_id ?? null,
    vehicle_id:      quote.vehicle_id  ?? null,
    job_category:    quote.job_category ?? null,
    job_subtype:     quote.job_subtype  ?? null,
    // Copy the original line items and pricing from the quote
    line_items:      quote.line_items   ?? [],
    subtotal:        Number(quote.parts_subtotal ?? 0) * (1 + Number(quote.parts_markup_percent ?? 0) / 100) + Number(quote.labor_subtotal ?? 0),
    tax_rate:        Number(quote.tax_percent ?? 0) / 100,
    tax_amount:      Number(quote.tax_amount   ?? 0),
    discount_amount: 0,
    total:           Number(quote.grand_total  ?? 0),
    status:          'draft',          // legacy status field — not used for workflow
    source:          'quote',
    notes:           quote.notes       ?? null,
    // Phase 3 fields
    invoice_status:  'in_progress',
    source_quote_id: quote.id,
    job_notes:       null,
    shop_supplies:   [],
    additional_parts: [],
    additional_labor: [],
    started_at:      now,
    // Phase 8: copy multi-job data from quote
    jobs:            quote.jobs ?? [],
  }

  const { data: newInvoice, error: insertErr } = await supabase
    .from('invoices')
    .insert(invoiceInsert)
    .select(INVOICE_SELECT)
    .single()

  if (insertErr || !newInvoice) {
    console.error('[POST /api/quotes/[id]/convert] insert invoice', insertErr)
    return NextResponse.json({ error: insertErr?.message ?? 'Failed to create invoice' }, { status: 500 })
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
