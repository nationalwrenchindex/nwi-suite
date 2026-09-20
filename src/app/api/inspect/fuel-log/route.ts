// POST /api/inspect/fuel-log — a driver's fillup, from the QR page.
//
// DELIBERATELY UNAUTHENTICATED, same reasoning as /api/inspect/submit: there is no
// driver account and the sticker on the truck is the capability. Everything the
// browser sends is therefore treated as hostile input:
//
//   * unit_id is looked up before anything is written
//   * fleet_account_id is derived SERVER-SIDE from that unit and never read from the
//     body — otherwise a driver could file fuel into someone else's fleet
//   * driver_id is verified to belong to THAT fleet before it is stored, so a valid
//     uuid from another carrier's roster cannot be pinned to this fillup
//   * every number is clamped to a physical ceiling
//   * mpg is computed here, never accepted from the client
//
// IDEMPOTENCY, same as the pre-trip route. A phone at a truck stop is frequently on
// one bar; the device mints client_uuid once and reuses it for every retry. Unlike
// pre-trip inspections there is no UNIQUE constraint to lean on (migration 133 does
// not add one, because a driver can legitimately fuel the same truck twice in a day
// and a UNIQUE would have to be on a column the client controls), so the replay check
// is an explicit lookup before the insert. That is a narrower guarantee and it is
// called out rather than left to look like the stronger one next door.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { COMPLIANCE_BUCKET } from '@/types/fleet-pro-compliance'
import { computeMpg, lastKnownOdometer } from '@/lib/fleet-pro/fuel'
import {
  FUEL_IMAGE_TYPES,
  MAX_DRIVER_NAME_CHARS,
  MAX_FUEL_COST,
  MAX_FUEL_IMAGE_BYTES,
  MAX_GALLONS,
  MAX_ODOMETER,
  MAX_PRICE_PER_GALLON,
  type FuelImageType,
} from '@/types/fleet-pro-fuel'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const RETIRED_STATUSES = new Set(['inactive', 'archived', 'retired', 'deleted'])

const MAX_REQUEST_BYTES = MAX_FUEL_IMAGE_BYTES + 512 * 1024

// A queued fillup can be a day or two old before it finds signal. Beyond a month it is
// not a fillup being logged, it is history being rewritten, and a future date is
// always wrong (one day of slack for a phone in another timezone).
const MAX_BACKDATE_DAYS = 30
const MAX_FUTURE_DAYS   = 1

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function dayOffset(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function fuelDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return today()
  if (Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())) return today()
  if (value < dayOffset(-MAX_BACKDATE_DAYS)) return today()
  if (value > dayOffset(MAX_FUTURE_DAYS)) return today()
  return value
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/** Non-negative, finite, clamped and rounded, or null. Never NaN, never negative —
 *  a negative gallons figure would produce a negative MPG and poison the average. */
function fuelNum(value: unknown, max: number, decimals: number): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  if (n > max) return null
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}

function magicMatches(bytes: Uint8Array, declared: FuelImageType): boolean {
  if (declared === 'image/png') {
    return bytes.length > 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  }
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

export async function POST(req: NextRequest) {
  // Size before the body is touched, same as the extractor.
  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return bad('That submission is too large.', 413)
  }

  // multipart rather than JSON: the pump photo rides along with the figures, so the
  // fillup and its evidence land in one atomic-ish request rather than two that can
  // half-fail.
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return bad('Could not read the submission')
  }

  const unitId = String(form.get('unit_id') ?? '')
  if (!UUID_RE.test(unitId)) return bad('Not found', 404)

  const clientUuidRaw = String(form.get('client_uuid') ?? '')
  const clientUuid = UUID_RE.test(clientUuidRaw) ? clientUuidRaw : null

  const svc = createServiceClient()

  // ── the unit, and the fleet it belongs to ───────────────────────────────────
  // Existence check BEFORE any write, and the source of truth for the fleet.
  const { data: unit, error: unitErr } = await svc
    .from('hd_units')
    .select('id, fleet_account_id, status, active')
    .eq('id', unitId)
    .maybeSingle()

  if (unitErr) return bad('Temporarily unavailable', 503)
  if (!unit) return bad('Not found', 404)
  if (unit.active === false) return bad('Not found', 404)
  if (RETIRED_STATUSES.has(String(unit.status ?? '').toLowerCase())) return bad('Not found', 404)

  const fleetAccountId = (unit.fleet_account_id as string | null) ?? null

  // ── replay check ────────────────────────────────────────────────────────────
  // Before anything is written or uploaded. A retry from a phone that already
  // succeeded must not produce a second fillup — that would halve the apparent MPG
  // of the next reading and put a phantom tank of fuel into the unit's cost.
  if (clientUuid) {
    const { data: existing } = await svc
      .from('fleet_pro_fuel_log')
      .select('id, mpg, miles_driven')
      .eq('client_uuid', clientUuid)
      .limit(1)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({
        ok:        true,
        duplicate: true,
        id:        String(existing.id),
        mpg:       existing.mpg === null ? null : Number(existing.mpg),
        miles:     existing.miles_driven === null ? null : Number(existing.miles_driven),
      })
    }
  }

  // ── driver identity ─────────────────────────────────────────────────────────
  // driver_id is accepted from the body but VERIFIED against this unit's fleet before
  // it is stored. Without that check a driver uuid belonging to another carrier —
  // which is guessable only with difficulty, but is still client-supplied — would
  // attach this fillup to a stranger's scorecard.
  const driverName = str(form.get('driver_name'), MAX_DRIVER_NAME_CHARS)
  const driverIdRaw = String(form.get('driver_id') ?? '')
  let driverId: string | null = null

  if (UUID_RE.test(driverIdRaw) && fleetAccountId) {
    const { data: driver } = await svc
      .from('fleet_pro_drivers')
      .select('id')
      .eq('id', driverIdRaw)
      .eq('fleet_account_id', fleetAccountId)
      .eq('active', true)
      .maybeSingle()
    driverId = driver ? String(driver.id) : null
  }

  // ── the figures ─────────────────────────────────────────────────────────────
  // Zero gallons is not a fillup, and migration 133 enforces gallons > 0 — so a 0 that
  // reached the insert would 500 rather than being quietly ignored. Normalized to null
  // here: a driver who typed 0 by accident still gets his odometer and photo saved.
  const gallonsRaw     = fuelNum(form.get('gallons'),          MAX_GALLONS,          3)
  const gallons        = gallonsRaw !== null && gallonsRaw > 0 ? gallonsRaw : null
  const totalCost      = fuelNum(form.get('total_cost'),       MAX_FUEL_COST,        2)
  const pricePerGallon = fuelNum(form.get('price_per_gallon'), MAX_PRICE_PER_GALLON, 3)
  const odometerEnd    = fuelNum(form.get('odometer_end'),     MAX_ODOMETER,         1)
  const date           = fuelDate(form.get('fuel_date'))

  // The start odometer is resolved SERVER-SIDE from the unit's own history, not taken
  // from the body. The client pre-populates a value for display, but trusting it would
  // let a driver widen his own span and manufacture an MPG figure.
  const odometerStart = await lastKnownOdometer(svc, unitId)

  // A reading below the previous one is a typo or the trip meter. Refused with a
  // message rather than silently stored, because the driver is standing there and can
  // fix it in five seconds — and because a rejected fillup he re-enters is worth more
  // than a saved one with a broken span.
  if (odometerEnd !== null && odometerStart !== null && odometerEnd < odometerStart) {
    return bad(
      `That odometer is lower than this unit's last reading (${odometerStart.toLocaleString()}). Check the hub meter and try again.`,
      422,
    )
  }

  const { miles, mpg } = computeMpg(odometerStart, odometerEnd, gallons)

  // ── the photo ───────────────────────────────────────────────────────────────
  // Uploaded only after every validation above has passed, so a rejected submission
  // never leaves a file behind. Unlike the unauthenticated invoice flow — which
  // deliberately does not store its photo — the pump image is kept: it is the only
  // evidence behind a fuel figure that feeds cost per mile, and a manager disputing a
  // fillup months later has nothing else to look at.
  let pumpImagePath: string | null = null
  const file = form.get('image')

  if (file instanceof File && file.size > 0) {
    const declaredType = file.type as FuelImageType
    if (!(FUEL_IMAGE_TYPES as readonly string[]).includes(declaredType)) {
      return bad('Photos must be JPEG or PNG. Use your phone camera.', 415)
    }
    if (file.size > MAX_FUEL_IMAGE_BYTES) {
      return bad('That photo is too large. Take it again at normal quality.', 413)
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!magicMatches(bytes, declaredType)) {
      return bad('That file is not a photo. Use your phone camera.', 415)
    }

    // Fleet-scoped path, matching the compliance-doc convention. Nothing reads this
    // bucket by prefix today, but it is what any future storage policy would key on
    // and a flat namespace could not be retrofitted without moving every object.
    const ext  = declaredType === 'image/png' ? 'png' : 'jpg'
    const path = `${fleetAccountId ?? 'unassigned'}/fuel/${unitId}/${Date.now()}.${ext}`

    const { error: uploadErr } = await svc.storage
      .from(COMPLIANCE_BUCKET)
      .upload(path, file, { contentType: declaredType, upsert: false })

    if (uploadErr) {
      // NON-FATAL, deliberately. The fillup is the record; the photo is corroboration.
      // A driver at a pump with a flaky connection should not lose his gallons and
      // odometer because an image upload timed out.
      console.error('[inspect/fuel-log] pump image upload failed:', uploadErr.message)
    } else {
      pumpImagePath = path
    }
  }

  // ── the write ───────────────────────────────────────────────────────────────
  const insertRow = {
    unit_id:          unitId,
    fleet_account_id: fleetAccountId,
    driver_id:        driverId,
    driver_name:      driverName,
    fuel_date:        date,
    gallons,
    total_cost:       totalCost,
    price_per_gallon: pricePerGallon,
    odometer_start:   odometerStart,
    odometer_end:     odometerEnd,
    miles_driven:     miles,
    mpg,
    pump_image_url:   pumpImagePath,
    client_uuid:      clientUuid,
  }

  const { data: inserted, error: insertErr } = await svc
    .from('fleet_pro_fuel_log')
    .insert(insertRow)
    .select('id, mpg')
    .single()

  if (insertErr) {
    // 23505 on the partial unique index: two retries raced and the other one won.
    // That is SUCCESS here, not an error — returning a failure is what turns one
    // dead-zone fillup into the driver submitting it a third time.
    if (insertErr.code === '23505' && clientUuid) {
      const { data: existing } = await svc
        .from('fleet_pro_fuel_log')
        .select('id, mpg, miles_driven')
        .eq('client_uuid', clientUuid)
        .maybeSingle()

      return NextResponse.json({
        ok:        true,
        duplicate: true,
        id:        existing ? String(existing.id) : null,
        mpg:       existing?.mpg === null || existing?.mpg === undefined ? null : Number(existing.mpg),
        miles:     existing?.miles_driven === null || existing?.miles_driven === undefined ? null : Number(existing.miles_driven),
      })
    }
    console.error('[inspect/fuel-log] insert failed:', insertErr.message)
    return bad('Could not save the fuel log', 500)
  }

  const fuelLogId = String(inserted.id)

  // ── meter history ───────────────────────────────────────────────────────────
  // The reason this route matters beyond fuel. fleet_pro_unit_meter_readings is what
  // cost-per-mile reads to find a span, and it is currently empty for most fleets
  // because it only ever filled from pre-trips. A fillup carries a hub reading from a
  // driver who is looking straight at it, several times a week.
  //
  // Non-fatal: the fillup is already saved and is the thing the driver was asked for.
  if (odometerEnd !== null) {
    const { error: meterErr } = await svc.from('fleet_pro_unit_meter_readings').insert({
      unit_id:          unitId,
      fleet_account_id: fleetAccountId,
      reading_date:     date,
      odometer:         odometerEnd,
      engine_hours:     null,
      source:           'fuel',
      source_id:        fuelLogId,
    })
    if (meterErr) console.error('[inspect/fuel-log] meter reading failed:', meterErr.message)
  }

  return NextResponse.json({
    ok:        true,
    duplicate: false,
    id:        fuelLogId,
    // Echoed so the driver's "saved" screen can show what his tank actually did.
    // null is a real answer on a first fillup and the client says so in words.
    mpg:       inserted.mpg === null ? null : Number(inserted.mpg),
    miles,
  })
}
