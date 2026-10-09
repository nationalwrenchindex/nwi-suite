'use client'

// SCREEN 2: one part, in full.
//
// Fitment rows, cross-references WITH THEIR SOURCE, supersession in both directions,
// this shop's stock, and the service interval where one applies.
//
// The source is on screen next to every claim, not tucked away. "30-60143-01 fits a
// Supra 660" and "a vendor listing says it might" are different statements, and the
// person about to fit the part is the one who needs to tell them apart.

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Fitment {
  id: string
  unit_model: string | null
  engine_model: string | null
  compressor_model: string | null
  serial_from: string | null
  serial_before: string | null
  build_date_from: string | null
  build_date_before: string | null
  qty_per_unit: number | null
  note: string | null
  verified: boolean
  source: string
}

interface Cross { id: string; brand: string; brand_number: string; verified: boolean; source: string }
interface Stock {
  id: string; on_hand: number; min_qty: number | null; bin: string | null
  location_type: string; location_name: string | null
  last_cost: number | null; sell_price: number | null
}
interface Supersession { old_number: string; new_number: string; note: string | null; verified: boolean; source: string }

interface Detail {
  part: {
    id: string; part_number: string; manufacturer: string; part_type: string
    description: string | null; belt_section: string | null; belt_section_canonical: string | null
    belt_length: string | null; belt_profile: string | null; notes: string | null
    verified: boolean; source: string
    vendor_price?: number | null; vendor_price_source?: string | null
  }
  prices_available: boolean
  fitment: Fitment[]
  crosses: Cross[]
  derived_cross: { section: string; length: string | null; profile: string | null; note: string } | null
  stock: Stock[]
  supersedes: Supersession[]
  superseded_by: Supersession[]
}

const money = (n: number | null | undefined) => (n == null ? '--' : `$${n.toFixed(2)}`)

// Service intervals that are published for a part TYPE. Shown only for the types where
// an interval is actually published, and labelled as a type-level guideline rather
// than a claim about this specific number - which would be inventing one.
const TYPE_INTERVALS: Array<[RegExp, string]> = [
  [/filter - oil \(engine\)/i, 'Engine oil and filter: every 2,000 running hours or annually, whichever comes first.'],
  [/filter - fuel/i,           'Fuel filter: every 2,000 running hours or annually.'],
  [/filter - air/i,            'Air filter: inspect at every service; replace on condition or every 2,000 hours.'],
  [/filter - fuel\/water/i,    'Fuel/water separator: drain at every service; replace every 2,000 hours.'],
  [/belt/i,                    'Belts: inspect at every service for glazing, cracking and tension.'],
]

function Badge({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-success/15 text-success font-semibold">verified</span>
  ) : (
    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-warning/15 text-warning font-semibold">unverified</span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-dark-card border border-dark-border rounded-xl p-4">
      <h2 className="font-condensed font-bold text-white text-sm tracking-wider uppercase mb-3">{title}</h2>
      {children}
    </div>
  )
}

export default function PartDetail({ partId }: { partId: string }) {
  const [data,    setData]    = useState<Detail | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/parts/${partId}`, { cache: 'no-store' })
      .then(async r => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? 'Could not load this part.')
        return j as Detail
      })
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load this part.'))
      .finally(() => setLoading(false))
  }, [partId])

  if (loading) return <p className="text-white/40 text-sm">Loading...</p>
  if (error)   return <p className="text-danger text-sm">{error}</p>
  if (!data)   return null

  const { part } = data
  const interval = TYPE_INTERVALS.find(([re]) => re.test(part.part_type))?.[1] ?? null
  const cost = data.stock[0]?.last_cost ?? part.vendor_price ?? null

  return (
    <div className="space-y-4">
      <div className="bg-dark-card border border-dark-border rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-condensed font-bold text-2xl text-white tracking-wide">{part.part_number}</h1>
              <Badge verified={part.verified} />
            </div>
            <p className="text-white/70 text-sm mt-1">{part.description ?? part.part_type}</p>
            <p className="text-white/35 text-xs mt-1">
              {part.manufacturer} &middot; {part.part_type} &middot; source {part.source}
            </p>
          </div>
          <div className="text-right">
            <p className="text-white/40 text-xs">Cost</p>
            <p className="text-white text-lg font-semibold">{money(cost)}</p>
            {part.vendor_price_source && (
              <p className="text-white/25 text-[11px]">list price from {part.vendor_price_source}</p>
            )}
            {!data.prices_available && (
              <p className="text-warning text-[11px]">prices not stored yet (migration 149)</p>
            )}
          </div>
        </div>
        {part.notes && <p className="text-white/50 text-xs mt-3 border-t border-dark-border pt-3">{part.notes}</p>}
      </div>

      {/* Supersession, both directions. An old number must find the part AND say what
          replaced it; a current number is worth knowing as a replacement too. */}
      {(data.superseded_by.length > 0 || data.supersedes.length > 0) && (
        <Section title="Supersession">
          {data.superseded_by.map(s => (
            <p key={`by-${s.new_number}`} className="text-sm text-white">
              Replaced by <Link href={`/parts/catalog?q=${encodeURIComponent(s.new_number)}`} className="text-orange hover:underline">{s.new_number}</Link>
              {s.note && <span className="text-white/45"> - {s.note}</span>}
              <span className="text-white/25 text-xs"> ({s.source}{s.verified ? '' : ', unverified'})</span>
            </p>
          ))}
          {data.supersedes.map(s => (
            <p key={`for-${s.old_number}`} className="text-sm text-white/70">
              Replaces {s.old_number}
              {s.note && <span className="text-white/45"> - {s.note}</span>}
              <span className="text-white/25 text-xs"> ({s.source}{s.verified ? '' : ', unverified'})</span>
            </p>
          ))}
        </Section>
      )}

      <Section title={`Fitment (${data.fitment.length})`}>
        {data.fitment.length === 0 ? (
          <p className="text-white/45 text-sm">
            No fitment recorded. That means nobody has recorded one - not that the part
            fits nothing. It will not appear in a search by unit until one exists.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.fitment.map(f => (
              <li key={f.id} className="text-sm flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-dark-border/50 last:border-0 pb-2 last:pb-0">
                <span className="text-white font-medium">
                  {f.unit_model ?? (f.engine_model ? `Engine ${f.engine_model}` : `Compressor ${f.compressor_model}`)}
                </span>
                {!f.unit_model && (
                  <span className="text-white/30 text-xs">
                    fits by {f.engine_model ? 'engine' : 'compressor'}, not by unit
                  </span>
                )}
                {f.serial_from   && <span className="text-orange text-xs">from serial {f.serial_from}</span>}
                {f.serial_before && <span className="text-orange text-xs">before serial {f.serial_before}</span>}
                {f.build_date_before && <span className="text-orange text-xs">built before {f.build_date_before}</span>}
                {f.qty_per_unit && <span className="text-white/45 text-xs">qty {f.qty_per_unit}</span>}
                {f.note && <span className="text-white/45 text-xs">{f.note}</span>}
                <Badge verified={f.verified} />
                <span className="text-white/20 text-xs">{f.source}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Cross-references">
        {data.derived_cross && (
          <div className="mb-3 pb-3 border-b border-dark-border">
            <p className="text-sm text-white">
              Section <span className="font-semibold">{data.derived_cross.section}</span>
              {data.derived_cross.length && <span> &middot; {data.derived_cross.length}</span>}
              {data.derived_cross.profile && <span> &middot; {data.derived_cross.profile}</span>}
            </p>
            <p className="text-white/40 text-xs mt-1">{data.derived_cross.note}</p>
          </div>
        )}
        {data.crosses.length === 0 ? (
          <p className="text-white/45 text-sm">
            {data.derived_cross
              ? 'No brand-specific cross recorded, and none is needed for a standard belt section.'
              : 'No cross-reference recorded.'}
          </p>
        ) : (
          <ul className="space-y-1">
            {data.crosses.map(c => (
              <li key={c.id} className="text-sm flex items-center gap-2">
                <span className="text-white/60 w-28">{c.brand}</span>
                <span className="text-white font-medium">{c.brand_number}</span>
                <Badge verified={c.verified} />
                <span className="text-white/20 text-xs">{c.source}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Stock">
        {data.stock.length === 0 ? (
          <p className="text-white/45 text-sm">None on hand, and no minimum set for it.</p>
        ) : (
          <ul className="space-y-1">
            {data.stock.map(s => (
              <li key={s.id} className="text-sm flex flex-wrap items-center gap-x-3">
                <span className="text-white font-medium">{s.on_hand} on hand</span>
                <span className="text-white/50">
                  {s.location_type === 'vehicle' ? s.location_name : 'Shop'}
                  {s.bin && ` · bin ${s.bin}`}
                </span>
                <span className="text-white/45">cost {money(s.last_cost)}</span>
                {s.sell_price != null && <span className="text-white/45">sell {money(s.sell_price)}</span>}
                <span className="text-white/30 text-xs">
                  {s.min_qty == null ? 'no minimum set' : `minimum ${s.min_qty}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {interval && (
        <Section title="Service interval">
          <p className="text-white/70 text-sm">{interval}</p>
          <p className="text-white/30 text-xs mt-2">
            Published guideline for this TYPE of part, not a figure recorded against this
            number. Always check the unit&apos;s own manual.
          </p>
        </Section>
      )}
    </div>
  )
}
