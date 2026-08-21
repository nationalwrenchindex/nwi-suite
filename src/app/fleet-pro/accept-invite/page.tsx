// /fleet-pro/accept-invite?token=… — the one Fleet Pro page a visitor reaches
// without a membership. The layout renders it bare for exactly that reason, so
// everything it needs to look like NWI lives here.
//
// The invite arrives one of two ways: a Supabase magic link that lands on
// /auth/callback and forwards here with a session already established, or a plain
// emailed link for someone who already had an account and signs in first.

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getFleetProMembership } from '@/lib/fleet-pro/access'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/types/fleet-pro'
import type { FleetProRole } from '@/types/fleet-pro'
import { FleetProWordmark, NWI_ORANGE } from '@/components/fleet-pro/brand'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Accept Invitation — NWI Fleet Pro' }

const FP_ORANGE = NWI_ORANGE

// ─── presentation ────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh flex items-center justify-center p-4 sm:p-6">
      <div
        className="max-w-md w-full rounded-xl p-8"
        style={{ background: '#111920', border: '1px solid #1e3040' }}
      >
        <FleetProWordmark className="block text-xs uppercase tracking-widest mb-2 font-semibold" />
        {children}
      </div>
    </main>
  )
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Shell>
      <h1 className="font-condensed font-bold text-2xl text-white tracking-wide mb-3">{title}</h1>
      <div className="text-sm leading-relaxed space-y-3" style={{ color: 'rgba(255,255,255,0.5)' }}>
        {children}
      </div>
    </Shell>
  )
}

// ─── page ────────────────────────────────────────────────────────────────────

interface InviteRecord {
  id:                string
  fleet_account_id:  string
  email:             string
  full_name:         string | null
  role:              string
  status:            string
  invite_expires_at: string | null
  hd_fleet_accounts: { fleet_name: string | null } | null
}

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!token) {
    return (
      <Notice title="INVITATION LINK INCOMPLETE">
        <p>
          This link is missing its invitation token. Open the link straight from the
          email you were sent rather than retyping it, or ask your fleet manager to
          send a fresh invitation.
        </p>
      </Notice>
    )
  }

  const svc = createServiceClient()

  const { data } = await svc
    .from('fleet_pro_members')
    .select(`
      id, fleet_account_id, email, full_name, role, status, invite_expires_at,
      hd_fleet_accounts ( fleet_name )
    `)
    .eq('invite_token', token)
    .maybeSingle()

  const invite = (data ?? null) as InviteRecord | null

  // Accepting clears invite_token, so a spent link and a fabricated one look the
  // same from here. If the visitor already has a live membership, the spent-link
  // reading is the right one — send them into the portal.
  if (!invite) {
    if (user) {
      const membership = await getFleetProMembership(user.id)
      if (membership) redirect('/fleet-pro')
    }
    return (
      <Notice title="INVITATION NOT VALID">
        <p>
          This invitation link has already been used or is no longer valid. If you
          have already accepted it, sign in and you will land in your fleet portal.
        </p>
        <p>
          <Link href="/login?redirect=/fleet-pro" className="font-semibold" style={{ color: FP_ORANGE }}>
            Sign in →
          </Link>
        </p>
      </Notice>
    )
  }

  const fleetName = invite.hd_fleet_accounts?.fleet_name ?? 'this fleet'
  const role      = invite.role as FleetProRole

  if (invite.status === 'revoked') {
    return (
      <Notice title="INVITATION REVOKED">
        <p>
          Access to {fleetName} was withdrawn for this invitation. Contact the fleet
          manager if you believe that was a mistake.
        </p>
      </Notice>
    )
  }

  if (invite.status === 'active') {
    if (user && user.email && user.email.toLowerCase() === invite.email.toLowerCase()) {
      redirect('/fleet-pro')
    }
    return (
      <Notice title="ALREADY ACCEPTED">
        <p>
          This invitation to {fleetName} has already been accepted. Sign in as{' '}
          <span className="text-white">{invite.email}</span> to reach the portal.
        </p>
        <p>
          <Link href="/login?redirect=/fleet-pro" className="font-semibold" style={{ color: FP_ORANGE }}>
            Sign in →
          </Link>
        </p>
      </Notice>
    )
  }

  const expiresAt = invite.invite_expires_at ? Date.parse(invite.invite_expires_at) : NaN
  if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
    return (
      <Notice title="INVITATION EXPIRED">
        <p>
          This invitation to {fleetName} has expired. Ask the fleet manager to send a
          new one — it only takes a moment.
        </p>
      </Notice>
    )
  }

  // ── no session: they have to prove who they are first ──────────────────────
  if (!user) {
    const loginHref = `/login?redirect=${encodeURIComponent(`/fleet-pro/accept-invite?token=${token}`)}`
    return (
      <Shell>
        <h1 className="font-condensed font-bold text-2xl text-white tracking-wide mb-2">
          JOIN {fleetName.toUpperCase()}
        </h1>
        <p className="text-sm leading-relaxed mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>
          You have been invited as <span className="text-white">{ROLE_LABELS[role]}</span>.
        </p>
        <div className="rounded-lg p-3 mb-5" style={{ background: '#162030', border: '1px solid #1e3040' }}>
          <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {ROLE_DESCRIPTIONS[role]}
          </p>
        </div>
        <p className="text-sm leading-relaxed mb-5" style={{ color: 'rgba(255,255,255,0.5)' }}>
          Sign in as <span className="text-white">{invite.email}</span> to accept. You
          will be brought straight back here.
        </p>
        <Link
          href={loginHref}
          className="block text-center px-4 py-3 rounded-lg text-sm font-semibold text-white"
          style={{ background: FP_ORANGE }}
        >
          Sign in to accept
        </Link>
      </Shell>
    )
  }

  // ── session present: the email must match, no exceptions ───────────────────
  // Binding a token to whoever happens to be signed in would let a forwarded
  // invitation hand a stranger the department's service records.
  const sessionEmail = (user.email ?? '').toLowerCase()
  if (sessionEmail !== invite.email.toLowerCase()) {
    return (
      <Notice title="WRONG ACCOUNT">
        <p>
          This invitation was issued to{' '}
          <span className="text-white">{invite.email}</span>, but you are signed in as{' '}
          <span className="text-white">{user.email}</span>.
        </p>
        <p>
          Sign out and sign back in with the invited address, or ask your fleet
          manager to reissue the invitation to the address you use.
        </p>
      </Notice>
    )
  }

  const { error } = await svc
    .from('fleet_pro_members')
    .update({
      user_id:           user.id,
      status:            'active',
      accepted_at:       new Date().toISOString(),
      invite_token:      null,
      invite_expires_at: null,
      full_name:         invite.full_name ?? (user.user_metadata?.full_name as string | null) ?? null,
      updated_at:        new Date().toISOString(),
    })
    .eq('id', invite.id)
    .eq('fleet_account_id', invite.fleet_account_id)

  if (error) {
    console.error('[fleet-pro/accept-invite] bind failed:', error.message)
    return (
      <Notice title="COULD NOT ACCEPT">
        <p>
          Something went wrong finishing your invitation to {fleetName}. Reload this
          page to try again, or ask your fleet manager to reissue the invitation.
        </p>
      </Notice>
    )
  }

  redirect('/fleet-pro')
}
