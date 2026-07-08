import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getNearbyPartsStores } from '@/lib/roadie/nearby-stores'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lat = Number(req.nextUrl.searchParams.get('lat'))
  const lng = Number(req.nextUrl.searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
  }

  try {
    const stores = await getNearbyPartsStores(lat, lng)
    return NextResponse.json({ stores })
  } catch (err) {
    console.error('[parts-delivery/nearby-stores] failed', err)
    const msg = err instanceof Error && err.message === 'GOOGLE_MAPS_NOT_CONFIGURED'
      ? 'Store lookup is not configured.'
      : 'Could not load nearby stores.'
    return NextResponse.json({ error: msg, stores: [] }, { status: 502 })
  }
}
