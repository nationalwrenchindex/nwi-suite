'use client'

// The parts counter: maker, unit, part type, answer. One component for /hd/parts and
// /reefer/parts - the surfaces differ only in `scope`, a filter on the catalog's data.
//
// THE FLOW (spec section 5): pick a unit you already have, or the maker; then the unit
// (model, BM, serial); then the part type from a flat list grouped by category; then a
// card per answer. A search box takes a part number in any format, a cross number, or
// the words a tech actually uses ("lube filter").
//
// WHAT A CARD SAYS AND DOES NOT SAY
//   * The trust tier, in words, and what to do about it - "one source, verify by serial".
//     A pre-migration-175 row says "verified" or "unverified", never a tier it was not
//     given.
//   * The current number first, and the number it replaced underneath as "was". A
//     weaker replacement is reported, never substituted.
//   * What on the shelf: on hand, allocated to open jobs, available.
//   * NO PRICE and NO SOURCE. A counter that put a cost beside a cross number would sit a
//     store's brand next to a price; cost and sell live on the inventory screen.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { counterStockLines, wrongCountLabel } from '@/lib/parts/stock-display'

export type CounterScope = 'all' | 'reefer'

interface Options {
  makers: string[]
  models: Record<string, string[]>
  part_types: Array<{ category: string; types: string[] }>
  units: Array<{ id: string; label: string; maker: string; model: string; serial: string; bm: string }>
}

interface CounterResult {
  id: string
  part_number: string
  manufacturer: string
  part_type: string
  description: string | null
  notes: string | null
  badge: string
  display: 'plain' | 'observed' | 'one_source' | 'conflict'
  advice: string | null
  matched_on: string
  was: string[]
  reported_replaced_by: { to: string; note: string | null; badge: string } | null
  /** False for an old number: shown so it can be found, never offered as the answer. */
  current: boolean
  replaced_by: Array<{ to: string; note: string | null; badge: string; followed: boolean }>
  /** The condition on a conditional replacement (11-9958 -> 11-9965 standard duty ...). */
  condition: string | null
  suppressed: boolean
  suppressed_reason: string | null
  unresolved_serial: boolean
  fitment: Array<{
    id: string; unit_model: string | null; engine: string | null; compressor_model: string | null
    serial_label: string | null; build_date_from: string | null; build_date_before: string | null; qty_per_unit: number | null
    mount_type: string | null; configuration: string | null; role: string | null
    note: string | null; badge: string; display: string
  }>
  crosses: Array<{ brand: string; numbers: Array<{ number: string; badge: string; display: string }> }>
  stock: { on_hand: number; allocated: number; available: number; locations: Array<{ location_id: string; location_name: string | null; bin: string | null; on_hand: number; available: number }> }
}

interface CounterResponse {
  count: number
  unresolved_serial_count: number
  bm_note: string | null
  build_date_note: string | null
  /** What the chart held back: weaker matches it does not support. */
  suppressed: Array<{ part_number: string; part_type: string; reason: string }>
  show_unconfirmed: boolean
  configuration_choices: Array<{ part_type: string; role: string | null; options: Array<{ configuration: string; part_numbers: string[] }> }>
  results: CounterResult[]
}

const PRIMARY = '#FF6600'

const field = { background: 'var(--hd-card)', border: '1px solid var(--hd-border)', minHeight: 44 } as const
const inputCls = 'w-full px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder:text-white/30 outline-none'

/** The badge colour says how much to trust the claim. Amber and red are the warnings. */
function Badge({ text, display }: { text: string; display: string }) {
  const color = display === 'conflict' ? 'var(--hd-negative)'
    : display === 'one_source' ? 'var(--hd-warn)'
    : display === 'observed' ? 'var(--hd-info)'
    : 'var(--hd-positive)'
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wide"
      style={{ color, border: `1px solid ${color}` }}
    >
      {text}
    </span>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs mb-1" style={{ color: 'var(--hd-text-faint)' }}>{children}</span>
}

export default function PartsCounter({ scope }: { scope: CounterScope }) {
  const [options, setOptions] = useState<Options | null>(null)
  const [optError, setOptError] = useState<string | null>(null)

  const [unitId, setUnitId]     = useState('')
  const [maker, setMaker]       = useState('')
  const [model, setModel]       = useState('')
  const [bm, setBm]             = useState('')
  const [serial, setSerial]     = useState('')
  const [engine, setEngine]     = useState('')
  const [partType, setPartType] = useState('')
  const [q, setQ]               = useState('')
  const [buildDate, setBuildDate] = useState('')
  // Set by answering the counter's "which configuration?" - never typed.
  const [configuration, setConfiguration] = useState('')
  // GUARD (Brock, Nov 16): reveals exactly what the chart suppressed.
  const [showUnconfirmed, setShowUnconfirmed] = useState(false)

  const [data, setData]       = useState<CounterResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/parts/counter/options?scope=${scope}`, { cache: 'no-store' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? 'Could not load the counter.'); return j as Options })
      .then(setOptions)
      .catch(e => setOptError(e instanceof Error ? e.message : 'Could not load the counter.'))
  }, [scope])

  // Step 0: a unit the shop already has fills in everything it knows.
  function pickUnit(id: string) {
    setUnitId(id)
    const u = options?.units.find(x => x.id === id)
    if (!u) return
    setMaker(u.maker); setModel(u.model); setSerial(u.serial); setBm(u.bm)
  }

  const run = useCallback(async (over?: { configuration?: string; showUnconfirmed?: boolean }) => {
    setLoading(true); setError(null)
    const cfg = over?.configuration ?? configuration
    const unconf = over?.showUnconfirmed ?? showUnconfirmed
    try {
      const p = new URLSearchParams({ scope })
      if (maker)          p.set('maker', maker)
      if (model.trim())   p.set('model', model.trim())
      if (serial.trim())  p.set('serial', serial.trim())
      if (bm.trim())      p.set('bm', bm.trim())
      if (engine.trim())  p.set('engine', engine.trim())
      if (buildDate.trim()) p.set('build_date', buildDate.trim())
      if (cfg)            p.set('configuration', cfg)
      if (unconf)         p.set('show_unconfirmed', '1')
      if (partType)       p.set('part_type', partType)
      if (q.trim())       p.set('q', q.trim())
      const res = await fetch(`/api/parts/counter?${p}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Search failed.')
      setData(json as CounterResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed.'); setData(null)
    } finally {
      setLoading(false)
    }
  }, [scope, maker, model, serial, bm, engine, buildDate, configuration, showUnconfirmed, partType, q])

  function chooseConfiguration(c: string) {
    setConfiguration(c)
    void run({ configuration: c })
  }
  function toggleUnconfirmed() {
    const next = !showUnconfirmed
    setShowUnconfirmed(next)
    void run({ showUnconfirmed: next })
  }

  const models = useMemo(() => (maker && options ? options.models[maker] ?? [] : []), [maker, options])
  const category = options?.part_types.find(g => g.types.includes(partType))?.category
  const crumbs = [maker, model.trim(), category, partType].filter(Boolean)
  const canRun = !!(model.trim() || bm.trim() || engine.trim() || q.trim() || partType)

  return (
    <div className="space-y-5">
      <div className="rounded-xl p-4 space-y-4" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}>
        {optError && <p className="text-sm" style={{ color: 'var(--hd-negative)' }}>{optError}</p>}

        {/* Step 0 - a unit already on file */}
        {options && options.units.length > 0 && (
          <label className="block">
            <Label>Your units</Label>
            <select value={unitId} onChange={e => pickUnit(e.target.value)} className={inputCls} style={field}>
              <option value="">Pick a unit you already have, or enter it below</option>
              {options.units.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
          </label>
        )}

        {/* Step 1 - maker */}
        <div>
          <Label>Make</Label>
          <div className="grid grid-cols-2 gap-3">
            {(options?.makers ?? ['Thermo King', 'Carrier Transicold']).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => { setMaker(maker === m ? '' : m); setUnitId('') }}
                aria-pressed={maker === m}
                className="px-4 py-3 rounded-lg text-sm font-semibold text-white"
                style={{
                  background: 'var(--hd-inner)', minHeight: 52,
                  border: maker === m ? `2px solid ${PRIMARY}` : '1px solid var(--hd-border)',
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Step 2 - unit identity. Model is the only one a result needs. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block">
            <Label>Unit model</Label>
            <input value={model} onChange={e => { setModel(e.target.value); setUnitId('') }} list="counter-models"
              placeholder={maker === 'Carrier Transicold' ? 'Supra 660' : 'SB-210'} className={inputCls} style={field} />
            <datalist id="counter-models">{models.map(m => <option key={m} value={m} />)}</datalist>
          </label>
          <label className="block">
            <Label>BM number <span style={{ color: 'var(--hd-text-faint)' }}>(Thermo King)</span></Label>
            <input value={bm} onChange={e => setBm(e.target.value)} placeholder="920381" className={inputCls} style={field} />
          </label>
          <label className="block">
            <Label>Serial</Label>
            <input value={serial} onChange={e => setSerial(e.target.value)} placeholder="GAG90483303" className={inputCls} style={field} />
          </label>
          <label className="block">
            <Label>Engine <span style={{ color: 'var(--hd-text-faint)' }}>(if known)</span></Label>
            <input value={engine} onChange={e => setEngine(e.target.value)} placeholder="TK486V" className={inputCls} style={field} />
          </label>
          <label className="block">
            <Label>Build date <span style={{ color: 'var(--hd-text-faint)' }}>(if known)</span></Label>
            <input value={buildDate} onChange={e => setBuildDate(e.target.value)} placeholder="2023-07" className={inputCls} style={field} />
          </label>
        </div>

        {/* Step 3 - part type. A flat list; the category is a header, not a step. */}
        {options && options.part_types.length > 0 && (
          <div>
            <Label>Part type</Label>
            <div className="space-y-2">
              {options.part_types.map(g => (
                <div key={g.category}>
                  <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--hd-text-faint)' }}>{g.category}</p>
                  <div className="flex flex-wrap gap-2">
                    {g.types.map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setPartType(partType === t ? '' : t)}
                        aria-pressed={partType === t}
                        className="px-3 py-1.5 rounded-lg text-sm text-white"
                        style={{ background: 'var(--hd-inner)', border: partType === t ? `2px solid ${PRIMARY}` : '1px solid var(--hd-border)' }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Always present: a number in any format, a cross number, or plain words. */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
          <label className="block">
            <Label>Part number, cross number or part name</Label>
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && canRun) { setConfiguration(''); void run({ configuration: '' }) } }}
              placeholder="11-9959 or 30-60143-01" className={inputCls} style={field} />
          </label>
          <button type="button" onClick={() => { setConfiguration(''); void run({ configuration: '' }) }} disabled={loading || !canRun}
            className="px-6 rounded-lg text-sm font-semibold text-on-accent disabled:opacity-50"
            style={{ background: PRIMARY, minHeight: 44 }}>
            {loading ? 'Searching...' : 'Find parts'}
          </button>
        </div>

        {crumbs.length > 0 && (
          <p className="text-xs" style={{ color: 'var(--hd-text-muted)' }}>{crumbs.join(' > ')}</p>
        )}
      </div>

      {error && <p className="text-sm" style={{ color: 'var(--hd-negative)' }}>{error}</p>}

      {data && (
        <p className="text-xs" style={{ color: 'var(--hd-text-muted)' }}>
          {data.count} {data.count === 1 ? 'part' : 'parts'}
          {data.unresolved_serial_count > 0 && (
            <span style={{ color: 'var(--hd-warn)' }}> &middot; {data.unresolved_serial_count} could not be narrowed by the serial given</span>
          )}
        </p>
      )}
      {data?.bm_note && <p className="text-xs" style={{ color: 'var(--hd-warn)' }}>{data.bm_note}</p>}
      {data?.build_date_note && <p className="text-xs" style={{ color: 'var(--hd-warn)' }}>{data.build_date_note}</p>}

      {/* Parts split only by configuration: ask, rather than hand back two unexplained hits. */}
      {data && (data.configuration_choices.length > 0 || configuration) && (
        <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--hd-card)', border: `1px solid ${PRIMARY}` }} data-testid="configuration-choice">
          {configuration && (
            <p className="text-sm text-white">
              Showing the parts for <span className="font-semibold">{configuration}</span>.{' '}
              <button type="button" className="underline text-xs" style={{ color: 'var(--hd-text-muted)' }} onClick={() => chooseConfiguration('')}>Show every configuration</button>
            </p>
          )}
          {data.configuration_choices.map(c => (
            <div key={`${c.part_type}|${c.role ?? ''}`}>
              <p className="text-sm text-white font-medium">Which configuration? <span style={{ color: 'var(--hd-text-muted)' }}>{c.role ?? c.part_type}</span></p>
              <div className="flex flex-wrap gap-2 mt-2">
                {c.options.map(o => (
                  <button key={o.configuration} type="button" onClick={() => chooseConfiguration(o.configuration)}
                    className="px-3 py-2 rounded-lg text-sm text-white" style={{ background: 'var(--hd-inner)', border: '1px solid var(--hd-border)', minHeight: 44 }}>
                    {o.configuration} <span className="font-mono text-xs" style={{ color: 'var(--hd-text-muted)' }}>{o.part_numbers.join(', ')}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* GUARD: what the chart held back, and a way to see exactly that. */}
      {data && (data.suppressed.length > 0 || showUnconfirmed) && (
        <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--hd-text-muted)' }}>
          <span>
            {data.suppressed.length} unconfirmed {data.suppressed.length === 1 ? 'match' : 'matches'} held back because Brock&apos;s chart covers this unit
          </span>
          <label className="inline-flex items-center gap-2 cursor-pointer text-white" style={{ minHeight: 44 }}>
            <input type="checkbox" checked={showUnconfirmed} onChange={toggleUnconfirmed} />
            Show unconfirmed matches
          </label>
        </div>
      )}

      {data && data.results.length === 0 && (
        <div className="rounded-xl p-6 text-center" style={{ background: 'var(--hd-card)', border: '1px solid var(--hd-border)' }}>
          <p className="text-white text-sm font-medium">No part is recorded for that.</p>
          <p className="text-sm mt-2" style={{ color: 'var(--hd-text-muted)' }}>
            {model.trim()
              ? 'Nothing in the catalog has fitment for that unit yet. That means nobody has recorded one - not that no part exists.'
              : 'Nothing matches that number or name.'}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {data?.results.map(r => <ResultCard key={r.id} r={r} />)}
      </div>
    </div>
  )
}

function ResultCard({ r }: { r: CounterResult }) {
  const old = !r.current
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'var(--hd-card)', border: '1px solid var(--hd-border)', opacity: old || r.suppressed ? 0.85 : 1,
        borderLeft: `4px solid ${old ? 'var(--hd-text-faint)' : r.display === 'conflict' ? 'var(--hd-negative)' : r.display === 'one_source' ? 'var(--hd-warn)' : PRIMARY}`,
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-mono text-2xl font-bold tracking-wide ${old ? 'line-through' : ''}`} style={{ color: old ? 'var(--hd-text-muted)' : 'white' }}>{r.part_number}</span>
            {old && <Badge text="old number" display="one_source" />}
            {r.suppressed && <Badge text="not in the chart" display="one_source" />}
            <Badge text={r.badge} display={r.display} />
            {r.unresolved_serial && <Badge text="serial not comparable" display="one_source" />}
          </div>
          {old && r.replaced_by.length > 0 && (
            <div className="text-sm mt-1 text-white">
              <p>Not current. {r.replaced_by.length > 1 ? 'Replaced by one of these - pick by the condition:' : 'Replaced by:'}</p>
              <ul className="mt-0.5 space-y-0.5">
                {r.replaced_by.map(x => (
                  <li key={x.to} className="text-xs">
                    <span className="font-mono font-semibold">{x.to}</span>{' '}
                    {x.note && <span style={{ color: 'var(--hd-text-muted)' }}>{x.note} </span>}
                    {!x.followed && <span style={{ color: 'var(--hd-warn)' }}>({x.badge} link - confirm before ordering)</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.condition && <p className="text-xs mt-1 font-medium" style={{ color: 'var(--hd-warn)' }}>{r.condition}</p>}
          {r.suppressed_reason && <p className="text-xs mt-1" style={{ color: 'var(--hd-warn)' }}>{r.suppressed_reason}</p>}
          <p className="text-sm text-white mt-1">{r.description ?? r.part_type}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--hd-text-muted)' }}>{r.manufacturer} &middot; {r.part_type}</p>
          {r.was.length > 0 && (
            <p className="text-xs mt-1 text-white">was {r.was.join(', ')}</p>
          )}
          {r.advice && (
            <p className="text-xs mt-1 font-medium" style={{ color: r.display === 'conflict' ? 'var(--hd-negative)' : 'var(--hd-warn)' }}>{r.advice}</p>
          )}
          {r.reported_replaced_by && (
            <p className="text-xs mt-1" style={{ color: 'var(--hd-warn)' }}>
              Reported replaced by {r.reported_replaced_by.to} ({r.reported_replaced_by.badge}) - not substituted. Order {r.part_number} unless you have confirmed the new number.
              {r.reported_replaced_by.note && <span style={{ color: 'var(--hd-text-muted)' }}> {r.reported_replaced_by.note}</span>}
            </p>
          )}
          <p className="text-xs mt-1" style={{ color: 'var(--hd-text-faint)' }}>{r.matched_on}</p>
        </div>

        {/* On the shelf - this shop's own stock. No price on the counter. */}
        {/* Display only (lib/parts/stock-display): availability never prints below 0,
            and a negative on-hand prints as a wrong count to correct, not as stock. */}
        <div className="text-right shrink-0" data-testid="counter-stock">
          {(() => {
            const s = counterStockLines(r.stock)
            return (<>
              <p className="text-xs" style={{ color: 'var(--hd-text-muted)' }}>On hand</p>
              {s.onHandWrong ? (
                <>
                  <p className="text-sm font-bold" style={{ color: 'var(--hd-negative)' }}>{s.onHand}</p>
                  <p className="text-[11px] max-w-[11rem]" style={{ color: 'var(--hd-negative)' }}>{wrongCountLabel(r.stock.on_hand)}</p>
                </>
              ) : (
                <p className="text-2xl font-bold text-white">{s.onHand}</p>
              )}
              <p className="text-xs text-white">{s.availability}</p>
              {s.locations.map((line, i) => (
                <p key={i} className="text-[11px]" style={{ color: 'var(--hd-text-muted)' }}>{line}</p>
              ))}
            </>)
          })()}
        </div>
      </div>

      {r.fitment.length > 0 && (
        <ul className="mt-3 pt-3 space-y-1 border-t" style={{ borderColor: 'var(--hd-border)' }}>
          {r.fitment.map(f => (
            <li key={f.id} className="text-xs flex flex-wrap items-center gap-x-2 gap-y-1 text-white">
              <span>{f.unit_model ?? (f.engine ? `engine ${f.engine}` : `compressor ${f.compressor_model}`)}</span>
              {f.role && <span className="font-medium">{f.role}</span>}
              {f.mount_type && <span style={{ color: 'var(--hd-text-muted)' }}>{f.mount_type} unit</span>}
              {f.unit_model && f.engine && <span style={{ color: 'var(--hd-warn)' }}>engine {f.engine}</span>}
              {f.configuration && <span style={{ color: 'var(--hd-warn)' }}>{f.configuration}</span>}
              {f.serial_label && <span style={{ color: 'var(--hd-warn)' }}>{f.serial_label}</span>}
              {f.build_date_from && <span style={{ color: 'var(--hd-warn)' }}>built from {f.build_date_from}</span>}
              {f.build_date_before && <span style={{ color: 'var(--hd-warn)' }}>built before {f.build_date_before}</span>}
              {f.qty_per_unit && <span style={{ color: 'var(--hd-text-muted)' }}>qty {f.qty_per_unit}</span>}
              {f.note && <span style={{ color: 'var(--hd-text-muted)' }}>{f.note}</span>}
              {f.display !== 'plain' && <Badge text={f.badge} display={f.display} />}
            </li>
          ))}
        </ul>
      )}

      {r.crosses.length > 0 && (
        <div className="mt-3 pt-3 border-t space-y-1" style={{ borderColor: 'var(--hd-border)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--hd-text-faint)' }}>Aftermarket crosses</p>
          {r.crosses.map(c => (
            <p key={c.brand} className="text-xs text-white flex flex-wrap items-center gap-2">
              <span className="w-28" style={{ color: 'var(--hd-text-muted)' }}>{c.brand}</span>
              {c.numbers.map(n => (
                <span key={n.number} className="inline-flex items-center gap-1">
                  <span className="font-mono">{n.number}</span>
                  {n.display !== 'plain' && <Badge text={n.badge} display={n.display} />}
                </span>
              ))}
            </p>
          ))}
        </div>
      )}

      {r.notes && <p className="text-xs mt-3 pt-3 border-t" style={{ borderColor: 'var(--hd-border)', color: 'var(--hd-text-muted)' }}>{r.notes}</p>}
    </div>
  )
}
