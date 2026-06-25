import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'

// ─── Cargo Watch — Notehub session/health ───────────────────────────────────────
// Returns the latest _session.qo event for the Delta Sentinel device: location,
// signal strength, battery voltage and last-seen timestamp for the status card.

const NOTEHUB_BASE = 'https://api.notefile.net'
const PROJECT_ID   = 'app:1a8c6ae4-e570-4a95-92b9-edb2a11aa13f'
const DEVICE_ID    = 'dev:862063070141804'

export const dynamic = 'force-dynamic'

function num(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

function str(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) return v
  }
  return null
}

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
    files:     '_session.qo',
    pageSize:  '1',
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
      console.error('[cargo-watch/session] Notehub error', res.status, detail.slice(0, 300))
      return NextResponse.json({ error: 'Unable to connect to device' }, { status: 502 })
    }

    const data   = await res.json()
    const events = Array.isArray(data?.events) ? data.events : []
    const latest = events[0] ?? null

    if (!latest) return NextResponse.json({ session: null })

    const body = (latest.body ?? {}) as Record<string, unknown>

    return NextResponse.json({
      session: {
        best_lat:           num(latest.best_lat, body.best_lat),
        best_lon:           num(latest.best_lon, body.best_lon),
        best_location:      str(latest.best_location, body.best_location),
        best_location_type: str(latest.best_location_type, body.best_location_type),
        rssi:               num(latest.rssi, body.rssi),
        bars:               num(latest.bars, body.bars),
        voltage:            num(latest.voltage, body.voltage),
        tower_lat:          num(latest.tower_lat, body.tower_lat),
        tower_lon:          num(latest.tower_lon, body.tower_lon),
        tower_location:     str(latest.tower_location, body.tower_location),
        received:           num(latest.received, latest.when),
      },
    })
  } catch (err) {
    console.error('[cargo-watch/session] fetch failed', err)
    return NextResponse.json({ error: 'Unable to connect to device' }, { status: 502 })
  }
}
