'use client'

// ─── Travel, mileage and shop supplies, on any document ───────────────────────
//
// ONE COMPONENT because there are five places that need it - the LD work order,
// the LD quote, the LD invoice editor, the HD invoice and the HD quote - and five
// copies of "hours times rate, miles times rate, percent of parts" is how two of them
// end up disagreeing about the cap.
//
// WHAT IT DOES NOT DO: ask for the shop supplies amount or its percentage. Those come
// from Settings and compute themselves. The only inputs are hours and miles, because
// those are facts only the tech knows.

import type { ExtrasResult, ExtrasSettings } from '@/lib/billable-extras'
import { extrasDisplayRows } from '@/lib/billable-extras'

function fmt(n: number): string {
  return `$${n.toFixed(2)}`
}

/**
 * The two inputs. Renders nothing at all when the shop bills neither.
 *
 * Hidden rather than disabled: an input for something that is not charged invites a
 * tech to type hours that are then silently dropped. See useExtrasSettings, which
 * returns EXTRAS_OFF until the shop's own answer has arrived for the same reason.
 */
export function ExtrasInputs({
  settings, travelHours, mileageMiles, onTravelHours, onMileageMiles, disabled, laborRate,
}: {
  settings:       ExtrasSettings
  travelHours:    number
  mileageMiles:   number
  onTravelHours:  (n: number) => void
  onMileageMiles: (n: number) => void
  disabled?:      boolean
  /** Shown as the travel rate when the shop has not set a separate one. */
  laborRate?:     number
}) {
  if (!settings.billTravel && !settings.billMileage) return null
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {settings.billTravel && (
        <label className="block">
          <span className="text-white/50 text-xs">Travel hours</span>
          <input
            type="number" min="0" step="0.25" inputMode="decimal" disabled={disabled}
            className="nwi-input text-sm w-full mt-1"
            value={travelHours || ''}
            onChange={e => onTravelHours(Math.max(0, Number(e.target.value) || 0))}
          />
          <span className="block text-white/35 text-[11px] mt-1">
            {fmt(settings.travelRatePerHour ?? laborRate ?? 0)}/hr
          </span>
        </label>
      )}
      {settings.billMileage && (
        <label className="block">
          <span className="text-white/50 text-xs">Miles</span>
          <input
            type="number" min="0" step="1" inputMode="decimal" disabled={disabled}
            className="nwi-input text-sm w-full mt-1"
            value={mileageMiles || ''}
            onChange={e => onMileageMiles(Math.max(0, Number(e.target.value) || 0))}
          />
          <span className="block text-white/35 text-[11px] mt-1">
            {fmt(settings.mileageRatePerMile ?? 0)}/mi, not taxed
          </span>
        </label>
      )}
    </div>
  )
}

/**
 * The computed lines, one per extra, each labelled.
 *
 * A ZERO EXTRA PRINTS NOTHING - not a 0.00 line, not a dash. So a labour-only job
 * shows no shop supplies line at all, and a job nobody drove to shows no mileage.
 * Returns null when all three are zero, so a caller can place it unconditionally.
 */
export function ExtrasRows({ extras }: { extras: ExtrasResult }) {
  const rows = extrasDisplayRows(extras)
  if (rows.length === 0) return null
  return (
    <>
      {rows.map(r => (
        <div key={r.key} className="flex justify-between text-sm">
          <span className="text-white/50">
            {r.label}
            {r.detail && <span className="text-white/30 text-xs ml-1.5">{r.detail}</span>}
          </span>
          <span className="text-white">{fmt(r.amount)}</span>
        </div>
      ))}
      {extras.shopSupplies.capped && (
        <p className="text-[11px] text-white/35 -mt-1">
          Shop supplies capped at {fmt(extras.shopSupplies.rate ?? 0)}.
        </p>
      )}
    </>
  )
}
