// The 8 sections of the excavator / track hoe / digger pre-use daily checklist.
//
// Run by the operator before the first cycle of the shift (OSHA 29 CFR 1926
// Subpart W, 1926.601 and 1926.602). 49 points covering the structure, the
// hydraulics that carry the load, the undercarriage that carries the machine,
// and the devices that stop it.
//
// safetyCritical marks the items that put a machine out of service on failure:
// structural cracks, control and brake failures, ROPS/FOPS damage, a quick
// coupler that will not positively lock, and dead safety devices. A weeping
// fitting, a low washer bottle or a faded decal is a deficiency to be written
// up; a cracked boom weld or a swing brake that will not hold is a machine
// nobody may operate.

import type { EquipmentSection } from '@/types/equipment'

export const EXCAVATOR_SECTIONS: EquipmentSection[] = [
  {
    id: 'documentation', num: 1, label: 'Pre-Inspection Documentation',
    items: [
      { id: 'manual_present',      label: 'Operator manual present in weather-resistant storage' },
      { id: 'capacity_legible',    label: 'Lift capacity chart present and legible for the installed boom and stick' },
      { id: 'previous_reviewed',   label: 'Previous shift report reviewed and open defects known' },
      { id: 'hour_meter_recorded', label: 'Hour meter reading recorded' },
      { id: 'service_current',     label: 'Scheduled service interval not overdue' },
    ],
  },
  {
    id: 'structural', num: 2, label: 'Structural — Boom, Arm, Bucket',
    items: [
      { id: 'no_weld_cracks',      label: 'No cracks in welds or structural members of boom, arm or house', safetyCritical: true },
      { id: 'no_bent_members',     label: 'No bent, twisted or gouged boom, arm or bucket linkage', safetyCritical: true },
      { id: 'pins_bushings',       label: 'Pins and bushings secure, retained and free of excessive play', safetyCritical: true },
      { id: 'quick_coupler_lock',  label: 'Quick coupler engages positive lock and safety pin installed', safetyCritical: true },
      { id: 'bucket_teeth',        label: 'Bucket teeth and adapters present and retained' },
      { id: 'decals_legible',      label: 'Safety decals and placards present and legible' },
    ],
  },
  {
    id: 'hydraulic', num: 3, label: 'Hydraulic Systems',
    items: [
      { id: 'no_hyd_leaks',        label: 'No hydraulic leaks at hoses, fittings or cylinders', safetyCritical: true },
      { id: 'cylinder_rods',       label: 'Boom, arm and bucket cylinder rods free of scoring, pitting or bending', safetyCritical: true },
      { id: 'no_drift',            label: 'Boom and arm hold position without drift when parked', safetyCritical: true },
      { id: 'hose_routing',        label: 'Hoses routed clear of pinch points with no chafing or bulging', safetyCritical: true },
      { id: 'hyd_fluid_level',     label: 'Hydraulic reservoir level within sight-glass range' },
      { id: 'aux_couplers',        label: 'Auxiliary circuit couplers clean, capped and free of leaks' },
    ],
  },
  {
    id: 'undercarriage', num: 4, label: 'Undercarriage — Tracks, Rollers, Idlers',
    items: [
      { id: 'track_tension',       label: 'Track tension within specification and adjusters holding' },
      { id: 'track_shoes',         label: 'Track shoes, links and pads intact with bolts tight', safetyCritical: true },
      { id: 'sprocket_wear',       label: 'Drive sprocket teeth within wear limits', safetyCritical: true },
      { id: 'rollers_idlers',      label: 'Track and carrier rollers and idlers turning freely, not seized or leaking' },
      { id: 'final_drives',        label: 'Final drive housings free of leaks and oil level correct' },
      { id: 'undercarriage_clear', label: 'Undercarriage clear of packed mud, rock and debris' },
    ],
  },
  {
    id: 'controls', num: 5, label: 'Controls and Safety Devices',
    items: [
      { id: 'joystick_function',   label: 'Joysticks and travel pedals move all functions correctly and return to neutral', safetyCritical: true },
      { id: 'pilot_lockout',       label: 'Hydraulic pilot control lockout lever disables all functions when raised', safetyCritical: true },
      { id: 'swing_brake',         label: 'Swing brake holds the house against grade and does not slip', safetyCritical: true },
      { id: 'travel_park_brake',   label: 'Travel and parking brake hold the machine on grade', safetyCritical: true },
      { id: 'travel_alarm',        label: 'Travel alarm and backup alarm audible over ambient noise', safetyCritical: true },
      { id: 'horn',                label: 'Horn functional' },
      { id: 'gauges_warnings',     label: 'Gauges and warning lamps illuminate on key-on and clear on start' },
    ],
  },
  {
    id: 'cab', num: 6, label: 'Cab, Visibility and Mirrors',
    items: [
      { id: 'rops_fops',           label: 'ROPS/FOPS structure undamaged with all mounting bolts present and tight', safetyCritical: true },
      { id: 'seat_belt',           label: 'Seat belt webbing, latch and retractor functional', safetyCritical: true },
      { id: 'glass_intact',        label: 'Cab glass intact with no cracks obstructing the operator view', safetyCritical: true },
      { id: 'mirrors_cameras',     label: 'Mirrors and rear-view camera present, clean and adjusted' },
      { id: 'access_handholds',    label: 'Steps, handholds and walkways secure and free of grease' },
      { id: 'extinguisher',        label: 'Fire extinguisher present, charged and within inspection date' },
    ],
  },
  {
    id: 'engine', num: 7, label: 'Engine, Fluids and Filters',
    items: [
      { id: 'engine_oil',          label: 'Engine oil level within range and no visible leaks' },
      { id: 'coolant_level',       label: 'Coolant level adequate and radiator core clear of debris' },
      { id: 'fuel_water_sep',      label: 'Fuel level adequate and water separator drained' },
      { id: 'air_filter',          label: 'Air filter restriction indicator within range and housing sealed' },
      { id: 'belts_hoses',         label: 'Belts and coolant hoses free of cracks, fraying or looseness' },
      { id: 'battery_secure',      label: 'Battery secured, terminals clean and cables tight', safetyCritical: true },
      { id: 'no_exhaust_leaks',    label: 'No exhaust leaks into the cab or engine compartment', safetyCritical: true },
    ],
  },
  {
    id: 'signoff', num: 8, label: 'Operator Sign-Off Readiness',
    items: [
      { id: 'overall_determination', label: 'Overall pass/fail determination made', safetyCritical: true },
      { id: 'deficiencies_noted',    label: 'All deficiencies described in notes' },
      { id: 'removal_assessed',      label: 'Removal from service assessed for any critical deficiency', safetyCritical: true },
      { id: 'swing_radius_planned',  label: 'Swing radius and overhead clearances assessed for the work area', safetyCritical: true },
      { id: 'operator_identified',   label: 'Operator identified and signature captured' },
      { id: 'datetime_recorded',     label: 'Date, time and hour meter recorded' },
    ],
  },
]
