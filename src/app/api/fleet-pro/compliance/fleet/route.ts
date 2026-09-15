// PUT / POST /api/fleet-pro/compliance/fleet
//
// The carrier-level compliance record: insurance certificate, IFTA account and the
// filing acknowledgements for IFTA and HUT 2290.
//
//   PUT   the fields (JSON), upserting on fleet_account_id
//   POST  the certificate of insurance scan (multipart/form-data, field `file`)
//
// There is no GET — the whole record already rides along on GET /api/fleet-pro/
// compliance as `fleet_record`, and a second endpoint returning the same row is a
// second thing to keep in agreement.
//
// IFTA and 2290 store an ACKNOWLEDGEMENT, not a due date. The due dates are fixed
// federal calendar and are computed in lib/fleet-pro/compliance.ts; what a manager can
// record here is "we filed through Q2" so the calendar stops nagging until Q3 closes.

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
import { FLEET_COMPLIANCE_COLUMNS } from '../calendar'

export const dynamic = 'force-dynamic'

// Matches the CHECK in migration 131. A 400 here beats a constraint violation.
const MIN_2290_YEAR = 2000
const MAX_2290_YEAR = 2100

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

function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (cleaned || 'certificate').slice(0, 80)
}

/** Manager gate, shared by both verbs. */
async function requireManager(userId: string | null) {
  const gate = await requireFleetProMember(userId)
  if (!gate.ok) return { ok: false as const, status: gate.status, error: gate.error }
  if (!canEditUnits(gate.membership.role)) {
    return { ok: false as const, status: 403, error: 'Fleet manager role required' }
  }
  return { ok: true as const, membership: gate.membership, svc: createServiceClient() }
}

// ── PUT ───────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireManager(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership, svc } = gate

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  for (const field of ['insurance_expires_on', 'ifta_filed_through'] as const) {
    const value = body[field]
    if (value != null && value !== '' && !isIsoDate(value)) {
      return NextResponse.json({ error: `${field} must be a valid date (YYYY-MM-DD)` }, { status: 400 })
    }
  }

  let filedYear: number | null = null
  const yearRaw = body.hut_2290_filed_for_year
  if (yearRaw != null && yearRaw !== '') {
    const n = Number(yearRaw)
    if (!Number.isInteger(n) || n < MIN_2290_YEAR || n > MAX_2290_YEAR) {
      return NextResponse.json(
        { error: `hut_2290_filed_for_year must be a year between ${MIN_2290_YEAR} and ${MAX_2290_YEAR}` },
        { status: 400 },
      )
    }
    filedYear = n
  }

  // created_by is insert-only. An upsert writes every column it is handed, so passing
  // it unconditionally would rewrite the original author on every save — the same trap
  // the registration PUT documents.
  const { data: existing } = await svc
    .from('fleet_pro_fleet_compliance')
    .select('id')
    .eq('fleet_account_id', membership.fleet_account_id)
    .maybeSingle()

  const record: Record<string, unknown> = {
    fleet_account_id:        membership.fleet_account_id,
    insurance_carrier:       text(body.insurance_carrier,       COMPLIANCE_LIMITS.insurance_carrier),
    insurance_policy_number: text(body.insurance_policy_number, COMPLIANCE_LIMITS.insurance_policy_number),
    insurance_expires_on:    body.insurance_expires_on ? String(body.insurance_expires_on) : null,
    ifta_account_number:     text(body.ifta_account_number,     COMPLIANCE_LIMITS.ifta_account_number),
    ifta_filed_through:      body.ifta_filed_through ? String(body.ifta_filed_through) : null,
    hut_2290_filed_for_year: filedYear,
    notes:                   text(body.notes, COMPLIANCE_LIMITS.notes),
    // Any edit re-arms the digest: a manager who has just corrected an insurance date
    // should be told tonight if it is still wrong, not silenced by yesterday's send.
    alert_digest_key:        null,
    updated_at:              new Date().toISOString(),
  }
  if (!existing) record.created_by = user?.id ?? null

  const { data, error } = await svc
    .from('fleet_pro_fleet_compliance')
    .upsert(record, { onConflict: 'fleet_account_id' })
    .select(FLEET_COMPLIANCE_COLUMNS)
    .single()

  if (error) {
    console.error('[fleet-pro/compliance/fleet] upsert failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ fleet_record: data })
}

// ── POST — the certificate of insurance scan ──────────────────────────────────
// Same server-side upload rationale as the document route: the bucket stays private
// with no storage policies of its own, and the membership check here is the only gate.

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireManager(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership, svc } = gate

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file supplied' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'File is empty' }, { status: 400 })
  if (file.size > COMPLIANCE_FILE_MAX_BYTES) {
    return NextResponse.json(
      { error: `File must be ${Math.round(COMPLIANCE_FILE_MAX_BYTES / 1024 / 1024)} MB or smaller` },
      { status: 400 },
    )
  }
  if (!COMPLIANCE_FILE_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, HEIC, WebP or PDF files are accepted' }, { status: 400 })
  }

  const fleetId = membership.fleet_account_id
  const path    = `${fleetId}/insurance/${Date.now()}-${safeFileName(file.name)}`

  const { data: existing } = await svc
    .from('fleet_pro_fleet_compliance')
    .select('id, insurance_doc_url')
    .eq('fleet_account_id', fleetId)
    .maybeSingle()

  const { error: uploadErr } = await svc.storage
    .from(COMPLIANCE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (uploadErr) {
    console.error('[fleet-pro/compliance/fleet] upload failed:', uploadErr.message)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const record: Record<string, unknown> = {
    fleet_account_id:   fleetId,
    insurance_doc_url:  path,
    insurance_doc_name: file.name.slice(0, COMPLIANCE_LIMITS.file_name),
    updated_at:         new Date().toISOString(),
  }
  if (!existing) record.created_by = user?.id ?? null

  const { data, error } = await svc
    .from('fleet_pro_fleet_compliance')
    .upsert(record, { onConflict: 'fleet_account_id' })
    .select(FLEET_COMPLIANCE_COLUMNS)
    .single()

  if (error) {
    await svc.storage.from(COMPLIANCE_BUCKET).remove([path])
    console.error('[fleet-pro/compliance/fleet] certificate save failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const previous = (existing?.insurance_doc_url as string | null) ?? null
  if (previous && previous !== path) {
    const { error: rmErr } = await svc.storage.from(COMPLIANCE_BUCKET).remove([previous])
    if (rmErr) console.error('[fleet-pro/compliance/fleet] old certificate cleanup failed:', rmErr.message)
  }

  const { data: signed } = await svc.storage
    .from(COMPLIANCE_BUCKET)
    .createSignedUrl(path, COMPLIANCE_SIGNED_URL_TTL_SECONDS)

  return NextResponse.json({ fleet_record: data, signed_url: signed?.signedUrl ?? null })
}
