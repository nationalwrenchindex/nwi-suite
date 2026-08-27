// POST /api/inspect/service-entry — write the technician's confirmed service record.
//
// DELIBERATELY UNAUTHENTICATED, and modelled line for line on /api/inspect/submit: the
// technician at the truck has no session, the QR sticker is the capability, and every
// field in the body is treated as hostile:
//
//   * unit_id is looked up before anything is written
//   * fleet_account_id AND the owning mechanic are derived SERVER-SIDE from that unit
//     and never read from the body — otherwise anyone could file a $40,000 repair into
//     someone else's fleet spend
//   * money is clamped non-negative and rounded; dates are windowed
//   * text and the parts array are size-capped so a public endpoint cannot be turned
//     into free object storage
//
// IDEMPOTENCY IS THE POINT OF THIS FILE, same as the pre-trip route. The device mints
// client_uuid once, before the first attempt, and reuses it on every retry;
// fleet_pro_service_entries.client_uuid is UNIQUE; a 23505 on it is SUCCESS here. Get
// that wrong and one repair in a dead zone becomes five line items in a spend report.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  MAX_JSON_BODY_CHARS,
  MAX_TECH_NAME_CHARS,
  cleanText,
  normalizeExtraction,
} from '@/lib/fleet-pro/service-entry'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Kept in step with /inspect/[unitId] and the extract route.
const RETIRED_STATUSES = new Set(['inactive', 'archived', 'retired', 'deleted'])

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function POST(req: NextRequest) {
  // Read as text first so an enormous body is rejected before it is parsed.
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return bad('Could not read request body')
  }
  if (raw.length > MAX_JSON_BODY_CHARS) return bad('Entry too large', 413)

  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return bad('Malformed JSON')
  }
  if (!body || typeof body !== 'object') return bad('Malformed submission')

  const unitId = typeof body.unit_id === 'string' ? body.unit_id : ''
  if (!UUID_RE.test(unitId)) return bad('Not found', 404)

  // A client_uuid is required for dedupe, but an entry that arrived WITHOUT one is
  // still a real repair and must not be thrown away. Mint one server-side: it cannot
  // dedupe a replay (there is nothing to match on), which is exactly why the device is
  // built to always send its own.
  const clientUuid = typeof body.client_uuid === 'string' && UUID_RE.test(body.client_uuid)
    ? body.client_uuid
    : crypto.randomUUID()

  const svc = createServiceClient()

  // Existence check BEFORE any write, and the source of truth for the fleet. Same
  // undifferentiated 404 as the rest of /api/inspect: an unknown id, an inactive unit
  // and a retired one are indistinguishable from outside.
  const { data: unit, error: unitErr } = await svc
    .from('hd_units')
    .select('id, fleet_account_id, user_id, status, active')
    .eq('id', unitId)
    .maybeSingle()

  if (unitErr) return bad('Temporarily unavailable', 503)
  if (!unit)   return bad('Not found', 404)
  if (unit.active === false) return bad('Not found', 404)
  if (RETIRED_STATUSES.has(String(unit.status ?? '').toLowerCase())) return bad('Not found', 404)

  // SERVER-DERIVED. The body has no say in either of these.
  const fleetAccountId = (unit.fleet_account_id as string | null) ?? null

  // The tech's corrected values and, separately, what the model originally produced.
  // Both go through the same sanitizer so the audit copy is capped too — otherwise
  // extracted_raw is an uncapped JSONB column on a public endpoint.
  const entry    = normalizeExtraction(body)
  const original = body.extracted_raw ? normalizeExtraction(body.extracted_raw) : null

  // Every money field can legitimately be blank (a warranty repair, a courtesy fix),
  // and the date can be blank if the tech never filled it in — but a row with nothing
  // at all on it is a mis-tap, not a service record.
  const hasContent = !!(
    entry.labor_description || entry.vendor_name || entry.invoice_number ||
    entry.parts.length > 0 ||
    entry.labor_cost !== null || entry.parts_cost !== null ||
    entry.tax !== null || entry.total !== null
  )
  if (!hasContent) return bad('Nothing to save — add what was done or what it cost.')

  const insertRow = {
    unit_id:           unitId,
    fleet_account_id:  fleetAccountId,
    technician_name:   cleanText(body.technician_name, MAX_TECH_NAME_CHARS),
    vendor_name:       entry.vendor_name,
    invoice_number:    entry.invoice_number,
    // The column is NOT NULL DEFAULT CURRENT_DATE. An unreadable date reaches here as
    // null and takes that default, which is the honest fallback: the record is dated
    // when it was filed, and the tech saw the empty box before pressing Confirm.
    ...(entry.service_date ? { service_date: entry.service_date } : {}),
    labor_description: entry.labor_description,
    parts:             entry.parts,
    labor_cost:        entry.labor_cost,
    parts_cost:        entry.parts_cost,
    tax:               entry.tax,
    total:             entry.total,
    // No storage upload in this flow — the photo never leaves the phone. The column
    // exists for a later step that puts the image in a bucket; extracted_raw carries
    // the audit value in the meantime.
    image_url:         null,
    extracted_raw:     original,
    source:            'qr_tech_entry',
    client_uuid:       clientUuid,
  }

  const { data: inserted, error: insertErr } = await svc
    .from('fleet_pro_service_entries')
    .insert(insertRow)
    .select('id, service_date, total')
    .single()

  if (insertErr) {
    // 23505 on client_uuid: this exact entry already landed. That is SUCCESS — an
    // error here is what turns one repair into five, or makes a phone on bad signal
    // retry forever against a row that already exists.
    if (insertErr.code === '23505') {
      const { data: existing } = await svc
        .from('fleet_pro_service_entries')
        .select('id, service_date, total')
        .eq('client_uuid', clientUuid)
        .maybeSingle()

      return NextResponse.json({
        ok:           true,
        duplicate:    true,
        id:           existing?.id ?? null,
        service_date: existing?.service_date ?? entry.service_date,
        total:        existing?.total ?? entry.total,
      })
    }
    console.error('[inspect/service-entry] insert failed:', insertErr.message)
    return bad('Could not save this service record', 500)
  }

  // ── PM schedule: DELIBERATELY NOT TOUCHED ─────────────────────────────────
  // Same rule as the pre-trip route, for a different reason. This IS a service, but
  // it is a service transcribed off a photograph by a machine and corrected by a tech
  // in a yard — not a completed PM. Moving fleet_pro_pm_schedules.last_service_date
  // from here would reset a unit's PM clock off an oil-change receipt and hide a PM
  // that is genuinely overdue. The clock moves when a mechanic completes a PM.

  return NextResponse.json({
    ok:           true,
    duplicate:    false,
    id:           String(inserted.id),
    service_date: inserted.service_date ?? entry.service_date,
    total:        inserted.total ?? entry.total,
  })
}
