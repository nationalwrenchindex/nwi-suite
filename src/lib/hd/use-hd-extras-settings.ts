'use client'

import { useEffect, useState } from 'react'
import { EXTRAS_OFF, type ExtrasSettings } from '@/lib/billable-extras'
import { hdExtrasSettingsFrom, hdServiceCallFrom, SERVICE_CALL_OFF, type HdServiceCallSettings } from '@/lib/hd/hd-extras'

// HD's drive time, mileage, shop supplies and service call defaults, for the HD quote
// and invoice forms. Read from /api/hd/settings: HD's own columns (migration 178), or
// LD's 142 columns before 178 - exactly what these forms read before HD had its own.
//
// The same three-state contract as useExtrasSettingsState: `loaded` is false until the
// answer arrives, and "not loaded" is never "bills nothing".

export interface HdExtrasSettingsState {
  settings: ExtrasSettings
  serviceCall: HdServiceCallSettings
  /** False before migration 178: no service call fee can be stored. */
  serviceCallAvailable: boolean
  loaded: boolean
  failed: boolean
}

export function useHdExtrasSettingsState(): HdExtrasSettingsState {
  const [state, setState] = useState<HdExtrasSettingsState>({
    settings: EXTRAS_OFF, serviceCall: SERVICE_CALL_OFF, serviceCallAvailable: false, loaded: false, failed: false,
  })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/hd/settings')
        if (!res.ok) throw new Error(String(res.status))
        const j = await res.json() as { extras?: Record<string, unknown> | null; extras_ld?: Record<string, unknown> | null; extras_available?: boolean }
        if (cancelled) return
        const row = j.extras_available ? (j.extras ?? {}) : (j.extras_ld ?? {})
        setState({
          settings: hdExtrasSettingsFrom(row),
          serviceCall: hdServiceCallFrom(row),
          serviceCallAvailable: j.extras_available === true,
          loaded: true, failed: false,
        })
      } catch {
        if (!cancelled) setState(s => ({ ...s, loaded: true, failed: true }))
      }
    })()
    return () => { cancelled = true }
  }, [])
  return state
}
