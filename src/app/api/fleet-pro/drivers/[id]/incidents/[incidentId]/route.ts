// PATCH / DELETE /api/fleet-pro/drivers/[id]/incidents/[incidentId]
//
// Resolve, re-open, or remove one incident. Manager only, matching the "managers
// write" policy in migration 134.
//
// Triple-scoped: the incident id, the driver id from the URL, and the fleet id from
// the caller's membership. The driver id in the path is not decoration — without it an
// incident id from a sibling driver on the SAME fleet would be editable through the
// wrong driver's page, which is how a resolution note ends up on the wrong person's
// record.
//
// WHAT IS EDITABLE, AND WHAT IS NOT.
// Only `resolved` and `resolution_notes` can be changed. incident_date, incident_type
// and description are deliberately immutable: this is a log of what was alleged and
// when, and a log whose entries can be rewritten afterwards is not evidence of
// anything. Correcting a genuine mistake is a DELETE and a fresh entry, which leaves
// the correction visible rather than silent.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { canEditUnits } from '@/types/fleet-pro'
import { INCIDENT_LIMITS } from '@/types/fleet-pro-drivers'
import { INCIDENT_COLUMNS, driverOnFleet, toIncident } from '../shared'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; incidentId: string }> }

async function requireManager(userId: string | null) {
  const gate = await requireFleetProMember(userId)
  if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error }
  if (!canEditUnits(gate.membership.role)) {
    return { ok: false as const, status: 403, error: 'Fleet manager role required' }
  }
  return { ok: true as const, membership: gate.membership, svc: createServiceClient() }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id, incidentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireManager(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership, svc } = gate

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}

  if ('resolved' in body) patch.resolved = body.resolved === true

  if ('resolution_notes' in body) {
    const notes = typeof body.resolution_notes === 'string' ? body.resolution_notes.trim() : ''
    patch.resolution_notes = notes ? notes.slice(0, INCIDENT_LIMITS.resolution_notes) : null
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  if (!(await driverOnFleet(svc, id, membership.fleet_account_id))) {
    return NextResponse.json({ error: 'Driver not found' }, { status: 404 })
  }

  const { data, error } = await svc
    .from('fleet_pro_driver_incidents')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', incidentId)
    .eq('driver_id', id)
    .eq('fleet_account_id', membership.fleet_account_id)
    .select(INCIDENT_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[fleet-pro/drivers/incidents] update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

  return NextResponse.json({ incident: toIncident(data as Record<string, unknown>) })
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, incidentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireManager(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership, svc } = gate

  if (!(await driverOnFleet(svc, id, membership.fleet_account_id))) {
    return NextResponse.json({ error: 'Driver not found' }, { status: 404 })
  }

  // .select() so a delete that matched nothing is distinguishable from one that did.
  // Without it PostgREST reports success either way and the UI would cheerfully
  // remove a row from the screen that is still in the table.
  const { data, error } = await svc
    .from('fleet_pro_driver_incidents')
    .delete()
    .eq('id', incidentId)
    .eq('driver_id', id)
    .eq('fleet_account_id', membership.fleet_account_id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[fleet-pro/drivers/incidents] delete failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
