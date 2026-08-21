// PATCH  /api/fleet-pro/members/[id] — change a member's role
// DELETE /api/fleet-pro/members/[id] — revoke a member or a pending invite
//
// Both are manager-only and both are guarded against the same catastrophe: a fleet
// with no active manager left has nobody who can invite one, and only the mechanic
// who owns the account could dig it back out. The last active manager can therefore
// neither be demoted nor revoked — including by themselves.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProManager } from '@/lib/fleet-pro/access'
import { FLEET_PRO_ROLES } from '@/types/fleet-pro'
import type { FleetProMemberRow, FleetProRole, FleetProStatus } from '@/types/fleet-pro'

export const dynamic = 'force-dynamic'

const MEMBER_COLUMNS = 'id, email, full_name, role, status, invited_at, accepted_at'

interface MemberRecord {
  id:          string
  email:       string
  full_name:   string | null
  role:        string
  status:      string
  invited_at:  string | null
  accepted_at: string | null
}

function isRole(value: unknown): value is FleetProRole {
  return typeof value === 'string' && (FLEET_PRO_ROLES as string[]).includes(value)
}

function toMemberRow(row: MemberRecord, isSelf: boolean): FleetProMemberRow {
  return {
    id:          String(row.id),
    email:       row.email,
    full_name:   row.full_name ?? null,
    role:        row.role as FleetProRole,
    status:      row.status as FleetProStatus,
    invited_at:  row.invited_at ?? null,
    accepted_at: row.accepted_at ?? null,
    is_self:     isSelf,
  }
}

/** How many active managers this fleet has right now. */
async function activeManagerCount(
  svc: ReturnType<typeof createServiceClient>,
  fleetAccountId: string,
): Promise<number> {
  const { count } = await svc
    .from('fleet_pro_members')
    .select('id', { count: 'exact', head: true })
    .eq('fleet_account_id', fleetAccountId)
    .eq('role', 'manager')
    .eq('status', 'active')
  return count ?? 0
}

const LAST_MANAGER_ERROR =
  'This is the fleet\'s only active manager. Promote someone else to manager first.'

// ─── PATCH ───────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProManager(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership } = gate

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!isRole(body.role)) {
    return NextResponse.json({ error: 'Role must be manager, supervisor or viewer' }, { status: 400 })
  }
  const role = body.role

  const svc = createServiceClient()

  // Scoped read. Without the fleet_account_id filter a manager could rewrite the
  // role of anyone in any fleet by guessing a uuid.
  const { data: target } = await svc
    .from('fleet_pro_members')
    .select('id, role, status')
    .eq('id', id)
    .eq('fleet_account_id', membership.fleet_account_id)
    .maybeSingle()

  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  if (target.status === 'revoked') {
    return NextResponse.json({ error: 'That membership has been revoked' }, { status: 409 })
  }

  // Only an active manager losing the role can empty the seat — a pending invite
  // marked 'manager' has never counted toward the total.
  const demotingActiveManager =
    target.role === 'manager' && target.status === 'active' && role !== 'manager'

  if (demotingActiveManager && (await activeManagerCount(svc, membership.fleet_account_id)) <= 1) {
    return NextResponse.json({ error: LAST_MANAGER_ERROR }, { status: 409 })
  }

  const { data, error } = await svc
    .from('fleet_pro_members')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('fleet_account_id', membership.fleet_account_id)
    .select(MEMBER_COLUMNS)
    .single()

  if (error || !data) {
    console.error('[fleet-pro/members] role update failed:', error?.message)
    return NextResponse.json({ error: 'Could not update that role' }, { status: 500 })
  }

  return NextResponse.json({ member: toMemberRow(data as MemberRecord, id === membership.member_id) })
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProManager(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership } = gate

  const svc = createServiceClient()

  const { data: target } = await svc
    .from('fleet_pro_members')
    .select('id, role, status')
    .eq('id', id)
    .eq('fleet_account_id', membership.fleet_account_id)
    .maybeSingle()

  if (!target) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  if (target.status === 'revoked') {
    return NextResponse.json({ error: 'That membership is already revoked' }, { status: 409 })
  }

  // Covers self-revocation as well: the caller is an active manager, so if they are
  // the only one the count is 1 and this refuses.
  if (target.role === 'manager' && target.status === 'active') {
    if ((await activeManagerCount(svc, membership.fleet_account_id)) <= 1) {
      return NextResponse.json({ error: LAST_MANAGER_ERROR }, { status: 409 })
    }
  }

  // The row is kept, not deleted — invited_at/accepted_at are the fleet's record of
  // who had access and when. Clearing invite_token kills any outstanding link
  // immediately and frees the UNIQUE index for a future re-invite.
  const { data, error } = await svc
    .from('fleet_pro_members')
    .update({
      status:            'revoked',
      invite_token:      null,
      invite_expires_at: null,
      updated_at:        new Date().toISOString(),
    })
    .eq('id', id)
    .eq('fleet_account_id', membership.fleet_account_id)
    .select(MEMBER_COLUMNS)
    .single()

  if (error || !data) {
    console.error('[fleet-pro/members] revoke failed:', error?.message)
    return NextResponse.json({ error: 'Could not revoke that member' }, { status: 500 })
  }

  return NextResponse.json({ member: toMemberRow(data as MemberRecord, id === membership.member_id) })
}
