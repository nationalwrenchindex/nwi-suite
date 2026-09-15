// POST /api/fleet-pro/compliance/docs
//
// Creates one compliance document row — the record first, the file second (see
// docs/[id]/route.ts for the upload). Splitting it that way means a failed upload
// leaves a dated row the manager can retry against, rather than an orphaned blob in
// the bucket with nothing pointing at it.
//
// THE TENANT RULE, twice over:
//   * fleet_account_id is taken from the caller's membership, never from the body.
//   * the unit or driver named in the body is re-read and checked to belong to THAT
//     fleet before anything is written. Without that check a manager of one department
//     could file a document against another department's truck by guessing a uuid, and
//     the row's own fleet_account_id would happily say it was his.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { canEditUnits } from '@/types/fleet-pro'
import { COMPLIANCE_LIMITS } from '@/types/fleet-pro-compliance'
import { DOC_COLUMNS } from '../calendar'

export const dynamic = 'force-dynamic'

// Mirrors the doc_type CHECK in migration 131. Restated here so a bad value is a 400
// the form can show rather than a 500 out of the driver.
const UNIT_DOC_TYPES   = ['annual_dot_inspection', 'registration', 'irp'] as const
const DRIVER_DOC_TYPES = ['cdl', 'medical_card'] as const
const ALL_DOC_TYPES    = [...UNIT_DOC_TYPES, ...DRIVER_DOC_TYPES, 'other'] as const

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProMember(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership } = gate

  if (!canEditUnits(membership.role)) {
    return NextResponse.json({ error: 'Fleet manager role required' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const docType = typeof body.doc_type === 'string' ? body.doc_type : ''
  if (!(ALL_DOC_TYPES as readonly string[]).includes(docType)) {
    return NextResponse.json({ error: 'Unknown doc_type' }, { status: 400 })
  }

  const unitId   = typeof body.unit_id   === 'string' && body.unit_id   ? body.unit_id   : null
  const driverId = typeof body.driver_id === 'string' && body.driver_id ? body.driver_id : null

  // The XOR from migration 131, enforced here too so the caller gets a sentence
  // instead of a constraint-violation string.
  if ((unitId && driverId) || (!unitId && !driverId)) {
    return NextResponse.json(
      { error: 'A document must reference exactly one unit or one driver' },
      { status: 400 },
    )
  }
  if ((UNIT_DOC_TYPES as readonly string[]).includes(docType) && !unitId) {
    return NextResponse.json({ error: 'That document type belongs to a unit' }, { status: 400 })
  }
  if ((DRIVER_DOC_TYPES as readonly string[]).includes(docType) && !driverId) {
    return NextResponse.json({ error: 'That document type belongs to a driver' }, { status: 400 })
  }

  for (const [field, value] of [['issued_on', body.issued_on], ['expires_on', body.expires_on]] as const) {
    if (value != null && value !== '' && !isIsoDate(value)) {
      return NextResponse.json({ error: `${field} must be a valid date (YYYY-MM-DD)` }, { status: 400 })
    }
  }
  const issuedOn  = body.issued_on  == null || body.issued_on  === '' ? null : String(body.issued_on)
  const expiresOn = body.expires_on == null || body.expires_on === '' ? null : String(body.expires_on)

  if (issuedOn && expiresOn && expiresOn < issuedOn) {
    return NextResponse.json({ error: 'expires_on cannot be before issued_on' }, { status: 400 })
  }

  const svc = createServiceClient()

  // Subject ownership. The unit or driver must be in the caller's own fleet.
  if (unitId) {
    const { data: unit } = await svc
      .from('hd_units')
      .select('id')
      .eq('id', unitId)
      .eq('fleet_account_id', membership.fleet_account_id)
      .maybeSingle()
    if (!unit) return NextResponse.json({ error: 'Unit not found in this fleet' }, { status: 404 })
  } else {
    const { data: driver } = await svc
      .from('fleet_pro_drivers')
      .select('id')
      .eq('id', driverId as string)
      .eq('fleet_account_id', membership.fleet_account_id)
      .maybeSingle()
    if (!driver) return NextResponse.json({ error: 'Driver not found in this fleet' }, { status: 404 })
  }

  const { data, error } = await svc
    .from('fleet_pro_compliance_docs')
    .insert({
      fleet_account_id: membership.fleet_account_id,
      unit_id:          unitId,
      driver_id:        driverId,
      doc_type:         docType,
      issued_on:        issuedOn,
      expires_on:       expiresOn,
      notes:            text(body.notes, COMPLIANCE_LIMITS.notes),
      created_by:       user?.id ?? null,
    })
    .select(DOC_COLUMNS)
    .single()

  if (error) {
    console.error('[fleet-pro/compliance/docs] insert failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ doc: data }, { status: 201 })
}
