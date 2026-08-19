// The 8 sections of the mini excavator pre-use daily checklist (OSHA 29 CFR
// 1926 Subpart W).
//
// Same eight-section shape as the full excavator, but a compact machine is not
// a small version of a big one. It rides on rubber tracks rather than steel
// pads, so cuts and exposed cords matter more than pin-and-bushing wear. It
// carries a dozer blade it grades and stabilizes with, and most units offset
// the boom to dig alongside a wall — a pivot, a lock pin and hoses that live in
// the hinge, none of which exist on a conventional excavator. The swing bearing
// is small, heavily loaded and the single most common structural failure.
//
// safetyCritical marks the items that put a machine out of service on failure:
// structural cracks, swing bearing failure, control and brake failures, ROPS or
// FOPS damage, exposed track cords. A weeping fitting or a faded decal is a
// deficiency; a cracked boom weld is a machine nobody may operate.

import type { EquipmentSection } from '@/types/equipment'

export const MINI_EXCAVATOR_SECTIONS: EquipmentSection[] = [
  {
    id: 'documentation', num: 1, label: 'Pre-Inspection Documentation',
    items: [
      { id: 'manual_present',      label: 'Operator manual present in weather-resistant storage' },
      { id: 'capacity_legible',    label: 'Lift capacity chart present and legible' },
      { id: 'decals_legible',      label: 'Safety decals and warning placards present and legible' },
      { id: 'previous_reviewed',   label: 'Previous shift inspection report reviewed' },
      { id: 'hour_meter_recorded', label: 'Hour meter reading recorded' },
      { id: 'service_current',     label: 'Scheduled service and any prior repairs current' },
    ],
  },
  {
    id: 'structural', num: 2, label: 'Structural — Boom, Arm, Bucket',
    items: [
      { id: 'no_weld_cracks',      label: 'No cracks in boom, arm or bucket welds and structural members', safetyCritical: true },
      { id: 'no_bent_members',     label: 'No bent, gouged or deformed boom, arm or house structure', safetyCritical: true },
      { id: 'pins_bushings',       label: 'Boom, arm and bucket pins secured, retainers in place, no excessive play', safetyCritical: true },
      { id: 'swing_bearing',       label: 'Swing bearing free of excessive play, greased, mount bolts tight to torque', safetyCritical: true },
      { id: 'offset_boom',         label: 'Offset boom pivot free of play, lock pin seats and secures, hoses through the offset unchafed', safetyCritical: true },
      { id: 'blade_condition',     label: 'Dozer blade, blade cylinder and cutting edge undamaged and securely mounted' },
      { id: 'bucket_teeth',        label: 'Bucket teeth, side cutters and coupler wedges present and tight' },
    ],
  },
  {
    id: 'hydraulic', num: 3, label: 'Hydraulic Systems',
    items: [
      { id: 'no_hyd_leaks',        label: 'No hydraulic leaks at hoses, fittings, cylinders or swivel', safetyCritical: true },
      { id: 'hyd_fluid_level',     label: 'Hydraulic fluid level adequate at sight glass' },
      { id: 'cylinder_rods',       label: 'Cylinder rods free of scoring, pitting and bent sections', safetyCritical: true },
      { id: 'no_cylinder_drift',   label: 'Boom, arm and blade hold position with no drift', safetyCritical: true },
      { id: 'hose_routing',        label: 'Hoses routed clear of pinch points, no chafing, abrasion or bulges' },
      { id: 'aux_couplers',        label: 'Auxiliary and thumb circuit couplers seated, capped and leak-free' },
    ],
  },
  {
    id: 'undercarriage', num: 4, label: 'Undercarriage — Rubber Tracks, Rollers, Idlers',
    items: [
      { id: 'track_condition',     label: 'Rubber tracks free of cuts, tears, embedded debris and exposed steel cords', safetyCritical: true },
      { id: 'track_tension',       label: 'Track tension within specification, tensioner holds grease' },
      { id: 'rollers_idlers',      label: 'Track rollers and idlers turn freely, no seized units or seal leaks' },
      { id: 'sprockets',           label: 'Drive sprockets free of excessive tooth wear and undamaged' },
      { id: 'track_frame',         label: 'Track frame undamaged, expandable undercarriage locks engaged', safetyCritical: true },
      { id: 'undercarriage_clean', label: 'Undercarriage clear of packed mud, rock and debris' },
    ],
  },
  {
    id: 'controls', num: 5, label: 'Controls and Safety Devices',
    items: [
      { id: 'lockout_lever',       label: 'Pilot control lockout lever disables all functions when raised', safetyCritical: true },
      { id: 'joystick_function',   label: 'Joysticks operate all functions smoothly and return to neutral', safetyCritical: true },
      { id: 'travel_controls',     label: 'Travel levers and pedals track straight and stop on release', safetyCritical: true },
      { id: 'swing_brake',         label: 'Swing function smooth and swing brake holds house position', safetyCritical: true },
      { id: 'blade_boom_swing',    label: 'Blade and boom swing pedals functional and return to neutral', safetyCritical: true },
      { id: 'travel_alarm',        label: 'Travel alarm and beacon functional' },
      { id: 'horn',                label: 'Horn functional' },
    ],
  },
  {
    id: 'cab', num: 6, label: 'Cab, Visibility and Mirrors',
    items: [
      { id: 'rops_fops',           label: 'ROPS/FOPS canopy or cab undamaged, unmodified, mount bolts tight', safetyCritical: true },
      { id: 'seat_belt',           label: 'Seat belt latches, retracts and webbing undamaged', safetyCritical: true },
      { id: 'seat_secure',         label: 'Operator seat and suspension secure and adjustable' },
      { id: 'glass_doors',         label: 'Glass clean and uncracked, door and window latches hold' },
      { id: 'mirrors_camera',      label: 'Mirrors and rear camera present, clean and correctly aimed' },
      { id: 'cab_clear',           label: 'Cab floor and step clear of tools, debris and grease' },
      { id: 'extinguisher',        label: 'Fire extinguisher present, charged and within inspection date' },
    ],
  },
  {
    id: 'engine', num: 7, label: 'Engine, Fluids and Filters',
    items: [
      { id: 'engine_oil',          label: 'Engine oil level within range, no visible leaks' },
      { id: 'coolant_level',       label: 'Coolant level adequate and radiator core clear of debris' },
      { id: 'fuel_water_sep',      label: 'Fuel level adequate and water separator drained' },
      { id: 'air_filter',          label: 'Air filter and pre-cleaner clean, restriction indicator clear' },
      { id: 'belts_hoses',         label: 'Belts and coolant hoses free of cracks, fraying and looseness' },
      { id: 'battery_terminals',   label: 'Battery secure, terminals clean and cables undamaged' },
      { id: 'engine_bay_clean',    label: 'Engine bay clear of oily debris and combustible material' },
    ],
  },
  {
    id: 'signoff', num: 8, label: 'Operator Sign-Off Readiness',
    items: [
      { id: 'overall_determination', label: 'Overall pass/fail determination made', safetyCritical: true },
      { id: 'deficiencies_noted',    label: 'All deficiencies described in notes' },
      { id: 'removal_assessed',      label: 'Removal from service assessed for any critical deficiency', safetyCritical: true },
      { id: 'work_area_assessed',    label: 'Work area assessed for overhead lines, utilities and ground stability', safetyCritical: true },
      { id: 'operator_identified',   label: 'Operator identified and signature captured' },
      { id: 'datetime_recorded',     label: 'Date, time and machine hours of inspection recorded' },
    ],
  },
]
