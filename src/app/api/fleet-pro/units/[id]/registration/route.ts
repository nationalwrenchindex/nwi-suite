// GET / PUT /api/fleet-pro/units/[id]/registration
//
// The plate record for one unit. Three different people legitimately reach this
// endpoint and they do not share an identity model:
//
//   mechanic owner — hd_units.user_id. Reads and writes; it is his equipment.
//   fleet member   — via requireFleetProMember. Everyone reads, only a manager writes.
//   partner        — the reseller. Not a member of his customers' fleets by design
//                    (see 106), so the member gate turns him away from a page about
//                    his own customer's truck. He gets in on partnerOwnsAccount.
//
// THE TENANT RULE, and the reason this file reads the unit before it does anything
// else: the fleet a unit belongs to is taken from hd_units.fleet_account_id, never
// from the request. A body-supplied fleet id would let a manager of one department
// write a plate onto another department's truck by guessing a uuid.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { getPartner, partnerOwnsAccount } from '@/lib/fleet-pro/partner-access'
import { canEditUnits } from '@/types/fleet-pro'
import { computeRegistrationState, daysUntilExpiration, registrationLabel, todayIso } from '@/lib/fleet-pro/registration'
import { REGISTRATION_LIMITS } from '@/types/fleet-pro-registration'
import type { UnitRegistration, UnitRegistrationPayload } from '@/types/fleet-pro-registration'

export const dynamic = 'force-dynamic'

const COLUMNS =
  'id, unit_id, fleet_account_id, license_plate, jurisdiction, expires_on, annual_cost, notes, updated_at'

// Postgres NUMERIC(10,2) tops out at 99,999,999.99. Rejecting above that here turns
// a 500 from the driver into a 400 the form can actually show.
const MAX_ANNUAL_COST = 99_999_999.99

interface Row { [key: string]: unknown }

/** Who got in, and whether they may write. */
interface RegAccess {
  kind:     'owner' | 'member' | 'partner'
  unitId:   string
  fleetId:  string | null
  canWrite: boolean
}

type AccessResult =
  | { ok: true;  access: RegAccess }
  | { ok: false; status: number; error: string }

// ── helpers ───────────────────────────────────────────────────────────────────

function dayOf(value: unknown): string | null {
  if (!value) return null
  const s = String(value)
  return s.length >= 10 ? s.slice(0, 10) : null
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
}

/** Trim, collapse empty to null, cap length. Used for every text field. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function toRegistration(row: Row | null): UnitRegistration | null {
  if (!row) return null
  return {
    id:               String(row.id),
    unit_id:          String(row.unit_id),
    fleet_account_id: (row.fleet_account_id as string | null) ?? null,
    license_plate:    (row.license_plate as string | null) ?? null,
    jurisdiction:     (row.jurisdiction as string | null) ?? null,
    expires_on:       dayOf(row.expires_on),
    annual_cost:      row.annual_cost == null ? null : Number(row.annual_cost),
    notes:            (row.notes as string | null) ?? null,
    updated_at:       (row.updated_at as string | null) ?? null,
  }
}

/** Row + computed state, the one payload both verbs return. */
function payloadFor(row: Row | null, canWrite: boolean): UnitRegistrationPayload {
  const registration = toRegistration(row)
  const today        = todayIso()
  const expiresOn    = registration?.expires_on ?? null
  return {
    registration,
    state:                 computeRegistrationState(expiresOn, today),
    label:                 registrationLabel(expiresOn, today),
    days_until_expiration: daysUntilExpiration(expiresOn, today),
    can_edit:              canWrite,
  }
}

/**
 * Resolve the caller against this unit. Runs before any registration data is read
 * or written, and is the only thing standing between one fleet and another's plates.
 */
async function resolveAccess(unitId: string, userId: string | null): Promise<AccessResult> {
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' }

  const svc = createServiceClient()

  // Read by id alone — the unit's own fleet_account_id is what every branch below
  // is checked against, so it has to be loaded before there is anything to check.
  // Nothing from this row reaches the response unless a branch below passes.
  const { data } = await svc
    .from('hd_units')
    .select('id, user_id, fleet_account_id')
    .eq('id', unitId)
    .maybeSingle()

  const unit = data as Row | null
  const gate = await requireFleetProMember(userId)

  if (!unit) {
    // Do not leak "this uuid is not a unit" to someone with no Fleet Pro standing
    // at all — they get the membership error they would have got anyway.
    if (!gate.ok) return { ok: false, status: gate.status, error: gate.error }
    return { ok: false, status: 404, error: 'Unit not found' }
  }

  const fleetId = (unit.fleet_account_id as string | null) ?? null

  // 1. The mechanic who owns the equipment.
  if ((unit.user_id as string | null) === userId) {
    return { ok: true, access: { kind: 'owner', unitId, fleetId, canWrite: true } }
  }

  // 2. A member of the fleet this unit actually belongs to. Note the equality check
  //    against the unit's own fleet — membership alone is not enough.
  if (gate.ok && fleetId && gate.membership.fleet_account_id === fleetId) {
    return {
      ok: true,
      access: {
        kind:     'member',
        unitId,
        fleetId,
        // Viewers and supervisors read; only a manager writes. The PUT turns this
        // into the 403.
        canWrite: canEditUnits(gate.membership.role),
      },
    }
  }

  // 3. The partner who resells this fleet. He may write: renewing plates for his
  //    customers is part of the service he bills for, and unlike unit editing there
  //    is no fleet-side record he would be overwriting.
  if (fleetId) {
    const partner = await getPartner(userId)
    if (partner && await partnerOwnsAccount(partner.id, fleetId)) {
      return { ok: true, access: { kind: 'partner', unitId, fleetId, canWrite: true } }
    }
  }

  if (!gate.ok) return { ok: false, status: gate.status, error: gate.error }
  return { ok: false, status: 404, error: 'Unit not found' }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: unitId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const resolved = await resolveAccess(unitId, user?.id ?? null)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  const svc = createServiceClient()
  const { data, error } = await svc
    .from('fleet_pro_unit_registration')
    .select(COLUMNS)
    .eq('unit_id', unitId)
    .maybeSingle()

  if (error) {
    console.error('[fleet-pro/registration] load failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // No row is not an error. The unit simply has no plate on file, which the state
  // calculator reports as 'missing' — a red flag, not an empty section.
  return NextResponse.json(payloadFor(data as Row | null, resolved.access.canWrite))
}

// ── PUT ───────────────────────────────────────────────────────────────────────
// Upserts on unit_id. The unique index from migration 114 is what makes a repeat
// save an edit rather than a duplicate.

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: unitId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const resolved = await resolveAccess(unitId, user?.id ?? null)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  const { access } = resolved
  if (!access.canWrite) {
    return NextResponse.json({ error: 'Fleet manager role required' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // ── validation ──────────────────────────────────────────────────────────────
  const licensePlate = text(body.license_plate, REGISTRATION_LIMITS.license_plate)
  if (typeof body.license_plate === 'string' && body.license_plate.trim().length > REGISTRATION_LIMITS.license_plate) {
    return NextResponse.json(
      { error: `license_plate must be ${REGISTRATION_LIMITS.license_plate} characters or fewer` },
      { status: 400 },
    )
  }

  const jurisdiction = text(body.jurisdiction, REGISTRATION_LIMITS.jurisdiction)
  if (typeof body.jurisdiction === 'string' && body.jurisdiction.trim().length > REGISTRATION_LIMITS.jurisdiction) {
    return NextResponse.json(
      { error: `jurisdiction must be ${REGISTRATION_LIMITS.jurisdiction} characters or fewer` },
      { status: 400 },
    )
  }
  // Matches the CHECK constraint in 114 — a one-character jurisdiction is a typo,
  // and letting it through would fail at the driver with a 500 instead of a 400.
  if (jurisdiction !== null && jurisdiction.length < 2) {
    return NextResponse.json({ error: 'jurisdiction must be at least 2 characters' }, { status: 400 })
  }

  const expiresRaw = body.expires_on
  const expiresOn  = expiresRaw == null || expiresRaw === '' ? null : expiresRaw
  if (expiresOn !== null && !isIsoDate(expiresOn)) {
    return NextResponse.json({ error: 'expires_on must be a valid date (YYYY-MM-DD)' }, { status: 400 })
  }

  const costRaw = body.annual_cost
  let annualCost: number | null = null
  if (costRaw != null && costRaw !== '') {
    const n = Number(costRaw)
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: 'annual_cost must be a number of 0 or more' }, { status: 400 })
    }
    if (n > MAX_ANNUAL_COST) {
      return NextResponse.json({ error: 'annual_cost is too large' }, { status: 400 })
    }
    // Round rather than truncate: NUMERIC(10,2) would round anyway, and rounding
    // here means the value returned matches what was stored.
    annualCost = Math.round(n * 100) / 100
  }

  const notes = text(body.notes, REGISTRATION_LIMITS.notes)
  if (typeof body.notes === 'string' && body.notes.trim().length > REGISTRATION_LIMITS.notes) {
    return NextResponse.json(
      { error: `notes must be ${REGISTRATION_LIMITS.notes} characters or fewer` },
      { status: 400 },
    )
  }

  // ── write ───────────────────────────────────────────────────────────────────
  const svc = createServiceClient()

  // created_by is an insert-only field. An upsert writes every column it is given,
  // so including it unconditionally would rewrite the original author's id on every
  // subsequent save — the manager who last touched the row is not who created it.
  const { data: existing } = await svc
    .from('fleet_pro_unit_registration')
    .select('id')
    .eq('unit_id', unitId)
    .maybeSingle()

  const record: Record<string, unknown> = {
    unit_id:          unitId,
    // From the unit, not the body. See the tenant rule at the top of this file.
    fleet_account_id: access.fleetId,
    license_plate:    licensePlate,
    jurisdiction:     jurisdiction,
    expires_on:       expiresOn as string | null,
    annual_cost:      annualCost,
    notes,
    updated_at:       new Date().toISOString(),
  }
  if (!existing) record.created_by = user?.id ?? null

  const { data, error } = await svc
    .from('fleet_pro_unit_registration')
    .upsert(record, { onConflict: 'unit_id' })
    .select(COLUMNS)
    .single()

  if (error) {
    console.error('[fleet-pro/registration] upsert failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(payloadFor(data as Row, true))
}
