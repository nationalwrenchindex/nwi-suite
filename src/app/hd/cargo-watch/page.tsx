'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

// ─── NWI brand colors (Cargo Watch) ─────────────────────────────────────────────
const ORANGE   = '#16a34a'
const BLUE     = '#15803d'
const BG       = '#1a1a1a'
const SURFACE  = '#242424'
const BORDER   = '#333333'
const MUTED     = 'rgba(255,255,255,0.5)'
const FAINT      = 'rgba(255,255,255,0.35)'

const DEVICE_ID = 'dev:862063070141804'

// How recent the last ping must be for the device to count as "online"
const ONLINE_WINDOW_MS = 15 * 60 * 1000

// ─── Types ───────────────────────────────────────────────────────────────────────
interface DsEvent {
  when?:     number
  received?: number
  body?: {
    temp1_f?: number
    temp2_f?: number
    [k: string]: unknown
  }
}

interface SessionData {
  best_lat:           number | null
  best_lon:           number | null
  best_location:      string | null
  best_location_type: string | null
  rssi:               number | null
  bars:               number | null
  voltage:            number | null
  tower_lat:          number | null
  tower_lon:          number | null
  tower_location:     string | null
  received:           number | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────────────
function eventTimeMs(e: DsEvent): number {
  const t = e.received ?? e.when ?? 0
  return t > 0 ? t * 1000 : 0
}

function barsFromRssi(rssi: number | null): number {
  if (rssi === null) return 0
  if (rssi > -70)  return 5
  if (rssi > -80)  return 4
  if (rssi > -90)  return 3
  if (rssi > -100) return 2
  return 1
}

function voltageColor(v: number | null): string {
  if (v === null) return MUTED
  if (v > 4.0) return '#22C55E'
  if (v >= 3.5) return '#EAB308'
  return '#EF4444'
}

function tempColor(f: number | null): string {
  if (f === null) return MUTED
  if (f < 35) return BLUE
  if (f < 50) return '#22C55E'
  if (f <= 70) return '#EAB308'
  return '#EF4444'
}

function fmtTime(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  return `${hh}:${mm}`
}

function fmtDateTime(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function timeAgo(ms: number): string {
  if (!ms) return 'never'
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (secs < 60)    return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60)    return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24)     return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

// ─── Page ───────────────────────────────────────────────────────────────────────
export default function CargoWatchPage() {
  const [events,     setEvents]     = useState<DsEvent[]>([])
  const [session,    setSession]    = useState<SessionData | null>(null)
  const [lastUpdate, setLastUpdate] = useState<number>(0)
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [connError,  setConnError]  = useState(false)

  const loadData = useCallback(async () => {
    setRefreshing(true)
    try {
      const [evRes, seRes] = await Promise.all([
        fetch('/api/hd/cargo-watch/events',  { cache: 'no-store' }),
        fetch('/api/hd/cargo-watch/session', { cache: 'no-store' }),
      ])

      if (!evRes.ok && !seRes.ok) {
        setConnError(true)
        return
      }

      if (evRes.ok) {
        const ev = await evRes.json()
        setEvents(Array.isArray(ev.events) ? ev.events : [])
      }
      if (seRes.ok) {
        const se = await seRes.json()
        setSession(se.session ?? null)
      }

      setConnError(!evRes.ok || !seRes.ok)
      setLastUpdate(Date.now())
    } catch {
      setConnError(true)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // Initial load + 60s auto-refresh
  useEffect(() => {
    loadData()
    const id = setInterval(loadData, 60_000)
    return () => clearInterval(id)
  }, [loadData])

  // Most recent temperature reading
  const latestTemp = useMemo(() => {
    const sorted = [...events].sort((a, b) => eventTimeMs(b) - eventTimeMs(a))
    return sorted[0] ?? null
  }, [events])

  const temp1 = typeof latestTemp?.body?.temp1_f === 'number' ? latestTemp.body.temp1_f : null
  const temp2 = typeof latestTemp?.body?.temp2_f === 'number' ? latestTemp.body.temp2_f : null
  const latestTempMs = latestTemp ? eventTimeMs(latestTemp) : 0

  // Last 24h chart data — ascending, max 24 points
  const chartData = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    return [...events]
      .map(e => ({
        ms:    eventTimeMs(e),
        temp1: typeof e.body?.temp1_f === 'number' ? e.body.temp1_f : null,
        temp2: typeof e.body?.temp2_f === 'number' ? e.body.temp2_f : null,
      }))
      .filter(d => d.ms >= cutoff && (d.temp1 !== null || d.temp2 !== null))
      .sort((a, b) => a.ms - b.ms)
      .slice(-24)
      .map(d => ({ time: fmtTime(d.ms), temp1: d.temp1, temp2: d.temp2 }))
  }, [events])

  // Last ping = most recent of session/temperature timestamps
  const lastPingMs = Math.max(
    latestTempMs,
    session?.received ? session.received * 1000 : 0,
  )
  const isOnline = lastPingMs > 0 && (Date.now() - lastPingMs) < ONLINE_WINDOW_MS

  const bars       = barsFromRssi(session?.rssi ?? null)
  const hasTempData = events.length > 0

  // Prefer GPS-accurate best_lat/best_lon. Only fall back to tower
  // triangulation coordinates when a best fix is unavailable.
  const usingBest = session?.best_lat != null && session?.best_lon != null
  const locLat = usingBest ? session!.best_lat : (session?.tower_lat ?? null)
  const locLon = usingBest ? session!.best_lon : (session?.tower_lon ?? null)
  const isGpsFix = usingBest && session?.best_location_type === 'gps'
  const hasLocation = locLat != null && locLon != null

  const mapsUrl = hasLocation
    ? `https://www.google.com/maps?q=${locLat},${locLon}`
    : null

  return (
    <main className="flex-1 p-4 sm:p-6" style={{ background: BG }}>
      <div className="max-w-3xl mx-auto">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">Cargo Watch</h1>
            <p className="text-sm" style={{ color: MUTED }}>Delta Sentinel Live Monitor</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full"
              style={isOnline
                ? { background: '#0f2f1c', color: '#22C55E', border: '1px solid #1c5c34' }
                : { background: '#2a2a2a', color: MUTED, border: `1px solid ${BORDER}` }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: isOnline ? '#22C55E' : '#666' }}
              />
              {isOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
            <span className="flex items-center gap-1.5 text-xs" style={{ color: FAINT }}>
              {refreshing && (
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{ background: ORANGE }}
                />
              )}
              {loading ? 'Loading…' : `Updated ${lastUpdate ? timeAgo(lastUpdate) : '—'}`}
            </span>
          </div>
        </div>

        {/* ── Connection error banner ── */}
        {connError && (
          <div
            className="rounded-xl p-4 mb-4 text-sm"
            style={{ background: '#2a1505', border: `1px solid ${ORANGE}55`, color: '#FBBF24' }}
          >
            Unable to connect to device. Last known data shown.
          </div>
        )}

        {/* ── Device Status Card ── */}
        <section className="rounded-xl p-5 mb-4" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          <p className="text-xs uppercase tracking-widest mb-3" style={{ color: FAINT }}>Device Status</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs mb-1" style={{ color: MUTED }}>Device ID</p>
              <p className="text-sm font-mono text-white break-all">{DEVICE_ID}</p>
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: MUTED }}>Location</p>
              <p className="text-sm text-white">{session?.best_location ?? '—'}</p>
            </div>

            <div>
              <p className="text-xs mb-1" style={{ color: MUTED }}>Signal</p>
              <div className="flex items-end gap-1 h-5">
                {[1, 2, 3, 4, 5].map(n => (
                  <span
                    key={n}
                    className="w-1.5 rounded-sm"
                    style={{
                      height: `${n * 18}%`,
                      background: n <= bars ? BLUE : BORDER,
                    }}
                  />
                ))}
                <span className="text-xs ml-2" style={{ color: MUTED }}>
                  {session?.rssi != null ? `${session.rssi} dBm` : '—'}
                </span>
              </div>
            </div>

            <div>
              <p className="text-xs mb-1" style={{ color: MUTED }}>Battery</p>
              <p className="text-lg font-bold" style={{ color: voltageColor(session?.voltage ?? null) }}>
                {session?.voltage != null ? `${session.voltage.toFixed(2)} V` : '—'}
              </p>
            </div>
          </div>

          <div className="mt-4 pt-3 flex items-center justify-between" style={{ borderTop: `1px solid ${BORDER}` }}>
            <span className="text-xs" style={{ color: MUTED }}>Last ping</span>
            <span className="text-sm text-white">{lastPingMs ? timeAgo(lastPingMs) : 'never'}</span>
          </div>
        </section>

        {/* ── Temperature Card ── */}
        <section className="rounded-xl p-5 mb-4" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          <p className="text-xs uppercase tracking-widest mb-3" style={{ color: FAINT }}>Current Temperature</p>

          {!hasTempData ? (
            <p className="text-sm leading-relaxed" style={{ color: MUTED }}>
              No temperature readings received yet.<br />
              Confirm Delta Sentinel is powered and connected.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs mb-1" style={{ color: MUTED }}>Temp 1</p>
                  <p className="text-4xl font-bold tracking-tight" style={{ color: tempColor(temp1) }}>
                    {temp1 != null ? `${temp1.toFixed(1)}°` : '—'}
                    <span className="text-lg font-semibold" style={{ color: MUTED }}>F</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs mb-1" style={{ color: MUTED }}>Temp 2</p>
                  <p className="text-4xl font-bold tracking-tight" style={{ color: tempColor(temp2) }}>
                    {temp2 != null ? `${temp2.toFixed(1)}°` : '—'}
                    <span className="text-lg font-semibold" style={{ color: MUTED }}>F</span>
                  </p>
                </div>
              </div>
              <p className="text-xs mt-3" style={{ color: FAINT }}>
                Last reading {latestTempMs ? fmtDateTime(latestTempMs) : '—'}
              </p>
            </>
          )}
        </section>

        {/* ── Temperature History Chart ── */}
        <section className="rounded-xl p-5 mb-4" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs uppercase tracking-widest" style={{ color: FAINT }}>24-Hour History</p>
            <div className="flex items-center gap-3 text-xs" style={{ color: MUTED }}>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: ORANGE }} /> Temp 1
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: BLUE }} /> Temp 2
              </span>
            </div>
          </div>

          {chartData.length === 0 ? (
            <p className="text-sm py-8 text-center" style={{ color: MUTED }}>
              No readings in the last 24 hours.
            </p>
          ) : (
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                  <XAxis dataKey="time" tick={{ fill: MUTED, fontSize: 11 }} stroke={BORDER} />
                  <YAxis
                    tick={{ fill: MUTED, fontSize: 11 }}
                    stroke={BORDER}
                    unit="°"
                    width={44}
                  />
                  <Tooltip
                    contentStyle={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 8, color: '#fff' }}
                    labelStyle={{ color: MUTED }}
                    formatter={(v) => (typeof v === 'number' ? `${v}°F` : '—')}
                  />
                  <Line type="monotone" dataKey="temp1" name="Temp 1" stroke={ORANGE} strokeWidth={2} dot={false} connectNulls />
                  <Line type="monotone" dataKey="temp2" name="Temp 2" stroke={BLUE}   strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* ── GPS Location Card ── */}
        <section className="rounded-xl p-5 mb-4" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs uppercase tracking-widest" style={{ color: FAINT }}>GPS Location</p>
            {hasLocation && (
              <span
                className="inline-flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full"
                style={isGpsFix
                  ? { background: '#0f2f1c', color: '#22C55E', border: '1px solid #1c5c34' }
                  : { background: '#2a2105', color: '#EAB308', border: '1px solid #5c4a0f' }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: isGpsFix ? '#22C55E' : '#EAB308' }}
                />
                {isGpsFix ? 'GPS' : 'Estimated'}
              </span>
            )}
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: MUTED }}>Location</span>
              <span className="text-sm text-white text-right">{session?.best_location ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: MUTED }}>Coordinates</span>
              <span className="text-sm font-mono text-white text-right">
                {hasLocation
                  ? `${locLat!.toFixed(5)}, ${locLon!.toFixed(5)}`
                  : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: MUTED }}>Last fix</span>
              <span className="text-sm text-white text-right">
                {session?.received ? fmtDateTime(session.received * 1000) : '—'}
              </span>
            </div>
          </div>

          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: BLUE }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <circle cx="12" cy="11" r="3" />
              </svg>
              Open in Google Maps
            </a>
          )}
        </section>

      </div>
    </main>
  )
}
