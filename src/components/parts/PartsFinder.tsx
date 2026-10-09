'use client'

// The parts finder, used by three screens:
//
//   /parts/catalog the catalog list      (mode="catalog")
//   /parts/find    find parts by unit    (mode="unit")
//   inside a work order, already filtered to the unit on the job (mode="unit" with
//                  a locked unit and an onPick handler)
//
// ONE component on purpose. The work-order picker is the screen that matters most, and
// the fastest way for it to start disagreeing with the standalone search about what
// fits a Supra 660 would be to write it twice.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//
//   * It never returns one confident answer. Every result is a row in a list with the
//     detail that distinguishes it - which serial range, which generation, whether
//     anyone has verified it. A reefer unit has two air filters depending on serial;
//     picking one and presenting it as "the" filter is how a tech fits the wrong part.
//   * It never hides that a row is unverified. The badge is not decoration: a vendor
//     listing and a manufacturer chart are not the same claim, and the person putting
//     the part in a unit is the one who needs to know which it is.
//   * It never says "try a shorter model". That hint was a workaround for the search
//     being broken, and it taught people to defeat the filter that makes the answer
//     correct.

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'

export interface FitmentRow {
  id: string
  unit_model: string | null
  engine_model: string | null
  compressor_model: string | null
  serial_from: string | null
  serial_before: string | null
  build_date_before: string | null
  qty_per_unit: number | null
  note: string | null
  verified: boolean
  source: string
  serial_label: string | null
  serial_side: string
}

export interface PartResult {
  id: string
  part_number: string
  part_number_normalized: string
  manufacturer: string
  part_type: string
  description: string | null
  belt_section: string | null
  belt_section_canonical: string | null
  belt_length: string | null
  belt_profile: string | null
  notes: string | null
  verified: boolean
  source: string
  vendor_price?: number | null
  superseded_by: { to: string; note: string | null } | null
  matched_by: string
  unresolved_serial: boolean
  fitment: FitmentRow[]
}

export interface StockRow {
  part_id: string
  on_hand: number
  min_qty: number | null
  bin: string | null
  location_type: string
  location_name: string | null
  last_cost: number | null
  sell_price: number | null
}

interface SearchResponse {
  query: { catch_all_excluded: boolean; include_unfitted: boolean }
  superseded: { from: string; to: string; note: string | null; verified: boolean; source: string } | null
  prices_available: boolean
  count: number
  unresolved_serial_count: number
  results: PartResult[]
}

export interface PickedPart {
  part_number: string
  description: string
  unit_cost: number | null
  quantity: number
}

interface Props {
  mode: 'catalog' | 'unit'
  /** Locks the unit to the one on the job. The inputs render read-only. */
  lockedUnit?: { manufacturer: string | null; model: string | null; serial: string | null }
  /** Present in the work-order picker. Receiving it switches the rows to "Add". */
  onPick?: (part: PickedPart) => void
  /** Shown next to the price so the tech can see what the customer will be charged. */
  markupPercent?: number | null
}

const MANUFACTURERS = ['Thermo King', 'Carrier Transicold']

const money = (n: number | null | undefined): string =>
  n == null ? '--' : `$${n.toFixed(2)}`

function VerifiedBadge({ verified }: { verified: boolean }) {
  // Two states, said plainly. "Unverified" is the one that matters, so it is the one
  // that is coloured - a quiet grey tick on the trusted rows and a visible warning on
  // the rest, not the other way round.
  return verified ? (
    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-success/15 text-success font-semibold">
      verified
    </span>
  ) : (
    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-warning/15 text-warning font-semibold">
      unverified
    </span>
  )
}

export default function PartsFinder({ mode, lockedUnit, onPick, markupPercent }: Props) {
  const [manufacturer, setManufacturer] = useState(lockedUnit?.manufacturer ?? '')
  const [model,        setModel]        = useState(lockedUnit?.model ?? '')
  const [serial,       setSerial]       = useState(lockedUnit?.serial ?? '')
  const [partType,     setPartType]     = useState('')
  const [text,         setText]         = useState('')
  const [includeUnfitted, setIncludeUnfitted] = useState(false)

  const [data,    setData]    = useState<SearchResponse | null>(null)
  const [stock,   setStock]   = useState<Map<string, StockRow>>(new Map())
  const [types,   setTypes]   = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [qty,     setQty]     = useState<Record<string, string>>({})

  const locked = !!lockedUnit
  const hasUnit = !!model.trim()

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams()
      if (manufacturer.trim()) p.set('manufacturer', manufacturer.trim())
      if (model.trim())        p.set('model', model.trim())
      if (serial.trim())       p.set('serial', serial.trim())
      if (partType.trim())     p.set('part_type', partType.trim())
      if (text.trim())         p.set('q', text.trim())
      if (includeUnfitted && !model.trim()) p.set('include_unfitted', 'true')

      const res  = await fetch(`/api/parts/search?${p.toString()}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Search failed.')
      setData(json as SearchResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [manufacturer, model, serial, partType, text, includeUnfitted])

  // Stock and the type list are loaded once. Stock is this shop's own - RLS makes that
  // true at the database, not here.
  useEffect(() => {
    fetch('/api/parts/inventory', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { stock: [] })
      .then((j: { stock?: StockRow[] }) => setStock(new Map((j.stock ?? []).map(s => [s.part_id, s]))))
      .catch(() => { /* stock is additive detail; its absence must not break the search */ })

    fetch('/api/parts/types', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { types: [] })
      .then((j: { types?: string[] }) => setTypes(j.types ?? []))
      .catch(() => { /* the filter degrades to a free-text box */ })
  }, [])

  // The work-order picker opens already filtered to the unit on the job, so it must
  // search on mount rather than waiting for a click.
  useEffect(() => { if (locked && model.trim()) void run() }, [locked, model, run])

  const results = data?.results ?? []

  const summary = useMemo(() => {
    if (!data) return null
    const unverified = results.filter(r => !r.verified).length
    return { count: data.count, unverified, unresolved: data.unresolved_serial_count }
  }, [data, results])

  return (
    <div className="space-y-5">
      {/* ── the query ──────────────────────────────────────────────────── */}
      <div className="bg-dark-card border border-dark-border rounded-xl p-4">
        {locked && (
          <p className="text-white/40 text-xs mb-3">
            Filtered to the unit on this job.{' '}
            <span className="text-white/70">
              {[lockedUnit?.manufacturer, lockedUnit?.model].filter(Boolean).join(' ') || 'no unit recorded'}
              {lockedUnit?.serial ? ` - serial ${lockedUnit.serial}` : ''}
            </span>
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-white/50 text-xs">Make</span>
            <select
              value={manufacturer}
              onChange={e => setManufacturer(e.target.value)}
              disabled={locked}
              className="w-full mt-1 bg-dark border border-dark-border rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50"
            >
              <option value="">Any make</option>
              {MANUFACTURERS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="text-white/50 text-xs">Unit model</span>
            <input
              value={model}
              onChange={e => setModel(e.target.value)}
              disabled={locked}
              placeholder="Supra 660"
              className="w-full mt-1 bg-dark border border-dark-border rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="text-white/50 text-xs">Serial <span className="text-white/25">(optional)</span></span>
            <input
              value={serial}
              onChange={e => setSerial(e.target.value)}
              disabled={locked}
              placeholder="GAG90483303"
              className="w-full mt-1 bg-dark border border-dark-border rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="text-white/50 text-xs">Part type</span>
            <select
              value={partType}
              onChange={e => setPartType(e.target.value)}
              className="w-full mt-1 bg-dark border border-dark-border rounded-lg px-3 py-2 text-white text-sm"
            >
              <option value="">Any type</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 mt-3 items-end">
          <label className="block">
            <span className="text-white/50 text-xs">Part number or description</span>
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void run() }}
              placeholder="781341, or: water pump belt"
              className="w-full mt-1 bg-dark border border-dark-border rounded-lg px-3 py-2 text-white text-sm"
            />
          </label>
          <button onClick={() => void run()} disabled={loading} className="btn-primary px-6 py-2">
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Catch-alls are offered ONLY when no model is selected. That is the rule, and
            saying it on screen is how the tech knows the list is not hiding anything. */}
        {mode === 'catalog' && !hasUnit && (
          <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeUnfitted}
              onChange={e => setIncludeUnfitted(e.target.checked)}
              className="h-4 w-4 rounded border-white/25 bg-transparent accent-orange"
            />
            <span className="text-white/50 text-xs">
              Include parts with no recorded fitment
            </span>
          </label>
        )}
        {hasUnit && (
          <p className="text-white/30 text-xs mt-3">
            Parts whose fitment names no model are excluded while a unit model is set.
          </p>
        )}
      </div>

      {error && <p className="text-danger text-sm">{error}</p>}

      {/* ── supersession notice ────────────────────────────────────────── */}
      {data?.superseded && (
        <div className="bg-orange/10 border border-orange/30 rounded-xl p-4">
          <p className="text-white text-sm">
            <span className="font-semibold">{data.superseded.from}</span> has been replaced by{' '}
            <span className="font-semibold text-orange">{data.superseded.to}</span>.
          </p>
          {data.superseded.note && <p className="text-white/50 text-xs mt-1">{data.superseded.note}</p>}
          <p className="text-white/30 text-xs mt-1">
            Showing the replacement. Source: {data.superseded.source}
            {data.superseded.verified ? '' : ' (unverified)'}
          </p>
        </div>
      )}

      {/* ── results ────────────────────────────────────────────────────── */}
      {summary && (
        <p className="text-white/40 text-xs">
          {summary.count} {summary.count === 1 ? 'part' : 'parts'}
          {summary.unverified > 0 && <span className="text-warning"> &middot; {summary.unverified} unverified</span>}
          {summary.unresolved > 0 && (
            <span className="text-warning"> &middot; {summary.unresolved} could not be narrowed by the serial given</span>
          )}
        </p>
      )}

      {data && results.length === 0 && (
        // An empty result says so plainly and offers the next step. It does NOT suggest
        // typing less of the model.
        <div className="bg-dark-card border border-dark-border rounded-xl p-6 text-center">
          <p className="text-white text-sm font-medium">No part is recorded for that.</p>
          <p className="text-white/50 text-sm mt-2 leading-relaxed">
            {hasUnit
              ? 'Nothing in the catalog has fitment for that unit. That means nobody has recorded one yet - not that no part exists.'
              : 'Nothing matches that number or description.'}
          </p>
          {/* NOT a button. There is no add-part screen, and there deliberately is no
              way for a subscriber to insert into the shared catalog - migration 148
              gives parts no write policy, so loading and correcting it goes through the
              service role. A button here could only 404 or fail, which is worse than
              saying plainly what to do. */}
          <p className="text-white/35 text-xs mt-4">
            The catalog is loaded centrally, so it cannot be added to from this screen.
            Send the part number, the unit it fits and where the fitment came from, and
            it goes in with its source recorded.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {results.map(part => {
          const inStock = stock.get(part.id)
          const cost = inStock?.last_cost ?? part.vendor_price ?? null
          const sell = inStock?.sell_price
            ?? (cost != null && markupPercent != null ? cost * (1 + markupPercent / 100) : null)

          return (
            <div key={part.id} className="bg-dark-card border border-dark-border rounded-xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/parts/${part.id}`} className="text-white font-semibold hover:text-orange transition-colors">
                      {part.part_number}
                    </Link>
                    <VerifiedBadge verified={part.verified} />
                    {part.unresolved_serial && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-warning/15 text-warning font-semibold">
                        serial not comparable
                      </span>
                    )}
                  </div>
                  <p className="text-white/60 text-sm mt-0.5">{part.description ?? part.part_type}</p>
                  <p className="text-white/30 text-xs mt-0.5">
                    {part.manufacturer} &middot; {part.part_type}
                    {part.belt_section_canonical && ` · section ${part.belt_section_canonical}`}
                    {part.belt_length && ` · ${part.belt_length}`}
                    {part.belt_profile && ` · ${part.belt_profile}`}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-white/40 text-xs">
                    On hand <span className="text-white font-medium">{inStock?.on_hand ?? 0}</span>
                    {inStock?.bin && <span className="text-white/30"> &middot; bin {inStock.bin}</span>}
                  </p>
                  <p className="text-white/40 text-xs mt-0.5">
                    Cost {money(cost)}
                    {sell != null && <span className="text-white/70"> &middot; Sell {money(sell)}</span>}
                  </p>
                  {cost == null && (
                    <p className="text-warning text-[11px] mt-0.5">no cost on record</p>
                  )}
                </div>
              </div>

              {part.superseded_by && (
                <p className="text-orange text-xs mt-2">
                  Replaced by {part.superseded_by.to}
                  {part.superseded_by.note && <span className="text-white/40"> - {part.superseded_by.note}</span>}
                </p>
              )}

              {/* The distinguishing detail. This is what makes a list of three air
                  filters usable instead of a coin toss. */}
              {part.fitment.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-dark-border pt-3">
                  {part.fitment.map(f => (
                    <li key={f.id} className="text-xs flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-white/70">
                        {f.unit_model ?? (f.engine_model ? `engine ${f.engine_model}` : `compressor ${f.compressor_model}`)}
                      </span>
                      {f.serial_label && <span className="text-orange">{f.serial_label}</span>}
                      {f.build_date_before && <span className="text-orange">built before {f.build_date_before}</span>}
                      {f.qty_per_unit && <span className="text-white/40">qty {f.qty_per_unit}</span>}
                      {f.note && <span className="text-white/40">{f.note}</span>}
                      {!f.verified && <span className="text-warning">unverified fitment</span>}
                      <span className="text-white/20">{f.source}</span>
                    </li>
                  ))}
                </ul>
              )}

              {onPick && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-dark-border">
                  <label className="text-white/50 text-xs">Qty</label>
                  <input
                    type="number"
                    min="1"
                    value={qty[part.id] ?? '1'}
                    onChange={e => setQty(q => ({ ...q, [part.id]: e.target.value }))}
                    className="w-16 bg-dark border border-dark-border rounded-lg px-2 py-1 text-white text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => onPick({
                      part_number: part.part_number,
                      description: part.description ?? part.part_type,
                      // The COST goes to the line. The line then prices itself off the
                      // work order's recorded markup through the existing path - this
                      // component never computes a customer price into a billing record.
                      unit_cost: cost,
                      quantity: Math.max(1, Number(qty[part.id] ?? '1') || 1),
                    })}
                    className="btn-primary px-4 py-1.5 text-sm"
                  >
                    Add to work order
                  </button>
                  {cost == null && (
                    <span className="text-warning text-xs">
                      no cost on record - you will need to enter one
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
