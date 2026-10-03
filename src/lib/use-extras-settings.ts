'use client'

import { useEffect, useState } from 'react'
import { extrasSettingsFrom, EXTRAS_OFF, type ExtrasSettings } from '@/lib/billable-extras'

/**
 * The shop's travel / mileage / shop-supplies settings, for the quote, work order
 * and invoice forms in both products. Mirrors useTaxSettings.
 *
 * RETURNS EXTRAS_OFF, NOT NULL, BEFORE THE FETCH RESOLVES — the opposite of
 * useTaxSettings, and deliberately so. Tax returns null because a momentary 0%
 * would under-collect, and under-collected tax is money the shop owes. These
 * three are the other way round: showing a travel input before we know the shop
 * bills travel invites a tech to type hours that are then silently not charged.
 * Nothing is billed until the shop's own answer has arrived.
 */
export function useExtrasSettings(): ExtrasSettings {
  const [settings, setSettings] = useState<ExtrasSettings>(EXTRAS_OFF)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/profile')
        if (!res.ok) return
        const json = await res.json()
        // All three read false when migration 142 has not been applied, which is
        // the correct reading: a shop that has never set them bills none of them.
        if (!cancelled) setSettings(extrasSettingsFrom(json))
      } catch {
        // Leave everything off rather than blocking the tech.
      }
    })()
    return () => { cancelled = true }
  }, [])

  return settings
}
