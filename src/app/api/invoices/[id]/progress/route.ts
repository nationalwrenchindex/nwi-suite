import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const INVOICE_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin),
  source_quote:quotes!invoices_source_quote_id_fkey(id, quote_number, line_items, labor_hours, labor_rate, parts_subtotal, parts_markup_percent, labor_subtotal, tax_percent, tax_amount, grand_total)
`

// ─── PATCH /api/invoices/[id]/progress ───────────────────────────────────────
// Saves in-progress job details: notes, shop supplies, additional parts/labor,
// and the recalculated running totals.
export async function PATCH(
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

  // Verify the invoice exists, belongs to this user, and is in_progress
  const { data: existing } = await supabase
    .from('invoices')
    .select('id, invoice_status')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  if (existing.invoice_status !== 'in_progress') {
    return NextResponse.json(
      { error: 'Can only edit invoices that are In Progress' },
      { status: 400 }
    )
  }

  const updates: Record<string, unknown> = {}

  if (body.job_notes        !== undefined) updates.job_notes        = body.job_notes        ?? null
  if (body.shop_supplies    !== undefined) updates.shop_supplies    = body.shop_supplies    ?? []
  if (body.additional_parts !== undefined) updates.additional_parts = body.additional_parts ?? []
  if (body.additional_labor !== undefined) updates.additional_labor = body.additional_labor ?? []
  if (body.subtotal         !== undefined) updates.subtotal         = Number(body.subtotal)
  if (body.tax_amount       !== undefined) updates.tax_amount       = Number(body.tax_amount)
  if (body.total            !== undefined) updates.total            = Number(body.total)

  const { data, error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(INVOICE_SELECT)
    .single()

  if (error || !data) {
    console.error('[PATCH /api/invoices/[id]/progress]', error)
    return NextResponse.json({ error: error?.message ?? 'Failed to save' }, { status: 500 })
  }

  return NextResponse.json({ invoice: data })
}
