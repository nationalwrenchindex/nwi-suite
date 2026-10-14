// PATCH /api/hd/work-orders/[id]
//
// The small, free-text details of a job: where it is, who is on it, the setpoint.
//
// WHY THIS ROUTE DID NOT EXIST. HD work orders had exactly two write paths -
// /status and /line-items - so `location` was rendered as read-only text with no way
// to change it. The address now defaults from the approved quote, which makes an
// edit path necessary rather than nice: the unit is often at neither the billing nor
// the corporate address, and a default nobody can correct is worse than a blank.
//
// DELIBERATELY NARROW. Money is not here. labor_rate, tax_percent, totals and the
// authorization record are the terms the customer agreed to, and they do not get a
// general-purpose PATCH to drift through - a document's recorded terms beat any later
// edit, and line items have their own route that re-prices properly.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'

export const dynamic = 'force-dynamic'

/** Trim to null: a cleared field means "not known", not an empty string. */
function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t.slice(0, max)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // An allow-list, not a spread of the request. A client that sends total_amount or
  // labor_rate gets them ignored rather than applied.
  const update: Record<string, unknown> = {}
  if ('location' in body)         update.location         = text(body.location, 500)
  if ('tech_name' in body)        update.tech_name        = text(body.tech_name, 200)
  if ('current_setpoint' in body) update.current_setpoint = text(body.current_setpoint, 60)

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  // Scoped by user_id as well as id: another subscriber's work order is
  // indistinguishable from one that does not exist.
  const { data, error } = await supabase
    .from('hd_work_orders')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, location, tech_name, current_setpoint')
    .single()

  if (error || !data) {
    console.error('[hd/work-orders PATCH]', error?.message)
    return NextResponse.json({ error: error?.message ?? 'Work order not found.' }, { status: error ? 500 : 404 })
  }

  return NextResponse.json({ work_order: data })
}
