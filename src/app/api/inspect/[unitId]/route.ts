// GET /api/inspect/[unitId] — public unit header for the driver pre-trip form.
//
// DELIBERATELY UNAUTHENTICATED. There is no driver account in this system; the QR
// sticker on the truck IS the credential, and putting a login between a driver and a
// legally required daily inspection would mean the inspection does not get done.
// A capability URL is only as safe as what it exposes, so this route is written to
// the standard of PUBLIC DATA:
//
//   returns  — unit number, make/model/year, serial, fleet branding, last meter
//   NEVER    — costs, invoices, work orders, customer contacts, fleet member emails,
//              PM state, anything about any OTHER unit, or the fleet_account_id
//
// The fleet_account_id in particular stays server-side: the submit route derives it
// from the unit itself, so nothing downstream needs the browser to know it.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getFleetBranding } from '@/lib/fleet-pro/partner-access'
import type { PretripUnitInfo } from '@/types/fleet-pro-partner'

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
  | { status: 'ok'; info: PretripUnitInfo }
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

  const [branding, { data: lastReading }] = await Promise.all([
    fleetAccountId ? getFleetBranding(fleetAccountId) : Promise.resolve(null),
    svc.from('fleet_pro_unit_meter_readings')
      .select('odometer, engine_hours')
      .eq('unit_id', unitId)
      .order('reading_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return {
    status: 'ok',
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

  return NextResponse.json({ unit: result.info }, {
    headers: {
      // Storable so the service worker can keep a copy for the offline render, but
      // always revalidated when there is signal — a unit's meter reading goes stale
      // every day. Explicitly not `no-store`, which would defeat the offline case.
      'Cache-Control': 'no-cache',
    },
  })
}
