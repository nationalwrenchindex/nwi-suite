// ─── HD billable extras: settings, and the service call fee ───────────────────
//
// Pure: no React, no database. Shared by the HD settings route, the forms, the work
// order extras route and the converter, so every surface reads one rule.
//
// SETTINGS. HD has its own travel, mileage and shop supplies defaults since migration
// 178 (hd_bill_travel, ...). Before 178 is applied the HD forms used LD's columns
// from 142, and they still do then: hdExtrasSettingsFrom reads the HD columns when the
// row has them and LD's when it does not, so nothing a shop bills moves on the day
// either side ships. 178 backfills HD's columns from LD's for the same reason.
//
// THE SERVICE CALL FEE (migration 178) is a flat fee, separate from the road call fee,
// with its own tax treatment:
//
//   'labor'  taxed in the labor bucket, so it follows the labor tax setting - taxed
//            where labor is, untaxed where labor is not. The default.
//   'none'   never taxed. Still in the subtotal.
//
// The treatment is RECORDED ON EACH DOCUMENT (service_call_tax) when it is priced, and
// a document is always taxed by its own record - never by today's setting. A fee with
// no recorded treatment is taxed as labor, which is how a fee was taxed before 178.
//
// The diagnostic and road call fees are NOT settable this way: both are always taxed
// as labor (src/lib/tax.ts). That is unchanged here.

import { extrasSettingsFrom, EXTRAS_SETTINGS_SELECT, round2, type ExtrasSettings } from '@/lib/billable-extras'
import { isServiceCallTax, serviceCallFee, serviceCallTaxed, type ServiceCallTax } from '@/lib/service-call'

// The document helpers are shared with LD (lib/service-call): the two document columns
// have the same names in both products. Re-exported so HD's callers are unchanged.
export {
  isServiceCallTax, serviceCallFee, serviceCallTaxed, serviceCallColumns, withoutServiceCall,
  type ServiceCallTax,
} from '@/lib/service-call'

export interface HdServiceCallSettings {
  bill: boolean
  /** NULL = never set. 0 is a real answer. */
  fee: number | null
  tax: ServiceCallTax
}

export const SERVICE_CALL_OFF: HdServiceCallSettings = { bill: false, fee: null, tax: 'labor' }

/** The HD columns from migration 178. */
export const HD_EXTRAS_SELECT =
  'hd_bill_travel, hd_travel_rate_per_hour, hd_bill_mileage, hd_mileage_rate_per_mile, ' +
  'hd_bill_shop_supplies, hd_shop_supplies_percent, hd_shop_supplies_cap, ' +
  'hd_bill_service_call, hd_service_call_fee, hd_service_call_tax'

/** LD's columns from 142, read when 178 is not applied yet. */
export const LD_EXTRAS_SELECT = EXTRAS_SETTINGS_SELECT

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** True when this profile row has the migration 178 columns. */
export function hasHdExtrasColumns(profile: Record<string, unknown> | null | undefined): boolean {
  return profile != null && 'hd_bill_travel' in profile
}

/** HD's travel, mileage and shop supplies defaults: HD's own columns, else LD's. */
export function hdExtrasSettingsFrom(profile: Record<string, unknown> | null | undefined): ExtrasSettings {
  const p = profile ?? {}
  if (!hasHdExtrasColumns(p)) return extrasSettingsFrom(p)
  return {
    billTravel:          p.hd_bill_travel === true,
    travelRatePerHour:   num(p.hd_travel_rate_per_hour),
    billMileage:         p.hd_bill_mileage === true,
    mileageRatePerMile:  num(p.hd_mileage_rate_per_mile),
    billShopSupplies:    p.hd_bill_shop_supplies === true,
    shopSuppliesPercent: num(p.hd_shop_supplies_percent),
    shopSuppliesCap:     num(p.hd_shop_supplies_cap),
  }
}

/** The service call default. Off before migration 178. */
export function hdServiceCallFrom(profile: Record<string, unknown> | null | undefined): HdServiceCallSettings {
  const p = profile ?? {}
  if (!hasHdExtrasColumns(p)) return SERVICE_CALL_OFF
  return {
    bill: p.hd_bill_service_call === true,
    fee:  num(p.hd_service_call_fee),
    tax:  isServiceCallTax(p.hd_service_call_tax) ? p.hd_service_call_tax : 'labor',
  }
}

// ─── On a document ────────────────────────────────────────────────────────────

/** Every flat fee on a document: diagnostic + road call + service call. In the subtotal. */
export function hdFeesTotal(doc: Record<string, unknown>): number {
  return round2((num(doc.diagnostic_fee) ?? 0) + (num(doc.road_call_fee) ?? 0) + serviceCallFee(doc))
}

/** The fees in the LABOR tax bucket: diagnostic + road call, and the service call unless untaxed. */
export function hdTaxableFees(doc: Record<string, unknown>): number {
  return round2((num(doc.diagnostic_fee) ?? 0) + (num(doc.road_call_fee) ?? 0) + (serviceCallTaxed(doc) ? serviceCallFee(doc) : 0))
}

/** True for a write refused because migration 178's document columns are missing. */
export function isMissingServiceCallColumn(error: unknown): boolean {
  const e = (error ?? {}) as { code?: string; message?: string }
  const missing = e.code === '42703' || e.code === 'PGRST204'
  return missing && /service_call_(fee|tax)/.test(String(e.message ?? ''))
}
