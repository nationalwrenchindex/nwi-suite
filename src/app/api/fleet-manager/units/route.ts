// GET /api/fleet-manager/units - the signed-in fleet manager's units.
//
// Everything comes out of lib/fleet-view/unit-history (whitelisted columns; the unit
// list carries no money and no contact details), scoped to the grant on his own auth user. Anyone without a
// grant gets a 403 - including the shop owner, who has the HD Suite for this.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveFleetManager } from '@/lib/fleet-view/access'
import { listFleetUnits } from '@/lib/fleet-view/unit-history'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveFleetManager(user)
  if (!access) return NextResponse.json({ error: 'No fleet manager access on this login.' }, { status: 403 })
  const units = await listFleetUnits(createServiceClient(), access)
  return NextResponse.json({ fleet_name: access.fleetName, units }, { headers: { 'Cache-Control': 'private, no-store' } })
}
