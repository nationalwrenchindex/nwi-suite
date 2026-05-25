import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    let body: { feature?: string; email?: string }
    try { body = await req.json() } catch { body = {} }

    const feature = (body.feature ?? 'parts_integration').slice(0, 100)
    const email   = (body.email ?? user.email ?? '').slice(0, 254)

    // Upsert so clicking twice doesn't error
    await supabase.from('hd_feature_notifications').upsert(
      { user_id: user.id, feature, email },
      { onConflict: 'user_id,feature', ignoreDuplicates: false }
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[feature-waitlist]', err)
    return NextResponse.json({ error: 'Failed to subscribe' }, { status: 500 })
  }
}
