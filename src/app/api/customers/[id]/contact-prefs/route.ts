// GET / PUT a customer's contact suppression preferences.
//
// Session-authed and owner-scoped: every query filters on BOTH the customer id
// and user_id = the caller. RLS on public.customers already enforces that (001),
// but the explicit .eq('user_id') is kept so the route is still correct if it is
// ever moved onto a service-role client, and so a wrong-owner id returns a clean
// 404 rather than an empty result the handler has to interpret.
//
// A missing row and a row owned by someone else both answer 404, never 403 — a
// 403 would confirm that the id exists on another mechanic's roster.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type RouteContext = { params: Promise<{ id: string }> }

const PREFS_SELECT = 'id, no_email, no_sms, contact_prefs_note, contact_prefs_updated_at'

// ─── GET /api/customers/[id]/contact-prefs ────────────────────────────────────
export async function GET(_req: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data, error } = await supabase
    .from('customers')
    .select(PREFS_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[GET /api/customers/[id]/contact-prefs]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  return NextResponse.json({ prefs: data })
}

// ─── PUT /api/customers/[id]/contact-prefs ────────────────────────────────────
// Accepts { no_email?, no_sms?, contact_prefs_note? }. Every field is optional so
// the UI can toggle one switch without having to send the others back and risk
// clobbering a change made in another tab.
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: Record<string, unknown>
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  // Built field by field rather than spreading the body: this endpoint sits on
  // the customers table, and spreading would let a caller write first_name,
  // phone or user_id through a route that is only supposed to move three flags.
  const updateData: Record<string, unknown> = {}

  if ('no_email' in body) {
    if (typeof body.no_email !== 'boolean')
      return NextResponse.json({ error: 'no_email must be a boolean' }, { status: 400 })
    updateData.no_email = body.no_email
  }

  if ('no_sms' in body) {
    if (typeof body.no_sms !== 'boolean')
      return NextResponse.json({ error: 'no_sms must be a boolean' }, { status: 400 })
    updateData.no_sms = body.no_sms
  }

  if ('contact_prefs_note' in body) {
    const note = body.contact_prefs_note
    if (note !== null && typeof note !== 'string')
      return NextResponse.json({ error: 'contact_prefs_note must be a string or null' }, { status: 400 })
    // Empty string normalises to NULL so "no note" has one representation and
    // the UI does not have to distinguish '' from null when rendering.
    const trimmed = typeof note === 'string' ? note.trim() : null
    updateData.contact_prefs_note = trimmed ? trimmed.slice(0, 2000) : null
  }

  if (Object.keys(updateData).length === 0)
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })

  // Stamped server-side, never taken from the body: this is the audit trail for
  // when a preference was set, so the client does not get to write it.
  updateData.contact_prefs_updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('customers')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(PREFS_SELECT)
    .maybeSingle()

  if (error) {
    console.error('[PUT /api/customers/[id]/contact-prefs]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

  return NextResponse.json({ prefs: data })
}
