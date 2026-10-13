'use client'

import { useEffect, useState } from 'react'

// The shop's HD labor rate and its two fees, for the forms that start a document.
//
// WHAT THIS REPLACES: `labor_rate: 125, diagnostic_fee: 125, road_call_fee: 0` written
// straight into the initial state of src/app/hd/quotes/new/page.tsx and
// src/app/hd/invoices/new/page.tsx. Every new quote and invoice opened at someone
// else's numbers, and the quote form had include_diagnostic ON by default, so $125 of
// a diagnostic fee was on the document before the tech touched anything.
//
// THREE STATES, NOT TWO. `loaded` is false until the fetch resolves, and a caller must
// not treat "not loaded" as "nothing configured" - that is the mistake
// useExtrasSettings made, where a form read "bills nothing" for the whole first render
// and dropped charges the shop had switched on.
//
// NULL IS NOT ZERO. A fee of null means the shop never set one and the caller applies
// its own fallback (125 / 0, which is what the forms did before). A fee of 0 means the
// shop said zero, and that must be honoured - a shop that does not charge to diagnose
// must not have $125 put back on its quotes.

export interface HdFeeSettings {
  /** profiles.hd_labor_rate. null = never set. */
  laborRate: number | null
  /** profiles.hd_diagnostic_fee. null = never set, which is NOT the same as 0. */
  diagnosticFee: number | null
  /** profiles.hd_road_call_fee. null = never set, which is NOT the same as 0. */
  roadCallFee: number | null
  /**
   * False when this database has not had migration 156 applied, so the fee columns do
   * not exist. The forms behave as though nothing was configured; the settings screen
   * uses it to say so rather than offering a field that cannot save.
   */
  feesAvailable: boolean
}

export interface HdFeeSettingsState extends HdFeeSettings {
  /** False until the fetch resolves. Not the same as "nothing is configured". */
  loaded: boolean
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function useHdFeeSettings(): HdFeeSettingsState {
  const [state, setState] = useState<HdFeeSettingsState>({
    laborRate: null, diagnosticFee: null, roadCallFee: null,
    feesAvailable: false, loaded: false,
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/hd/settings')
        if (!res.ok) {
          // Mark it loaded anyway. A caller that waits forever on a failed fetch would
          // leave the tech looking at a form it refuses to seed.
          if (!cancelled) setState(s => ({ ...s, loaded: true }))
          return
        }
        const json = await res.json() as {
          settings?: Record<string, unknown> | null
          fees_available?: boolean
        }
        if (cancelled) return
        const s = json.settings ?? {}
        setState({
          laborRate:     num(s.hd_labor_rate),
          diagnosticFee: num(s.hd_diagnostic_fee),
          roadCallFee:   num(s.hd_road_call_fee),
          feesAvailable: Boolean(json.fees_available),
          loaded:        true,
        })
      } catch {
        if (!cancelled) setState(s => ({ ...s, loaded: true }))
      }
    })()
    return () => { cancelled = true }
  }, [])

  return state
}
