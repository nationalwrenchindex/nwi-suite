// POST /api/quotes/[id]/respond
// Tech manually marks a 'sent' quote as approved or declined.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const QUOTE_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin)
`

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabase
    .from('quotes')
    .select('id, status')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
  if (existing.status !== 'sent') {
    return NextResponse.json({ error: 'Only Sent quotes can be manually approved or declined.' }, { status: 409 })
  }

  let body: { action: 'approve' | 'decline'; note?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (body.action !== 'approve' && body.action !== 'decline') {
    return NextResponse.json({ error: 'action must be "approve" or "decline".' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> =
    body.action === 'approve'
      ? { status: 'approved', approved_at: now, approval_method: 'verbal' }
      : { status: 'declined', declined_at: now, customer_response_note: body.note ?? null, approval_method: 'verbal' }

  const { data: updated, error: updateErr } = await supabase
    .from('quotes')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(QUOTE_SELECT)
    .single()

  if (updateErr || !updated) {
    console.error('[respond] update failed:', updateErr)
    return NextResponse.json({ error: 'Failed to update quote.' }, { status: 500 })
  }

  return NextResponse.json({ quote: updated })
}
