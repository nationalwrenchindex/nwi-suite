// POST /api/fleet-pro/service-entries — write a fleet manager's confirmed invoice.
//
// The manager-side twin of /api/inspect/service-entry, and modelled on it field for
// field so the two write identical rows. Three differences, each with a reason:
//
//   * AUTHENTICATED. fleet_account_id comes from the caller's membership and the unit
//     must already belong to that fleet, so a manager cannot file cost into another
//     fleet's spend. The QR route derives the fleet from the unit instead, because
//     there is no caller to ask.
//   * COST-GATED. A viewer cannot see a cost figure anywhere in Fleet Pro; letting one
//     write a cost record would be a hole in the same wall.
//   * IT KEEPS THE PHOTO. The QR flow deliberately drops it — an unauthenticated
//     endpoint plus object storage is a free bucket for anyone with a unit id. This
//     one costs a Fleet Pro seat to reach, so the image goes into the private
//     compliance bucket and image_url finally carries the path the column was added
//     for. Reads are short-lived signed URLs minted after the same membership check.
//
// IDEMPOTENCY works exactly as it does on the QR route: the browser mints client_uuid
// once and reuses it on retry, fleet_pro_service_entries.client_uuid is UNIQUE, and a
// 23505 on it is SUCCESS. A double-tapped Submit must not become two line items in a
// spend report.
//
// The new row rolls into cost per mile with no further wiring: src/lib/fleet-pro/cost.ts
// reads fleet_pro_service_entries without filtering on source.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { canViewCosts } from '@/types/fleet-pro'
import { COMPLIANCE_BUCKET, COMPLIANCE_SIGNED_URL_TTL_SECONDS } from '@/types/fleet-pro-compliance'
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_JSON_BODY_CHARS,
  MAX_TECH_NAME_CHARS,
  SERVICE_ENTRY_SOURCE_MANAGER_SCAN,
  cleanText,
  imageMagicMatches,
  normalizeExtraction,
  type AllowedImageType,
} from '@/lib/fleet-pro/service-entry'

export const dynamic = 'force-dynamic'

// Uploading a 5MB photo alongside the JSON takes longer than a plain insert, and a
// manager on shop wifi should get an answer rather than a platform timeout.
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 512 * 1024

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

/** Same rule as the compliance routes: a filename is user input that becomes part of
 *  an object path. */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (cleaned || 'invoice').slice(0, 80)
}

export async function POST(req: NextRequest) {
  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return bad('That photo is too large. Take it again at normal quality.', 413)
  }

  // ── membership, then cost access ────────────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProMember(user?.id ?? null)
  if (!gate.ok) return bad(gate.error, gate.status)
  if (!canViewCosts(gate.membership.role)) {
    return bad('Filing an invoice requires cost access', 403)
  }
  const fleetId = gate.membership.fleet_account_id

  // multipart, not JSON: the photo travels with the confirmed values so one submit
  // either files the record with its evidence or files nothing.
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return bad('Expected multipart/form-data')
  }

  const raw = String(form.get('entry') ?? '')
  if (!raw) return bad('Nothing to save')
  if (raw.length > MAX_JSON_BODY_CHARS) return bad('Entry too large', 413)

  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return bad('Malformed submission')
  }
  if (!body || typeof body !== 'object') return bad('Malformed submission')

  const unitId = typeof body.unit_id === 'string' ? body.unit_id : ''
  if (!UUID_RE.test(unitId)) return bad('Pick which unit this invoice is for')

  // A client_uuid is required for dedupe, but an entry that arrived WITHOUT one is
  // still a real invoice and must not be thrown away. Mint one server-side: it cannot
  // dedupe a replay, which is why the browser is built to always send its own.
  const clientUuid = typeof body.client_uuid === 'string' && UUID_RE.test(body.client_uuid)
    ? body.client_uuid
    : crypto.randomUUID()

  const svc = createServiceClient()

  // THE OWNERSHIP CHECK. The unit in the body is user input; it is only acceptable if
  // it is already in the caller's own fleet. Without this the dropdown is advisory and
  // a crafted request could file a repair against any truck in the system.
  const { data: unit, error: unitErr } = await svc
    .from('hd_units')
    .select('id')
    .eq('id', unitId)
    .eq('fleet_account_id', fleetId)
    .maybeSingle()

  if (unitErr) return bad('Temporarily unavailable', 503)
  if (!unit)   return bad('That unit is not in this fleet', 404)

  // The manager's corrected values and, separately, what the model originally
  // produced. Both go through the same sanitizer so the audit copy is capped too.
  const entry    = normalizeExtraction(body)
  const original = body.extracted_raw ? normalizeExtraction(body.extracted_raw) : null

  // Every money field can legitimately be blank (a warranty repair, a courtesy fix),
  // and the date can be blank — but a row with nothing at all on it is a mis-tap.
  const hasContent = !!(
    entry.labor_description || entry.vendor_name || entry.invoice_number ||
    entry.parts.length > 0 ||
    entry.labor_cost !== null || entry.parts_cost !== null ||
    entry.tax !== null || entry.total !== null
  )
  if (!hasContent) return bad('Nothing to save — add what was done or what it cost.')

  // ── the photo, if one came ──────────────────────────────────────────────────
  // Optional on purpose: a manager typing in an invoice he already has on file is a
  // legitimate path, and refusing it would push him back to no record at all.
  let imagePath: string | null = null
  const file = form.get('image')

  if (file instanceof File && file.size > 0) {
    const declaredType = file.type as AllowedImageType
    if (!ALLOWED_IMAGE_TYPES.includes(declaredType)) {
      return bad('Photos must be JPEG or PNG.', 415)
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return bad('That photo is too large. Take it again at normal quality.', 413)
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return bad('That photo is too large. Take it again at normal quality.', 413)
    }
    // The declared type is a string the client chose; these bytes are the evidence.
    if (!imageMagicMatches(bytes, declaredType)) {
      return bad('That file is not a photo. Use your phone camera.', 415)
    }

    // Fleet-scoped, then unit-scoped. Nothing reads this bucket by prefix today, but
    // it is what a future storage policy would key on and a flat namespace could not
    // be retrofitted without moving every object.
    const path = `${fleetId}/invoices/${unitId}/${Date.now()}-${safeFileName(file.name)}`

    const { error: uploadErr } = await svc.storage
      .from(COMPLIANCE_BUCKET)
      .upload(path, file, { contentType: declaredType, upsert: false })

    if (uploadErr) {
      console.error('[fleet-pro/service-entries] upload failed:', uploadErr.message)
      return bad('Could not save the invoice photo', 500)
    }
    imagePath = path
  }

  const insertRow = {
    unit_id:           unitId,
    fleet_account_id:  fleetId,
    // Who filed it, not who turned the wrench — the column is the only attribution
    // this record has, and on this path the shop's own name is in vendor_name.
    technician_name:   cleanText(body.technician_name, MAX_TECH_NAME_CHARS)
                         ?? gate.membership.full_name
                         ?? gate.membership.email,
    vendor_name:       entry.vendor_name,
    invoice_number:    entry.invoice_number,
    // The column is NOT NULL DEFAULT CURRENT_DATE. An unreadable date reaches here as
    // null and takes that default: the record is dated when it was filed, and the
    // manager saw the empty box before pressing Submit.
    ...(entry.service_date ? { service_date: entry.service_date } : {}),
    labor_description: entry.labor_description,
    parts:             entry.parts,
    labor_cost:        entry.labor_cost,
    parts_cost:        entry.parts_cost,
    tax:               entry.tax,
    total:             entry.total,
    // A STORAGE PATH, never a URL — reads are signed on demand below.
    image_url:         imagePath,
    extracted_raw:     original,
    source:            SERVICE_ENTRY_SOURCE_MANAGER_SCAN,
    client_uuid:       clientUuid,
  }

  const { data: inserted, error: insertErr } = await svc
    .from('fleet_pro_service_entries')
    .insert(insertRow)
    .select('id, service_date, total')
    .single()

  if (insertErr) {
    // 23505 on client_uuid: this exact entry already landed. That is SUCCESS — an
    // error here is what turns one repair into five when a submit is retried.
    if (insertErr.code === '23505') {
      // The stored row already has its own photo. The one just uploaded is now
      // unreferenced, so remove it rather than leave an orphan in the bucket.
      if (imagePath) {
        const { error: rmErr } = await svc.storage.from(COMPLIANCE_BUCKET).remove([imagePath])
        if (rmErr) console.error('[fleet-pro/service-entries] duplicate cleanup failed:', rmErr.message)
      }

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

    // The row did not land, so the object just written is unreachable — nothing
    // points at it and nothing ever will.
    if (imagePath) {
      const { error: rmErr } = await svc.storage.from(COMPLIANCE_BUCKET).remove([imagePath])
      if (rmErr) console.error('[fleet-pro/service-entries] orphan cleanup failed:', rmErr.message)
    }
    console.error('[fleet-pro/service-entries] insert failed:', insertErr.message)
    return bad('Could not save this service record', 500)
  }

  // ── PM schedule: DELIBERATELY NOT TOUCHED ───────────────────────────────────
  // Same rule as the QR route. This IS a service, but it is a service transcribed off
  // a photograph and corrected by hand — not a completed PM. Moving
  // fleet_pro_pm_schedules.last_service_date from here would reset a unit's PM clock
  // off an oil-change receipt and hide a PM that is genuinely overdue.

  // Signed on the way out so the confirmation can show the manager the photo it filed,
  // without the path ever standing in for a readable URL.
  let signedUrl: string | null = null
  if (imagePath) {
    const { data: signed } = await svc.storage
      .from(COMPLIANCE_BUCKET)
      .createSignedUrl(imagePath, COMPLIANCE_SIGNED_URL_TTL_SECONDS)
    signedUrl = signed?.signedUrl ?? null
  }

  return NextResponse.json({
    ok:           true,
    duplicate:    false,
    id:           inserted.id,
    service_date: inserted.service_date,
    total:        inserted.total,
    signed_url:   signedUrl,
  })
}
