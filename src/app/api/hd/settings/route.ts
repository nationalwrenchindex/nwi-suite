import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/hd/settings — the tech's HD profile settings. Client surfaces that are
// not server-rendered (QuickWrench) need the configured labor rate so the quotes,
// work orders and invoices they push carry the real rate instead of the 125 default.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('profiles')
    .select('hd_labor_rate, hd_tech_name, hd_epa_cert_number, hd_company_logo_url')
    .eq('id', user.id)
    .single()

  return NextResponse.json({ settings: data ?? null })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { hd_labor_rate?: number | null; hd_tech_name?: string | null; hd_epa_cert_number?: string | null; hd_company_logo_url?: string | null }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const updates: Record<string, unknown> = {}
  if ('hd_labor_rate'        in body) updates.hd_labor_rate        = body.hd_labor_rate
  if ('hd_tech_name'         in body) updates.hd_tech_name         = body.hd_tech_name
  if ('hd_epa_cert_number'   in body) updates.hd_epa_cert_number   = body.hd_epa_cert_number
  if ('hd_company_logo_url'  in body) updates.hd_company_logo_url  = body.hd_company_logo_url

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
