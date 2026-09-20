// SERVER-ONLY. Shared shape and validation for the driver incident routes.
//
// A plain module beside route.ts for the reason ../../shared.ts gives: Next.js
// type-checks a route file's export surface, and anything there that is not a handler
// or a route segment option is a build error. The collection route and the
// [incidentId] route both need the same row mapper and the same guard, and two copies
// would let the create form and the resolve form drift.

import { createServiceClient } from '@/lib/supabase/service'
import type { DriverIncident, IncidentType } from '@/types/fleet-pro-drivers'

// One string literal, not a concatenation — the Supabase client parses this at the
// type level and a `string` it cannot read statically degrades the result to an error
// type. Same reason DRIVER_COLUMNS is written this way.
export const INCIDENT_COLUMNS =
  'id, driver_id, incident_date, incident_type, description, resolved, resolution_notes, created_at, updated_at'

/** Explicit cap. PostgREST silently truncates at 1000, and a log that stops at an
 *  arbitrary row without saying so is worse than one that shows a stated 200. */
export const INCIDENT_LIMIT = 200

export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))
}

function dayOf(value: unknown): string | null {
  if (!value) return null
  const s = String(value)
  return s.length >= 10 ? s.slice(0, 10) : null
}

export function toIncident(row: Record<string, unknown>): DriverIncident {
  return {
    id:               String(row.id),
    driver_id:        String(row.driver_id),
    incident_date:    dayOf(row.incident_date) ?? '',
    incident_type:    row.incident_type as IncidentType,
    description:      (row.description as string | null) ?? '',
    resolved:         row.resolved === true,
    resolution_notes: (row.resolution_notes as string | null) ?? null,
    created_at:       (row.created_at as string | null) ?? null,
    updated_at:       (row.updated_at as string | null) ?? null,
  }
}

/**
 * Confirms the driver exists on the caller's fleet before anything touches the
 * incident table.
 *
 * Without it, a request carrying a foreign driver id would be stopped only by the
 * foreign key — surfacing as a 500 with a Postgres message rather than as the 404 the
 * tenant boundary should produce. It also keeps the two routes' failure mode
 * identical, which matters because one of them writes.
 */
export async function driverOnFleet(
  svc:      ReturnType<typeof createServiceClient>,
  driverId: string,
  fleetId:  string,
): Promise<boolean> {
  const { data } = await svc
    .from('fleet_pro_drivers')
    .select('id')
    .eq('id', driverId)
    .eq('fleet_account_id', fleetId)
    .maybeSingle()
  return !!data
}
