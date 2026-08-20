'use client'

import { useState, useEffect } from 'react'

// Reads the tech's saved tax default (Settings → pricing defaults) for the HD
// quote/invoice forms. HD stores tax_rate as a percent (8.5), which is the same
// unit as profiles.default_tax_percent, so the value applies as-is — unlike the
// LD side, which stores a fraction.
//
// Returns null until the fetch resolves so callers can tell "not loaded yet"
// from a genuine 0% rate.
export function useDefaultTaxPercent(): number | null {
  const [pct, setPct] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/profile')
        if (!res.ok) return
        const json = await res.json()
        const n = Number(json.default_tax_percent)
        if (!cancelled && Number.isFinite(n)) setPct(n)
      } catch {
        // Leave the form at its 0 default rather than blocking the tech.
      }
    })()
    return () => { cancelled = true }
  }, [])

  return pct
}
