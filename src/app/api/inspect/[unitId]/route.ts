// GET /api/inspect/[unitId] — public unit header for the driver pre-trip form.
//
// DELIBERATELY UNAUTHENTICATED. There is no driver account in this system; the QR
// sticker on the truck IS the credential, and putting a login between a driver and a
// legally required daily inspection would mean the inspection does not get done.
// A capability URL is only as safe as what it exposes, so this route is written to
// the standard of PUBLIC DATA:
//
//   returns  — unit number, make/model/year, serial, fleet branding, last meter,
//              and the fleet's active driver NAMES (see the note on the roster below)
//   NEVER    — costs, invoices, work orders, customer contacts, fleet member emails,
//              PM state, anything about any OTHER unit, or the fleet_account_id
//
// The fleet_account_id in particular stays server-side: the submit route derives it
// from the unit itself, so nothing downstream needs the browser to know it.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getFleetBranding } from '@/lib/fleet-pro/partner-access'
import { lastKnownOdometer } from '@/lib/fleet-pro/fuel'
import type { PretripUnitInfo } from '@/types/fleet-pro-partner'
import type { FuelRosterDriver } from '@/types/fleet-pro-fuel'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Statuses that take a unit off the road for good. 'out_of_service' is NOT here on
// purpose: a truck being brought back into service still needs a walkaround, and
// refusing the form would push that inspection onto paper or nowhere.
const RETIRED_STATUSES = new Set(['inactive', 'archived', 'retired', 'deleted'])

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Look up everything the pre-trip form needs, or say why not.
 *
 * 'not_found' and a retired unit are the SAME answer on purpose — a scanner walking
 * uuids must not be able to tell "no such unit" from "unit exists but is retired",
 * because the second answer confirms an id.
 *
 * NOTE: /inspect/[unitId]/page.tsx runs the same two queries server-side for the
 * first render. Next refuses non-route exports from a route file, so the shape is
 * repeated there rather than shared; keep the two in step.
 */
async function loadUnitInfo(
  unitId: string,
): Promise<
  | { status: 'ok'; info: PretripUnitInfo; roster: FuelRosterDriver[]; lastOdometer: number | null }
  | { status: 'not_found' }
  | { status: 'unavailable' }
> {
  if (!UUID_RE.test(unitId)) return { status: 'not_found' }

  const svc = createServiceClient()

  const { data: unit, error } = await svc
    .from('hd_units')
    // Only the public-safe columns. fleet_account_id is read to resolve branding and
    // is never put on the response.
    .select('id, unit_number, manufacturer, model, year, serial_number, status, active, total_hours, fleet_account_id')
    .eq('id', unitId)
    .maybeSingle()

  // A database problem must not masquerade as "bad QR code": the page falls back to
  // its cached copy on 'unavailable' but hard-404s on 'not_found'.
  if (error) return { status: 'unavailable' }
  if (!unit) return { status: 'not_found' }
  if (unit.active === false) return { status: 'not_found' }
  if (RETIRED_STATUSES.has(String(unit.status ?? '').toLowerCase())) return { status: 'not_found' }

  const fleetAccountId = (unit.fleet_account_id as string | null) ?? null

  // The driver roster for the fuel screen's "who are you" picker.
  //
  // DELIBERATELY NARROW: id and full_name, active drivers only, and only for a fleet
  // this unit actually belongs to. fleet_pro_drivers also holds CDL numbers, licence
  // states, medical card dates, phones and emails — none of which may cross this
  // boundary. A QR sticker photographed off the side of a parked truck is a public
  // capability, and it must not turn into the carrier's driver list with licence
  // numbers attached. The names alone are what the picker needs, and a driver's name
  // is already written on the inspection he files.
  //
  // The 200 cap is a real bound, not a formality: PostgREST silently truncates an
  // unbounded select, and a dropdown past a couple of hundred names is unusable on a
  // phone anyway — a fleet that large needs a search box, not a longer list.
  const [branding, { data: lastReading }, rosterRes, lastOdometer] = await Promise.all([
    fleetAccountId ? getFleetBranding(fleetAccountId) : Promise.resolve(null),
    svc.from('fleet_pro_unit_meter_readings')
      .select('odometer, engine_hours')
      .eq('unit_id', unitId)
      .order('reading_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    fleetAccountId
      ? svc.from('fleet_pro_drivers')
          .select('id, full_name')
          .eq('fleet_account_id', fleetAccountId)
          .eq('active', true)
          .order('full_name', { ascending: true })
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    // Highest odometer across BOTH meter sources — see lastKnownOdometer. The
    // pre-trip form's last_odometer below stays on the meter table alone so the
    // driver's existing screen is unchanged; the fuel screen needs the stricter
    // figure because it is the floor for the reading he is about to type.
    lastKnownOdometer(svc, unitId),
  ])

  // A roster failure is not a unit failure: the fuel screen falls back to a free-text
  // name box, which is what an off-roster driver uses anyway.
  if (rosterRes.error) {
    console.error('[inspect/[unitId]] driver roster load failed:', rosterRes.error.message)
  }

  const roster: FuelRosterDriver[] = (rosterRes.data ?? []).map(d => ({
    id:        String(d.id),
    full_name: (d.full_name as string | null) ?? '',
  })).filter(d => d.full_name.length > 0)

  return {
    status: 'ok',
    roster,
    lastOdometer,
    info: {
      unit_id:        String(unit.id),
      unit_number:    (unit.unit_number as string | null) ?? '',
      manufacturer:   (unit.manufacturer as string | null) ?? null,
      model:          (unit.model as string | null) ?? null,
      year:           num(unit.year),
      serial_number:  (unit.serial_number as string | null) ?? null,
      brand_name:     branding?.brand_name ?? 'Pre-Trip Inspection',
      brand_logo_url: branding?.brand_logo_url ?? null,
      last_odometer:  num(lastReading?.odometer),
      // hd_units.total_hours is the live figure the shop maintains; the meter history
      // only fills in when the unit has never been written to hd_units.
      last_hours:     num(unit.total_hours) ?? num(lastReading?.engine_hours),
    },
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params

  const result = await loadUnitInfo(unitId)

  if (result.status === 'not_found') {
    // Plain, uninformative 404. Same body for a bad uuid, a missing unit and a
    // retired one.
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (result.status === 'unavailable') {
    return NextResponse.json({ error: 'Temporarily unavailable' }, { status: 503 })
  }

  return NextResponse.json({
    unit:   result.info,
    // Separate top-level keys rather than fields on PretripUnitInfo: that type is the
    // pre-trip form's contract and is shared with the offline queue, and widening it
    // would put a driver roster into every cached inspection payload on every phone.
    roster:        result.roster,
    last_odometer: result.lastOdometer,
  }, {
    headers: {
      // Storable so the service worker can keep a copy for the offline render, but
      // always revalidated when there is signal — a unit's meter reading goes stale
      // every day. Explicitly not `no-store`, which would defeat the offline case.
      'Cache-Control': 'no-cache',
    },
  })
}
