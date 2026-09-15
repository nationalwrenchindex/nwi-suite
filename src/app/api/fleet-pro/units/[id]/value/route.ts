// PUT /api/fleet-pro/units/[id]/value — the manager's estimate of what the unit is
// worth today. It is the denominator of the replacement cost ratio, so without it
// half of the replacement rule cannot run at all.
//
// Hand-maintained on purpose (see migration 132): there is no book-value feed here,
// and a stale figure a human typed is more defensible in a budget meeting than a
// depreciation curve nobody in the room agreed to. value_updated_at is stamped on
// every write so the meeting can see how old the number is.
//
// ── THE TENANT RULE ──────────────────────────────────────────────────────────
// The fleet a unit belongs to is taken from hd_units.fleet_account_id and checked
// against the caller's RESOLVED membership, never against anything in the request.
// Without that check a manager of one department could write a valuation onto
// another department's truck by guessing a uuid.
//
// ── WHO MAY WRITE ────────────────────────────────────────────────────────────
// canEditUnits — manager only, matching every other unit mutation in the portal.
// Supervisors see the report and the numbers behind it; they do not set the numbers.
// Deliberately narrower than the registration route, which also lets the reselling
// partner write: a plate renewal is a service the partner performs, but declaring
// what the customer's asset is worth is the customer's own judgement call.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { canEditUnits } from '@/types/fleet-pro'
import { todayIso } from '@/lib/fleet-pro/registration'

export const dynamic = 'force-dynamic'

// hd_units.estimated_value is NUMERIC(12,2) — ten digits before the point. Rejecting
// above that here turns a 500 from the driver into a 400 the form can show.
const MAX_VALUE = 9_999_999_999.99

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: unitId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProMember(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { membership } = gate
  if (!canEditUnits(membership.role)) {
    return NextResponse.json({ error: 'Fleet manager role required' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // ── validate ────────────────────────────────────────────────────────────────
  // A missing key is not the same as an explicit null. Clearing the value is a real
  // action — a manager who typed the wrong truck's price needs a way to undo it —
  // so null and '' clear, and anything else must parse as a non-negative number.
  const raw = body.estimated_value
  let estimatedValue: number | null = null

  if (raw !== null && raw !== undefined && raw !== '') {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: 'estimated_value must be a number of 0 or more' }, { status: 400 })
    }
    if (n > MAX_VALUE) {
      return NextResponse.json({ error: 'estimated_value is too large' }, { status: 400 })
    }
    // Round rather than truncate: NUMERIC(12,2) would round anyway, so rounding here
    // means the value echoed back is the value that was stored.
    estimatedValue = Math.round(n * 100) / 100
  }

  const svc = createServiceClient()

  // Read the unit by id alone, then check its fleet against the resolved membership.
  // Nothing from this row reaches the response unless that check passes.
  const { data: unitRow, error: readError } = await svc
    .from('hd_units')
    .select('id, fleet_account_id')
    .eq('id', unitId)
    .maybeSingle()

  if (readError) {
    console.error('[fleet-pro/unit-value] read failed:', readError.message)
    return NextResponse.json({ error: readError.message }, { status: 500 })
  }

  // A unit in another fleet and a unit that does not exist get the same 404. Telling
  // the caller which one it was confirms the uuid is real to someone with no claim
  // on it.
  if (!unitRow || unitRow.fleet_account_id !== membership.fleet_account_id) {
    return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
  }

  // Clearing the value clears its timestamp too. A "last valued" date sitting next to
  // an empty value would read as though someone had confirmed the blank.
  const { data, error } = await svc
    .from('hd_units')
    .update({
      estimated_value:  estimatedValue,
      value_updated_at: estimatedValue === null ? null : todayIso(),
    })
    .eq('id', unitId)
    // Belt and braces: the tenant check above already passed, but the write itself is
    // also scoped, so a race that moved the unit between the two cannot land.
    .eq('fleet_account_id', membership.fleet_account_id)
    .select('id, unit_number, estimated_value, value_updated_at')
    .single()

  if (error) {
    console.error('[fleet-pro/unit-value] update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    unit_id:          data.id as string,
    unit_number:      (data.unit_number as string | null) ?? '',
    // PostgREST hands NUMERIC back as a string; coerce so the client never has to.
    estimated_value:  data.estimated_value === null ? null : Number(data.estimated_value),
    value_updated_at: (data.value_updated_at as string | null) ?? null,
  })
}
