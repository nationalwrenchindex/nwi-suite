// GET  /api/quotes/[id] — fetch single quote
// PUT  /api/quotes/[id] — update a Draft quote in-place
// DELETE /api/quotes/[id] — hard-delete a Draft quote

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

const QUOTE_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin)
`

// Phone-dedup: reuse or create customer. Same logic as /api/quickwrench/quote.
async function resolveCustomer(
  supabase:  SupabaseClient,
  userId:    string,
  name:      string,
  phone:     string,
): Promise<string | null> {
  if (!name.trim() && !phone.trim()) return null

  if (phone.trim()) {
    const { data } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', userId)
      .eq('phone', phone.trim())
      .limit(1)
    if (data && data.length > 0) return data[0].id
  }

  const parts     = name.trim().split(/\s+/)
  const firstName = parts[0] || 'Walk-up'
  const lastName  = parts.slice(1).join(' ') || 'Customer'

  const { data: created } = await supabase
    .from('customers')
    .insert({ user_id: userId, first_name: firstName, last_name: lastName, phone: phone.trim() || null })
    .select('id')
    .single()

  return created?.id ?? null
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: quote, error } = await supabase
    .from('quotes')
    .select(QUOTE_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !quote) {
    return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
  }

  return NextResponse.json({ quote })
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify the quote exists, belongs to user, and is a draft
  const { data: existing } = await supabase
    .from('quotes')
    .select('id, status')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
  if (existing.status !== 'draft') {
    return NextResponse.json({ error: 'Only Draft quotes can be edited.' }, { status: 409 })
  }

  let body: {
    line_items:           Array<{ description: string; quantity: number; unit_price: number; total: number }>
    labor_hours:          number
    labor_rate:           number
    parts_subtotal:       number
    parts_markup_percent: number
    labor_subtotal:       number
    tax_percent:          number
    tax_amount:           number
    grand_total:          number
    notes:                string
    customer_name:        string
    customer_phone:       string
    vehicle_id?:          string | null
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (body.grand_total < 0) {
    return NextResponse.json({ error: 'Grand total cannot be negative.' }, { status: 422 })
  }

  const customerId = await resolveCustomer(supabase, user.id, body.customer_name ?? '', body.customer_phone ?? '')

  const { data: updated, error: updateErr } = await supabase
    .from('quotes')
    .update({
      line_items:           body.line_items,
      labor_hours:          body.labor_hours,
      labor_rate:           body.labor_rate,
      parts_subtotal:       body.parts_subtotal,
      parts_markup_percent: body.parts_markup_percent,
      labor_subtotal:       body.labor_subtotal,
      tax_percent:          body.tax_percent,
      tax_amount:           body.tax_amount,
      grand_total:          body.grand_total,
      notes:                body.notes ?? null,
      customer_id:          customerId,
      vehicle_id:           body.vehicle_id ?? null,
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select(QUOTE_SELECT)
    .single()

  if (updateErr || !updated) {
    console.error('[PUT /api/quotes/[id]]', updateErr)
    return NextResponse.json({ error: 'Failed to update quote.' }, { status: 500 })
  }

  return NextResponse.json({ quote: updated })
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only draft quotes may be deleted
  const { data: existing } = await supabase
    .from('quotes')
    .select('id, status')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
  if (existing.status !== 'draft') {
    return NextResponse.json({ error: 'Only Draft quotes can be deleted.' }, { status: 409 })
  }

  const { error: delErr } = await supabase
    .from('quotes')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (delErr) {
    console.error('[DELETE /api/quotes/[id]]', delErr)
    return NextResponse.json({ error: 'Failed to delete quote.' }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}
