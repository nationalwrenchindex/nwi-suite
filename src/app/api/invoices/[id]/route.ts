import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const INVOICE_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin),
  source_quote:quotes!invoices_source_quote_id_fkey(id, quote_number, line_items, labor_hours, labor_rate, parts_subtotal, parts_markup_percent, labor_subtotal, tax_percent, tax_amount, grand_total)
`

// ─── GET /api/invoices/[id] ───────────────────────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  return NextResponse.json({ invoice: data })
}

// ─── PATCH /api/invoices/[id] ────────────────────────────────────────────────
// Body: { payment_instructions: string }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if ('payment_instructions' in body) updates.payment_instructions = body.payment_instructions ?? null

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(INVOICE_SELECT)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Update failed.' }, { status: 500 })
  }

  return NextResponse.json({ invoice: data })
}

// ─── PUT /api/invoices/[id] ───────────────────────────────────────────────────
// Body: { status: 'paid' | 'unpaid' | 'overdue', payment_method?: string }
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { status, payment_method, payment_reference, payment_notes } = body as {
    status?: string
    payment_method?: string
    payment_reference?: string | null
    payment_notes?: string | null
  }

  if (!status) {
    return NextResponse.json({ error: 'status is required' }, { status: 400 })
  }

  // 'unpaid' is a UI-friendly alias for 'sent' (outstanding but not past due)
  const dbStatus = status === 'unpaid' ? 'sent' : status

  const validStatuses = ['draft', 'sent', 'viewed', 'paid', 'overdue', 'cancelled']
  if (!validStatuses.includes(dbStatus)) {
    return NextResponse.json(
      { error: 'status must be one of: paid, unpaid, overdue, draft, sent, viewed, cancelled' },
      { status: 400 }
    )
  }

  const updates: Record<string, unknown> = { status: dbStatus }

  if (dbStatus === 'paid') {
    updates.paid_at        = new Date().toISOString()
    updates.invoice_status = 'paid'
    if (payment_method)                updates.payment_method    = payment_method
    if (payment_reference !== undefined) updates.payment_reference = payment_reference ?? null
    if (payment_notes     !== undefined) updates.payment_notes     = payment_notes     ?? null
  } else {
    // Revert paid fields when un-marking as paid
    updates.paid_at = null
    if (dbStatus !== 'sent') updates.payment_method = null
    if (dbStatus === 'cancelled') updates.invoice_status = 'void'
  }

  const { data, error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(INVOICE_SELECT)
    .single()

  if (error) {
    console.error('[PUT /api/invoices/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  return NextResponse.json({ invoice: data })
}
