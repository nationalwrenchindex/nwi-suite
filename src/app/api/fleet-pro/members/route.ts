// GET  /api/fleet-pro/members — the roster for the caller's fleet (managers only)
// POST /api/fleet-pro/members — invite someone onto the fleet
//
// This is the first invite flow in the app, and the first use of supabase.auth.admin.
// Two paths reach it: the fleet's own manager (requireFleetProManager) and the
// mechanic who owns the fleet account (ownsFleetAccount) seating the department's
// first manager before any member exists to do it themselves.

import { NextResponse, type NextRequest } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProManager, ownsFleetAccount } from '@/lib/fleet-pro/access'
import { FLEET_PRO_ROLES, ROLE_LABELS } from '@/types/fleet-pro'
import type { FleetProMemberRow, FleetProRole, FleetProStatus } from '@/types/fleet-pro'

export const dynamic = 'force-dynamic'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://tools.nationalwrenchindex.com').replace(/\/$/, '')
const FROM     = 'NWI Fleet Pro <onboarding@resend.dev>'
const INVITE_TTL_DAYS = 14

// ─── helpers ─────────────────────────────────────────────────────────────────

interface MemberRecord {
  id:          string
  email:       string
  full_name:   string | null
  role:        string
  status:      string
  invited_at:  string | null
  accepted_at: string | null
}

/** The roster columns, and only those — FleetProMemberRow carries nothing else. */
const MEMBER_COLUMNS = 'id, email, full_name, role, status, invited_at, accepted_at, user_id'

function isEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
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

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))
}

/**
 * Fallback delivery. supabase.auth.admin.inviteUserByEmail refuses an address that
 * already has an auth account, which is a completely normal case here — a mechanic
 * with an NWI login being seated on a fleet, or someone invited to a second fleet.
 * They do not need a magic link, they need the accept URL. Mirrors the lazy-client,
 * never-throws shape of src/lib/email-alerts.ts.
 */
async function sendInviteLinkEmail({
  to,
  fleetName,
  role,
  acceptUrl,
}: {
  to:        string
  fleetName: string
  role:      FleetProRole
  acceptUrl: string
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[fleet-pro/members] RESEND_API_KEY not set — invite email skipped')
    return
  }
  try {
    const resend = new Resend(apiKey)
    await resend.emails.send({
      from:    FROM,
      to,
      subject: `You've been added to ${fleetName} on NWI Fleet Pro`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#111920;color:#fff;padding:32px;border-radius:12px;">
          <p style="color:#E85D24;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">NWI Fleet Pro</p>
          <h2 style="color:#fff;font-size:22px;margin:0 0 16px;">${esc(fleetName)}</h2>
          <p style="color:rgba(255,255,255,0.7);line-height:1.6;margin:0 0 20px;">
            You have been given <strong style="color:#fff;">${esc(ROLE_LABELS[role])}</strong> access to the
            ${esc(fleetName)} fleet portal, where you can see the service, PM schedules and
            inspections performed on your equipment.
          </p>
          <p style="margin:0 0 20px;">
            <a href="${acceptUrl}"
               style="display:inline-block;background:#E85D24;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
              Accept invitation →
            </a>
          </p>
          <p style="color:rgba(255,255,255,0.4);font-size:12px;line-height:1.6;margin:0;">
            Sign in with this email address to accept. This link expires in ${INVITE_TTL_DAYS} days.<br/>
            ${esc(acceptUrl)}
          </p>
        </div>
      `,
    })
  } catch (err) {
    console.error('[fleet-pro/members] invite email failed:', err)
  }
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProManager(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership } = gate

  const svc = createServiceClient()

  const { data, error } = await svc
    .from('fleet_pro_members')
    .select(MEMBER_COLUMNS)
    .eq('fleet_account_id', membership.fleet_account_id)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[fleet-pro/members] list failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as (MemberRecord & { user_id: string | null })[]
  const members = rows.map(r => toMemberRow(r, r.id === membership.member_id))

  return NextResponse.json({ members, fleet_name: membership.fleet_name })
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // Who is allowed to seat people, and onto which fleet.
  //
  // A fleet manager may only ever invite onto their own fleet — the id comes from
  // their membership, never from the request. The mechanic who owns the account is
  // the only caller permitted to name a fleet_account_id, and only after
  // ownsFleetAccount confirms it is his.
  const gate = await requireFleetProManager(user.id)
  let fleetAccountId: string

  if (gate.ok) {
    fleetAccountId = gate.membership.fleet_account_id
  } else {
    const requested = body.fleet_account_id
    if (typeof requested !== 'string' || !requested) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }
    if (!(await ownsFleetAccount(user.id, requested))) {
      return NextResponse.json({ error: gate.error }, { status: gate.status })
    }
    fleetAccountId = requested
  }

  // ── validate ────────────────────────────────────────────────────────────────
  if (!isEmail(body.email)) {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 })
  }
  const email = body.email.trim().toLowerCase()

  if (!isRole(body.role)) {
    return NextResponse.json({ error: 'Role must be manager, supervisor or viewer' }, { status: 400 })
  }
  const role = body.role

  const fullName = typeof body.full_name === 'string' && body.full_name.trim()
    ? body.full_name.trim().slice(0, 120)
    : null

  const svc = createServiceClient()

  // ── the fleet, for the email copy and to prove the account exists ──────────
  const { data: account } = await svc
    .from('hd_fleet_accounts')
    .select('id, fleet_name')
    .eq('id', fleetAccountId)
    .maybeSingle()

  if (!account) return NextResponse.json({ error: 'Fleet account not found' }, { status: 404 })
  const fleetName = (account.fleet_name as string | null) ?? 'your fleet'

  // ── duplicate guard ─────────────────────────────────────────────────────────
  // Compared in JS rather than with .ilike() because an email may legitimately
  // contain an underscore, which ilike would treat as a wildcard. The roster is a
  // handful of rows, so the read is cheap and the comparison is exact.
  const { data: existingRows } = await svc
    .from('fleet_pro_members')
    .select('id, email, status')
    .eq('fleet_account_id', fleetAccountId)

  const existing = ((existingRows ?? []) as { id: string; email: string; status: string }[])
    .find(r => String(r.email ?? '').toLowerCase() === email)

  if (existing && existing.status !== 'revoked') {
    return NextResponse.json(
      { error: 'That email already has access to this fleet' },
      { status: 409 },
    )
  }

  // ── write the invite ────────────────────────────────────────────────────────
  const token   = crypto.randomUUID()
  const now     = new Date()
  const expires = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000)

  const invitePayload = {
    role,
    full_name:         fullName,
    status:            'invited',
    invite_token:      token,
    invite_expires_at: expires.toISOString(),
    invited_by:        user.id,
    invited_at:        now.toISOString(),
    accepted_at:       null,
    updated_at:        now.toISOString(),
  }

  // A revoked row is reused rather than replaced: the unique index on
  // (fleet_account_id, lower(email)) would reject a second row for the same
  // address, and user_id is cleared so re-acceptance has to happen properly.
  const write = existing
    ? svc.from('fleet_pro_members')
        .update({ ...invitePayload, user_id: null })
        .eq('id', existing.id)
        .eq('fleet_account_id', fleetAccountId)
        .select(MEMBER_COLUMNS)
        .single()
    : svc.from('fleet_pro_members')
        .insert({ ...invitePayload, fleet_account_id: fleetAccountId, email })
        .select(MEMBER_COLUMNS)
        .single()

  const { data: member, error: writeError } = await write

  if (writeError || !member) {
    console.error('[fleet-pro/members] invite write failed:', writeError?.message)
    return NextResponse.json({ error: 'Could not create the invitation' }, { status: 500 })
  }

  // ── deliver ────────────────────────────────────────────────────────────────
  const acceptPath = `/fleet-pro/accept-invite?token=${token}`
  const acceptUrl  = `${APP_URL}${acceptPath}`
  // The whole destination is percent-encoded so the token survives as part of the
  // `next` value. Left raw, the second '?' would be parsed as a sibling query
  // parameter of the callback and the token would never reach the accept page.
  const redirectTo = `${APP_URL}/auth/callback?next=${encodeURIComponent(acceptPath)}`

  const { error: inviteError } = await svc.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { fleet_pro: true },
  })

  if (inviteError) {
    // Almost always "a user with this email address has already been registered",
    // which is not a failure — they simply do not need an account created for them.
    // Any other delivery problem lands here too and gets the same direct email.
    console.warn('[fleet-pro/members] inviteUserByEmail fell back to direct email:', inviteError.message)
    await sendInviteLinkEmail({ to: email, fleetName, role, acceptUrl })
  }

  // Deliberately identical whichever branch ran above: the response must never
  // reveal whether this address already had an NWI account.
  return NextResponse.json(
    { member: toMemberRow(member as MemberRecord, false) },
    { status: 201 },
  )
}
