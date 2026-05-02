// GET /api/invoices/public/[token]
// Public endpoint — no auth. Fetches finalized invoice for customer-facing view.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

const INVOICE_SELECT = `
  id, invoice_number, invoice_status, public_token,
  line_items, subtotal, tax_rate, tax_amount, total,
  service_lines, adjustments, tip_amount_cents,
  payment_instructions, finalized_at, paid_at,
  notes, job_category, job_subtype,
  customer:customers(id, first_name, last_name),
  vehicle:vehicles(id, year, make, model),
  user_id
`

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const sc = createServiceClient()

  const { data: invoice, error } = await sc
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('public_token', token)
    .single()

  if (error || !invoice) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })
  }

  // Fetch the business profile for display
  const { data: profile } = await sc
    .from('profiles')
    .select('full_name, business_name, phone, business_type, default_payment_instructions')
    .eq('id', invoice.user_id)
    .single()

  return NextResponse.json({ invoice, profile })
}
