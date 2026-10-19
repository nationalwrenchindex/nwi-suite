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
//
// THE HEADER EDIT (/hd/work-orders/[id]/edit) writes through here too: customer, unit
// fields, unit number, complaint, diagnosis and scheduled date. Kurt had to delete and
// rebuild five work orders because none of that could be corrected. It is still an
// allow-list - the invoice PUT's raw-body spread is exactly what this does not copy -
// and still no money.
//
// LOCKED ONCE INVOICED. The invoice carries its own copy of every one of these fields,
// so editing the work order afterwards would put the two documents out of step with
// nothing to reconcile them. The line-items grid already locks at the same point;
// this is the server side of that rule. Reopening the work order unlocks it.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { isMissingMigration159Column, withoutMigration159Columns } from '@/lib/hd/migration-159'

export const dynamic = 'force-dynamic'

/** The header fields and their caps. unit_year..vin are migration 159's. */
const HEADER_TEXT_FIELDS: Array<[string, number]> = [
  ['customer_name', 200], ['customer_phone', 40],
  ['unit_number', 60], ['unit_manufacturer', 120], ['unit_model', 120], ['unit_serial', 120],
  ['unit_year', 10], ['truck_make', 120], ['truck_model', 120], ['truck_year', 10], ['vin', 40],
  // The customer's complaint and the tech's diagnosis. On a work order they are
  // service_requests and comments - the same split quote -> work order uses.
  ['service_requests', 5000], ['comments', 5000],
]

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

  // The header. Text columns only; customer_id and the unit/fleet links are not here,
  // so retyping a name does not silently move the job to another customer's account.
  for (const [k, max] of HEADER_TEXT_FIELDS) if (k in body) update[k] = text(body[k], max)
  if ('scheduled_at' in body) {
    const raw = body.scheduled_at
    if (raw == null || raw === '') update.scheduled_at = null
    else {
      const d = new Date(String(raw))
      if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'scheduled_at is not a date.' }, { status: 400 })
      update.scheduled_at = d.toISOString()
    }
  }

  // THE UNIT LINK. Settable so a job booked as free text can be linked to the unit it
  // was for - a work order with no unit_id cannot appear in a per-unit history.
  //
  // OWNERSHIP IS CHECKED HERE, not left to the foreign key. hd_units.id is a plain FK,
  // and an FK does not apply RLS: without this, an id lifted from another shop's unit
  // would link that shop's unit to this work order. null or '' clears the link.
  if ('unit_id' in body) {
    const raw = body.unit_id
    if (raw == null || raw === '') {
      update.unit_id = null
    } else {
      const { data: unit } = await supabase
        .from('hd_units')
        .select('id')
        .eq('id', String(raw))
        .eq('user_id', user.id)
        .maybeSingle()
      if (!unit) return NextResponse.json({ error: 'That unit was not found in your units.' }, { status: 400 })
      update.unit_id = unit.id
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  // Scoped by user_id as well as id: another subscriber's work order is
  // indistinguishable from one that does not exist.
  const { data: current } = await supabase
    .from('hd_work_orders')
    .select('status')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!current) return NextResponse.json({ error: 'Work order not found.' }, { status: 404 })
  if (current.status === 'invoiced') {
    return NextResponse.json({
      error: 'This work order has been invoiced, so it is locked. Edit the invoice, or reopen the work order first.',
      reason: 'locked',
    }, { status: 409 })
  }

  // '*' back, not a column list: the migration-159 columns may not exist yet.
  const write = (row: Record<string, unknown>) => supabase
    .from('hd_work_orders')
    .update(row)
    .eq('id', id)
    .eq('user_id', user.id)
    .neq('status', 'invoiced')
    .select('*')
    .maybeSingle()

  let { data, error } = await write(update)
  // Migration 159 (unit year, truck fields, VIN) is applied by hand. Until it is, the
  // rest of the header saves and the response says which fields could not.
  let notSaved: string[] = []
  if (error && isMissingMigration159Column(error)) {
    console.error('[hd/work-orders PATCH] unit columns missing - run migration 159', error.message)
    const stripped = withoutMigration159Columns(update)
    notSaved = Object.keys(update).filter(k => !(k in stripped))
    ;({ data, error } = Object.keys(stripped).length ? await write(stripped) : { data: null, error })
  }

  if (error || !data) {
    console.error('[hd/work-orders PATCH]', error?.message)
    return NextResponse.json({ error: error?.message ?? 'Work order not found.' }, { status: error ? 500 : 409 })
  }

  return NextResponse.json({ work_order: data, not_saved: notSaved })
}
