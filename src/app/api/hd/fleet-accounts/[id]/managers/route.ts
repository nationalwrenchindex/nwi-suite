// /api/hd/fleet-accounts/[id]/managers - the shop invites, lists and removes the
// fleet managers of ONE of its fleet accounts.
//
//   GET     the managers holding a grant on this account
//   POST    { email }   invite (or seat an existing login) and email the link
//   DELETE  ?user_id=   remove the grant - access ends on his next request
//
// THE GRANT is app_metadata.fleet_manager on the manager's auth user (see
// lib/fleet-view/access for why it is not a fleet_pro_members row: migration 105 would
// hand that row every invoice's money). No table, so no migration.
//
// THE LINK is built here from the invite's hashed token and THIS deployment's origin,
// and it lands on /fleet-manager/accept - a page with a button, so a mail scanner
// prefetching the link cannot spend it. After it he sets his own password.
//
// Not sent to a reserved test domain (example.com/.net/.org, *.test, *.invalid,
// *.example - RFC 2606): those can never be delivered, and the smoke suite invites one
// on every run.

import { NextResponse, type NextRequest } from 'next/server'
import { Resend } from 'resend'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkHDStarterAccess, reeferStandaloneCan } from '@/lib/hd-access'
import { FLEET_MANAGER_KEY, grantOf } from '@/lib/fleet-view/access'

export const dynamic = 'force-dynamic'

const FROM = process.env.INVOICE_FROM_EMAIL ?? 'invoices@nationalwrenchindex.com'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** RFC 2606 / 6761 reserved names: never deliverable, so never sent to. */
function isReservedTestAddress(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  return /^example\.(com|net|org)$/.test(domain) || /\.(test|invalid|example|localhost)$/.test(domain)
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}

type Gate = { ok: true; userId: string; fleetName: string; shopName: string } | { ok: false; res: NextResponse }

async function gate(fleetAccountId: string): Promise<Gate> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const can = (await checkHDStarterAccess(user.id)) || (await reeferStandaloneCan(user.id, 'reefer_customers'))
  if (!can) return { ok: false, res: NextResponse.json({ error: 'HD subscription required' }, { status: 403 }) }
  // Ownership on the account itself: another shop's account id is "not found".
  const { data: acct } = await supabase.from('hd_fleet_accounts').select('id, fleet_name')
    .eq('id', fleetAccountId).eq('user_id', user.id).maybeSingle()
  if (!acct) return { ok: false, res: NextResponse.json({ error: 'Fleet account not found.' }, { status: 404 }) }
  const { data: prof } = await supabase.from('profiles').select('business_name').eq('id', user.id).maybeSingle()
  return { ok: true, userId: user.id, fleetName: String(acct.fleet_name ?? ''), shopName: String(prof?.business_name ?? 'Your service shop') }
}

/** Every auth user holding a grant on this account. Paged: GoTrue lists at most 1,000 a page. */
async function managersOf(fleetAccountId: string, shopUserId: string): Promise<User[]> {
  const svc = createServiceClient()
  const out: User[] = []
  for (let page = 1; page < 50; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(error.message)
    for (const u of data.users) {
      const g = grantOf(u)
      if (g && g.fleet_account_id === fleetAccountId && g.shop_user_id === shopUserId) out.push(u)
    }
    if (data.users.length < 1000) break
  }
  return out
}

const view = (u: User) => ({
  user_id: u.id,
  email: u.email ?? null,
  granted_at: grantOf(u)?.granted_at ?? null,
  // Has he finished: signed in at least once since the link.
  signed_in: !!u.last_sign_in_at,
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gate(id)
  if (!g.ok) return g.res
  const list = await managersOf(id, g.userId)
  return NextResponse.json({ managers: list.map(view) })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gate(id)
  if (!g.ok) return g.res
  const body = await req.json().catch(() => ({})) as { email?: unknown }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Enter the fleet manager\'s email address.' }, { status: 400 })

  const svc = createServiceClient()
  const origin = req.nextUrl.origin
  // A new address gets an invite (creates the login, no password yet). An address that
  // already has a login gets a sign-in link instead; either way he lands on set-password.
  let type: 'invite' | 'magiclink' = 'invite'
  let gen = await svc.auth.admin.generateLink({ type: 'invite', email })
  if (gen.error) {
    type = 'magiclink'
    gen = await svc.auth.admin.generateLink({ type: 'magiclink', email })
  }
  const target = gen.data?.user
  const hashed = gen.data?.properties?.hashed_token
  if (gen.error || !target || !hashed) {
    console.error('[hd/fleet-accounts/managers] generateLink failed:', gen.error?.message)
    return NextResponse.json({ error: 'Could not create the invitation. Try again.' }, { status: 500 })
  }
  if (target.id === g.userId) {
    return NextResponse.json({ error: 'That is your own login. Invite the fleet manager\'s address.' }, { status: 400 })
  }
  const existing = grantOf(target)
  if (existing && (existing.fleet_account_id !== id || existing.shop_user_id !== g.userId)) {
    return NextResponse.json({ error: 'That login is already a fleet manager for another fleet account. Use a different address.' }, { status: 409 })
  }

  const grant = { fleet_account_id: id, shop_user_id: g.userId, granted_at: existing?.granted_at || new Date().toISOString() }
  const upd = await svc.auth.admin.updateUserById(target.id, {
    app_metadata: { ...(target.app_metadata ?? {}), [FLEET_MANAGER_KEY]: grant },
  })
  if (upd.error) {
    console.error('[hd/fleet-accounts/managers] grant failed:', upd.error.message)
    return NextResponse.json({ error: 'Could not grant access. Try again.' }, { status: 500 })
  }

  const link = `${origin}/fleet-manager/accept?token_hash=${encodeURIComponent(hashed)}&type=${type}`
  let emailSent = false
  if (isReservedTestAddress(email)) {
    // Never deliverable; see the header.
  } else if (!process.env.RESEND_API_KEY) {
    console.warn('[hd/fleet-accounts/managers] RESEND_API_KEY not set - invite email skipped')
  } else {
    try {
      const r = await new Resend(process.env.RESEND_API_KEY).emails.send({
        from: FROM, to: email,
        subject: `${g.shopName} shared your fleet's service history`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
          <h2 style="margin:0 0 12px">${esc(g.fleetName)}</h2>
          <p style="line-height:1.6;margin:0 0 16px">${esc(g.shopName)} has given you access to your fleet's units,
          PM due dates, repair history and PM and DOT sheets.</p>
          <p style="margin:0 0 16px"><a href="${link}" style="display:inline-block;background:#E85D24;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Set your password</a></p>
          <p style="font-size:12px;color:#555;line-height:1.6;margin:0">The link works once. After that, sign in at ${esc(origin)}/fleet-manager/login with this email address and your password.</p>
        </div>`,
      })
      emailSent = !r.error
      if (r.error) console.error('[hd/fleet-accounts/managers] invite email failed:', r.error.message)
    } catch (err) {
      console.error('[hd/fleet-accounts/managers] invite email failed:', err)
    }
  }
  return NextResponse.json({ manager: view(upd.data.user), email_sent: emailSent, existing_login: type === 'magiclink' }, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const g = await gate(id)
  if (!g.ok) return g.res
  const userId = req.nextUrl.searchParams.get('user_id') ?? ''
  const svc = createServiceClient()
  const { data, error } = await svc.auth.admin.getUserById(userId)
  const grant = grantOf(data?.user)
  // Only a grant this shop gave on this account can be removed from here.
  if (error || !data?.user || !grant || grant.fleet_account_id !== id || grant.shop_user_id !== g.userId) {
    return NextResponse.json({ error: 'That fleet manager was not found on this account.' }, { status: 404 })
  }
  const meta = { ...(data.user.app_metadata ?? {}) } as Record<string, unknown>
  // null, not delete: GoTrue MERGES app_metadata, so an absent key would survive.
  meta[FLEET_MANAGER_KEY] = null
  const upd = await svc.auth.admin.updateUserById(userId, { app_metadata: meta })
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 })
  return NextResponse.json({ removed: true })
}
