// GET / POST /api/fleet-pro/drivers
//
// The driver roster for the caller's fleet. Every member reads it; only a manager
// writes. The fleet id comes from the resolved membership, never from the request.
//
// CDL numbers are masked for read-only viewers — the mapper in ./shared.ts does it,
// and the reasoning is spelled out there and beside the read policy in migration 131.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { canEditUnits } from '@/types/fleet-pro'
import type { DriversPayload } from '@/types/fleet-pro-compliance'
import { DRIVER_COLUMNS, toDriver, validateDriverBody, type DriverRow } from './shared'

export const dynamic = 'force-dynamic'

// ── GET ───────────────────────────────────────────────────────────────────────
// Inactive drivers come back too, so the roster can show and restore them. They are
// excluded from the compliance calendar itself — an expired CDL for somebody who left
// in March is not a compliance problem, and leaving it red trains the fleet to ignore
// red. See buildComplianceCalendar.

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProMember(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership } = gate

  const svc = createServiceClient()
  const { data, error } = await svc
    .from('fleet_pro_drivers')
    .select(DRIVER_COLUMNS)
    .eq('fleet_account_id', membership.fleet_account_id)
    .order('active', { ascending: false })
    .order('full_name', { ascending: true })

  if (error) {
    console.error('[fleet-pro/drivers] load failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const payload: DriversPayload = {
    drivers:  (data ?? []).map(row => toDriver(row as DriverRow, membership.role)),
    can_edit: canEditUnits(membership.role),
    role:     membership.role,
  }
  return NextResponse.json(payload)
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
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

  const validated = validateDriverBody(body, { requireName: true })
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })

  const svc = createServiceClient()
  const { data, error } = await svc
    .from('fleet_pro_drivers')
    .insert({
      ...validated.patch,
      // From the membership, never the body — the tenant rule the registration route
      // spells out. A body-supplied fleet id would let one department seat a driver
      // (with their CDL number) on another department's roster.
      fleet_account_id: membership.fleet_account_id,
      created_by:       user?.id ?? null,
    })
    .select(DRIVER_COLUMNS)
    .single()

  if (error) {
    console.error('[fleet-pro/drivers] insert failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ driver: toDriver(data as DriverRow, membership.role) }, { status: 201 })
}
