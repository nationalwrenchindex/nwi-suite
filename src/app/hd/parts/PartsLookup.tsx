'use client'

import { useState, useCallback, useEffect } from 'react'

const HD_ORANGE = '#E85D24'

interface CrossRef {
  id:          string
  part_number: string
  cross_mfr:   string
  cross_part:  string
  cross_notes?: string
}

interface CrossRefMatch {
  cross_part: string
  cross_mfr:  string
}

interface Part {
  id:              string
  part_number:     string
  manufacturer:    string
  description:     string
  category:        string
  unit_models:     string[]
  notes?:          string
  superseded_by?:  string
  field_critical:  boolean
  hd_parts_cross_ref?: CrossRef[]
  _cross_ref_match?: CrossRefMatch[]
}

const CATEGORIES = [
  { value: '',           label: 'All Categories' },
  { value: 'starter',   label: 'Starter' },
  { value: 'alternator',label: 'Alternator' },
  { value: 'fuel_pump', label: 'Fuel Pump / Banjo' },
  { value: 'solenoid',  label: 'Solenoid' },
  { value: 'glow_plug', label: 'Glow Plugs' },
  { value: 'belt',      label: 'Belts' },
  { value: 'vibrasorber',label: 'Vibrasorber' },
  { value: 'thermostat',label: 'Thermostat' },
  { value: 'water_pump',label: 'Water Pump' },
  { value: 'sensor',    label: 'Sensors' },
  { value: 'switch',    label: 'Switches' },
  { value: 'filter',    label: 'Filters' },
  { value: 'compressor',label: 'Compressor' },
  { value: 'refrigerant',label: 'Refrigerant' },
  { value: 'controller',label: 'Controller' },
  { value: 'battery',   label: 'Battery' },
  { value: 'consumable',label: 'Consumables' },
]

const MANUFACTURERS = [
  { value: '',                   label: 'All Manufacturers' },
  { value: 'Thermo King',        label: 'Thermo King' },
  { value: 'Carrier Transicold', label: 'Carrier Transicold' },
  { value: 'Delco Remy',         label: 'Delco Remy' },
  { value: 'Generic',            label: 'Generic' },
]

function categoryLabel(cat: string): string {
  return CATEGORIES.find(c => c.value === cat)?.label ?? cat
}

function SeverityBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold uppercase tracking-wide"
      style={{ background: `${HD_ORANGE}25`, color: HD_ORANGE, border: `1px solid ${HD_ORANGE}40` }}
    >
      FIELD CRITICAL
    </span>
  )
}

function PartRow({ part, expanded, onToggle }: {
  part:      Part
  expanded:  boolean
  onToggle:  () => void
}) {
  const hasXref = (part.hd_parts_cross_ref?.length ?? 0) > 0
  const hasMeta = part.notes || part.superseded_by || hasXref

  const crossRefMatches = part._cross_ref_match ?? []

  return (
    <div
      className="rounded-lg overflow-hidden transition-all"
      style={{ background: '#111920', border: `1px solid ${crossRefMatches.length > 0 ? '#1e3a5f' : '#1e3040'}` }}
    >
      {crossRefMatches.length > 0 && (
        <div
          className="px-4 py-3 text-xs text-white"
          style={{ background: '#15803d', borderRadius: '8px 8px 0 0' }}
        >
          {crossRefMatches.map(xr => (
            <p key={xr.cross_part}>
              Found via cross reference: <strong>{xr.cross_part}</strong> ({xr.cross_mfr}) to TK OEM Part: <strong>{part.part_number}</strong>
            </p>
          ))}
        </div>
      )}
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-white/5 transition-colors"
        disabled={!hasMeta}
      >
        {/* Part number */}
        <div className="flex-shrink-0 min-w-[130px]">
          <span className="font-mono text-sm font-bold" style={{ color: HD_ORANGE }}>
            {part.part_number}
          </span>
        </div>

        {/* Description + badges */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <span className="text-white text-sm font-medium">{part.description}</span>
            {part.field_critical && <SeverityBadge />}
            {part.superseded_by && (
              <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: '#2d1b0a', color: '#f59e0b', border: '1px solid #92400e' }}>
                SUPERSEDED
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <span>{part.manufacturer}</span>
            <span>·</span>
            <span>{categoryLabel(part.category)}</span>
            {(part.unit_models ?? []).length > 0 && (
              <>
                <span>·</span>
                <span>{(part.unit_models ?? []).slice(0, 3).join(', ')}{(part.unit_models ?? []).length > 3 ? ` +${(part.unit_models ?? []).length - 3}` : ''}</span>
              </>
            )}
          </div>
        </div>

        {/* Expand indicator */}
        {hasMeta && (
          <svg
            className="w-4 h-4 flex-shrink-0 mt-0.5 transition-transform"
            style={{ color: 'rgba(255,255,255,0.3)', transform: expanded ? 'rotate(90deg)' : undefined }}
            fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        )}
      </button>

      {expanded && hasMeta && (
        <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: '#1e3040' }}>

          {part.superseded_by && (
            <div className="mt-3 p-3 rounded-lg" style={{ background: '#1a1000', border: '1px solid #92400e' }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#f59e0b' }}>Superseded By</p>
              <p className="font-mono text-sm font-bold" style={{ color: '#f59e0b' }}>{part.superseded_by}</p>
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.5)' }}>Always order the current part number. Verify fitment.</p>
            </div>
          )}

          {part.notes && (
            <div className="mt-3 p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #1e3040' }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>Field Notes</p>
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.75)' }}>{part.notes}</p>
            </div>
          )}

          {(part.unit_models ?? []).length > 3 && (
            <div className="mt-2">
              <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>All Compatible Models</p>
              <div className="flex flex-wrap gap-1.5">
                {(part.unit_models ?? []).map(m => (
                  <span key={m} className="px-2 py-0.5 rounded text-xs" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}>
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}

          {hasXref && (
            <div className="mt-2">
              <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>Cross References</p>
              <div className="space-y-1.5">
                {part.hd_parts_cross_ref!.map(xr => (
                  <div key={xr.id} className="flex items-center gap-3 text-sm">
                    <span className="font-mono font-bold" style={{ color: '#60a5fa' }}>{xr.cross_part}</span>
                    <span style={{ color: 'rgba(255,255,255,0.4)' }}>{xr.cross_mfr}</span>
                    {xr.cross_notes && <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{xr.cross_notes}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function PartsLookup() {
  const [parts,        setParts]       = useState<Part[]>([])
  const [loading,      setLoading]     = useState(false)
  const [seeding,      setSeeding]     = useState(false)
  const [seedMsg,      setSeedMsg]     = useState('')
  const [search,       setSearch]      = useState('')
  const [manufacturer, setManufacturer]= useState('')
  const [category,     setCategory]    = useState('')
  const [expandedIds,  setExpandedIds] = useState<Set<string>>(new Set())
  const [hasSeeded,    setHasSeeded]   = useState<boolean | null>(null)

  const fetchParts = useCallback(async (s: string, mfr: string, cat: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ cross_ref: 'true' })
      if (s)   params.set('search', s)
      if (mfr) params.set('manufacturer', mfr)
      if (cat) params.set('category', cat)

      const res  = await fetch(`/api/hd/parts?${params}`)
      const json = await res.json()
      setParts(json.parts ?? [])
      if (hasSeeded === null) setHasSeeded((json.parts ?? []).length > 0)
    } finally {
      setLoading(false)
    }
  }, [hasSeeded])

  useEffect(() => {
    fetchParts(search, manufacturer, category)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function seedDatabase() {
    setSeeding(true)
    setSeedMsg('')
    try {
      const res  = await fetch('/api/hd/parts/seed', { method: 'POST' })
      const json = await res.json()
      if (json.ok) {
        setSeedMsg(`Loaded ${json.parts} parts and ${json.cross_refs} cross-references.`)
        setHasSeeded(true)
        fetchParts(search, manufacturer, category)
      } else {
        setSeedMsg(`Error: ${json.error}`)
      }
    } finally {
      setSeeding(false)
    }
  }

  function applyFilters(s: string, mfr: string, cat: string) {
    setSearch(s)
    setManufacturer(mfr)
    setCategory(cat)
    fetchParts(s, mfr, cat)
  }

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectStyle: React.CSSProperties = {
    background: '#111920',
    border: '1px solid #1e3040',
    color: 'rgba(255,255,255,0.7)',
    borderRadius: '0.5rem',
    padding: '0.5rem 0.75rem',
    fontSize: '0.875rem',
    outline: 'none',
    cursor: 'pointer',
  }

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>HD Suite</p>
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">PARTS LOOKUP</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
          TK, Carrier Transicold, and Delco Remy parts with cross-references and field notes.
        </p>
      </div>

      {/* Seed CTA — shown when DB is empty */}
      {hasSeeded === false && (
        <div className="mb-6 rounded-xl p-5" style={{ background: '#111920', border: '1px solid #1e3040' }}>
          <p className="text-white font-semibold mb-1">Parts database not loaded</p>
          <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Load the built-in parts catalog (~210 TK and Carrier parts with cross-references) to get started.
          </p>
          <button
            onClick={seedDatabase}
            disabled={seeding}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: HD_ORANGE }}
          >
            {seeding ? 'Loading…' : 'Load Parts Database'}
          </button>
          {seedMsg && <p className="mt-3 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>{seedMsg}</p>}
        </div>
      )}

      {/* Search + Filters */}
      <div className="mb-4 flex flex-col sm:flex-row sm:flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search part #, description, or cross-ref number…"
          value={search}
          onChange={e => applyFilters(e.target.value, manufacturer, category)}
          className="w-full sm:flex-1 sm:min-w-[220px] px-3 py-2.5 rounded-lg text-base sm:text-sm text-white placeholder:text-white/30 outline-none"
          style={{ background: '#111920', border: '1px solid #1e3040', minHeight: 44 }}
        />
        <select
          value={manufacturer}
          onChange={e => applyFilters(search, e.target.value, category)}
          className="w-full sm:w-auto"
          style={{ ...selectStyle, minHeight: 44 }}
        >
          {MANUFACTURERS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select
          value={category}
          onChange={e => applyFilters(search, manufacturer, e.target.value)}
          className="w-full sm:w-auto"
          style={{ ...selectStyle, minHeight: 44 }}
        >
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>

      {/* Results */}
      {loading ? (
        <div className="text-center py-12" style={{ color: 'rgba(255,255,255,0.3)' }}>Loading…</div>
      ) : parts.length === 0 ? (
        <div className="text-center py-12" style={{ color: 'rgba(255,255,255,0.3)' }}>
          {hasSeeded === false ? 'Load the parts database above to begin.' : 'No parts found.'}
        </div>
      ) : (
        <>
          <p className="text-xs mb-3" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {parts.length} part{parts.length !== 1 ? 's' : ''} — click a row to expand field notes and cross-references
          </p>
          <div className="space-y-2">
            {parts.map(part => (
              <PartRow
                key={part.id}
                part={part}
                expanded={expandedIds.has(part.id)}
                onToggle={() => toggleExpand(part.id)}
              />
            ))}
          </div>
        </>
      )}

      {/* Reload seed button (shown after seeded) */}
      {hasSeeded === true && (
        <div className="mt-8 pt-6 border-t" style={{ borderColor: '#1e3040' }}>
          <p className="text-xs mb-2" style={{ color: 'rgba(255,255,255,0.3)' }}>Parts database management</p>
          <button
            onClick={seedDatabase}
            disabled={seeding}
            className="px-4 py-2 rounded-lg text-xs font-medium disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid #1e3040' }}
          >
            {seeding ? 'Reloading…' : 'Reload Parts Catalog'}
          </button>
          {seedMsg && <p className="mt-2 text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>{seedMsg}</p>}
        </div>
      )}

      <p className="mt-6 text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
        Part numbers are reference only. Verify fitment and supersession before ordering. Always replace superseded part numbers with current replacement.
      </p>
    </main>
  )
}
