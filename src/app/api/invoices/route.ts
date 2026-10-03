import { NextResponse, type NextRequest } from 'next/server'
import { isMissingTaxBreakdownColumn, withoutTaxBreakdown } from '@/lib/tax'
import { missingMigration142Column, withoutMigration142Columns } from '@/lib/migration-142'
import { createClient } from '@/lib/supabase/server'

const INVOICE_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin)
`

// ─── GET /api/invoices ────────────────────────────────────────────────────────
// Query params: status, invoice_status, source, limit, offset
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp             = request.nextUrl.searchParams
  const status         = sp.get('status')
  const invoice_status = sp.get('invoice_status')
  const source         = sp.get('source')
  const limit          = Number(sp.get('limit')  ?? 100)
  const offset         = Number(sp.get('offset') ?? 0)

  let query = supabase
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('user_id', user.id)
    .order('invoice_date', { ascending: false })
    .order('created_at',   { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (invoice_status) {
    // 'active' is a virtual filter meaning in_progress OR awaiting_payment
    if (invoice_status === 'active') {
      query = query.in('invoice_status', ['in_progress', 'awaiting_payment'])
    } else {
      query = query.eq('invoice_status', invoice_status)
    }
  }
  if (source) query = query.eq('source', source)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/invoices]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ invoices: data ?? [] })
}

// ─── POST /api/invoices ───────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.invoice_number || typeof body.invoice_number !== 'string') {
    return NextResponse.json({ error: 'invoice_number is required' }, { status: 400 })
  }
  if (!Array.isArray(body.line_items)) {
    return NextResponse.json({ error: 'line_items must be an array' }, { status: 400 })
  }
  if (body.total === undefined) {
    return NextResponse.json({ error: 'total is required' }, { status: 400 })
  }

  const today = new Date().toISOString().slice(0, 10)

  const invoiceRow = {
      user_id:         user.id,
      invoice_number:  body.invoice_number,
      po_number:       (body.po_number as string | null)?.trim() || null,
      invoice_date:    body.invoice_date    ?? today,
      due_date:        body.due_date        ?? null,
      customer_id:     body.customer_id     ?? null,
      // vehicle_id WAS NOT ACCEPTED AT ALL, so a dashboard-created invoice could not
      // be linked to a unit even if the form sent one — which is why Fleet Pro has no
      // cost history for anything billed this way.
      vehicle_id:      body.vehicle_id      ?? null,
      // The fleet's own identifier, carried onto the document (migration 142).
      unit_number:     body.unit_number     ?? null,
      job_id:          body.job_id          ?? null,
      line_items:      body.line_items,
      subtotal:        Number(body.subtotal        ?? 0),
      tax_rate:        Number(body.tax_rate        ?? 0),
      tax_amount:      Number(body.tax_amount      ?? 0),
      // What was taxed. Null reads as "no split known", never as "nothing taxed".
      tax_breakdown:   body.tax_breakdown ?? null,
      discount_amount: Number(body.discount_amount ?? 0),
      total:           Number(body.total),
      status:           body.status          ?? 'draft',
      source:           body.source          ?? 'manual',
      job_category:     body.job_category    ?? null,
      job_subtype:      body.job_subtype     ?? null,
      notes:            body.notes           ?? null,
      terms:            body.terms           ?? null,
      invoice_status:   body.invoice_status  ?? 'in_progress',
  }

  let { data, error } = await supabase
    .from('invoices')
    .insert(invoiceRow)
    .select(INVOICE_SELECT)
    .single()

  // Migration 140 is applied by hand. An invoice a tech just typed must not be lost
  // because a display column is not there yet -- tax_amount and total are complete.
  if (error && isMissingTaxBreakdownColumn(error)) {
    console.error('[POST /api/invoices] tax_breakdown missing — run migration 140', error.message)
    ;({ data, error } = await supabase
      .from('invoices')
      .insert(withoutTaxBreakdown(invoiceRow))
      .select(INVOICE_SELECT)
      .single())
  }

  // Same window, migration 142 — unit_number. The invoice itself is complete
  // without it, so it is the field that gets dropped and not the invoice.
  if (error && missingMigration142Column(error)) {
    console.error('[POST /api/invoices] unit_number missing — run migration 142', error.message)
    ;({ data, error } = await supabase
      .from('invoices')
      .insert(withoutMigration142Columns(withoutTaxBreakdown(invoiceRow)))
      .select(INVOICE_SELECT)
      .single())
  }

  if (error) {
    console.error('[POST /api/invoices]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ invoice: data }, { status: 201 })
}
