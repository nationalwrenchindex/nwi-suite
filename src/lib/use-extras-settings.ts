'use client'

import { useEffect, useState } from 'react'
import { EXTRAS_OFF, type ExtrasSettings } from '@/lib/billable-extras'

/**
 * The settings as GET /api/user/profile sends them: already an ExtrasSettings object,
 * spread onto the response (billTravel, travelRatePerHour, ...).
 *
 * THE BUG THIS CLOSES (Oct 3 - Nov 4, 2026): the answer was read back through
 * extrasSettingsFrom, which reads the PROFILE ROW's column names (bill_travel, ...).
 * The response has none of them, so every flag read false and every rate null: every
 * LD form believed the shop billed no travel, mileage or shop supplies, whatever
 * Settings said, and no new LD document could bill any of the three.
 */
export function extrasSettingsFromProfileApi(json: Record<string, unknown> | null | undefined): ExtrasSettings {
  const j = json ?? {}
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    billTravel:          j.billTravel === true,
    travelRatePerHour:   num(j.travelRatePerHour),
    billMileage:         j.billMileage === true,
    mileageRatePerMile:  num(j.mileageRatePerMile),
    billShopSupplies:    j.billShopSupplies === true,
    shopSuppliesPercent: num(j.shopSuppliesPercent),
    shopSuppliesCap:     num(j.shopSuppliesCap),
  }
}

/**
 * The shop's travel / mileage / shop-supplies settings, for the quote, work order
 * and invoice forms in both products. Mirrors useTaxSettings.
 *
 * READ THIS BEFORE CHANGING THE LOADING BEHAVIOUR.
 *
 * It used to return EXTRAS_OFF while the fetch was in flight and let callers treat
 * that as "this shop bills nothing". That was wrong twice over:
 *
 *   1. It HID the travel and mileage inputs on first render, so a tech had nowhere to
 *      type hours until a fetch they cannot see completed. On a slow connection the
 *      fields simply were not there.
 *   2. Worse, callers used it to PRICE. computeExtras gated the charges on these
 *      flags, so first render recomputed every extra as zero - and the LD invoice
 *      editor then subtracted a fee the invoice already carried. INV-2026-0015 lost
 *      0.77 of shop supplies that way and was finalized 0.83 light.
 *
 * So `loaded` is now part of the contract. "Not loaded" is a THIRD state and must not
 * be collapsed into "off":
 *
 *   SHOW inputs when   loaded === false || the relevant bill* flag is true
 *   PRICE from         the document's own recorded rates first, these only as the
 *                      fallback for a document that has none
 *
 * The pricing half is enforced in computeExtras, which treats a recorded rate or
 * percentage as proof that the document bills that extra. This hook cannot be the
 * thing that decides a saved document charges nothing.
 */
export interface ExtrasSettingsState {
  settings: ExtrasSettings
  /** False until the profile answer has actually arrived. */
  loaded:   boolean
  /** True when the fetch finished but failed, so the caller can say why. */
  failed:   boolean
}

export function useExtrasSettingsState(): ExtrasSettingsState {
  const [state, setState] = useState<ExtrasSettingsState>({
    settings: EXTRAS_OFF,
    loaded:   false,
    failed:   false,
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/profile')
        if (!res.ok) {
          if (!cancelled) setState({ settings: EXTRAS_OFF, loaded: true, failed: true })
          return
        }
        const json = await res.json()
        // All three read false when migration 142 has not been applied, which is the
        // correct reading: a shop that has never set them bills none of them.
        if (!cancelled) setState({ settings: extrasSettingsFromProfileApi(json), loaded: true, failed: false })
      } catch {
        if (!cancelled) setState({ settings: EXTRAS_OFF, loaded: true, failed: true })
      }
    })()
    return () => { cancelled = true }
  }, [])

  return state
}

/**
 * The settings alone, for callers that only need the values.
 *
 * Kept so the existing call sites compile unchanged. A caller deciding whether to
 * SHOW an input wants useExtrasSettingsState so it can honour `loaded`.
 */
export function useExtrasSettings(): ExtrasSettings {
  return useExtrasSettingsState().settings
}
