'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

// ─── Palette (dark, works in both LD and HD QuickWrench) ─────────────────────
const ORANGE = '#16a34a'
const BLUE   = '#15803d'
const BG     = '#0d1820'
const BORDER = '#1e3040'
const INPUT  = '#162030'
const GREEN  = '#16A34A'
const YELLOW = '#CA8A04'

// ─── Types ───────────────────────────────────────────────────────────────────
export interface PartInput { name: string; oem: string; aftermarket?: string }
export interface DeliveryVehicleInfo {
  year?: string; make?: string; model?: string; engine?: string; trim?: string; vin?: string
  unitManufacturer?: string; unitModel?: string
}
interface Store {
  name: string; address: string; phone: string; placeId: string
  distanceMiles: number; lat: number; lng: number
  note?: string
}
interface PartRow { name: string; oem: string; aftermarket?: string; confirmed: boolean; verified: boolean }

interface QuoteResult {
  deliveryId: string; roadieFeeCents: number; platformFeeCents: number
  totalCents: number; etaMinutes: number; breakdown: string; storeName: string
}

type Screen = 'stores' | 'confirm' | 'quote' | 'tracking' | 'coming_soon'

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

// ─── Component ────────────────────────────────────────────────────────────────
export default function PartsOnTheWay({
  suite, parts, vehicleInfo, techPhone, onClose, onDeliveryDispatched,
}: {
  suite:                'ld' | 'hd'
  parts:                PartInput[]
  vehicleInfo:          DeliveryVehicleInfo
  techPhone:            string
  onClose:              () => void
  onDeliveryDispatched: (trackingUrl: string) => void
}) {
  const [screen, setScreen]     = useState<Screen>('stores')
  const [partRows, setPartRows] = useState<PartRow[]>(
    parts.map(p => ({ name: p.name, oem: p.oem, aftermarket: p.aftermarket, confirmed: true, verified: false })),
  )

  const [coords,   setCoords]   = useState<{ lat: number; lng: number } | null>(null)
  const [geoError, setGeoError] = useState('')
  const [stores,   setStores]   = useState<Store[] | null>(null)
  const [storesLoading, setStoresLoading] = useState(false)
  const [selectedStore, setSelectedStore] = useState<string>('') // placeId

  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')

  const [quote, setQuote] = useState<QuoteResult | null>(null)

  const [tracking, setTracking] = useState<{
    trackingUrl: string; driverName: string | null; driverPhone: string | null
    etaMinutes: number | null; status: string
  } | null>(null)

  // ── Geolocation → nearby stores ──
  useEffect(() => {
    if (!('geolocation' in navigator)) { setGeoError('Location not available on this device.'); return }
    navigator.geolocation.getCurrentPosition(
      pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()  => setGeoError('Location permission denied. Enable location to find nearby stores.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [])

  useEffect(() => {
    if (!coords) return
    setStoresLoading(true)
    fetch(`/api/parts-delivery/nearby-stores?lat=${coords.lat}&lng=${coords.lng}`)
      .then(r => r.json())
      .then(d => setStores(Array.isArray(d.stores) ? d.stores : []))
      .catch(() => setStores([]))
      .finally(() => setStoresLoading(false))
  }, [coords])

  // ── Field-verified catalog match (green badge) ──
  useEffect(() => {
    const oems = parts.map(p => p.oem?.trim()).filter(Boolean) as string[]
    if (oems.length === 0 || !vehicleInfo.make) return
    const supabase = createClient()
    supabase
      .from('confirmed_parts')
      .select('oem_part_number')
      .eq('suite', suite)
      .in('oem_part_number', oems)
      .then(({ data }) => {
        const verified = new Set((data ?? []).map((r: { oem_part_number: string }) => r.oem_part_number))
        if (verified.size === 0) return
        setPartRows(rows => {
          const next = rows.map(r => ({ ...r, verified: verified.has(r.oem) }))
          // verified parts first
          return next.sort((a, b) => Number(b.verified) - Number(a.verified))
        })
      })
  }, [parts, vehicleInfo.make, suite])

  const store = stores?.find(s => s.placeId === selectedStore) ?? null

  // ── Screen 2 → quote (+ confirm parts) ──
  async function submitConfirmAndQuote() {
    if (!store || !coords) { setError('Select a store first.'); return }
    const confirmedParts = partRows.filter(p => p.confirmed && p.name.trim())
    if (confirmedParts.length === 0) { setError('Confirm at least one part.'); return }
    setBusy(true); setError('')
    try {
      const qRes = await fetch('/api/parts-delivery/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suite,
          parts: confirmedParts.map(p => ({ name: p.name, oem: p.oem, aftermarket: p.aftermarket })),
          storeAddress: store.address, storeLat: store.lat, storeLng: store.lng,
          storePhone: store.phone, storeName: store.name,
          deliveryLat: coords.lat, deliveryLng: coords.lng,
          techPhone,
          vehicleInfo,
        }),
      })
      const qData = await qRes.json()
      if (qData.enabled === false) { setScreen('coming_soon'); return }
      if (!qRes.ok) throw new Error(qData.error ?? 'Could not get a quote.')

      // Persist confirmation + grow the catalog now that we have a deliveryId.
      await fetch('/api/parts-delivery/confirm-parts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryId: qData.deliveryId,
          confirmedParts: confirmedParts.map(p => ({ name: p.name, oem: p.oem, confirmed: true, aftermarket: p.aftermarket })),
        }),
      })

      setQuote({
        deliveryId:       qData.deliveryId,
        roadieFeeCents:   qData.roadieFeeCents,
        platformFeeCents: qData.platformFeeCents,
        totalCents:       qData.totalCents,
        etaMinutes:       qData.etaMinutes,
        breakdown:        qData.breakdown,
        storeName:        store.name,
      })
      setScreen('quote')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  // ── Screen 3 → dispatch ──
  async function dispatch() {
    if (!quote) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/parts-delivery/dispatch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryId: quote.deliveryId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Dispatch failed.')
      setTracking({
        trackingUrl: data.trackingUrl ?? '', driverName: data.driverName ?? null,
        driverPhone: data.driverPhone ?? null, etaMinutes: data.etaMinutes ?? quote.etaMinutes,
        status: 'dispatched',
      })
      onDeliveryDispatched(data.trackingUrl ?? '')
      setScreen('tracking')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dispatch failed.')
    } finally {
      setBusy(false)
    }
  }

  // ── Screen 4 → poll status every 30s ──
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollStatus = useCallback(async () => {
    if (!quote) return
    try {
      const res = await fetch(`/api/parts-delivery/status?deliveryId=${quote.deliveryId}`)
      const d = await res.json()
      if (res.ok) {
        setTracking(t => t ? {
          ...t,
          status:      d.status ?? t.status,
          driverName:  d.driverName ?? t.driverName,
          driverPhone: d.driverPhone ?? t.driverPhone,
          etaMinutes:  d.etaMinutes ?? t.etaMinutes,
          trackingUrl: d.trackingUrl ?? t.trackingUrl,
        } : t)
      }
    } catch { /* transient */ }
  }, [quote])

  useEffect(() => {
    if (screen !== 'tracking') return
    pollStatus()
    pollRef.current = setInterval(pollStatus, 30000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [screen, pollStatus])

  // ── Shared shell ──
  const isHD = suite === 'hd'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: '12px 12px 0 0', width: '100%', maxWidth: 540, maxHeight: '92dvh', display: 'flex', flexDirection: 'column' }} className="sm:rounded-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <h3 className="font-condensed font-bold text-xl flex items-center gap-2" style={{ color: '#fff' }}>
            <span>🚚</span> PARTS ON THE WAY
          </h3>
          <button onClick={onClose} style={{ color: '#8a9bad' }} aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex flex-col gap-4">
          {error && <div className="px-3 py-2 rounded-lg text-sm" style={{ background: '#2a1315', border: '1px solid #6b2530', color: '#fca5a5' }}>{error}</div>}

          {/* ── SCREEN 5: Coming soon ── */}
          {screen === 'coming_soon' && (
            <div className="text-center py-6 flex flex-col gap-3">
              <div className="text-4xl">🚚</div>
              <p className="font-condensed font-bold text-xl text-white">Parts on the Way — Coming Soon</p>
              <p className="text-sm" style={{ color: '#c9d5e0' }}>
                We&apos;re finalizing our delivery partner integration. This feature will let you get parts delivered to your job site in under an hour.
              </p>
              <button onClick={onClose} className="mt-2 mx-auto px-6 py-2.5 rounded-lg font-semibold text-sm text-white" style={{ background: ORANGE }}>Got It</button>
            </div>
          )}

          {/* ── SCREEN 1: Vehicle + parts + stores ── */}
          {screen === 'stores' && (
            <>
              {/* Section A */}
              <div className="p-3 rounded-lg" style={{ background: INPUT, border: `1px solid ${BORDER}` }}>
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: ORANGE }}>Tell This To The Parts Store</p>
                <div className="text-sm leading-relaxed" style={{ color: '#e5edf5' }}>
                  {(vehicleInfo.year || vehicleInfo.make || vehicleInfo.model) && (
                    <div>Year: <b>{vehicleInfo.year || '—'}</b>&nbsp; Make: <b>{vehicleInfo.make || '—'}</b>&nbsp; Model: <b>{vehicleInfo.model || '—'}</b></div>
                  )}
                  {(vehicleInfo.engine || vehicleInfo.trim) && (
                    <div>Engine: <b>{vehicleInfo.engine || '—'}</b>&nbsp; Trim: <b>{vehicleInfo.trim || '—'}</b></div>
                  )}
                  {vehicleInfo.vin && <div>VIN: <b>{vehicleInfo.vin}</b></div>}
                  {isHD && (vehicleInfo.unitManufacturer || vehicleInfo.unitModel) && (
                    <div>Unit: <b>{vehicleInfo.unitManufacturer || ''} {vehicleInfo.unitModel || ''}</b></div>
                  )}
                </div>
              </div>

              {/* Section B */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#8a9bad' }}>Parts Needed</p>
                <div className="flex flex-col gap-2">
                  {partRows.length === 0 && <p className="text-sm" style={{ color: '#8a9bad' }}>No parts suggested yet.</p>}
                  {partRows.map((p, i) => (
                    <div key={i} className="p-2.5 rounded-lg" style={{ background: INPUT, border: `1px solid ${BORDER}` }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-white">{p.name}</span>
                        {p.verified ? (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-white shrink-0" style={{ background: GREEN }}>Field Verified</span>
                        ) : (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-white shrink-0" style={{ background: YELLOW }}>AI suggested — verify with store</span>
                        )}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: '#8a9bad' }}>
                        {p.oem && <>OEM: <span className="font-mono" style={{ color: '#c9d5e0' }}>{p.oem}</span></>}
                        {p.aftermarket && <>&nbsp; Aftermarket: <span style={{ color: '#c9d5e0' }}>{p.aftermarket}</span></>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section C */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: '#8a9bad' }}>Nearby Stores</p>
                {geoError && <p className="text-xs mb-2" style={{ color: '#fca5a5' }}>{geoError}</p>}
                {storesLoading && <p className="text-sm" style={{ color: '#8a9bad' }}>Finding stores near you…</p>}
                {stores && stores.length === 0 && !storesLoading && <p className="text-sm" style={{ color: '#8a9bad' }}>No stores found nearby.</p>}
                <div className="flex flex-col gap-2">
                  {stores?.map(s => {
                    const sel = selectedStore === s.placeId
                    return (
                      <label key={s.placeId} className="p-3 rounded-lg cursor-pointer flex gap-3" style={{ background: INPUT, border: `1px solid ${sel ? ORANGE : BORDER}`, borderLeft: sel ? `3px solid ${ORANGE}` : `1px solid ${BORDER}` }}>
                        <input type="radio" name="store" checked={sel} onChange={() => setSelectedStore(s.placeId)} className="mt-1" style={{ accentColor: ORANGE }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-white">{s.name}</span>
                            <span className="text-xs shrink-0" style={{ color: ORANGE }}>{s.distanceMiles} mi</span>
                          </div>
                          <div className="text-xs mt-0.5" style={{ color: '#8a9bad' }}>{s.address}</div>
                          {s.phone && <a href={`tel:${s.phone}`} onClick={e => e.stopPropagation()} className="text-xs font-semibold" style={{ color: BLUE }}>📞 {s.phone}</a>}
                          {s.note && (
                            <p className="text-xs mt-1 px-1.5 py-1 rounded" style={{ background: '#2a2213', border: '1px solid #6b5417', color: '#FCD34D' }}>
                              ⚠ {s.note}
                            </p>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>
                <p className="text-xs mt-2 italic" style={{ color: '#8a9bad' }}>Call the store, read them the vehicle info above, confirm they have your parts.</p>
              </div>

              <button
                onClick={() => { setError(''); if (!selectedStore) { setError('Select a store first.'); return } setScreen('confirm') }}
                className="w-full py-3 rounded-lg font-semibold text-sm text-white"
                style={{ background: ORANGE }}
              >
                I Called — Store Has My Parts →
              </button>
            </>
          )}

          {/* ── SCREEN 2: Confirm parts ── */}
          {screen === 'confirm' && (
            <>
              <p className="text-sm" style={{ color: '#c9d5e0' }}>Check the parts the store confirmed. Update the OEM number if they gave you a different one.</p>
              <div className="flex flex-col gap-2">
                {partRows.map((p, i) => (
                  <div key={i} className="p-3 rounded-lg" style={{ background: INPUT, border: `1px solid ${BORDER}` }}>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={p.confirmed} onChange={e => setPartRows(rows => rows.map((r, ri) => ri === i ? { ...r, confirmed: e.target.checked } : r))} className="w-4 h-4" style={{ accentColor: ORANGE }} />
                      <span className="text-sm font-medium text-white">{p.name}</span>
                    </label>
                    {p.confirmed && (
                      <div className="mt-2 pl-6">
                        <label className="text-[10px] uppercase tracking-widest" style={{ color: '#8a9bad' }}>OEM Part #</label>
                        <input
                          value={p.oem}
                          onChange={e => setPartRows(rows => rows.map((r, ri) => ri === i ? { ...r, oem: e.target.value } : r))}
                          placeholder="Store-confirmed part number"
                          className="w-full mt-1 px-2 py-1.5 rounded font-mono text-sm"
                          style={{ background: BG, border: `1px solid ${BORDER}`, color: '#fff', outline: 'none' }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={submitConfirmAndQuote} disabled={busy} className="w-full py-3 rounded-lg font-semibold text-sm text-white disabled:opacity-50" style={{ background: ORANGE }}>
                {busy ? 'Getting quote…' : 'Confirm Parts & Get Delivery Quote →'}
              </button>
              <button onClick={() => setScreen('stores')} className="text-xs mx-auto" style={{ color: '#8a9bad' }}>← Back to stores</button>
            </>
          )}

          {/* ── SCREEN 3: Delivery quote ── */}
          {screen === 'quote' && quote && (
            <>
              <div className="p-4 rounded-lg" style={{ background: INPUT, border: `1px solid ${BORDER}` }}>
                <p className="text-sm font-semibold text-white mb-1">Delivery from {quote.storeName}</p>
                {store && <p className="text-xs" style={{ color: '#c9d5e0' }}>📍 {store.distanceMiles} miles away</p>}
                <p className="text-xs" style={{ color: '#c9d5e0' }}>⏱ Estimated arrival: {quote.etaMinutes} minutes</p>
                <div className="my-3" style={{ borderTop: `1px solid ${BORDER}` }} />
                <div className="flex justify-between text-sm" style={{ color: '#c9d5e0' }}><span>Delivery fee:</span><span>{usd(quote.roadieFeeCents)}</span></div>
                <div className="flex justify-between text-sm" style={{ color: '#c9d5e0' }}><span>Platform fee:</span><span>{usd(quote.platformFeeCents)}</span></div>
                <div className="my-2" style={{ borderTop: `1px solid ${BORDER}` }} />
                <div className="flex justify-between text-base font-bold text-white"><span>Total charged:</span><span style={{ color: ORANGE }}>{usd(quote.totalCents)}</span></div>
                <p className="text-xs mt-2" style={{ color: '#8a9bad' }}>Charged to card on file</p>
              </div>
              <div className="px-3 py-2 rounded-lg text-xs" style={{ background: '#2a2213', border: '1px solid #6b5417', color: '#FCD34D' }}>
                ⚠ This amount will be charged to your account immediately and added to your customer&apos;s invoice.
              </div>
              <button onClick={dispatch} disabled={busy} className="w-full py-3 rounded-lg font-semibold text-sm text-white disabled:opacity-50" style={{ background: ORANGE }}>
                {busy ? 'Dispatching…' : '✓ Confirm & Dispatch Driver'}
              </button>
              <button onClick={onClose} className="text-xs mx-auto" style={{ color: '#8a9bad' }}>✗ Cancel</button>
            </>
          )}

          {/* ── SCREEN 4: Tracking ── */}
          {screen === 'tracking' && tracking && (
            <div className="text-center flex flex-col gap-3 py-2">
              <div className="text-3xl">✓</div>
              <p className="font-condensed font-bold text-xl text-white">Driver Dispatched!</p>
              <p className="text-sm" style={{ color: '#c9d5e0' }}>
                {tracking.driverName ? <b>{tracking.driverName}</b> : 'A driver'} is on the way
              </p>
              {tracking.etaMinutes != null && <p className="text-sm" style={{ color: '#c9d5e0' }}>Estimated arrival: <b>{tracking.etaMinutes} minutes</b></p>}
              {tracking.trackingUrl && (
                <a href={tracking.trackingUrl} target="_blank" rel="noopener noreferrer" className="mx-auto px-6 py-2.5 rounded-lg font-semibold text-sm text-white" style={{ background: BLUE }}>Live Tracking →</a>
              )}
              <p className="text-xs" style={{ color: '#8a9bad' }}>Parts will be added to your invoice automatically.</p>
              {techPhone && <p className="text-xs" style={{ color: '#8a9bad' }}>Driver will call you on arrival: {techPhone}</p>}
              <button onClick={onClose} className="mt-1 mx-auto px-6 py-2.5 rounded-lg font-semibold text-sm" style={{ background: INPUT, color: '#c9d5e0', border: `1px solid ${BORDER}` }}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
