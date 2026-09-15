// POST /api/fleet-pro/units/[id]/meter — record an odometer / engine-hour reading.
//
// ── WHY THIS ROUTE EXISTS ────────────────────────────────────────────────────
// Cost per mile has a denominator problem: four sources already write meter readings
// (pretrip, work order, PM, invoice), and every one of them depends on somebody
// else doing their job. A trailer that never gets a pre-trip has no mileage at all,
// so its cost per mile reads "—" forever and the unit quietly drops out of the fleet
// average. This is the manager's own way in — he reads the dash and types it.
//
// ── WHAT THIS ROUTE DELIBERATELY DOES NOT DO ─────────────────────────────────
// It does not write hd_units.current_odometer. The trigger from migration 132
// (fleet_pro_sync_unit_odometer) maintains that cache on insert, and doing it here
// as well would mean two writers for one column — the one that eventually disagrees
// with the reading series is the one nobody thinks to check.
//
// ── THE TENANT RULE ──────────────────────────────────────────────────────────
// The fleet is the one on the caller's membership, and the unit must belong to it.
// fleet_account_id is written from that resolved id and never from the body: a
// body-supplied id would let a manager of one department log miles onto another
// department's truck by guessing a uuid.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { canEditUnits } from '@/types/fleet-pro'

export const dynamic = 'force-dynamic'

// NUMERIC(12,1) and NUMERIC(10,2) in migration 106. Rejecting past the column's
// range here turns a driver 500 into a 400 the form can actually show, and catches
// the transposed-digit entry (1,200,000 miles) that would otherwise poison the
// twelve-month span for this unit and drag the whole fleet average with it.
const MAX_ODOMETER     = 9_999_999.9
const MAX_ENGINE_HOURS = 999_999.99

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
}

/** Absent stays absent; present must be a real non-negative number. */
function meterValue(raw: unknown, max: number, label: string): number | null | { error: string } {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return { error: `${label} must be a number of 0 or more` }
  if (n > max) return { error: `${label} is too large` }
  return n
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: unitId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProMember(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { membership } = gate
  // Supervisors read the whole portal including money, but recording a meter reading
  // is a write against the asset record — same bar as editing the unit itself.
  if (!canEditUnits(membership.role)) {
    return NextResponse.json({ error: 'Fleet manager role required' }, { status: 403 })
  }

  const fleetId = membership.fleet_account_id
  const svc     = createServiceClient()

  // THE tenant check, before anything is parsed or written. Scoping the insert by
  // unit_id alone would accept any uuid the caller could guess.
  const { data: unit, error: unitError } = await svc
    .from('hd_units')
    .select('id')
    .eq('id', unitId)
    .eq('fleet_account_id', fleetId)
    .maybeSingle()

  if (unitError) {
    console.error('[fleet-pro/meter] unit lookup failed:', unitError.message)
    return NextResponse.json({ error: unitError.message }, { status: 500 })
  }
  if (!unit) return NextResponse.json({ error: 'Unit not found' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const odometer = meterValue(body.odometer, MAX_ODOMETER, 'odometer')
  if (odometer !== null && typeof odometer === 'object') {
    return NextResponse.json({ error: odometer.error }, { status: 400 })
  }

  const engineHours = meterValue(body.engine_hours, MAX_ENGINE_HOURS, 'engine_hours')
  if (engineHours !== null && typeof engineHours === 'object') {
    return NextResponse.json({ error: engineHours.error }, { status: 400 })
  }

  // A row with neither figure is not a reading. Rejected rather than stored, because
  // an empty reading still lands in the series the cost window walks and would
  // contribute a meaningless date to it.
  if (odometer === null && engineHours === null) {
    return NextResponse.json(
      { error: 'Enter an odometer reading, engine hours, or both' },
      { status: 400 },
    )
  }

  // Defaults to today. A backdated reading is allowed on purpose — catching up a
  // month of missed entries is the normal case — but a future one is not: it would
  // sit outside the rolling window's far end and silently never be counted.
  const rawDate = body.reading_date
  let readingDate = new Date().toISOString().slice(0, 10)
  if (rawDate !== null && rawDate !== undefined && rawDate !== '') {
    if (!isIsoDate(rawDate)) {
      return NextResponse.json({ error: 'reading_date must be a valid date (YYYY-MM-DD)' }, { status: 400 })
    }
    if (rawDate > readingDate) {
      return NextResponse.json({ error: 'reading_date cannot be in the future' }, { status: 400 })
    }
    readingDate = rawDate
  }

  const { data, error } = await svc
    .from('fleet_pro_unit_meter_readings')
    .insert({
      unit_id:          unitId,
      fleet_account_id: fleetId,   // resolved, never from the body — see the header
      reading_date:     readingDate,
      // Rounded to what the columns actually hold, so the value echoed back matches
      // what was stored rather than what was typed.
      odometer:     odometer     === null ? null : Math.round(odometer * 10) / 10,
      engine_hours: engineHours  === null ? null : Math.round(engineHours * 100) / 100,
      // This is the hand-entered source; the other four writers stamp their own.
      source:    'manual',
      source_id: null,
    })
    .select('id, reading_date, odometer, engine_hours, source')
    .single()

  if (error) {
    console.error('[fleet-pro/meter] insert failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // PostgREST hands NUMERIC back as a string; coerced here so the client never has
  // to guess which fields arrive as text.
  return NextResponse.json({
    reading: {
      id:           String(data.id),
      reading_date: String(data.reading_date).slice(0, 10),
      odometer:     data.odometer === null ? null : Number(data.odometer),
      engine_hours: data.engine_hours === null ? null : Number(data.engine_hours),
      source:       String(data.source),
    },
  }, { status: 201 })
}
