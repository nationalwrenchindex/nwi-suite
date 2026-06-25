import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'

// ─── Cargo Watch — Notehub temperature events ───────────────────────────────────
// Returns the raw ds_data.qo event stream for the Delta Sentinel device so the
// dashboard can render the latest reading + a 24h history chart client-side.

const NOTEHUB_BASE = 'https://api.notefile.net'
const PROJECT_ID   = 'app:1a8c6ae4-e570-4a95-92b9-edb2a11aa13f'
const DEVICE_ID    = 'dev:862063070141804'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const token = process.env.NOTEHUB_API_TOKEN
  if (!token) return NextResponse.json({ error: 'Cargo Watch is not configured' }, { status: 503 })

  const params = new URLSearchParams({
    deviceUID: DEVICE_ID,
    files:     'ds_data.qo',
    pageSize:  '100',
  })
  const url = `${NOTEHUB_BASE}/v1/projects/${PROJECT_ID}/events?${params.toString()}`

  try {
    const res = await fetch(url, {
      headers: { 'X-SESSION-TOKEN': token, Accept: 'application/json' },
      cache:   'no-store',
      signal:  AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[cargo-watch/events] Notehub error', res.status, detail.slice(0, 300))
      return NextResponse.json({ error: 'Unable to connect to device' }, { status: 502 })
    }

    const data = await res.json()
    return NextResponse.json({ events: Array.isArray(data?.events) ? data.events : [] })
  } catch (err) {
    console.error('[cargo-watch/events] fetch failed', err)
    return NextResponse.json({ error: 'Unable to connect to device' }, { status: 502 })
  }
}
