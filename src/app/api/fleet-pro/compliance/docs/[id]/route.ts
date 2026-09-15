// PATCH / POST / DELETE /api/fleet-pro/compliance/docs/[id]
//
//   PATCH   edit the dates and notes on an existing document row
//   POST    attach or replace the scan (multipart/form-data, field name `file`)
//   DELETE  remove the row and the object behind it
//
// POST rather than a separate /file sub-route: the upload targets this exact document
// and nothing else, and one file per row means there is no collection to POST into.
// It is called out here because a POST that replaces rather than creates is worth
// saying out loud.
//
// ── WHY THE UPLOAD GOES THROUGH THE SERVER ──────────────────────────────────
// The HD work-order photo flow uploads straight from the browser on the session
// client. That works there because the bucket's own storage policies decide who may
// write. These documents are CDL and medical-card scans, and a browser-side upload
// would mean a second, separate access model (storage policies) that has to be kept in
// agreement with fleet_pro_managed_account_ids() by hand. Routing the bytes through
// here means the bucket needs NO public policy at all: the service role writes it, the
// membership check above is the only gate, and reads are short-lived signed URLs.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { canEditUnits } from '@/types/fleet-pro'
import {
  COMPLIANCE_BUCKET,
  COMPLIANCE_FILE_MAX_BYTES,
  COMPLIANCE_FILE_TYPES,
  COMPLIANCE_LIMITS,
  COMPLIANCE_SIGNED_URL_TTL_SECONDS,
} from '@/types/fleet-pro-compliance'
import { DOC_COLUMNS } from '../../calendar'

export const dynamic = 'force-dynamic'

interface Row { [key: string]: unknown }

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

/**
 * Strip a filename down to something safe to put in a storage key. Anything that is
 * not a letter, digit, dot, dash or underscore becomes a dash — a user-supplied name
 * must never be able to introduce a path segment.
 */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (cleaned || 'document').slice(0, 80)
}

/**
 * Resolve the document, and refuse it unless it belongs to the caller's own fleet.
 * Every verb below starts here — the id in the URL is user input like any other.
 */
async function loadDoc(docId: string, userId: string | null) {
  const gate = await requireFleetProMember(userId)
  if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error }

  const svc = createServiceClient()
  const { data } = await svc
    .from('fleet_pro_compliance_docs')
    .select(DOC_COLUMNS)
    .eq('id', docId)
    .eq('fleet_account_id', gate.membership.fleet_account_id)
    .maybeSingle()

  if (!data) return { ok: false as const, status: 404, error: 'Document not found' }
  return { ok: true as const, svc, membership: gate.membership, doc: data as Row }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const loaded = await loadDoc(id, user?.id ?? null)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  if (!canEditUnits(loaded.membership.role)) {
    return NextResponse.json({ error: 'Fleet manager role required' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  // Only fields actually present are touched. The subject and the doc_type are NOT
  // patchable: re-pointing a medical card at a different driver is a new document, not
  // an edit, and allowing it here would let a row drift out of the CHECK in 131.
  for (const field of ['issued_on', 'expires_on'] as const) {
    if (!(field in body)) continue
    const value = body[field]
    if (value == null || value === '') { patch[field] = null; continue }
    if (!isIsoDate(value)) {
      return NextResponse.json({ error: `${field} must be a valid date (YYYY-MM-DD)` }, { status: 400 })
    }
    patch[field] = value
  }
  if ('notes' in body) patch.notes = text(body.notes, COMPLIANCE_LIMITS.notes)

  const issued  = (patch.issued_on  as string | null | undefined) ?? (loaded.doc.issued_on  as string | null)
  const expires = (patch.expires_on as string | null | undefined) ?? (loaded.doc.expires_on as string | null)
  if (issued && expires && String(expires).slice(0, 10) < String(issued).slice(0, 10)) {
    return NextResponse.json({ error: 'expires_on cannot be before issued_on' }, { status: 400 })
  }

  const { data, error } = await loaded.svc
    .from('fleet_pro_compliance_docs')
    .update(patch)
    .eq('id', id)
    .eq('fleet_account_id', loaded.membership.fleet_account_id)
    .select(DOC_COLUMNS)
    .single()

  if (error) {
    console.error('[fleet-pro/compliance/docs] update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ doc: data })
}

// ── POST — attach or replace the scan ─────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const loaded = await loadDoc(id, user?.id ?? null)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  if (!canEditUnits(loaded.membership.role)) {
    return NextResponse.json({ error: 'Fleet manager role required' }, { status: 403 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file supplied' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'File is empty' }, { status: 400 })
  }
  if (file.size > COMPLIANCE_FILE_MAX_BYTES) {
    return NextResponse.json(
      { error: `File must be ${Math.round(COMPLIANCE_FILE_MAX_BYTES / 1024 / 1024)} MB or smaller` },
      { status: 400 },
    )
  }
  // Allow-list, not a block-list. The only things that legitimately land in this
  // bucket are a phone photo or a PDF.
  if (!COMPLIANCE_FILE_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, HEIC, WebP or PDF files are accepted' }, { status: 400 })
  }

  const fleetId  = loaded.membership.fleet_account_id
  // Fleet-scoped prefix. Nothing reads the bucket by prefix today, but it is what a
  // future storage policy would have to key on, and a flat namespace could not be
  // retrofitted without moving every object.
  const path     = `${fleetId}/${id}/${Date.now()}-${safeFileName(file.name)}`
  const previous = (loaded.doc.file_url as string | null) ?? null

  const { error: uploadErr } = await loaded.svc.storage
    .from(COMPLIANCE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (uploadErr) {
    console.error('[fleet-pro/compliance/docs] upload failed:', uploadErr.message)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const { data, error } = await loaded.svc
    .from('fleet_pro_compliance_docs')
    .update({
      file_url:   path,
      file_name:  file.name.slice(0, COMPLIANCE_LIMITS.file_name),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('fleet_account_id', fleetId)
    .select(DOC_COLUMNS)
    .single()

  if (error) {
    // The row did not take the new path, so the object just written is unreachable.
    // Remove it rather than leave a scan of somebody's licence in the bucket with
    // nothing pointing at it and no way to ever find it again.
    await loaded.svc.storage.from(COMPLIANCE_BUCKET).remove([path])
    console.error('[fleet-pro/compliance/docs] file metadata save failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Only once the row points at the new object. Best effort — a failure here leaks one
  // superseded file, which is much better than deleting the copy still in use.
  if (previous && previous !== path) {
    const { error: rmErr } = await loaded.svc.storage.from(COMPLIANCE_BUCKET).remove([previous])
    if (rmErr) console.error('[fleet-pro/compliance/docs] old file cleanup failed:', rmErr.message)
  }

  const { data: signed } = await loaded.svc.storage
    .from(COMPLIANCE_BUCKET)
    .createSignedUrl(path, COMPLIANCE_SIGNED_URL_TTL_SECONDS)

  return NextResponse.json({ doc: data, signed_url: signed?.signedUrl ?? null })
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const loaded = await loadDoc(id, user?.id ?? null)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  if (!canEditUnits(loaded.membership.role)) {
    return NextResponse.json({ error: 'Fleet manager role required' }, { status: 403 })
  }

  const path = (loaded.doc.file_url as string | null) ?? null

  const { error } = await loaded.svc
    .from('fleet_pro_compliance_docs')
    .delete()
    .eq('id', id)
    .eq('fleet_account_id', loaded.membership.fleet_account_id)

  if (error) {
    console.error('[fleet-pro/compliance/docs] delete failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // The row is gone, so the object is now unreachable — personal data with no owner.
  // Removed after the row rather than before, so a failed delete does not destroy the
  // file of a document that still exists.
  if (path) {
    const { error: rmErr } = await loaded.svc.storage.from(COMPLIANCE_BUCKET).remove([path])
    if (rmErr) console.error('[fleet-pro/compliance/docs] file cleanup failed:', rmErr.message)
  }

  return NextResponse.json({ ok: true })
}
