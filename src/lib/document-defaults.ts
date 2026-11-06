// ─── What a NEW LD document starts at ─────────────────────────────────────────
//
// ONE place for the shop's document defaults: the labour rate a new labour line starts
// at, the parts markup, the tax settings, travel / mileage / shop supplies, and the
// service call fee with its tax treatment. Every LD surface that starts a document -
// the New Quote form, the work order form, QuickWrench and its save route - reads them
// through here and prices through lib/document-money. Before it, five surfaces each
// carried their own copy of "125 / 20 / 8.5", and QuickWrench never read the extras or
// the service call at all, so the same job quoted two ways came out two prices.
//
// NO INVENTED RATES. A setting the shop never made reads as 0 and says so
// (`laborRateSet` / `markupSet` false), never as a number nobody chose. 125 / 20 / 8.5
// used to be filled in silently, and a tech who typed before Settings landed quoted at
// them without noticing.
//
// An EXISTING document never reads these: recorded values beat current settings
// (CLAUDE.md). This is only what a document starts at.
//
// Pure, so the client hook (use-document-defaults) and the server loader
// (document-defaults.server) read one answer the same way. It accepts both shapes it
// meets: a profiles ROW (bill_travel, ...) and the GET /api/user/profile body
// (billTravel, ...). The tax and service call keys are the same in both.

import { taxSettingsFrom, type TaxSettings } from '@/lib/tax'
import {
  extrasSettingsFrom, extrasSettingsFromProfileApi, EXTRAS_OFF, type ExtrasSettings,
} from '@/lib/billable-extras'
import {
  ldServiceCallFrom, serviceCallSeed, SERVICE_CALL_OFF,
  type ServiceCall, type ServiceCallSettings,
} from '@/lib/service-call'

export interface DocumentDefaults {
  /** The rate a new labour line starts at. 0 when the shop never set one. */
  laborRate:    number
  laborRateSet: boolean
  /** Parts markup percent. 0 when the shop never set one. */
  markupPct:    number
  markupSet:    boolean
  /**
   * The single rate a document records as tax_percent and falls back to only when the
   * split is unknown: the parts rate, which is the post-140 home of the old single rate.
   * The tax itself is computed from `taxSettings`, bucket by bucket.
   */
  taxPct:       number
  taxSettings:  TaxSettings
  /** Travel, mileage and shop supplies, as the billing method picker set them. */
  extras:       ExtrasSettings
  serviceCall:  ServiceCallSettings
  /** False when the database has no migration 180: then no document offers the fee. */
  serviceCallAvailable: boolean
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function documentDefaultsFrom(profile: Record<string, unknown> | null | undefined): DocumentDefaults {
  const p = profile ?? {}
  const laborRate = num(p.default_labor_rate)
  const markupPct = num(p.default_parts_markup_percent)
  const taxSettings = taxSettingsFrom(p)
  // The API body spreads the extras as camelCase; a profiles row has the column names.
  const extras = 'billTravel' in p ? extrasSettingsFromProfileApi(p)
    : 'bill_travel' in p ? extrasSettingsFrom(p)
    : EXTRAS_OFF
  const serviceCallAvailable = 'service_call_available' in p
    ? p.service_call_available === true
    : 'bill_service_call' in p
  return {
    laborRate:    laborRate ?? 0,
    laborRateSet: laborRate !== null,
    markupPct:    markupPct ?? 0,
    markupSet:    markupPct !== null,
    taxPct:       taxSettings.tax_rate_parts,
    taxSettings,
    extras,
    serviceCall:  serviceCallAvailable ? ldServiceCallFrom(p) : SERVICE_CALL_OFF,
    serviceCallAvailable,
  }
}

/** Before anything has loaded: nothing billed, nothing invented. */
export const NO_DOCUMENT_DEFAULTS: DocumentDefaults = documentDefaultsFrom(null)

/**
 * The service call a NEW document starts with: the shop's fee when it bills one, taxed
 * the way Settings says. Null when the database cannot record a fee (pre-180), which
 * lib/document-money reads as "no fee".
 */
export function newDocumentServiceCall(d: DocumentDefaults): ServiceCall | null {
  return d.serviceCallAvailable ? serviceCallSeed(d.serviceCall) : null
}

/** How the fee's tax treatment reads under the field - from the setting or the record. */
export function serviceCallTaxText(tax: ServiceCall['tax'], from: 'settings' | 'document'): string {
  const what = tax === 'none' ? 'Not taxed' : 'Taxed as labor'
  return from === 'settings' ? `${what} (your Settings).` : `${what} (as recorded on this document).`
}
