// POST /api/invoices/[id]/finalize
// Locks the invoice, transitions status to 'awaiting_payment', generates public_token.
// Pulls default_payment_instructions from profile if not already set on invoice.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const INVOICE_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin),
  source_quote:quotes(id, quote_number, line_items, labor_hours, labor_rate, parts_subtotal, parts_markup_percent, labor_subtotal, tax_percent, tax_amount, grand_total)
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

  const { data: invoice, error: fetchErr } = await supabase
    .from('invoices')
    .select('id, invoice_status, public_token, payment_instructions')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !invoice) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })
  }

  if (invoice.invoice_status !== 'in_progress') {
    return NextResponse.json(
      { error: 'Only in-progress invoices can be finalized.' },
      { status: 400 }
    )
  }

  // Pull default payment instructions from profile if invoice has none
  let paymentInstructions = invoice.payment_instructions as string | null
  if (!paymentInstructions) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('default_payment_instructions')
      .eq('id', user.id)
      .single()
    paymentInstructions = (profile as { default_payment_instructions?: string } | null)?.default_payment_instructions ?? null
  }

  const token = (invoice.public_token as string | null) ?? genToken()
  const now   = new Date().toISOString()

  const updates: Record<string, unknown> = {
    invoice_status: 'awaiting_payment',
    finalized_at:   now,
    public_token:   token,
  }
  if (paymentInstructions) updates.payment_instructions = paymentInstructions

  const { data: updated, error: updateErr } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(INVOICE_SELECT)
    .single()

  if (updateErr || !updated) {
    console.error('[finalize]', updateErr)
    return NextResponse.json({ error: 'Failed to finalize invoice.' }, { status: 500 })
  }

  return NextResponse.json({ invoice: updated })
}
