// PATCH  /api/fleet-pro/partner/accounts/[accountId] — branding + contact details
// DELETE /api/fleet-pro/partner/accounts/[accountId] — unlink the fleet, nothing more
//
// Both take a fleet account id straight off the URL, so both start with
// partnerOwnsAccount(). That single check is the whole boundary between one
// partner's book of business and another's.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requirePartner, partnerOwnsAccount } from '@/lib/fleet-pro/partner-access'
import type { PartnerAccountRow } from '@/components/fleet-pro/partner/AccountsClient'

export const dynamic = 'force-dynamic'

// Same expression as the CHECK on fleet_pro_reseller_accounts.brand_accent_color.
const ACCENT_HEX = /^#[0-9a-f]{6}$/i

const NOT_FOUND = 'Fleet account not found'

interface ResellerRecord {
  brand_name:         string | null
  brand_logo_url:     string | null
  brand_accent_color: string | null
}

interface AccountRecord {
  fleet_name:        string | null
  contact_name:      string | null
  contact_phone:     string | null
  contact_email:     string | null
  fleet_pro_enabled: boolean | null
  fleet_pro_status:  string | null
}

/** Trimmed, length-capped text. An explicitly blank string clears the field. */
function text(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/**
 * Resolve the caller to a partner AND prove he resells this fleet.
 *
 * Deliberately answers a non-owned account with the same 404 an unknown id gets:
 * a partner probing uuids must not be able to tell "that fleet exists but is
 * someone else's" from "no such fleet".
 */
async function gateAccount(accountId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requirePartner(user?.id ?? null)
  if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error }

  if (!accountId || !(await partnerOwnsAccount(gate.partner.id, accountId))) {
    return { ok: false as const, status: 404, error: NOT_FOUND }
  }
  return { ok: true as const, partner: gate.partner }
}

// ─── PATCH ───────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params

  const gate = await gateAccount(accountId)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { partner } = gate

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const now = new Date().toISOString()

  // ── branding, on the reseller row ──────────────────────────────────────────
  const branding: Record<string, unknown> = {}

  if ('brand_name' in body)     branding.brand_name     = text(body.brand_name, 160)
  if ('brand_logo_url' in body) branding.brand_logo_url = text(body.brand_logo_url, 500)

  if ('brand_accent_color' in body) {
    const raw = body.brand_accent_color
    if (raw === null || raw === '') {
      branding.brand_accent_color = null
    } else if (typeof raw !== 'string' || !ACCENT_HEX.test(raw.trim())) {
      return NextResponse.json(
        { error: 'Accent color must be a 6-digit hex value like #ff6600' },
        { status: 400 },
      )
    } else {
      branding.brand_accent_color = raw.trim().toLowerCase()
    }
  }

  // ── the CRM record, on hd_fleet_accounts ───────────────────────────────────
  const account: Record<string, unknown> = {}

  if ('fleet_name' in body) {
    const fleetName = text(body.fleet_name, 160)
    // NOT NULL in the schema, and it is the fallback label everywhere branding is
    // unset — an empty rename would leave rows with no name at all.
    if (!fleetName) return NextResponse.json({ error: 'A fleet name is required' }, { status: 400 })
    account.fleet_name = fleetName
  }
  if ('contact_name' in body)  account.contact_name  = text(body.contact_name, 120)
  if ('contact_email' in body) account.contact_email = text(body.contact_email, 200)?.toLowerCase() ?? null
  if ('contact_phone' in body) account.contact_phone = text(body.contact_phone, 40)
  if ('address' in body)       account.address       = text(body.address, 400)

  if (Object.keys(branding).length === 0 && Object.keys(account).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const svc = createServiceClient()

  let brandingRow: ResellerRecord | null = null
  if (Object.keys(branding).length > 0) {
    // partner_id is in the filter as well as the fleet_account_id: ownership was
    // already proven above, and this keeps the write itself scoped to his row.
    const { data, error } = await svc
      .from('fleet_pro_reseller_accounts')
      .update({ ...branding, updated_at: now })
      .eq('partner_id', partner.id)
      .eq('fleet_account_id', accountId)
      .select('brand_name, brand_logo_url, brand_accent_color')
      .single()

    if (error || !data) {
      console.error('[fleet-pro/partner/accounts] branding update failed:', error?.message)
      return NextResponse.json({ error: 'Could not save that branding' }, { status: 500 })
    }
    brandingRow = data as ResellerRecord
  }

  let accountRow: AccountRecord | null = null
  if (Object.keys(account).length > 0) {
    const { data, error } = await svc
      .from('hd_fleet_accounts')
      .update(account)
      .eq('id', accountId)
      .select('fleet_name, contact_name, contact_phone, contact_email, fleet_pro_enabled, fleet_pro_status')
      .single()

    if (error || !data) {
      console.error('[fleet-pro/partner/accounts] account update failed:', error?.message)
      return NextResponse.json({ error: 'Could not save those contact details' }, { status: 500 })
    }
    accountRow = data as AccountRecord
  }

  // Only the fields that were actually written come back; the client merges them
  // into the row it already has so unit and member counts survive an edit.
  const patch: Partial<PartnerAccountRow> = {}

  if (brandingRow) {
    // brand_name falls back to the fleet's own name, exactly as getFleetBranding
    // does — clearing the brand must not leave the row with a blank label.
    let fallbackName = accountRow?.fleet_name ?? null
    if (!brandingRow.brand_name && !fallbackName) {
      const { data } = await svc
        .from('hd_fleet_accounts')
        .select('fleet_name')
        .eq('id', accountId)
        .maybeSingle()
      fallbackName = (data?.fleet_name as string | null) ?? null
    }
    patch.brand_name         = brandingRow.brand_name ?? fallbackName ?? 'Unnamed fleet'
    patch.brand_logo_url     = brandingRow.brand_logo_url ?? null
    patch.brand_accent_color = brandingRow.brand_accent_color ?? null
  }
  if (accountRow) {
    patch.fleet_name        = accountRow.fleet_name ?? 'Unnamed fleet'
    patch.contact_name      = accountRow.contact_name ?? null
    patch.contact_email     = accountRow.contact_email ?? null
    patch.contact_phone     = accountRow.contact_phone ?? null
    patch.fleet_pro_enabled = accountRow.fleet_pro_enabled === true
    patch.fleet_pro_status  = accountRow.fleet_pro_status ?? null
  }

  return NextResponse.json({ account: patch })
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params

  const gate = await gateAccount(accountId)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { partner } = gate

  const svc = createServiceClient()

  const { data: account } = await svc
    .from('hd_fleet_accounts')
    .select('id, fleet_name, fleet_pro_enabled, fleet_pro_status')
    .eq('id', accountId)
    .maybeSingle()

  if (!account) return NextResponse.json({ error: NOT_FOUND }, { status: 404 })

  // Unlinking a fleet whose portal is still live would leave a $299/mo subscription
  // running against an account the partner can no longer see, and would black out a
  // customer's portal without cancelling what they are paying for. Cancel first.
  if (account.fleet_pro_enabled === true) {
    return NextResponse.json(
      { error: 'Fleet Pro is still active for this account. Cancel the subscription before unlinking it.' },
      { status: 409 },
    )
  }

  // UNLINK ONLY. The hd_fleet_accounts row stays: it carries the units, work orders,
  // invoices and DOT/inspection history for this customer, some of which is a
  // compliance record with a retention obligation. A mis-click on a partner screen
  // must never be able to destroy it — this deletes the reseller relationship and
  // the white-label settings, and nothing else.
  const { error } = await svc
    .from('fleet_pro_reseller_accounts')
    .delete()
    .eq('partner_id', partner.id)
    .eq('fleet_account_id', accountId)

  if (error) {
    console.error('[fleet-pro/partner/accounts] unlink failed:', error.message)
    return NextResponse.json({ error: 'Could not unlink that fleet account' }, { status: 500 })
  }

  return NextResponse.json({
    unlinked:         true,
    fleet_account_id: accountId,
    fleet_name:       (account.fleet_name as string | null) ?? null,
  })
}
