// GET  /api/fleet-pro/partner/accounts — every fleet account this partner resells
// POST /api/fleet-pro/partner/accounts — create a fleet account and link it to him
//
// The partner layer's book of business. A fleet account is two rows: the CRM record
// on hd_fleet_accounts (which the mechanic owns, and which carries units, work
// orders and inspection history) and the reseller link on
// fleet_pro_reseller_accounts (which owns the relationship and the white labelling).
// Creating a customer writes both; unlinking one deletes only the second.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requirePartner } from '@/lib/fleet-pro/partner-access'
import type { PartnerAccountRow } from '@/components/fleet-pro/partner/AccountsClient'

export const dynamic = 'force-dynamic'

// Mirrors the CHECK on fleet_pro_reseller_accounts.brand_accent_color. Validated
// here so a typo comes back as a 400 the form can show, rather than as a constraint
// violation surfacing to the user as a 500.
const ACCENT_HEX = /^#[0-9a-f]{6}$/i

interface AccountRecord {
  id:                string
  fleet_name:        string | null
  contact_name:      string | null
  contact_phone:     string | null
  contact_email:     string | null
  fleet_pro_enabled: boolean | null
  fleet_pro_status:  string | null
  created_at:        string | null
}

interface ResellerRecord {
  fleet_account_id:   string
  brand_name:         string | null
  brand_logo_url:     string | null
  brand_accent_color: string | null
}

/** Trimmed, length-capped text, or null for anything blank or non-string. */
function text(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requirePartner(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { partner } = gate

  const svc = createServiceClient()

  // The reseller rows ARE the scope of this response. Every id used below comes
  // from this query filtered by partner_id, so no other partner's customer can be
  // reached even if one of the follow-up queries were somehow influenced.
  const { data: resellerRows, error: resellerError } = await svc
    .from('fleet_pro_reseller_accounts')
    .select('fleet_account_id, brand_name, brand_logo_url, brand_accent_color')
    .eq('partner_id', partner.id)

  if (resellerError) {
    console.error('[fleet-pro/partner/accounts] reseller list failed:', resellerError.message)
    return NextResponse.json({ error: 'Could not load your fleet accounts' }, { status: 500 })
  }

  const reseller = (resellerRows ?? []) as ResellerRecord[]
  const ids      = reseller.map(r => r.fleet_account_id)

  if (ids.length === 0) {
    return NextResponse.json({ accounts: [], partner_name: partner.partner_name })
  }

  const [{ data: accountRows }, { data: unitRows }, { data: memberRows }] = await Promise.all([
    svc.from('hd_fleet_accounts')
      .select('id, fleet_name, contact_name, contact_phone, contact_email, fleet_pro_enabled, fleet_pro_status, created_at')
      .in('id', ids),
    svc.from('hd_units')
      .select('id, fleet_account_id')
      .in('fleet_account_id', ids),
    svc.from('fleet_pro_members')
      .select('id, fleet_account_id, status')
      .in('fleet_account_id', ids),
  ])

  const accounts = new Map<string, AccountRecord>()
  for (const row of (accountRows ?? []) as AccountRecord[]) accounts.set(row.id, row)

  const unitCounts = new Map<string, number>()
  for (const row of (unitRows ?? []) as { fleet_account_id: string | null }[]) {
    if (!row.fleet_account_id) continue
    unitCounts.set(row.fleet_account_id, (unitCounts.get(row.fleet_account_id) ?? 0) + 1)
  }

  // Revoked members are kept as a record of who used to have access; counting them
  // here would tell the partner his customer has seats that cannot sign in.
  const memberCounts = new Map<string, number>()
  for (const row of (memberRows ?? []) as { fleet_account_id: string; status: string | null }[]) {
    if (row.status === 'revoked') continue
    memberCounts.set(row.fleet_account_id, (memberCounts.get(row.fleet_account_id) ?? 0) + 1)
  }

  const rows: PartnerAccountRow[] = reseller.map(r => {
    const account = accounts.get(r.fleet_account_id)
    const fleetName = account?.fleet_name ?? 'Unnamed fleet'
    return {
      fleet_account_id:   r.fleet_account_id,
      fleet_name:         fleetName,
      contact_name:       account?.contact_name  ?? null,
      contact_email:      account?.contact_email ?? null,
      contact_phone:      account?.contact_phone ?? null,
      brand_name:         r.brand_name ?? fleetName,
      brand_logo_url:     r.brand_logo_url ?? null,
      brand_accent_color: r.brand_accent_color ?? null,
      fleet_pro_enabled:  account?.fleet_pro_enabled === true,
      fleet_pro_status:   account?.fleet_pro_status ?? null,
      unit_count:         unitCounts.get(r.fleet_account_id) ?? 0,
      member_count:       memberCounts.get(r.fleet_account_id) ?? 0,
      created_at:         account?.created_at ?? null,
    }
  })

  rows.sort((a, b) => a.fleet_name.localeCompare(b.fleet_name))

  return NextResponse.json({ accounts: rows, partner_name: partner.partner_name })
}

// ─── POST ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requirePartner(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { partner } = gate

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const fleetName = text(body.fleet_name, 160)
  if (!fleetName) {
    return NextResponse.json({ error: 'A fleet name is required' }, { status: 400 })
  }

  let accent: string | null = null
  const rawAccent = body.brand_accent_color
  if (rawAccent !== undefined && rawAccent !== null && rawAccent !== '') {
    if (typeof rawAccent !== 'string' || !ACCENT_HEX.test(rawAccent.trim())) {
      return NextResponse.json(
        { error: 'Accent color must be a 6-digit hex value like #ff6600' },
        { status: 400 },
      )
    }
    accent = rawAccent.trim().toLowerCase()
  }

  const svc = createServiceClient()

  // user_id is the PARTNER's user id, never anything from the body: the mechanic
  // owns the CRM record, which is what makes ownsFleetAccount() and every hd_*
  // policy work for him afterwards.
  const { data: account, error: accountError } = await svc
    .from('hd_fleet_accounts')
    .insert({
      user_id:       partner.user_id,
      fleet_name:    fleetName,
      contact_name:  text(body.contact_name, 120),
      contact_email: text(body.contact_email, 200)?.toLowerCase() ?? null,
      contact_phone: text(body.contact_phone, 40),
      notes:         text(body.notes, 2000),
      // Fleet Pro is NOT switched on here, and no charge is made. Billing is a
      // separate, explicit step through /api/fleet-pro/checkout — quietly starting
      // a $299/mo subscription from an "Add fleet account" button would bill a
      // partner for a customer he was only setting up.
      fleet_pro_enabled: false,
    })
    .select('id, fleet_name, contact_name, contact_phone, contact_email, fleet_pro_enabled, fleet_pro_status, created_at')
    .single()

  if (accountError || !account) {
    console.error('[fleet-pro/partner/accounts] account insert failed:', accountError?.message)
    return NextResponse.json({ error: 'Could not create that fleet account' }, { status: 500 })
  }

  const record = account as AccountRecord

  const { data: link, error: linkError } = await svc
    .from('fleet_pro_reseller_accounts')
    .insert({
      partner_id:         partner.id,
      fleet_account_id:   record.id,
      brand_name:         text(body.brand_name, 160) ?? fleetName,
      brand_logo_url:     text(body.brand_logo_url, 500) ?? partner.default_logo_url,
      brand_accent_color: accent,
      notes:              text(body.notes, 2000),
    })
    .select('fleet_account_id, brand_name, brand_logo_url, brand_accent_color')
    .single()

  if (linkError || !link) {
    // Roll the CRM record back. It was created moments ago inside this request, so
    // it cannot yet carry units, work orders or inspections — unlike the DELETE
    // route below, deleting it here destroys nothing. Leaving it would strand an
    // account the partner cannot see or manage from any screen.
    await svc.from('hd_fleet_accounts').delete().eq('id', record.id)
    console.error('[fleet-pro/partner/accounts] reseller link failed:', linkError?.message)
    return NextResponse.json({ error: 'Could not link that fleet account to your partner account' }, { status: 500 })
  }

  const linkRecord = link as ResellerRecord

  const row: PartnerAccountRow = {
    fleet_account_id:   record.id,
    fleet_name:         record.fleet_name ?? fleetName,
    contact_name:       record.contact_name  ?? null,
    contact_email:      record.contact_email ?? null,
    contact_phone:      record.contact_phone ?? null,
    brand_name:         linkRecord.brand_name ?? fleetName,
    brand_logo_url:     linkRecord.brand_logo_url ?? null,
    brand_accent_color: linkRecord.brand_accent_color ?? null,
    fleet_pro_enabled:  false,
    fleet_pro_status:   record.fleet_pro_status ?? null,
    unit_count:         0,
    member_count:       0,
    created_at:         record.created_at ?? null,
  }

  return NextResponse.json({ account: row }, { status: 201 })
}
