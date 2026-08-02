import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'

export const dynamic = 'force-dynamic'

// GET — the tech's late-fee settings (or null if never configured).
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { data, error } = await supabase
    .from('late_fee_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}

// POST — upsert the tech's late-fee settings (one row per user).
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const num = (v: unknown, fallback: number): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v)
    return fallback
  }
  const feeType = body.fee_type === 'percentage' ? 'percentage' : 'flat'

  const row = {
    user_id:               user.id,
    grace_period_days:     Math.max(0, Math.round(num(body.grace_period_days, 0))),
    fee_type:              feeType,
    flat_fee_amount:       num(body.flat_fee_amount, 25),
    percentage_rate:       num(body.percentage_rate, 1.5),
    send_sms_notification: body.send_sms_notification !== false,
    active:                body.active !== false,
  }

  // One row per user (enforced by the unique index in migration 078).
  const { data, error } = await supabase
    .from('late_fee_settings')
    .upsert(row, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ settings: data })
}
