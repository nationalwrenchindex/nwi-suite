'use client'

// ─── Find a part for the unit on a document ───────────────────────────────────
//
// The HD quote's ADD PARTS LINE box and the HD work order's parts card, one lookup.
// Before Nov 6 the quote searched the old 255-row hd_parts table by manufacturer
// only, so "belt" on a Thermo King S-600 quote returned SB, Super II, KDII and SMX
// belts - none of which fit it - and the only way to the right part was to already
// know its number.
//
// WHAT IT DOES
//
//   * Opens already showing the parts whose fitment names the unit on the document,
//     before anything is typed (/api/parts/search with the document's model).
//   * Words, a heading or a type stay filtered to that unit. The WHOLE CATALOG is a
//     deliberate switch, said on screen while it is on - never the default.
//   * An exact part number is never filtered: the route returns it whatever unit is
//     set and says whether its fitment names this one.
//   * Every row shows its trust tier (the counter's badge, lib/parts/counter), so a
//     row loaded "unconfirmed" never looks like one that was confirmed.
//   * Browses by the counter's headings (CATEGORY_ORDER), nothing invented.
//
// WHAT IT DOES NOT DO: name the line. The search box is only a search box. Picking a
// result hands back the catalog's description, number and the shop's last cost (when
// it stocks the part); the form puts them on the line, where the tech can still edit
// them. No price is computed here.

import { useCallback, useEffect, useRef, useState } from 'react'
import { CATEGORY_ORDER, adviceOf, badgeOf, displayOf, type Trust } from '@/lib/parts/counter'

export interface LookupPick {
  part_number: string
  description: string
  /** The shop's own last cost for this part, when it stocks it. The catalog holds none. */
  unit_cost: number | null
}

interface Result {
  id: string
  part_number: string
  part_type: string
  description: string | null
  matched_by: string
  fits_unit?: boolean
  trust: Trust | null
  fitment: Array<{ id: string; unit_model: string | null; serial_label: string | null; note: string | null }>
  superseded_by: { to: string } | null
}

/** The surface it sits on: the white document form, or the HD theme tokens. */
export interface LookupPalette {
  text: string; muted: string; border: string; field: string; card: string; accent: string; warn: string; good: string
}
export const PAPER_PALETTE: LookupPalette = {
  text: 'var(--paper-text)', muted: 'var(--paper-muted)', border: '#E5E7EB', field: '#FFFFFF', card: '#F9FAFB',
  accent: '#1A6BAF', warn: '#92400E', good: '#047857',
}
export const HD_PALETTE: LookupPalette = {
  text: 'var(--hd-text)', muted: 'var(--hd-text-muted)', border: 'var(--hd-border)', field: 'var(--hd-inner)', card: 'var(--hd-sunken)',
  accent: 'var(--hd-info)', warn: 'var(--hd-warn)', good: 'var(--hd-positive)',
}

/** The lookup's headings: the counter's, without its catch-all "Other". */
const HEADINGS = CATEGORY_ORDER.filter(c => c !== 'Other')
const SHOWN = 40

export default function DocumentPartLookup({
  unit, onPick, palette = PAPER_PALETTE, numberQuery,
}: {
  unit: { manufacturer: string | null; model: string | null; serial: string | null }
  onPick: (p: LookupPick) => void
  palette?: LookupPalette
  /** A number typed in the line's own Part Number box and sent here with Lookup. */
  numberQuery?: { text: string; nonce: number } | null
}) {
  const P = palette
  const model = unit.model?.trim() || ''
  const hasUnit = !!model
  const unitName = [unit.manufacturer, unit.model].filter(Boolean).join(' ')
  const [text, setText] = useState('')
  const [heading, setHeading] = useState<string | null>(null)
  const [wholeCatalog, setWholeCatalog] = useState(!hasUnit)
  const [results, setResults] = useState<Result[] | null>(null)
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [costs, setCosts] = useState<Map<string, number>>(new Map())
  const seq = useRef(0)

  const run = useCallback(async (q: string, h: string | null, whole: boolean) => {
    // The whole catalog with nothing typed and no heading would list 2,700 parts.
    if (whole && !q.trim() && !h) { setResults(null); setCount(0); return }
    const n = ++seq.current
    setLoading(true); setError(null)
    try {
      const p = new URLSearchParams()
      if (unit.manufacturer?.trim()) p.set('manufacturer', unit.manufacturer.trim())
      if (!whole && hasUnit) {
        p.set('model', model)
        if (unit.serial?.trim()) p.set('serial', unit.serial.trim())
      }
      if (q.trim()) p.set('q', q.trim())
      if (h) p.set('heading', h)
      const res = await fetch(`/api/parts/search?${p.toString()}`, { cache: 'no-store' })
      const j = await res.json()
      if (n !== seq.current) return
      if (!res.ok) throw new Error(j.error ?? 'Search failed.')
      setResults(j.results as Result[]); setCount(Number(j.count) || 0)
    } catch (e) {
      if (n === seq.current) { setError(e instanceof Error ? e.message : 'Search failed.'); setResults(null) }
    } finally {
      if (n === seq.current) setLoading(false)
    }
  }, [unit.manufacturer, unit.serial, hasUnit, model])

  // The unit's parts, on open, before anything is typed.
  useEffect(() => { void run('', null, !hasUnit) }, [run, hasUnit])

  // The shop's own stock, for a cost on pick. The catalog itself carries no price.
  useEffect(() => {
    fetch('/api/parts/inventory', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { stock: [] }))
      .then((j: { stock?: Array<{ part_id: string; last_cost: number | null }> }) =>
        setCosts(new Map((j.stock ?? []).filter(s => s.last_cost != null).map(s => [s.part_id, Number(s.last_cost)]))))
      .catch(() => { /* a cost is additive; its absence leaves the cost box for the tech */ })
  }, [])

  // Lookup beside the line's Part Number box: an exact number, unfiltered by the route.
  useEffect(() => {
    if (!numberQuery?.text.trim()) return
    setText(numberQuery.text); setHeading(null)
    void run(numberQuery.text, null, wholeCatalog)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numberQuery?.nonce])

  const search = (q = text, h = heading, whole = wholeCatalog) => void run(q, h, whole)
  const field: React.CSSProperties = {
    width: '100%', border: `1px solid ${P.border}`, borderRadius: 8, padding: '10px 12px', fontSize: 14,
    color: P.text, background: P.field, outline: 'none', minHeight: 44,
  }
  const chip = (on: boolean): React.CSSProperties => ({
    border: `1px solid ${on ? P.accent : P.border}`, color: on ? P.accent : P.muted, background: on ? P.card : 'transparent',
    borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: on ? 600 : 400,
  })

  return (
    <div data-testid="part-lookup" style={{ border: `1px solid ${P.border}`, borderRadius: 10, padding: 12, background: P.card }}>
      <p className="text-xs" style={{ color: P.muted }} data-testid="part-lookup-scope">
        {wholeCatalog
          ? <span style={{ color: P.warn }}>Searching the WHOLE catalog - these parts are not filtered to {hasUnit ? unitName : 'a unit'}.</span>
          : <>Parts recorded as fitting <strong style={{ color: P.text }}>{unitName}</strong>{unit.serial ? ` (serial ${unit.serial})` : ''}.</>}
        {' '}
        {hasUnit && (
          <button type="button" className="underline" style={{ color: P.accent }} data-testid="part-lookup-toggle"
            onClick={() => { const w = !wholeCatalog; setWholeCatalog(w); search(text, heading, w) }}>
            {wholeCatalog ? `Back to ${unitName} only` : 'Search the whole catalog instead'}
          </button>
        )}
        {!hasUnit && ' No unit model on this document, so nothing can be filtered to it.'}
      </p>

      <div className="flex gap-2 mt-2">
        <label className="flex-1">
          <span className="sr-only">Search the catalog</span>
          <input style={field} value={text} onChange={e => setText(e.target.value)} data-testid="part-lookup-q"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search() } }}
            placeholder={hasUnit && !wholeCatalog ? `Search ${unitName} parts: number or words` : 'Search the catalog: number or words'} />
        </label>
        <button type="button" onClick={() => search()} disabled={loading}
          className="px-4 rounded-lg text-sm font-semibold text-on-fill disabled:opacity-50" style={{ background: '#1A6BAF', minHeight: 44 }}>
          {loading ? '...' : 'Search'}
        </button>
      </div>
      <p className="text-[11px] mt-1" style={{ color: P.muted }}>
        This box only searches. The line&apos;s description is the field below it, filled from the part you pick.
      </p>

      <div className="flex flex-wrap gap-1.5 mt-2" data-testid="part-lookup-headings">
        <button type="button" style={chip(heading == null)} onClick={() => { setHeading(null); search(text, null) }}>All</button>
        {HEADINGS.map(h => (
          <button key={h} type="button" style={chip(heading === h)} onClick={() => { setHeading(h); search(text, h) }}>{h}</button>
        ))}
      </div>

      {error && <p className="text-xs mt-2" style={{ color: P.warn }}>{error}</p>}
      {results && (
        <p className="text-xs mt-2" style={{ color: P.muted }} data-testid="part-lookup-count">
          {count} {count === 1 ? 'part' : 'parts'}{count > SHOWN ? ` - the first ${SHOWN} shown; narrow with words or a heading` : ''}
        </p>
      )}
      {results && results.length === 0 && (
        <p className="text-xs mt-1" style={{ color: P.text }}>
          {hasUnit && !wholeCatalog
            ? `Nothing recorded as fitting ${unitName} matches that. That means nobody has recorded it yet - not that no part exists. Search the whole catalog if you need to.`
            : 'Nothing in the catalog matches that.'}
        </p>
      )}

      {results && results.length > 0 && (
        <div className="mt-2" style={{ maxHeight: 300, overflowY: 'auto', border: `1px solid ${P.border}`, borderRadius: 8, background: P.field }}>
          {results.slice(0, SHOWN).map(r => {
            const t: Trust = r.trust ?? { tier: null, verified: false }
            const d = displayOf(t)
            const advice = adviceOf(d)
            const models = [...new Set(r.fitment.map(f => f.unit_model).filter(Boolean))].slice(0, 3).join(', ')
            const name = r.description ?? r.part_type
            return (
              <button key={r.id} type="button" data-testid="part-lookup-result" data-part={r.part_number} data-tier={badgeOf(t)}
                onClick={() => onPick({ part_number: r.part_number, description: name, unit_cost: costs.get(r.id) ?? null })}
                className="w-full text-left px-3 py-2 flex items-start gap-3" style={{ borderBottom: `1px solid ${P.border}` }}>
                <span className="font-mono text-xs font-semibold" style={{ color: P.text, minWidth: 96 }}>{r.part_number}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm" style={{ color: P.text }}>{name}</span>
                  <span className="block text-[11px]" style={{ color: P.muted }}>
                    {r.part_type}{models ? ` · fits ${models}` : ''}{r.superseded_by ? ` · replaced by ${r.superseded_by.to}` : ''}
                  </span>
                  {r.matched_by === 'number' && hasUnit && r.fits_unit === false && (
                    <span className="block text-[11px]" style={{ color: P.warn }}>Exact number. Not recorded as fitting {unitName}.</span>
                  )}
                  {advice && <span className="block text-[11px]" style={{ color: d === 'conflict' ? P.warn : P.muted }}>{advice}</span>}
                </span>
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold shrink-0"
                  style={{ color: d === 'plain' ? P.good : P.warn, border: `1px solid ${d === 'plain' ? P.good : P.warn}` }}>
                  {badgeOf(t)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
