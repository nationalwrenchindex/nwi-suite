// The equipment form definitions.
//
// Every machine class is one entry here. Adding a class is a new sections file
// plus a row in EQUIPMENT_FORMS — no schema change, because hd_equipment_inspections
// stores equipment_type as free text for exactly this reason.
//
// Crane is the one class with two cadences (ASME B30.5 frequent and annual). The
// annual is composed as frequent + annual-only sections, the same way the aerial
// annual is composed, so a change to a shared crane item lands in both by
// construction rather than by someone remembering to edit twice.

import type { EquipmentFormDef, EquipmentType } from '@/types/equipment'
import { EXCAVATOR_SECTIONS }      from './sections/excavator'
import { MINI_EXCAVATOR_SECTIONS } from './sections/mini-excavator'
import { SKID_STEER_SECTIONS }     from './sections/skid-steer'
import { DOZER_SECTIONS }          from './sections/dozer'
import { BACKHOE_SECTIONS }        from './sections/backhoe'
import { TRENCHER_SECTIONS }       from './sections/trencher'
import { TELEHANDLER_SECTIONS }    from './sections/telehandler'
import { FORKLIFT_SECTIONS }       from './sections/forklift'
import { CRANE_FREQUENT_SECTIONS, CRANE_ANNUAL_SECTIONS } from './sections/crane'
import { COMPACTOR_SECTIONS }      from './sections/compactor'
import { UTV_SECTIONS }            from './sections/utv'

/** Defaults shared by every daily pre-use form, so they cannot drift apart. */
const PRE_USE_FLAGS = {
  requiresInspectorCert:   false,
  requiresServiceHistory:  false,
  requiresOperatorContext: true,
} as const

const OSHA_SUBPART_W = 'OSHA 29 CFR 1926 Subpart W'
const DAILY_CADENCE  = 'Required daily, before every shift, by the operator.'

export const EQUIPMENT_FORMS: Record<EquipmentType, EquipmentFormDef> = {
  excavator: {
    type: 'excavator', title: 'Excavator Pre-Use Inspection',
    citation: OSHA_SUBPART_W, cadence: DAILY_CADENCE,
    sections: EXCAVATOR_SECTIONS, ...PRE_USE_FLAGS,
  },
  mini_excavator: {
    type: 'mini_excavator', title: 'Mini Excavator Pre-Use Inspection',
    citation: OSHA_SUBPART_W, cadence: DAILY_CADENCE,
    sections: MINI_EXCAVATOR_SECTIONS, ...PRE_USE_FLAGS,
  },
  skid_steer: {
    type: 'skid_steer', title: 'Skid Steer Loader Pre-Use Inspection',
    citation: OSHA_SUBPART_W, cadence: DAILY_CADENCE,
    sections: SKID_STEER_SECTIONS, ...PRE_USE_FLAGS,
  },
  dozer: {
    type: 'dozer', title: 'Dozer Pre-Use Inspection',
    citation: OSHA_SUBPART_W, cadence: DAILY_CADENCE,
    sections: DOZER_SECTIONS, ...PRE_USE_FLAGS,
  },
  backhoe: {
    type: 'backhoe', title: 'Backhoe Loader Pre-Use Inspection',
    citation: OSHA_SUBPART_W, cadence: DAILY_CADENCE,
    sections: BACKHOE_SECTIONS, ...PRE_USE_FLAGS,
  },
  trencher: {
    type: 'trencher', title: 'Trencher Pre-Use Inspection',
    citation: `${OSHA_SUBPART_W} · Subpart P for the excavation`, cadence: DAILY_CADENCE,
    sections: TRENCHER_SECTIONS, ...PRE_USE_FLAGS,
  },
  telehandler: {
    type: 'telehandler', title: 'Telehandler Pre-Use Inspection',
    citation: 'OSHA 29 CFR 1910.178 · ANSI/ITSDF B56.6',
    cadence: 'Required before each shift the vehicle is used.',
    sections: TELEHANDLER_SECTIONS, ...PRE_USE_FLAGS,
  },
  forklift: {
    type: 'forklift', title: 'Forklift Pre-Use Inspection',
    citation: 'OSHA 29 CFR 1910.178(q)',
    cadence: 'Required before each shift. A truck found unsafe must be removed from service immediately.',
    sections: FORKLIFT_SECTIONS, ...PRE_USE_FLAGS,
  },
  crane_frequent: {
    type: 'crane_frequent', title: 'Crane Frequent Inspection',
    citation: 'ASME B30.5',
    cadence: 'Required at daily-to-monthly intervals depending on service severity.',
    sections: CRANE_FREQUENT_SECTIONS,
    requiresInspectorCert:   false,
    requiresServiceHistory:  true,
    requiresOperatorContext: false,
  },
  crane_annual: {
    type: 'crane_annual', title: 'Crane Annual Inspection',
    citation: 'ASME B30.5',
    cadence: 'Required every 12 months by a qualified inspector; credential and load-test documentation required.',
    sections: [...CRANE_FREQUENT_SECTIONS, ...CRANE_ANNUAL_SECTIONS],
    requiresInspectorCert:   true,
    requiresServiceHistory:  true,
    requiresOperatorContext: false,
    requiresLoadTest:        true,
  },
  compactor: {
    type: 'compactor', title: 'Compactor / Roller Pre-Use Inspection',
    citation: OSHA_SUBPART_W, cadence: DAILY_CADENCE,
    sections: COMPACTOR_SECTIONS, ...PRE_USE_FLAGS,
  },
  utv: {
    type: 'utv', title: 'UTV Pre-Use Inspection',
    citation: 'OSHA General Duty Clause · ANSI/OPEI B71.9',
    cadence: DAILY_CADENCE,
    sections: UTV_SECTIONS, ...PRE_USE_FLAGS,
  },
}

export const EQUIPMENT_TYPE_LABEL: Record<EquipmentType, string> = {
  excavator:      'Excavator',
  mini_excavator: 'Mini Excavator',
  skid_steer:     'Skid Steer',
  dozer:          'Dozer',
  backhoe:        'Backhoe Loader',
  trencher:       'Trencher',
  telehandler:    'Telehandler',
  forklift:       'Forklift',
  crane_frequent: 'Crane — Frequent',
  crane_annual:   'Crane — Annual',
  compactor:      'Compactor / Roller',
  utv:            'UTV',
}

/**
 * How long each inspection stays valid, in days. Drives the overdue flags on the
 * equipment dashboard. Daily pre-use forms expire the next day; crane frequent is
 * treated at the monthly end of the B30.5 range, annual at 12 months.
 */
export const EQUIPMENT_INTERVAL_DAYS: Record<EquipmentType, number> = {
  excavator:      1,
  mini_excavator: 1,
  skid_steer:     1,
  dozer:          1,
  backhoe:        1,
  trencher:       1,
  telehandler:    1,
  forklift:       1,
  crane_frequent: 30,
  crane_annual:   365,
  compactor:      1,
  utv:            1,
}

/**
 * Billable hours when an inspection creates its own invoice. A daily walkaround
 * is minutes; a crane annual is a day's work. Billing them all the same would
 * overcharge every pre-use form.
 */
export const EQUIPMENT_INSPECTION_HOURS: Record<EquipmentType, number> = {
  excavator:      0.5,
  mini_excavator: 0.5,
  skid_steer:     0.5,
  dozer:          0.5,
  backhoe:        0.5,
  trencher:       0.5,
  telehandler:    0.5,
  forklift:       0.5,
  crane_frequent: 2.0,
  crane_annual:   4.0,
  compactor:      0.5,
  utv:            0.5,
}

export const EQUIPMENT_TYPES = Object.keys(EQUIPMENT_FORMS) as EquipmentType[]

export function isEquipmentType(v: unknown): v is EquipmentType {
  return typeof v === 'string' && v in EQUIPMENT_FORMS
}
