import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { code?: string }
  try { body = await req.json() } catch { return NextResponse.json({ valid: false, error: 'Invalid request' }) }

  const code = body.code?.trim()
  if (!code) return NextResponse.json({ valid: false, error: 'No code provided' })

  try {
    const { data: promos } = await stripe.promotionCodes.list({ code, active: true, limit: 1 })
    if (!promos?.length) {
      return NextResponse.json({ valid: false, error: 'Invalid or expired promo code' })
    }
    return NextResponse.json({ valid: true, promotionCodeId: promos[0].id })
  } catch {
    return NextResponse.json({ valid: false, error: 'Unable to validate code — please try again' })
  }
}
