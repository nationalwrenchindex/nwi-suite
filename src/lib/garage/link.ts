// Links a sent NWI Suite invoice to the customer's NWI Garage.
//
// NWI Garage lives in the same Supabase project (krjzvlvnviyyxolxjqdo) but is a
// separate product with its own tables. Two things about that shape drive this
// file:
//
//   • The service record goes in `garage_service_history`, NOT the `service_history`
//     table in this app. That one is the mechanic's own record, keyed
//     vehicle_id -> vehicles -> customers; writing there would file the repair
//     under the shop's records where the car owner can never see it. The Garage
//     table keys vehicle_id -> garage_vehicles and carries its own user_id.
//
//   • There is no garage_users table. An account exists only if the email maps
//     to an auth user AND that user has a `garage_profiles` row — every mechanic
//     on the Suite also has an auth user, so the auth hit alone proves nothing.
//
// Failures here never block sending an invoice. The invoice is the product; the
// garage post is a bonus.

import { createServiceClient } from '@/lib/supabase/service'

const GARAGE_JOIN_URL = process.env.NWI_GARAGE_JOIN_URL ?? 'https://nwigarage.com/join'

export interface InvoiceVehicle {
  vin:     string | null
  year:    number | null
  make:    string | null
  model:   string | null
  mileage: number | null
}

export interface GarageSyncInput {
  invoiceId:     string
  customerEmail: string | null
  vehicle:       InvoiceVehicle | null
  mechanicName:  string
  mechanicPhone: string | null
  /** Free text from the invoice lines; categorised before it reaches BD. */
  serviceType:   string
  notes:         string | null
  cost:          number | null
  serviceDate:   string          // YYYY-MM-DD
}

/**
 * garage_service_history.service_type is not free text — a CHECK constraint
 * (garage_service_history_type) restricts it to a fixed vocabulary, and an
 * invoice line description like "Labor — Tire Rotation" fails it with 23514.
 *
 * Established empirically against the live table; the Garage product owns this
 * list and does not publish it. 'electrical' is accepted too but nothing in an
 * invoice maps to it reliably, so it is not inferred.
 */
const GARAGE_SERVICE_TYPES = ['oil_change', 'tires', 'brakes', 'transmission', 'diagnostics', 'other'] as const
type GarageServiceType = typeof GARAGE_SERVICE_TYPES[number]

/** First category whose keywords appear in the invoice text; 'other' otherwise. */
export function categoriseService(freeText: string): GarageServiceType {
  const t = freeText.toLowerCase()
  const rules: Array<[GarageServiceType, RegExp]> = [
    ['oil_change',   /\boil\b|lube|oil change|filter change/],
    ['brakes',       /\bbrake|rotor|caliper|brake pad/],
    ['tires',        /\btire|wheel|rotation|balance|tpms|alignment/],
    ['transmission', /transmission|clutch|differential|drivetrain/],
    ['diagnostics',  /diagnos|scan|check engine|fault code|inspection/],
  ]
  for (const [type, re] of rules) if (re.test(t)) return type
  return 'other'
}

export type GarageSyncResult =
  | { linked: true;  posted: boolean; nwiGarageId: string | null; reason?: string }
  | { linked: false; joinUrl: string }

/**
 * Resolves an email to a Garage account.
 *
 * Uses GoTrue's admin filter rather than paginating listUsers — verified to
 * return the exact match, so this stays O(1) as the user table grows.
 */
async function findGarageUser(email: string): Promise<{ userId: string; nwiGarageId: string | null } | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return null

  let userId: string | null = null
  try {
    const res = await fetch(`${base}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal:  AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const json = await res.json() as { users?: Array<{ id: string; email: string }> }
    // The filter is a search, not an equality test — confirm the address.
    const hit = (json.users ?? []).find(u => u.email?.toLowerCase() === email.toLowerCase())
    userId = hit?.id ?? null
  } catch {
    return null
  }
  if (!userId) return null

  // An auth user is not a Garage user. Mechanics have auth accounts too.
  const { data } = await createServiceClient()
    .from('garage_profiles')
    .select('user_id, nwi_garage_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (!data) return null
  return { userId, nwiGarageId: (data.nwi_garage_id as string | null) ?? null }
}

/**
 * Compact signup link for SMS: VIN only, protocol stripped.
 *
 * The full email link carries five params and runs ~110 characters, which would
 * add a segment to every invoice text. VIN alone is enough for the join page to
 * identify the vehicle, and handsets linkify a bare domain fine.
 */
export function buildGarageJoinSmsLink(vin: string): string {
  const host = GARAGE_JOIN_URL.replace(/^https?:\/\//, '')
  return `${host}?vin=${encodeURIComponent(vin)}`
}

/** Pre-populated signup link for customers who have no Garage account yet. */
export function buildGarageJoinUrl(vehicle: InvoiceVehicle | null): string {
  const params = new URLSearchParams()
  if (vehicle?.vin)     params.set('vin', vehicle.vin)
  if (vehicle?.year)    params.set('year', String(vehicle.year))
  if (vehicle?.make)    params.set('make', vehicle.make)
  if (vehicle?.model)   params.set('model', vehicle.model)
  if (vehicle?.mileage) params.set('mileage', String(vehicle.mileage))
  const qs = params.toString()
  return qs ? `${GARAGE_JOIN_URL}?${qs}` : GARAGE_JOIN_URL
}

/**
 * Finds the customer's garage vehicle, creating it from the invoice when the
 * VIN is not already there — the whole point is that the customer does nothing.
 *
 * VIN is the match key when present. Without one, year+make+model is the best
 * available, and is scoped to this user so a collision only ever merges two of
 * their own identical vehicles.
 */
async function findOrCreateGarageVehicle(
  userId: string,
  vehicle: InvoiceVehicle,
): Promise<{ id: string; created: boolean; mileage: number | null } | null> {
  const svc = createServiceClient()

  let query = svc.from('garage_vehicles').select('id, mileage').eq('user_id', userId)
  query = vehicle.vin
    ? query.eq('vin', vehicle.vin)
    : query.eq('year', vehicle.year).eq('make', vehicle.make).eq('model', vehicle.model)

  const { data: existing } = await query.limit(1).maybeSingle()
  if (existing) return { id: existing.id as string, created: false, mileage: (existing.mileage as number | null) ?? null }

  const { data: inserted, error } = await svc
    .from('garage_vehicles')
    .insert({
      user_id: userId,
      vin:     vehicle.vin,
      year:    vehicle.year,
      make:    vehicle.make,
      model:   vehicle.model,
      mileage: vehicle.mileage,
      ...(vehicle.mileage ? { mileage_updated_at: new Date().toISOString() } : {}),
    })
    .select('id')
    .single()

  if (error) {
    console.error('[garage/link] could not create garage vehicle:', error.message)
    return null
  }
  return { id: inserted.id as string, created: true, mileage: vehicle.mileage }
}

/**
 * Posts a sent invoice to the customer's garage.
 *
 * Returns `linked: false` with a pre-populated join URL when there is no
 * account, so the caller can put the signup button in the invoice email.
 */
export async function syncInvoiceToGarage(input: GarageSyncInput): Promise<GarageSyncResult> {
  const notLinked: GarageSyncResult = { linked: false, joinUrl: buildGarageJoinUrl(input.vehicle) }

  if (!input.customerEmail) return notLinked

  const account = await findGarageUser(input.customerEmail.trim().toLowerCase())
  if (!account) return notLinked

  // Everything below is best-effort: the account exists, so the email should say
  // so even if the write fails — we just do not claim a record we did not create.
  const svc = createServiceClient()

  const { data: invoice, error: guardErr } = await svc
    .from('invoices')
    .select('garage_posted_at')
    .eq('id', input.invoiceId)
    .maybeSingle()

  if (guardErr) {
    // Almost always migration 097 not applied. Posting without the guard would
    // duplicate the service record on every resend — invoices.times_sent
    // increments freely — and there is no invoice reference on
    // garage_service_history to deduplicate against afterwards. Refuse instead.
    console.error(
      `[garage/link] no idempotency guard, refusing to post invoice ${input.invoiceId} ` +
      `(is migration 097 applied?): ${guardErr.message}`,
    )
    return { linked: true, posted: false, nwiGarageId: account.nwiGarageId, reason: 'guard column missing' }
  }

  if (!invoice) {
    // No such invoice. The send route always loads one first, but this is now
    // callable with any id, and posting here would put an unattributable record
    // in a real customer's garage with no guard row to stop it repeating.
    console.error(`[garage/link] invoice ${input.invoiceId} not found, refusing to post`)
    return { linked: true, posted: false, nwiGarageId: account.nwiGarageId, reason: 'invoice not found' }
  }

  if (invoice.garage_posted_at) {
    return { linked: true, posted: false, nwiGarageId: account.nwiGarageId, reason: 'already posted' }
  }

  if (!input.vehicle) {
    return { linked: true, posted: false, nwiGarageId: account.nwiGarageId, reason: 'invoice has no vehicle' }
  }

  const garageVehicle = await findOrCreateGarageVehicle(account.userId, input.vehicle)
  if (!garageVehicle) {
    return { linked: true, posted: false, nwiGarageId: account.nwiGarageId, reason: 'vehicle lookup failed' }
  }

  // mileage_at_service is NOT NULL. An invoice whose vehicle has no odometer
  // reading falls back to whatever the garage already knows; posting a 0 would
  // corrupt the customer's mileage history and their service reminders, which
  // are driven off due_mileage.
  const mileage = input.vehicle.mileage ?? garageVehicle.mileage
  if (mileage == null) {
    return { linked: true, posted: false, nwiGarageId: account.nwiGarageId, reason: 'no mileage available' }
  }

  const { data: record, error } = await svc
    .from('garage_service_history')
    .insert({
      vehicle_id:         garageVehicle.id,
      user_id:            account.userId,
      service_date:       input.serviceDate,
      mileage_at_service: mileage,
      // Constrained vocabulary — see categoriseService.
      service_type:        categoriseService(input.serviceType),
      // The real line detail, which service_type cannot carry.
      service_description: input.serviceType,
      notes:               input.notes,
      mechanic_name:       input.mechanicName,
      mechanic_phone:      input.mechanicPhone,
      logged_by_mechanic:  true,
      cost:                input.cost,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[garage/link] service history insert failed:', error.message)
    return { linked: true, posted: false, nwiGarageId: account.nwiGarageId, reason: error.message }
  }

  // Stamped only after the Garage write succeeds, so a failure retries on the
  // next send rather than being silently marked done.
  const { error: stampErr } = await svc
    .from('invoices')
    .update({ garage_posted_at: new Date().toISOString(), garage_service_record_id: record.id })
    .eq('id', input.invoiceId)
  if (stampErr) {
    // The record exists in their garage; we just lost the guard. Say so loudly —
    // the next send would otherwise duplicate it.
    console.error(
      `[garage/link] POSTED ${record.id} but could not stamp invoice ${input.invoiceId}: ${stampErr.message}`,
    )
  }

  // Keep the garage's odometer current when this service reports a higher one.
  if (input.vehicle.mileage) {
    await svc
      .from('garage_vehicles')
      .update({ mileage: input.vehicle.mileage, mileage_updated_at: new Date().toISOString() })
      .eq('id', garageVehicle.id)
      .lt('mileage', input.vehicle.mileage)
  }

  return { linked: true, posted: true, nwiGarageId: account.nwiGarageId }
}
