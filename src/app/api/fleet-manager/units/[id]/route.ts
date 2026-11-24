// GET /api/fleet-manager/units/[id] - one unit's repair history, newest first, each
// invoiced visit with its invoice exactly as printed for him (the customer tier of
// lib/fleet-view/unit-history).
//
// A unit that is not on the manager's fleet is a 404, the same answer as a unit that
// does not exist: another fleet's unit id tells the caller nothing.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolveFleetManager } from '@/lib/fleet-view/access'
import { getCustomerUnitHistory } from '@/lib/fleet-view/unit-history'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await resolveFleetManager(user)
  if (!access) return NextResponse.json({ error: 'No fleet manager access on this login.' }, { status: 403 })
  const history = await getCustomerUnitHistory(createServiceClient(), access, id)
  if (!history) return NextResponse.json({ error: 'Unit not found.' }, { status: 404 })
  return NextResponse.json(history, { headers: { 'Cache-Control': 'private, no-store' } })
}
