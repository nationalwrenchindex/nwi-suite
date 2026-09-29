// GET  /api/quotes/[id] — fetch single quote
// PUT  /api/quotes/[id] — update a Draft quote in-place
// DELETE /api/quotes/[id] — hard-delete a Draft quote

import { NextResponse } from 'next/server'
import { isMissingTaxBreakdownColumn } from '@/lib/tax'
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

  // MATCH ON THE TRAILING TEN DIGITS, not the whole string. An exact match meant
  // "863-555-0100" and "+18635550100" read as two different people, so this function
  // minted a SECOND customers row for someone the shop already had. Same
  // reconciliation logHDCustomer already does for the HD side.
  const wantDigits = phone.replace(/\D/g, '').slice(-10)
  if (wantDigits.length === 10) {
    const { data } = await supabase
      .from('customers')
      .select('id, phone')
      .eq('user_id', userId)
      .not('phone', 'is', null)
    const hit = (data ?? []).find(
      c => String(c.phone ?? '').replace(/\D/g, '').slice(-10) === wantDigits,
    )
    if (hit) return hit.id
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
    po_number?:           string | null
    /** Preferred over re-resolving from name and phone. See the comment at the
     *  call site: re-deriving created duplicate customers. */
    customer_id?:         string | null
    jobs?:                unknown[]
    // Detailer model
    service_lines?: Array<{ service_name: string; vehicle_category: string | null; price_cents: number }>
    adjustments?:   Array<{ name: string; price_cents: number }>
    /** What was taxed. The editor has computed this since the parts/labor split
     *  shipped and this route was silently dropping it — so an LD quote stored a
     *  correct tax_amount with no record of WHAT was taxed, the public quote page
     *  could not say "Labor — not taxable", and a converted invoice inherited null. */
    tax_breakdown?: unknown
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (body.grand_total < 0) {
    return NextResponse.json({ error: 'Grand total cannot be negative.' }, { status: 422 })
  }

  // For detailers the service fee lives in labor_rate — strip any synthetic 'Service' line item
  // so it can never be double-counted regardless of what the client sends.
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('business_type')
    .eq('id', user.id)
    .single()
  const isDetailer = profileRow?.business_type === 'detailer'
  const safeLineItems = isDetailer
    ? body.line_items.filter((li) => li.description?.trim() !== 'Service')
    : body.line_items

  // THE QUOTE ALREADY KNOWS ITS CUSTOMER. Re-deriving one from the typed name and
  // phone on every save is how a quote created against a customer with no phone on
  // file ended up reassigned to a brand-new duplicate: resolveCustomer could not
  // match on a blank phone, so it inserted. An explicit customer_id wins, verified
  // as belonging to this user so an id from a request body cannot reach across
  // accounts.
  let customerId: string | null = null
  if (typeof body.customer_id === 'string' && body.customer_id) {
    const { data: owned } = await supabase
      .from('customers')
      .select('id')
      .eq('id', body.customer_id)
      .eq('user_id', user.id)
      .maybeSingle()
    customerId = owned?.id ?? null
  }
  if (!customerId) {
    customerId = await resolveCustomer(supabase, user.id, body.customer_name ?? '', body.customer_phone ?? '')
  }

  const updatePayload: Record<string, unknown> = {
    line_items:           safeLineItems,
    labor_hours:          isDetailer ? 0 : body.labor_hours,
    labor_rate:           isDetailer ? 0 : body.labor_rate,
    parts_subtotal:       isDetailer ? 0 : body.parts_subtotal,
    parts_markup_percent: isDetailer ? 0 : body.parts_markup_percent,
    labor_subtotal:       isDetailer ? 0 : body.labor_subtotal,
    tax_percent:          body.tax_percent,
    tax_amount:           body.tax_amount,
    grand_total:          body.grand_total,
    notes:                body.notes ?? null,
    customer_id:          customerId,
    vehicle_id:           body.vehicle_id ?? null,
    // Trimmed to null so an emptied field clears the PO rather than storing "",
    // which would print an empty "PO #" row on the customer's invoice.
    po_number:            body.po_number?.trim() || null,
  }
  if (body.jobs !== undefined) updatePayload.jobs = body.jobs
  // Written only when sent, so a caller that does not know about the split cannot
  // wipe a breakdown that is already on the row.
  if (body.tax_breakdown !== undefined) updatePayload.tax_breakdown = body.tax_breakdown ?? null
  if (isDetailer) {
    updatePayload.service_lines = (body.service_lines ?? []).filter(
      (sl) => typeof sl.service_name === 'string' && sl.service_name.trim().length > 0
    )
    updatePayload.adjustments = (body.adjustments ?? []).filter(
      (a) => typeof a.name === 'string' && a.name.trim().length > 0
    )
  }

  let { data: updated, error: updateErr } = await supabase
    .from('quotes')
    .update(updatePayload)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(QUOTE_SELECT)
    .single()

  // A display column must not cost a tech their edit if 140 has not run here.
  if (updateErr && isMissingTaxBreakdownColumn(updateErr)) {
    console.error('[PUT /api/quotes/:id] tax_breakdown missing — run migration 140', updateErr.message)
    delete updatePayload.tax_breakdown
    ;({ data: updated, error: updateErr } = await supabase
      .from('quotes')
      .update(updatePayload)
      .eq('id', id)
      .eq('user_id', user.id)
      .select(QUOTE_SELECT)
      .single())
  }

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
