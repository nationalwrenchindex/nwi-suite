import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { HD_EXTRAS_SELECT, LD_EXTRAS_SELECT } from '@/lib/hd/hd-extras'

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

  // Drive time, mileage, shop supplies and the service call fee (migration 178). Its own
  // query, so a database without 178 loses only these and never the labor rate or logo.
  const extras = await supabase.from('profiles').select(HD_EXTRAS_SELECT).eq('id', user.id).maybeSingle()
  // Before 178 the HD forms bill from LD's 142 columns, exactly as they did before.
  const ld = extras.error ? await supabase.from('profiles').select(LD_EXTRAS_SELECT).eq('id', user.id).maybeSingle() : null

  return NextResponse.json({
    settings: data ?? null,
    fees_available: data != null && ('hd_diagnostic_fee' in row),
    extras: extras.error ? null : (extras.data ?? null),
    extras_available: !extras.error,
    extras_ld: ld && !ld.error ? (ld.data ?? null) : null,
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
  } & Record<string, unknown>
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

  // Migration 178. Same rules: NULL survives (a blank rate means "not set", which for
  // drive time means "bill it at the labor rate"), 0 is a real answer, negatives refused.
  const HD_NUMBERS: Array<[string, number]> = [
    ['hd_travel_rate_per_hour', 9999], ['hd_mileage_rate_per_mile', 99], ['hd_shop_supplies_percent', 100],
    ['hd_shop_supplies_cap', 99999], ['hd_service_call_fee', 99999],
  ]
  let extrasWrite = false
  for (const key of ['hd_bill_travel', 'hd_bill_mileage', 'hd_bill_shop_supplies', 'hd_bill_service_call']) {
    if (!(key in body)) continue
    if (typeof body[key] !== 'boolean') return NextResponse.json({ error: `${key} must be true or false` }, { status: 400 })
    updates[key] = body[key]; extrasWrite = true
  }
  for (const [key, max] of HD_NUMBERS) {
    if (!(key in body)) continue
    extrasWrite = true
    const raw = body[key]
    if (raw === null || raw === undefined || raw === '') { updates[key] = null; continue }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0 || n > max) {
      return NextResponse.json({ error: `${key} must be a number between 0 and ${max}, or blank` }, { status: 400 })
    }
    updates[key] = key === 'hd_mileage_rate_per_mile' ? Math.round(n * 10000) / 10000
      : key === 'hd_shop_supplies_percent' ? Math.round(n * 1000) / 1000 : Math.round(n * 100) / 100
  }
  if ('hd_service_call_tax' in body) {
    if (body.hd_service_call_tax !== 'labor' && body.hd_service_call_tax !== 'none') {
      return NextResponse.json({ error: "hd_service_call_tax must be 'labor' or 'none'" }, { status: 400 })
    }
    updates.hd_service_call_tax = body.hd_service_call_tax; extrasWrite = true
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
    if (error) {
      if (extrasWrite && /hd_(bill_|travel_|mileage_|shop_supplies_|service_call_)/.test(error.message ?? '')) {
        return NextResponse.json({
          error: 'Drive time, mileage, shop supplies and service call settings are not available on this database yet (migration 178). Nothing was saved.',
        }, { status: 503 })
      }
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
