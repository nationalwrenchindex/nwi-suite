// GET /api/fleet-pro/compliance
//
// The whole DOT & compliance calendar for the caller's fleet: every tracked deadline
// across units, drivers and the carrier itself, already classified, plus the two lists
// the page builds its filters from.
//
// Read-only and open to every member. A read-only viewer sees the same red rows as the
// manager — knowing a truck cannot legally roll on Monday is not a privileged fact, and
// hiding it from a supervisor would defeat the point of the calendar. Editing is a
// different matter and lives behind canEditUnits() in the sibling routes.
//
// The fleet id comes from the resolved membership, never from the request.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { canEditUnits } from '@/types/fleet-pro'
import { todayIso } from '@/lib/fleet-pro/compliance'
import type { ComplianceCalendar } from '@/types/fleet-pro-compliance'
import { buildComplianceCalendar } from './calendar'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProMember(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership } = gate

  const svc   = createServiceClient()
  const today = todayIso()

  const built = await buildComplianceCalendar(
    svc,
    membership.fleet_account_id,
    membership.fleet_name,
    today,
    { withSignedUrls: true },
  )

  const payload: ComplianceCalendar = {
    fleet_account_id: membership.fleet_account_id,
    fleet_name:       membership.fleet_name,
    role:             membership.role,
    can_edit:         canEditUnits(membership.role),
    today,
    items:            built.items,
    expired_count:    built.items.filter(i => i.state === 'expired').length,
    missing_count:    built.items.filter(i => i.state === 'missing').length,
    due_soon_count:   built.items.filter(i => i.state === 'due_soon').length,
    upcoming_count:   built.items.filter(i => i.state === 'upcoming').length,
    units:            built.units,
    drivers:          built.drivers,
    fleet_record:     built.fleetRecord,
  }

  return NextResponse.json(payload)
}
