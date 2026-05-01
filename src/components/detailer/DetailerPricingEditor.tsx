'use client'

import { useState, useCallback } from 'react'
import { DETAILER_SERVICES, VEHICLE_CATEGORIES, VEHICLE_CATEGORY_LABELS, type VehicleCategory } from '@/lib/scheduler'
import { DETAILER_PRICING_DEFAULTS } from '@/lib/detailer-pricing-defaults'

export interface PricingRow {
  service_name:     string
  vehicle_category: VehicleCategory
  base_price:       number
  estimated_hours:  number
  is_offered:       boolean
}

function buildDefaultRows(): PricingRow[] {
  const rows: PricingRow[] = []
  for (const svc of DETAILER_SERVICES) {
    for (const cat of VEHICLE_CATEGORIES) {
      const def = DETAILER_PRICING_DEFAULTS[svc]?.[cat] ?? { basePrice: 0, estimatedHours: 1 }
      rows.push({
        service_name:     svc,
        vehicle_category: cat,
        base_price:       def.basePrice,
        estimated_hours:  def.estimatedHours,
        is_offered:       def.basePrice > 0,
      })
    }
  }
  return rows
}

function mergeSavedRows(saved: PricingRow[]): PricingRow[] {
  const defaults = buildDefaultRows()
  if (!saved.length) return defaults

  const savedMap = new Map(saved.map(r => [`${r.service_name}|${r.vehicle_category}`, r]))
  return defaults.map(d => {
    const key = `${d.service_name}|${d.vehicle_category}`
    return savedMap.get(key) ?? d
  })
}

interface Props {
  initialRows?: PricingRow[]
  onSave:       (rows: PricingRow[]) => Promise<void>
  saveLabel?:   string
  showSkip?:    boolean
  onSkip?:      () => void
}

export default function DetailerPricingEditor({
  initialRows = [],
  onSave,
  saveLabel = 'Save Pricing',
  showSkip  = false,
  onSkip,
}: Props) {
  const [rows, setRows]       = useState<PricingRow[]>(() => mergeSavedRows(initialRows))
  const [saving, setSaving]   = useState(false)
  const [saved,  setSaved]    = useState(false)
  const [error,  setError]    = useState<string | null>(null)

  // Collapse all by default; expand only the three most common services on load
  const DEFAULT_EXPANDED = new Set(['Basic Wash', 'Full Detail', 'Interior Detail'])
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>()
    for (const svc of DETAILER_SERVICES) {
      if (DEFAULT_EXPANDED.has(svc)) s.add(svc)
    }
    return s
  })

  const updateRow = useCallback((svc: string, cat: VehicleCategory, field: keyof PricingRow, value: unknown) => {
    setRows(prev => prev.map(r =>
      r.service_name === svc && r.vehicle_category === cat
        ? { ...r, [field]: value }
        : r
    ))
  }, [])

  function toggleService(svc: string, offered: boolean) {
    setRows(prev => prev.map(r =>
      r.service_name === svc ? { ...r, is_offered: offered } : r
    ))
  }

  function toggleExpanded(svc: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(svc)) next.delete(svc)
      else next.add(svc)
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await onSave(rows)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {error && <div className="alert-error">{error}</div>}
      {saved && <div className="alert-success">Pricing saved.</div>}

      {showSkip && onSkip && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-dark-border bg-dark-card/60">
          <p className="text-white/50 text-sm">Not sure about pricing yet?</p>
          <button
            type="button"
            onClick={onSkip}
            className="text-sm font-medium text-orange hover:text-orange/80 transition-colors whitespace-nowrap"
          >
            Skip all &amp; use defaults →
          </button>
        </div>
      )}

      {DETAILER_SERVICES.map(svc => {
        const svcRows = rows.filter(r => r.service_name === svc)
        const isOffered = svcRows.some(r => r.is_offered)
        const isOpen    = expanded.has(svc)

        return (
          <div key={svc} className={`rounded-xl border transition-colors ${
            isOffered ? 'border-dark-border bg-dark-card' : 'border-dark-border/50 bg-dark opacity-60'
          }`}>
            {/* Service header row */}
            <div className="flex items-center gap-3 px-4 py-3">
              {/* Toggle offered */}
              <button
                type="button"
                onClick={() => toggleService(svc, !isOffered)}
                className={`relative inline-flex w-10 h-5 rounded-full transition-colors focus:outline-none flex-shrink-0 ${
                  isOffered ? 'bg-orange' : 'bg-dark-border'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  isOffered ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>

              <span className={`flex-1 text-sm font-medium ${isOffered ? 'text-white' : 'text-white/40'}`}>
                {svc}
              </span>

              {isOffered && (
                <button
                  type="button"
                  onClick={() => toggleExpanded(svc)}
                  className="text-white/30 hover:text-white transition-colors text-xs flex items-center gap-1"
                >
                  {isOpen ? 'Hide prices ↑' : 'Edit prices ↓'}
                </button>
              )}
            </div>

            {/* Per-category pricing table */}
            {isOffered && isOpen && (
              <div className="border-t border-dark-border px-4 pb-4 pt-3">
                <div className="grid grid-cols-3 gap-x-3 gap-y-2 mb-2">
                  <p className="text-white/30 text-[10px] uppercase tracking-widest">Vehicle Type</p>
                  <p className="text-white/30 text-[10px] uppercase tracking-widest">Base Price ($)</p>
                  <p className="text-white/30 text-[10px] uppercase tracking-widest">Est. Hours</p>
                </div>
                {VEHICLE_CATEGORIES.map(cat => {
                  const row = svcRows.find(r => r.vehicle_category === cat)
                  if (!row) return null
                  return (
                    <div key={cat} className="grid grid-cols-3 gap-x-3 gap-y-1 items-center mb-2">
                      <p className="text-white/70 text-xs">{VEHICLE_CATEGORY_LABELS[cat]}</p>
                      <input
                        type="number"
                        min="0"
                        step="5"
                        className="nwi-input py-1.5 text-sm"
                        value={row.base_price}
                        onChange={e => updateRow(svc, cat, 'base_price', parseFloat(e.target.value) || 0)}
                      />
                      <input
                        type="number"
                        min="0"
                        step="0.25"
                        className="nwi-input py-1.5 text-sm"
                        value={row.estimated_hours}
                        onChange={e => updateRow(svc, cat, 'estimated_hours', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      <div className={`flex gap-3 pt-2 ${showSkip ? 'justify-between' : 'justify-end'}`}>
        {showSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="text-white/40 hover:text-white text-sm transition-colors"
          >
            Skip for now
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </div>
  )
}
