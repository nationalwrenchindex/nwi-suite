// PATCH / DELETE /api/fleet-pro/drivers/[id]
//
// Manager only, and every query is double-scoped: the id from the URL AND the fleet id
// from the caller's membership. A driver id belonging to another department therefore
// reads as 404 rather than as a row somebody else's manager can edit.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { canEditUnits } from '@/types/fleet-pro'
import { COMPLIANCE_BUCKET } from '@/types/fleet-pro-compliance'
import { DRIVER_COLUMNS, toDriver, validateDriverBody, type DriverRow } from '../shared'

export const dynamic = 'force-dynamic'

async function requireManager(userId: string | null) {
  const gate = await requireFleetProMember(userId)
  if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error }
  if (!canEditUnits(gate.membership.role)) {
    return { ok: false as const, status: 403, error: 'Fleet manager role required' }
  }
  return { ok: true as const, membership: gate.membership, svc: createServiceClient() }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
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

  const validated = validateDriverBody(body, { requireName: false })
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })

  if (Object.keys(validated.patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await svc
    .from('fleet_pro_drivers')
    .update({ ...validated.patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('fleet_account_id', membership.fleet_account_id)
    .select(DRIVER_COLUMNS)
    .maybeSingle()

  if (error) {
    console.error('[fleet-pro/drivers] update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Driver not found' }, { status: 404 })

  return NextResponse.json({ driver: toDriver(data as DriverRow, membership.role) })
}

// ── DELETE ────────────────────────────────────────────────────────────────────
// A real delete, not a deactivation — `active: false` is already available through
// PATCH and is the right move for a driver who has left. This verb is for a record
// that should never have existed, and it is offered because the row holds a CDL
// number: a fleet that wants that erased must have a way to erase it rather than only
// a way to hide it. The FK cascade in migration 131 takes the driver's documents with
// it; the objects behind them are removed here, since nothing else will ever find them.

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireManager(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership, svc } = gate

  const { data: existing } = await svc
    .from('fleet_pro_drivers')
    .select('id')
    .eq('id', id)
    .eq('fleet_account_id', membership.fleet_account_id)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: 'Driver not found' }, { status: 404 })

  // Collected BEFORE the delete: the cascade removes the rows, and with them the only
  // record of which objects in the bucket belonged to this driver.
  const { data: docs } = await svc
    .from('fleet_pro_compliance_docs')
    .select('file_url')
    .eq('driver_id', id)
    .eq('fleet_account_id', membership.fleet_account_id)
    .not('file_url', 'is', null)

  const { error } = await svc
    .from('fleet_pro_drivers')
    .delete()
    .eq('id', id)
    .eq('fleet_account_id', membership.fleet_account_id)

  if (error) {
    console.error('[fleet-pro/drivers] delete failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const paths = (docs ?? [])
    .map(d => d.file_url as string | null)
    .filter((p): p is string => !!p)

  if (paths.length > 0) {
    const { error: rmErr } = await svc.storage.from(COMPLIANCE_BUCKET).remove(paths)
    if (rmErr) console.error('[fleet-pro/drivers] document cleanup failed:', rmErr.message)
  }

  return NextResponse.json({ ok: true })
}
