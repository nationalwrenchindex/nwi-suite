// /inspect/[unitId] — the page behind the QR sticker on the truck.
//
// PUBLIC. No session, no nav, no Fleet Pro layout: this is a driver standing in a
// yard at 5am holding a phone in one hand, and every chrome element that is not the
// checklist is in the way. The root layout renders nothing but <body>, so this page
// is the whole screen.
//
// The unit header is fetched server-side so the FIRST (online) scan is useful
// immediately. After that the service worker serves this page from cache and the
// client falls back to its own localStorage copy — which is why the fetch below can
// fail without breaking anything.

import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { getFleetBranding } from '@/lib/fleet-pro/partner-access'
import PretripClient from '@/components/inspect/PretripClient'
import type { PretripUnitInfo } from '@/types/fleet-pro-partner'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Pre-Trip Inspection' }

// Full-bleed on a phone, and the browser chrome matches the page rather than flashing
// white over a dark form.
export const viewport = {
  width:        'device-width',
  initialScale: 1,
  themeColor:   '#0a0f14',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Kept in step with GET /api/inspect/[unitId]. 'out_of_service' is deliberately absent
// — a unit coming back into service still gets a walkaround.
const RETIRED_STATUSES = new Set(['inactive', 'archived', 'retired', 'deleted'])

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Same query and the same public-data discipline as GET /api/inspect/[unitId]: unit
 * identity and branding only, never costs, contacts or other units. Next rejects
 * non-route exports from a route file, so the shape is repeated here rather than
 * imported — keep the two in step.
 */
async function loadUnitInfo(
  unitId: string,
): Promise<
  | { status: 'ok'; info: PretripUnitInfo }
  | { status: 'not_found' }
  | { status: 'unavailable' }
> {
  if (!UUID_RE.test(unitId)) return { status: 'not_found' }

  try {
    const svc = createServiceClient()

    const { data: unit, error } = await svc
      .from('hd_units')
      .select('id, unit_number, manufacturer, model, year, serial_number, status, active, total_hours, fleet_account_id')
      .eq('id', unitId)
      .maybeSingle()

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
        last_hours:     num(unit.total_hours) ?? num(lastReading?.engine_hours),
      },
    }
  } catch {
    // Env missing, Supabase unreachable, anything: an infrastructure failure must not
    // present as "bad QR code". Fall through to the client's cached copy.
    return { status: 'unavailable' }
  }
}

export default async function InspectPage({ params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params

  const result = await loadUnitInfo(unitId)

  // A genuinely unknown id is a bad sticker and should say so. A backend outage is
  // NOT a 404 — the client still renders and the driver can still complete the
  // inspection offline against the unit id in the URL.
  if (result.status === 'not_found') notFound()

  return (
    <PretripClient
      unitId={unitId}
      initialUnit={result.status === 'ok' ? result.info : null}
    />
  )
}
