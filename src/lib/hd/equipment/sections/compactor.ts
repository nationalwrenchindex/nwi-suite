// The 8 sections of the compactor / roller pre-use daily checklist.
//
// OSHA 29 CFR 1926 Subpart W — rollers are covered material-handling equipment
// and must be inspected before each shift, with defective machines taken out of
// service until repaired.
//
// safetyCritical marks the items that put a machine out of service on failure:
// structural cracks in frame or drum, a missing articulation lock bar, damaged
// ROPS, and any brake, control or presence-switch failure. A worn pad foot or a
// clogged spray nozzle is a deficiency; an unlocked articulation joint is a
// machine nobody may operate.
//
// The water spray section applies only to machines so equipped — inspectors mark
// those items N/A otherwise, so none of them are safety critical.

import type { EquipmentSection } from '@/types/equipment'

export const COMPACTOR_SECTIONS: EquipmentSection[] = [
  {
    id: 'documentation', num: 1, label: 'Pre-Inspection Documentation',
    items: [
      { id: 'prior_defects_reviewed', label: 'Previous shift report reviewed and open defects closed' },
      { id: 'manual_present',         label: 'Operator manual present in weather-resistant storage' },
      { id: 'decals_legible',         label: 'Safety decals, ROPS plate and capacity data legible' },
      { id: 'hour_meter_recorded',    label: 'Hour meter reading recorded at start of shift' },
      { id: 'operator_qualified',     label: 'Operator trained and authorized for this machine class' },
    ],
  },
  {
    id: 'drum', num: 2, label: 'Drum or Pad Foot Condition',
    items: [
      { id: 'drum_shell_intact',    label: 'No cracks, splits or deep gouges in drum shell', safetyCritical: true },
      { id: 'drum_no_dents',        label: 'Drum free of dents or flat spots affecting finish' },
      { id: 'pad_feet_retained',    label: 'Pad feet / tamping feet present, within wear limits and securely retained' },
      { id: 'isolation_mounts',     label: 'Drum isolation mounts intact, no cracked or collapsed rubber' },
      { id: 'scraper_bars',         label: 'Scraper bars adjusted, undamaged and clearing the drum' },
      { id: 'vibration_function',   label: 'Vibration system engages, changes amplitude and shuts off on command' },
    ],
  },
  {
    id: 'frame', num: 3, label: 'Frame and Articulation Joint',
    items: [
      { id: 'frame_no_cracks',    label: 'No cracks in frame welds, yokes or structural members', safetyCritical: true },
      { id: 'articulation_pins',  label: 'Articulation joint pins and bushings secure, no excessive play', safetyCritical: true },
      { id: 'lock_bar_present',   label: 'Articulation lock bar present, operable and stowed for operation', safetyCritical: true },
      { id: 'hardware_tight',     label: 'Frame, drum yoke and counterweight fasteners tight' },
      { id: 'steps_handholds',    label: 'Steps, handholds and operator platform secure and free of grease' },
    ],
  },
  {
    id: 'hydraulic', num: 4, label: 'Hydraulic Systems',
    items: [
      { id: 'no_hyd_leaks',     label: 'No hydraulic leaks at hoses, fittings or cylinders' },
      { id: 'hose_condition',   label: 'Hydraulic hoses free of chafing, cracking, bulges and kinks' },
      { id: 'reservoir_level',  label: 'Hydraulic reservoir level within sight-glass range' },
      { id: 'cylinder_rods',    label: 'Steering and lift cylinder rods free of scoring, pitting and drift' },
      { id: 'filter_indicator', label: 'Hydraulic filter indicator reading normal, not in bypass' },
    ],
  },
  {
    id: 'controls', num: 5, label: 'Controls and ROPS',
    items: [
      { id: 'rops_intact',          label: 'ROPS undamaged, unmodified and mounting fasteners tight', safetyCritical: true },
      { id: 'seat_belt',            label: 'Seat belt present, latches and retracts, webbing undamaged', safetyCritical: true },
      { id: 'seat_presence_switch', label: 'Seat presence switch stops propel when operator leaves the seat', safetyCritical: true },
      { id: 'propel_neutral',       label: 'Propel lever returns to neutral and machine comes to a stop', safetyCritical: true },
      { id: 'steering_response',    label: 'Steering responds smoothly through full articulation both ways', safetyCritical: true },
      { id: 'brakes_hold',          label: 'Service and parking brakes stop and hold the machine on grade', safetyCritical: true },
      { id: 'alarm_horn_lights',    label: 'Travel / back-up alarm, horn, lights and beacon functional' },
    ],
  },
  {
    id: 'water_system', num: 6, label: 'Water Spray System (if equipped)',
    items: [
      { id: 'system_equipped', label: 'Machine equipped with water spray system — mark this section N/A if not' },
      { id: 'tank_level',      label: 'Water tank filled to operating level for the shift' },
      { id: 'nozzles_clear',   label: 'Spray nozzles unclogged and wetting the full drum width' },
      { id: 'water_pump',      label: 'Water pump primes and runs without cavitation or cycling' },
      { id: 'water_filter',    label: 'Water filter and tank strainer clean and free of debris' },
      { id: 'no_water_leaks',  label: 'No leaks at water lines, tank fittings or drain valves' },
    ],
  },
  {
    id: 'engine', num: 7, label: 'Engine, Fluids and Filters',
    items: [
      { id: 'engine_oil',   label: 'Engine oil at operating level, no leaks under the machine' },
      { id: 'coolant',      label: 'Coolant level adequate and radiator core clear of debris' },
      { id: 'fuel_level',   label: 'Fuel level adequate for the shift, no fuel leaks or weeping lines' },
      { id: 'air_filter',   label: 'Air filter restriction indicator in range, element and housing sealed' },
      { id: 'belts_hoses',  label: 'Belts and coolant hoses free of cracking, glazing and looseness' },
      { id: 'battery',      label: 'Battery secured, terminals clean and cables tight' },
    ],
  },
  {
    id: 'signoff', num: 8, label: 'Operator Sign-Off Readiness',
    items: [
      { id: 'overall_determination', label: 'Overall pass/fail determination made', safetyCritical: true },
      { id: 'deficiencies_noted',    label: 'All deficiencies described in notes' },
      { id: 'removal_assessed',      label: 'Removal from service assessed for any critical deficiency', safetyCritical: true },
      { id: 'hour_meter_logged',     label: 'Hour meter reading logged on the completed form' },
      { id: 'operator_identified',   label: 'Operator identified and signature captured' },
      { id: 'datetime_recorded',     label: 'Date, time and job location of inspection recorded' },
    ],
  },
]
