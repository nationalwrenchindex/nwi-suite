// POST /api/fleet-pro/partner/accounts/[accountId]/invite — seat a fleet manager
//
// The partner-side twin of POST /api/fleet-pro/members. That route is reachable by
// the fleet's own manager (or by the mechanic through ownsFleetAccount), which
// leaves a gap: a fleet the partner just created has NO members at all, so there is
// nobody who can invite the first one and no screen that offers it. This is that
// screen's route, so the default role is 'manager' — the partner is handing the
// customer the keys to their own portal.
//
// The mechanics here are deliberately identical to the members route: service-role
// write, supabase.auth.admin.inviteUserByEmail with a percent-encoded `next`, a
// Resend fallback when the address already has an auth account, reuse of a revoked
// row so the unique index is not violated, and a response that never reveals
// whether an NWI account already existed.

import { NextResponse, type NextRequest } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requirePartner, partnerOwnsAccount, getFleetBranding } from '@/lib/fleet-pro/partner-access'
import { FLEET_PRO_ROLES, ROLE_LABELS } from '@/types/fleet-pro'
import type { FleetProMemberRow, FleetProRole, FleetProStatus } from '@/types/fleet-pro'

export const dynamic = 'force-dynamic'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://tools.nationalwrenchindex.com').replace(/\/$/, '')
const FROM     = 'NWI Fleet Pro <onboarding@resend.dev>'
const INVITE_TTL_DAYS = 14

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

function isEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
}

function isRole(value: unknown): value is FleetProRole {
  return typeof value === 'string' && (FLEET_PRO_ROLES as string[]).includes(value)
}

function toMemberRow(row: MemberRecord): FleetProMemberRow {
  return {
    id:          String(row.id),
    email:       row.email,
    full_name:   row.full_name ?? null,
    role:        row.role as FleetProRole,
    status:      row.status as FleetProStatus,
    invited_at:  row.invited_at ?? null,
    accepted_at: row.accepted_at ?? null,
    // The partner is never a member of his customer's fleet, so no row he creates
    // here can ever be himself.
    is_self:     false,
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))
}

/**
 * Fallback delivery, same as the members route: inviteUserByEmail refuses an
 * address that already has an auth account, which is entirely normal here. Those
 * people do not need a magic link, they need the accept URL. Never throws.
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
    console.warn('[fleet-pro/partner/invite] RESEND_API_KEY not set — invite email skipped')
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
          <p style="color:#ff6600;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">NWI Fleet Pro</p>
          <h2 style="color:#fff;font-size:22px;margin:0 0 16px;">${esc(fleetName)}</h2>
          <p style="color:rgba(255,255,255,0.7);line-height:1.6;margin:0 0 20px;">
            You have been given <strong style="color:#fff;">${esc(ROLE_LABELS[role])}</strong> access to the
            ${esc(fleetName)} fleet portal, where you can see the service, PM schedules and
            inspections performed on your equipment.
          </p>
          <p style="margin:0 0 20px;">
            <a href="${acceptUrl}"
               style="display:inline-block;background:#ff6600;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
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
    console.error('[fleet-pro/partner/invite] invite email failed:', err)
  }
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requirePartner(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { partner } = gate

  // Before anything is read or written. The fleet id comes from the URL, so without
  // this a partner could seat himself — or anyone — onto a rival partner's customer.
  if (!accountId || !(await partnerOwnsAccount(partner.id, accountId))) {
    return NextResponse.json({ error: 'Fleet account not found' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!isEmail(body.email)) {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 })
  }
  const email = body.email.trim().toLowerCase()

  // Defaulted rather than required: this route exists to seat the customer's FIRST
  // manager. An explicitly supplied role is still validated.
  let role: FleetProRole = 'manager'
  if (body.role !== undefined) {
    if (!isRole(body.role)) {
      return NextResponse.json({ error: 'Role must be manager, supervisor or viewer' }, { status: 400 })
    }
    role = body.role
  }

  const fullName = typeof body.full_name === 'string' && body.full_name.trim()
    ? body.full_name.trim().slice(0, 120)
    : null

  const svc = createServiceClient()

  // The invitee is the partner's CUSTOMER, so the email is signed with the brand the
  // partner white-labelled this fleet under, not with the fleet's raw CRM name.
  const branding  = await getFleetBranding(accountId)
  const fleetName = branding.brand_name

  // ── duplicate guard ────────────────────────────────────────────────────────
  // Compared in JS rather than with .ilike() because an email may legitimately
  // contain an underscore, which ilike would treat as a wildcard.
  const { data: existingRows } = await svc
    .from('fleet_pro_members')
    .select('id, email, status')
    .eq('fleet_account_id', accountId)

  const existing = ((existingRows ?? []) as { id: string; email: string; status: string }[])
    .find(r => String(r.email ?? '').toLowerCase() === email)

  if (existing && existing.status !== 'revoked') {
    return NextResponse.json(
      { error: 'That email already has access to this fleet' },
      { status: 409 },
    )
  }

  // ── write the invite ───────────────────────────────────────────────────────
  const token   = crypto.randomUUID()
  const now     = new Date()
  const expires = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000)

  const invitePayload = {
    role,
    full_name:         fullName,
    status:            'invited',
    invite_token:      token,
    invite_expires_at: expires.toISOString(),
    invited_by:        partner.user_id,
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
        .eq('fleet_account_id', accountId)
        .select(MEMBER_COLUMNS)
        .single()
    : svc.from('fleet_pro_members')
        .insert({ ...invitePayload, fleet_account_id: accountId, email })
        .select(MEMBER_COLUMNS)
        .single()

  const { data: member, error: writeError } = await write

  if (writeError || !member) {
    console.error('[fleet-pro/partner/invite] invite write failed:', writeError?.message)
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
    console.warn('[fleet-pro/partner/invite] inviteUserByEmail fell back to direct email:', inviteError.message)
    await sendInviteLinkEmail({ to: email, fleetName, role, acceptUrl })
  }

  // Identical whichever branch ran: the response must never reveal whether this
  // address already had an NWI account.
  return NextResponse.json(
    { member: toMemberRow(member as MemberRecord) },
    { status: 201 },
  )
}
