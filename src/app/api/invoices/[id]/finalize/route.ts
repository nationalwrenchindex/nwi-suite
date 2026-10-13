// POST /api/invoices/[id]/finalize
// Locks the invoice, transitions status to 'awaiting_payment', generates public_token.
// Pulls default_payment_instructions from profile if not already set on invoice.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computeDueDate, DEFAULT_PAYMENT_TERMS, isMissingPaymentTermsColumn } from '@/lib/hd/payment-terms'
import { deductForInvoice, releaseAllocations } from '@/lib/inventory/ledger'

const INVOICE_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin),
  source_quote:quotes!invoices_source_quote_id_fkey(id, quote_number, line_items, labor_hours, labor_rate, parts_subtotal, parts_markup_percent, labor_subtotal, tax_percent, tax_amount, grand_total)
`

function genToken(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // `*` rather than a column list: this needs invoice_date, payment_terms and
  // due_date, and naming payment_terms explicitly would make the whole read fail
  // until migration 143 is applied — which would block finalizing any invoice.
  const { data: invoiceRow, error: fetchErr } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !invoiceRow) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })
  }
  const invoice = invoiceRow as Record<string, unknown>

  if (invoice.invoice_status !== 'in_progress') {
    return NextResponse.json(
      { error: 'Only in-progress invoices can be finalized.' },
      { status: 400 }
    )
  }

  // Pull the shop's defaults for anything the invoice has not set itself. One read
  // for both, because they are now saved together in Settings.
  let paymentInstructions = invoice.payment_instructions as string | null
  let shopDefaultTerms: string | null = null
  {
    const withTerms = await supabase
      .from('profiles')
      .select('default_payment_instructions, default_payment_terms')
      .eq('id', user.id)
      .single()
    let profile = withTerms.data as Record<string, unknown> | null
    // Migration 143 applied by hand: without this fallback finalizing an invoice
    // would fail outright, which is far worse than finalizing it with no due date.
    if (withTerms.error) {
      const legacy = await supabase
        .from('profiles')
        .select('default_payment_instructions')
        .eq('id', user.id)
        .single()
      profile = legacy.data as Record<string, unknown> | null
    }
    const p = profile as { default_payment_instructions?: string | null; default_payment_terms?: string | null } | null
    if (!paymentInstructions) paymentInstructions = p?.default_payment_instructions ?? null
    shopDefaultTerms = p?.default_payment_terms ?? null
  }

  const token = (invoice.public_token as string | null) ?? genToken()
  const now   = new Date().toISOString()

  const updates: Record<string, unknown> = {
    invoice_status: 'awaiting_payment',
    finalized_at:   now,
    public_token:   token,
  }
  if (paymentInstructions) updates.payment_instructions = paymentInstructions

  // ── PAYMENT TERMS AND THE DUE DATE (migration 143) ──
  // FINALIZING IS THE RIGHT MOMENT. This is when the invoice stops being editable
  // and becomes something a customer can be held to, so it is when the due date
  // is fixed. The invoice's own terms win over the shop default; nothing here
  // recomputes a due date that already exists, because a sent invoice must keep
  // the date the customer was given.
  const effectiveTerms =
    (invoice.payment_terms as string | null) ?? shopDefaultTerms ?? DEFAULT_PAYMENT_TERMS
  if (!invoice.payment_terms) updates.payment_terms = effectiveTerms
  if (!invoice.due_date) {
    // Derived from the invoice date where there is one, so the due date matches the
    // date printed on the document rather than the moment the button was pressed.
    const basis = (invoice.invoice_date as string | null) ?? now
    updates.due_date = computeDueDate(basis, effectiveTerms)
  }

  let { data: updated, error: updateErr } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(INVOICE_SELECT)
    .single()

  // Same window again. An invoice that cannot be finalized is an invoice that
  // cannot be sent, so the terms are what get dropped, not the finalize.
  if (updateErr && isMissingPaymentTermsColumn(updateErr)) {
    console.error('[finalize] payment_terms/due_date missing — run migration 143', updateErr.message)
    delete updates.payment_terms
    delete updates.due_date
    ;({ data: updated, error: updateErr } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', id)
      .eq('user_id', user.id)
      .select(INVOICE_SELECT)
      .single())
  }

  if (updateErr || !updated) {
    console.error('[finalize]', updateErr)
    return NextResponse.json({ error: 'Failed to finalize invoice.' }, { status: 500 })
  }

  // Link any auto-generated COGS expenses from job completion to this invoice
  const jobId = (invoice as Record<string, unknown>).job_id as string | null
  if (jobId) {
    await supabase
      .from('expenses')
      .update({ linked_invoice_id: id })
      .eq('job_id', jobId)
      .eq('user_id', user.id)
      .is('linked_invoice_id', null)
      .eq('transaction_type', 'auto_invoice')
  }

  // ---------------------------------------------------------------- STOCK
  //
  // FINALIZE IS THE COMMITTED EVENT, so this is where stock leaves the shelf. Not
  // when a part is added to the work order - work orders get edited and reopened all
  // week, and deducting on edit would have the counter chasing a moving target.
  //
  // Safe to run again. Re-finalizing a reopened invoice hits the unique index
  // stock_movement_one_use_per_source and writes nothing, which is why the guard is in
  // the database and not in an if-statement here.
  //
  // Deliberately AFTER the invoice is already updated and never able to fail it: an
  // invoice that will not finalize because of a stock problem is a worse outcome than
  // a stock count that needs a correction. Problems are logged and returned alongside.
  let stock: Awaited<ReturnType<typeof deductForInvoice>> | null = null
  try {
    stock = await deductForInvoice({
      userId:      user.id,
      invoiceKind: 'ld',
      invoiceId:   id,
      invoiceRef:  (updated as Record<string, unknown>).invoice_number as string | null,
      lineItems:   (updated as Record<string, unknown>).line_items,
      createdBy:   user.id,
    })

    // The parts are deducted for real now, so holding them allocated as well would
    // count them twice against available.
    const woId = (invoice as Record<string, unknown>).source_work_order_id as string | null
    if (woId) await releaseAllocations(user.id, 'ld', woId, 'invoiced')

    if (stock.unmatched.length) {
      console.warn(`[finalize] ${id}: not in the parts catalog, no stock moved: ${stock.unmatched.join(', ')}`)
    }
    if (stock.errors.length) console.error(`[finalize] ${id}: stock errors`, stock.errors)
  } catch (err: unknown) {
    console.error('[finalize] stock deduction threw, invoice still finalized:',
      err instanceof Error ? err.message : String(err))
  }

  return NextResponse.json({ invoice: updated, stock })
}
