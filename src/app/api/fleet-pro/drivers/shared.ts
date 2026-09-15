// SERVER-ONLY. Shared shape and validation for the driver roster routes.
//
// A plain module beside route.ts, not exports from it: Next.js type-checks a route
// file's export surface and anything that is not a handler or a route segment option
// is a build error there. The collection route and the [id] route both need the same
// row mapper and the same validator, and two copies would mean the create form and the
// edit form could quietly start accepting different things.

import { canViewCosts, type FleetProRole } from '@/types/fleet-pro'
import { COMPLIANCE_LIMITS, type FleetProDriver } from '@/types/fleet-pro-compliance'

// One string literal, not a concatenation: the Supabase client parses this at the type
// level to work out the row shape, and a `string` it cannot read statically degrades
// every result to an error type.
export const DRIVER_COLUMNS =
  'id, fleet_account_id, full_name, cdl_number, cdl_state, cdl_expires_on, medical_card_expires_on, phone, email, active, notes, created_at, updated_at'

export interface DriverRow { [key: string]: unknown }

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

function dayOf(value: unknown): string | null {
  if (!value) return null
  const s = String(value)
  return s.length >= 10 ? s.slice(0, 10) : null
}

/**
 * Whether this role may see a whole CDL number. Reuses canViewCosts rather than
 * inventing a parallel predicate: both answer the same question — "is this a manager
 * or a supervisor, rather than a read-only viewer" — and a second helper that happens
 * to agree today is a second helper that can drift tomorrow.
 */
export function canSeeCdlNumber(role: FleetProRole): boolean {
  return canViewCosts(role)
}

/** "•••• 8821". Enough to confirm a record matches a licence in hand, and no more. */
function maskCdl(value: string | null): string | null {
  if (!value) return null
  return `•••• ${value.slice(-4)}`
}

/**
 * Row -> API shape, applying the CDL mask. Every read path goes through here; RLS
 * cannot express a per-column rule, so this function is where the viewer restriction
 * actually lives (migration 131 says so beside the read policy).
 */
export function toDriver(row: DriverRow, role: FleetProRole): FleetProDriver {
  const full   = (row.cdl_number as string | null) ?? null
  const masked = !canSeeCdlNumber(role)
  return {
    id:                      String(row.id),
    fleet_account_id:        String(row.fleet_account_id),
    full_name:               (row.full_name as string | null) ?? '',
    cdl_number:              masked ? maskCdl(full) : full,
    cdl_masked:              masked && !!full,
    cdl_state:               (row.cdl_state as string | null) ?? null,
    cdl_expires_on:          dayOf(row.cdl_expires_on),
    medical_card_expires_on: dayOf(row.medical_card_expires_on),
    phone:                   (row.phone as string | null) ?? null,
    email:                   (row.email as string | null) ?? null,
    active:                  row.active !== false,
    notes:                   (row.notes as string | null) ?? null,
    created_at:              (row.created_at as string | null) ?? null,
    updated_at:              (row.updated_at as string | null) ?? null,
  }
}

/**
 * Shared field validation. `requireName` is true on create and false on edit, which is
 * the only difference between the two. Returns either the column patch or the sentence
 * to hand back as a 400.
 *
 * Only keys actually present in the body appear in the patch, so a PATCH that sends
 * one field cannot blank the other nine.
 */
export function validateDriverBody(
  body: Record<string, unknown>,
  { requireName }: { requireName: boolean },
): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const patch: Record<string, unknown> = {}

  if (requireName || 'full_name' in body) {
    const name = text(body.full_name, COMPLIANCE_LIMITS.full_name)
    if (!name) return { ok: false, error: 'full_name is required' }
    patch.full_name = name
  }

  if ('cdl_number' in body) patch.cdl_number = text(body.cdl_number, COMPLIANCE_LIMITS.cdl_number)

  if ('cdl_state' in body) {
    const state = text(body.cdl_state, COMPLIANCE_LIMITS.cdl_state)
    // Matches the 2-8 CHECK in migration 131. A one-character jurisdiction is a typo
    // and would otherwise fail at the driver as a 500 instead of here as a sentence.
    if (state !== null && state.length < 2) {
      return { ok: false, error: 'cdl_state must be at least 2 characters' }
    }
    patch.cdl_state = state
  }

  for (const field of ['cdl_expires_on', 'medical_card_expires_on'] as const) {
    if (!(field in body)) continue
    const value = body[field]
    if (value == null || value === '') { patch[field] = null; continue }
    if (!isIsoDate(value)) return { ok: false, error: `${field} must be a valid date (YYYY-MM-DD)` }
    patch[field] = value
  }

  if ('phone'  in body) patch.phone  = text(body.phone,  COMPLIANCE_LIMITS.phone)
  if ('email'  in body) patch.email  = text(body.email,  COMPLIANCE_LIMITS.email)
  if ('notes'  in body) patch.notes  = text(body.notes,  COMPLIANCE_LIMITS.notes)
  if ('active' in body) patch.active = body.active !== false

  return { ok: true, patch }
}
