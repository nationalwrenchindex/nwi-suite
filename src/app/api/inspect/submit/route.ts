// POST /api/inspect/submit — a driver's pre-trip inspection, from the QR page.
//
// DELIBERATELY UNAUTHENTICATED, same reasoning as GET /api/inspect/[unitId]: there is
// no driver account and the sticker on the truck is the capability. Everything the
// browser sends is therefore treated as hostile input:
//
//   * unit_id is looked up before anything is written
//   * fleet_account_id is derived SERVER-SIDE from that unit and never read from the
//     body — otherwise a driver could file an inspection into someone else's fleet
//   * odometer / hours are clamped to sane non-negative numbers
//   * checklist, defects and signature are size-capped so a public endpoint cannot be
//     turned into free object storage
//
// IDEMPOTENCY IS THE POINT OF THIS FILE. An offline submission WILL be replayed — a
// manual retry, a second tab, the service worker's sync. The device mints client_uuid
// once, before the first attempt, and reuses it forever; fleet_pro_pretrip_inspections
// .client_uuid is UNIQUE; a 23505 on it is SUCCESS here, not an error. Get that wrong
// and a driver in a dead zone files five identical inspections.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── payload caps ──────────────────────────────────────────────────────────────
// Sized to a generous DVIR, not to whatever the client feels like sending.
const MAX_BODY_CHARS      = 400_000   // whole request; signature dominates it
const MAX_SIGNATURE_CHARS = 200_000   // ~150KB PNG data URL
const MAX_CHECKLIST_KEYS  = 300
const MAX_KEY_CHARS       = 64
const MAX_DEFECTS         = 100
const MAX_LABEL_CHARS     = 200
const MAX_NOTE_CHARS      = 1_000
const MAX_NAME_CHARS      = 120

// Physical ceilings. A truck does not do ten million miles and a reefer does not run
// two hundred thousand hours, so anything past these is a typo or an attack.
const MAX_ODOMETER = 9_999_999
const MAX_HOURS    = 200_000

// A queued inspection can legitimately be days old before it finds signal. Beyond a
// month it is not a pre-trip any more, and a future date is always wrong (one day of
// slack for a phone in a different timezone).
const MAX_BACKDATE_DAYS = 30
const MAX_FUTURE_DAYS   = 1

interface Row { [key: string]: unknown }

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/** Non-negative, finite, clamped and rounded. Anything else becomes null rather than
 *  poisoning the meter history with NaN or a negative reading. */
function meter(value: unknown, max: number, decimals: number): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  const clamped = Math.min(n, max)
  const factor  = 10 ** decimals
  return Math.round(clamped * factor) / factor
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function dayOffset(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** YYYY-MM-DD inside the allowed window, else today. */
function inspectionDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return today()
  if (Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())) return today()
  if (value < dayOffset(-MAX_BACKDATE_DAYS)) return today()
  if (value > dayOffset(MAX_FUTURE_DAYS)) return today()
  return value
}

/** Only pass/fail/na, only sane keys, only up to the cap. */
function checklist(value: unknown): Record<string, 'pass' | 'fail' | 'na'> {
  const out: Record<string, 'pass' | 'fail' | 'na'> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_CHECKLIST_KEYS) break
    if (!key || key.length > MAX_KEY_CHARS) continue
    if (v === 'pass' || v === 'fail' || v === 'na') out[key] = v
  }
  return out
}

function defects(value: unknown): { key: string; label: string; note?: string }[] {
  if (!Array.isArray(value)) return []
  const out: { key: string; label: string; note?: string }[] = []
  for (const entry of value.slice(0, MAX_DEFECTS)) {
    if (!entry || typeof entry !== 'object') continue
    const row   = entry as Row
    const key   = str(row.key, MAX_KEY_CHARS)
    const label = str(row.label, MAX_LABEL_CHARS)
    if (!key || !label) continue
    const note = str(row.note, MAX_NOTE_CHARS)
    out.push(note ? { key, label, note } : { key, label })
  }
  return out
}

/** Accept a PNG/JPEG data URL and nothing else — this string is rendered back into an
 *  <img> on the shop side, so an SVG data URL would be a stored-XSS vector. */
function signature(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length > MAX_SIGNATURE_CHARS) return null
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\s]+$/.test(value)) return null
  return value
}

export async function POST(req: NextRequest) {
  // Read as text first so an enormous body is rejected before it is parsed.
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return bad('Could not read request body')
  }
  if (raw.length > MAX_BODY_CHARS) return bad('Submission too large', 413)

  let body: Row
  try {
    body = JSON.parse(raw) as Row
  } catch {
    return bad('Malformed JSON')
  }
  if (!body || typeof body !== 'object') return bad('Malformed submission')

  const unitId = typeof body.unit_id === 'string' ? body.unit_id : ''
  if (!UUID_RE.test(unitId)) return bad('Not found', 404)

  // A client_uuid is required for dedupe, but a submission that arrived WITHOUT one is
  // still a completed inspection and must not be thrown away. Mint one server-side: it
  // cannot dedupe a replay (nothing to match on), which is exactly why the client is
  // built to always send its own.
  const clientUuid = typeof body.client_uuid === 'string' && UUID_RE.test(body.client_uuid)
    ? body.client_uuid
    : crypto.randomUUID()

  const svc = createServiceClient()

  // Existence check BEFORE any write, and the source of truth for the fleet.
  const { data: unit, error: unitErr } = await svc
    .from('hd_units')
    .select('id, fleet_account_id, total_hours')
    .eq('id', unitId)
    .maybeSingle()

  if (unitErr) return bad('Temporarily unavailable', 503)
  if (!unit)   return bad('Not found', 404)

  const fleetAccountId = (unit.fleet_account_id as string | null) ?? null

  const checklistData = checklist(body.checklist_data)
  const defectRows    = defects(body.defects)
  const odometer      = meter(body.odometer, MAX_ODOMETER, 1)
  const reeferHours   = meter(body.reefer_hours, MAX_HOURS, 2)

  // ANY failed item fails the inspection — same rule as a paper DVIR, and computed
  // here rather than trusted from the body so the record cannot be dressed up as a
  // pass by an edited request.
  const overallResult = Object.values(checklistData).includes('fail') ? 'fail' : 'pass'

  const insertRow = {
    fleet_account_id:  fleetAccountId,
    unit_id:           unitId,
    driver_name:       str(body.driver_name, MAX_NAME_CHARS),
    inspection_date:   inspectionDate(body.inspection_date),
    odometer,
    reefer_hours:      reeferHours,
    checklist_data:    checklistData,
    defects:           defectRows,
    overall_result:    overallResult,
    signature_data:    signature(body.signature_data),
    client_uuid:       clientUuid,
    submitted_offline: body.submitted_offline === true,
  }

  const { data: inserted, error: insertErr } = await svc
    .from('fleet_pro_pretrip_inspections')
    .insert(insertRow)
    .select('id, overall_result')
    .single()

  if (insertErr) {
    // 23505 on client_uuid: this exact inspection already landed. That is SUCCESS —
    // returning an error here is what turns one dead-zone inspection into five, or
    // makes the device retry forever against a row that already exists.
    if (insertErr.code === '23505') {
      const { data: existing } = await svc
        .from('fleet_pro_pretrip_inspections')
        .select('id, overall_result')
        .eq('client_uuid', clientUuid)
        .maybeSingle()

      return NextResponse.json({
        ok:             true,
        duplicate:      true,
        id:             existing?.id ?? null,
        overall_result: existing?.overall_result ?? overallResult,
      })
    }
    console.error('[inspect/submit] insert failed:', insertErr.message)
    return bad('Could not save inspection', 500)
  }

  const inspectionId = String(inserted.id)

  // ── meter history ───────────────────────────────────────────────────────────
  // Only when the driver actually gave a reading. Writing a row of two nulls would
  // put a flat spot in the unit's mileage/hours trend for no reason.
  // This runs only on a genuine insert, so a replay never double-writes it.
  if (odometer !== null || reeferHours !== null) {
    const { error: meterErr } = await svc.from('fleet_pro_unit_meter_readings').insert({
      unit_id:          unitId,
      fleet_account_id: fleetAccountId,
      reading_date:     insertRow.inspection_date,
      odometer,
      engine_hours:     reeferHours,
      source:           'pretrip',
      source_id:        inspectionId,
    })
    // Non-fatal: the inspection itself is the safety record and is already saved.
    if (meterErr) console.error('[inspect/submit] meter reading failed:', meterErr.message)
  }

  // ── current hours on the unit ───────────────────────────────────────────────
  // FORWARD ONLY. An hour meter is monotonic; a lower number is a typo, a different
  // unit's reading, or a driver keying the trailer number into the hours box. Moving
  // hd_units.total_hours backwards would make an hours-based PM look not-yet-due and
  // hide a service that is actually overdue, so a lower reading is kept in the meter
  // history (above, where it is visible) and simply not promoted to current.
  if (reeferHours !== null) {
    const rawStored = unit.total_hours
    const stored    = rawStored === null || rawStored === undefined ? null : Number(rawStored)
    const noBaseline = stored === null || !Number.isFinite(stored)

    if (noBaseline || reeferHours > (stored as number)) {
      let update = svc.from('hd_units').update({ total_hours: reeferHours }).eq('id', unitId)
      // Guard against the shop side writing a higher reading between our read and this
      // write: only touch the row while it is still at or below what we are setting.
      // Skipped when the column is NULL, since NULL never satisfies a comparison and
      // the guard would silently drop the very first reading.
      if (!noBaseline) update = update.lte('total_hours', reeferHours)
      const { error: hoursErr } = await update
      if (hoursErr) console.error('[inspect/submit] total_hours update failed:', hoursErr.message)
    }
  }

  // ── PM schedule: DELIBERATELY NOT TOUCHED ───────────────────────────────────
  // A pre-trip is a driver walkaround, not a preventive-maintenance service. Setting
  // fleet_pro_pm_schedules.last_service_date (and with it next_due_date) from this
  // endpoint would reset a unit's PM clock every single morning, so a truck that is
  // 40 days past its interval would show as freshly serviced and the overdue alert
  // would never fire. Nothing here qualifies as a PM event, so nothing is written —
  // the PM clock only moves when a mechanic completes a PM.

  return NextResponse.json({
    ok:             true,
    duplicate:      false,
    id:             inspectionId,
    overall_result: inserted.overall_result ?? overallResult,
  })
}
