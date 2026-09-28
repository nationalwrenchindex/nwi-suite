'use client'

import { useEffect, useState } from 'react'
import { taxSettingsFrom, type TaxSettings } from '@/lib/tax'

// Reads the shop's tax settings (Settings → Sales Tax) for the quote, work order and
// invoice forms in both products. Replaces useDefaultTaxPercent, which returned one
// rate and could not express "parts are taxed and labor is not".
//
// Returns null until the fetch resolves, so a caller can tell "not loaded yet" from
// a genuine 0% rate and avoid prefilling a form with a zero the tech did not choose.
export function useTaxSettings(): TaxSettings | null {
  const [settings, setSettings] = useState<TaxSettings | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/profile')
        if (!res.ok) return
        const json = await res.json()
        // taxSettingsFrom carries the pre-migration-140 fallback: no tax columns
        // means labor stays taxed at default_tax_percent, which is what the forms
        // did before the split. It never falls back to a 0% rate -- that would
        // under-collect, and under-collected tax is money the shop owes itself.
        if (!cancelled) setSettings(taxSettingsFrom(json))
      } catch {
        // Leave the form on its own defaults rather than blocking the tech.
      }
    })()
    return () => { cancelled = true }
  }, [])

  return settings
}
