// GET / POST /api/fleet-pro/drivers/[id]/incidents
//
// The incident and complaint log for one driver (migration 134).
//
// GET is open to every member, matching the "members read" policy: a supervisor who
// cannot see that a driver has three open complaints cannot supervise. POST is
// manager-only, matching "managers write" — logging a written allegation against a
// named person is a manager act.
//
// Every query is double-scoped, driver id AND the fleet id from the membership, so a
// driver belonging to another department is a 404 rather than a log to append to.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { canEditUnits } from '@/types/fleet-pro'
import { INCIDENT_LIMITS, isIncidentType } from '@/types/fleet-pro-drivers'
import { INCIDENT_COLUMNS, INCIDENT_LIMIT, driverOnFleet, isIsoDate, toIncident } from './shared'

export const dynamic = 'force-dynamic'

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProMember(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership } = gate

  const svc = createServiceClient()
  if (!(await driverOnFleet(svc, id, membership.fleet_account_id))) {
    return NextResponse.json({ error: 'Driver not found' }, { status: 404 })
  }

  const { data, error } = await svc
    .from('fleet_pro_driver_incidents')
    .select(INCIDENT_COLUMNS)
    .eq('driver_id', id)
    .eq('fleet_account_id', membership.fleet_account_id)
    .order('incident_date', { ascending: false })
    .limit(INCIDENT_LIMIT)

  if (error) {
    console.error('[fleet-pro/drivers/incidents] load failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    incidents: (data ?? []).map(row => toIncident(row as Record<string, unknown>)),
    can_edit:  canEditUnits(membership.role),
  })
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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

  if (!isIncidentType(body.incident_type)) {
    return NextResponse.json(
      { error: 'incident_type must be complaint, accident, policy_violation or other' },
      { status: 400 },
    )
  }

  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) {
    return NextResponse.json({ error: 'A description is required' }, { status: 400 })
  }

  // Optional, and the column defaults to today. Validated here when supplied rather
  // than left to the DATE cast, so a typo comes back as a sentence instead of a 500.
  let incidentDate: string | undefined
  if (body.incident_date != null && body.incident_date !== '') {
    if (!isIsoDate(body.incident_date)) {
      return NextResponse.json({ error: 'incident_date must be a valid date (YYYY-MM-DD)' }, { status: 400 })
    }
    incidentDate = body.incident_date
  }

  const svc = createServiceClient()
  if (!(await driverOnFleet(svc, id, membership.fleet_account_id))) {
    return NextResponse.json({ error: 'Driver not found' }, { status: 404 })
  }

  const { data, error } = await svc
    .from('fleet_pro_driver_incidents')
    .insert({
      driver_id: id,
      // From the membership, never the body — the tenant rule the roster route spells
      // out. A body-supplied fleet id would file an allegation on another fleet's log.
      fleet_account_id: membership.fleet_account_id,
      incident_type:    body.incident_type,
      description:      description.slice(0, INCIDENT_LIMITS.description),
      ...(incidentDate ? { incident_date: incidentDate } : {}),
    })
    .select(INCIDENT_COLUMNS)
    .single()

  if (error) {
    console.error('[fleet-pro/drivers/incidents] insert failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ incident: toIncident(data as Record<string, unknown>) }, { status: 201 })
}
