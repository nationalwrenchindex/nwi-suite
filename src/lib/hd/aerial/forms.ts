// The three aerial form definitions.
//
// Each cadence is the shared 8 sections plus whatever that cadence adds, so a
// change to a common item lands in all three by construction rather than by
// three people remembering to make the same edit.

import type { AerialFormDef, AerialInspectionType } from '@/types/aerial'
import { PRE_USE_SECTIONS, FREQUENT_SECTIONS, ANNUAL_SECTIONS } from './sections'

export const PRE_USE_FORM: AerialFormDef = {
  type:     'pre_use',
  title:    'Aerial Pre-Use Inspection',
  citation: 'OSHA 29 CFR 1926.453 · ANSI/SAIA A92.22',
  cadence:  'Required daily, before every shift, by the operator.',
  sections: PRE_USE_SECTIONS,
  requiresInspectorCert:   false,
  requiresServiceHistory:  false,
  requiresOperatorContext: true,
}

export const FREQUENT_FORM: AerialFormDef = {
  type:     'frequent',
  title:    'Aerial Frequent Inspection',
  citation: 'ANSI/SAIA A92',
  cadence:  'Required every 3 months or 150 hours of operation, whichever comes first. Must be performed by a qualified mechanic.',
  sections: [...PRE_USE_SECTIONS, ...FREQUENT_SECTIONS],
  requiresInspectorCert:   false,
  requiresServiceHistory:  true,
  requiresOperatorContext: false,
}

export const ANNUAL_FORM: AerialFormDef = {
  type:     'annual',
  title:    'Aerial Annual Machine Inspection',
  citation: 'ANSI/SAIA A92.20',
  cadence:  'Required every 13 months. Must be performed by a qualified person; inspector license or certification number is required.',
  sections: [...PRE_USE_SECTIONS, ...FREQUENT_SECTIONS, ...ANNUAL_SECTIONS],
  requiresInspectorCert:   true,
  requiresServiceHistory:  true,
  requiresOperatorContext: false,
}

export const AERIAL_FORMS: Record<AerialInspectionType, AerialFormDef> = {
  pre_use:  PRE_USE_FORM,
  frequent: FREQUENT_FORM,
  annual:   ANNUAL_FORM,
}

export const AERIAL_TYPE_LABEL: Record<AerialInspectionType, string> = {
  pre_use:  'Pre-Use',
  frequent: 'Frequent',
  annual:   'Annual',
}

/**
 * How long each cadence stays valid. Drives the overdue flags on the dashboard
 * (item 6). Frequent also has a 150-hour limit, which the hour meter check
 * applies separately — whichever comes first.
 */
export const AERIAL_INTERVAL_DAYS: Record<AerialInspectionType, number> = {
  pre_use:  1,
  frequent: 90,
  annual:   396, // 13 months
}

export const FREQUENT_INTERVAL_HOURS = 150
