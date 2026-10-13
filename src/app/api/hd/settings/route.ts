import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/hd/settings — the tech's HD profile settings. Client surfaces that are
// not server-rendered (QuickWrench) need the configured labor rate so the quotes,
// work orders and invoices they push carry the real rate instead of the 125 default.

// The columns that exist on every deployment.
const BASE = 'hd_labor_rate, hd_tech_name, hd_epa_cert_number, hd_company_logo_url'

// Added by migration 156. Migrations here are applied by hand in the Supabase console
// and the code deploys independently, so there is a window where these do not exist.
// Selecting a missing column fails the WHOLE query, which would take the labor rate
// and the logo down with the fees - and the HD quote and invoice forms read this
// endpoint to seed themselves.
const FEES = 'hd_diagnostic_fee, hd_road_call_fee'

function isMissingFeeColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = String((error as { code?: unknown }).code ?? '')
  if (code === 'PGRST204' || code === '42703') return true
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase()
  const missing =
    message.includes('does not exist') || message.includes('could not find') || message.includes('schema cache')
  return missing && (message.includes('hd_diagnostic_fee') || message.includes('hd_road_call_fee'))
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let { data, error } = await supabase
    .from('profiles')
    .select(`${BASE}, ${FEES}`)
    .eq('id', user.id)
    .single()

  if (error && isMissingFeeColumn(error)) {
    ;({ data, error } = await supabase
      .from('profiles')
      .select(BASE)
      .eq('id', user.id)
      .single())
  }

  // `fees_available` lets a caller tell "this shop has not set a fee" from "this
  // database cannot store one yet". The forms treat both as "use the fallback", but
  // the settings screen needs to know not to offer a field it cannot save.
  const row = (data ?? {}) as Record<string, unknown>
  return NextResponse.json({
    settings: data ?? null,
    fees_available: data != null && ('hd_diagnostic_fee' in row),
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    hd_labor_rate?: number | null
    hd_tech_name?: string | null
    hd_epa_cert_number?: string | null
    hd_company_logo_url?: string | null
    hd_diagnostic_fee?: number | null
    hd_road_call_fee?: number | null
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const updates: Record<string, unknown> = {}
  if ('hd_labor_rate'        in body) updates.hd_labor_rate        = body.hd_labor_rate
  if ('hd_tech_name'         in body) updates.hd_tech_name         = body.hd_tech_name
  if ('hd_epa_cert_number'   in body) updates.hd_epa_cert_number   = body.hd_epa_cert_number
  if ('hd_company_logo_url'  in body) updates.hd_company_logo_url  = body.hd_company_logo_url

  // The two fees (migration 156).
  //
  // NULL SURVIVES. Clearing the field means "I never said", and the forms fall back to
  // 125 and 0 for it. Coercing null to 0 would save "I charge nothing to diagnose",
  // which is a different and expensive statement.
  //
  // No pre-migration fallback on the write side, deliberately: GET degrades because a
  // form still has to render, but a save that cannot persist must fail loudly rather
  // than return ok and quietly discard the number the shop typed.
  for (const key of ['hd_diagnostic_fee', 'hd_road_call_fee'] as const) {
    if (!(key in body)) continue
    const raw = body[key]
    if (raw === null || raw === undefined || (raw as unknown) === '') {
      updates[key] = null
      continue
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0 || n > 99999) {
      return NextResponse.json({ error: `${key} must be a number between 0 and 99999, or blank` }, { status: 400 })
    }
    updates[key] = Math.round(n * 100) / 100
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
    if (error) {
      if (isMissingFeeColumn(error)) {
        return NextResponse.json({
          error: 'The diagnostic and road call fee settings are not available on this database yet (migration 156).',
        }, { status: 503 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
