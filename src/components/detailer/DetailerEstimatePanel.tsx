'use client'

import { useState, useEffect } from 'react'
import { VEHICLE_CATEGORY_LABELS, type VehicleCategory } from '@/lib/scheduler'
import { CONDITION_MULTIPLIERS, getMultiplier } from '@/lib/condition-multipliers'
import { getAddonsForService } from '@/lib/detailer-addons'
import { DETAILER_PRICING_DEFAULTS } from '@/lib/detailer-pricing-defaults'

interface Props {
  serviceName:      string
  vehicleCategory:  VehicleCategory | null
  /** Override base price — falls back to national-average defaults */
  savedBasePrice?:  number | null
  /** Called when the final price changes */
  onPriceChange?:   (price: number) => void
}

export default function DetailerEstimatePanel({
  serviceName,
  vehicleCategory,
  savedBasePrice,
  onPriceChange,
}: Props) {
  const cat = vehicleCategory ?? 'sedan'

  const defaultPricing = DETAILER_PRICING_DEFAULTS[serviceName]?.[cat]
  const defaultBase    = savedBasePrice ?? defaultPricing?.basePrice ?? 0

  const [conditionRating, setConditionRating] = useState<number>(2)
  const [basePrice,       setBasePrice]       = useState(defaultBase)
  const [manualOverride,  setManualOverride]  = useState(false)
  const [overridePrice,   setOverridePrice]   = useState('')
  const [selectedAddons,  setSelectedAddons]  = useState<Set<string>>(new Set())

  const addons     = getAddonsForService(serviceName)
  const multiplier = getMultiplier(conditionRating)

  const adjustedBase   = manualOverride && overridePrice !== ''
    ? parseFloat(overridePrice) || 0
    : Math.round(basePrice * multiplier)

  const addonTotal = addons
    .filter(a => selectedAddons.has(a.name))
    .reduce((s, a) => s + a.defaultPrice, 0)

  const totalPrice = adjustedBase + addonTotal

  useEffect(() => {
    onPriceChange?.(totalPrice)
  }, [totalPrice, onPriceChange])

  function toggleAddon(name: string) {
    setSelectedAddons(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <div className="space-y-4">
      {/* Vehicle category display */}
      {vehicleCategory && (
        <div className="flex items-center gap-2">
          <span className="text-white/40 text-xs">Vehicle type:</span>
          <span className="text-white text-xs font-medium">{VEHICLE_CATEGORY_LABELS[vehicleCategory]}</span>
        </div>
      )}

      {/* Base price */}
      <div>
        <p className="text-white/40 text-xs uppercase tracking-widest mb-2">Base Price</p>
        <div className="flex items-center gap-3">
          <span className="font-condensed font-bold text-2xl text-white">${basePrice.toFixed(0)}</span>
          <span className="text-white/30 text-xs">for {vehicleCategory ? VEHICLE_CATEGORY_LABELS[vehicleCategory] : 'this vehicle'}</span>
        </div>
      </div>

      {/* Condition rating */}
      <div>
        <p className="text-white/40 text-xs uppercase tracking-widest mb-2">Vehicle Condition</p>
        <div className="grid grid-cols-5 gap-1.5">
          {CONDITION_MULTIPLIERS.map(c => (
            <button
              key={c.rating}
              type="button"
              onClick={() => { setConditionRating(c.rating); setManualOverride(false) }}
              className={`rounded-lg border px-2 py-2 text-center transition-all ${
                conditionRating === c.rating
                  ? 'border-orange bg-orange/10'
                  : 'border-dark-border bg-dark-card hover:border-white/20'
              }`}
            >
              <p className={`text-[10px] font-bold ${conditionRating === c.rating ? 'text-orange' : 'text-white/60'}`}>
                {c.label}
              </p>
              <p className={`text-[9px] mt-0.5 ${conditionRating === c.rating ? 'text-orange/70' : 'text-white/30'}`}>
                ×{c.multiplier}
              </p>
            </button>
          ))}
        </div>
        {conditionRating !== 2 && (
          <p className="text-white/30 text-xs mt-1.5">
            {CONDITION_MULTIPLIERS.find(c => c.rating === conditionRating)?.description}
          </p>
        )}
      </div>

      {/* Price after multiplier */}
      <div className="nwi-card bg-dark-input">
        <div className="flex items-center justify-between mb-2">
          <p className="text-white/40 text-xs uppercase tracking-widest">Adjusted Price</p>
          <p className="font-condensed font-bold text-xl text-orange">${adjustedBase.toFixed(2)}</p>
        </div>
        <p className="text-white/30 text-[10px]">
          ${basePrice.toFixed(0)} × {multiplier} condition multiplier
        </p>

        {/* Manual override */}
        <div className="mt-3 pt-3 border-t border-dark-border">
          <label className="flex items-center gap-2 cursor-pointer mb-2">
            <input
              type="checkbox"
              checked={manualOverride}
              onChange={e => {
                setManualOverride(e.target.checked)
                if (e.target.checked) setOverridePrice(String(adjustedBase))
              }}
              className="w-3.5 h-3.5 accent-orange"
            />
            <span className="text-white/50 text-xs">Override price manually</span>
          </label>
          {manualOverride && (
            <div className="flex items-center gap-2">
              <span className="text-white/40 text-sm">$</span>
              <input
                type="number"
                min="0"
                step="5"
                className="nwi-input py-1.5 text-sm w-28"
                value={overridePrice}
                onChange={e => setOverridePrice(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Add-ons */}
      {addons.length > 0 && (
        <div>
          <p className="text-white/40 text-xs uppercase tracking-widest mb-2">Common Add-Ons</p>
          <div className="space-y-1.5">
            {addons.map(addon => {
              const checked = selectedAddons.has(addon.name)
              return (
                <label
                  key={addon.name}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                    checked ? 'border-orange/40 bg-orange/5' : 'border-dark-border bg-dark-card hover:border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAddon(addon.name)}
                      className="w-3.5 h-3.5 accent-orange flex-shrink-0"
                    />
                    <span className={`text-xs font-medium ${checked ? 'text-white' : 'text-white/60'}`}>
                      {addon.name}
                    </span>
                  </div>
                  <span className={`text-xs font-bold flex-shrink-0 ${checked ? 'text-orange' : 'text-white/40'}`}>
                    +${addon.defaultPrice}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      )}

      {/* Total */}
      <div className="flex items-center justify-between pt-3 border-t border-dark-border">
        <p className="font-condensed font-bold text-white tracking-wide">ESTIMATED TOTAL</p>
        <p className="font-condensed font-bold text-2xl text-success">${totalPrice.toFixed(2)}</p>
      </div>
    </div>
  )
}
