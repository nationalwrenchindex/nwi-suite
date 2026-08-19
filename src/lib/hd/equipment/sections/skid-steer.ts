// The 8 sections of the skid steer loader pre-use daily checklist.
//
// Run by the operator before the first cycle of the shift (OSHA 29 CFR 1926
// Subpart W, 1926.600 and 1926.602). 50 points covering the frame and the
// attachment that hangs off it, the arms that lift the load, what the machine
// rolls on, and the interlocks that are the only thing between the operator
// and the lift arms.
//
// safetyCritical marks the items that put a machine out of service on failure:
// structural cracks, a seat bar or presence interlock that does not disable
// functions, a quick-attach that will not positively lock, ROPS/FOPS damage or
// a missing certification label, brake and control failures, and a missing lift
// arm support device. A weeping fitting, a dirty screen or a faded decal is a
// deficiency to be written up; a lap bar that lets the arms move while raised
// is a machine nobody may operate.

import type { EquipmentSection } from '@/types/equipment'

export const SKID_STEER_SECTIONS: EquipmentSection[] = [
  {
    id: 'documentation', num: 1, label: 'Pre-Inspection Documentation',
    items: [
      { id: 'manual_present',    label: 'Operator manual present in cab storage' },
      { id: 'capacity_plate',    label: 'Rated operating capacity plate present and legible for the installed attachment' },
      { id: 'previous_reviewed', label: 'Previous shift report reviewed and open defects known' },
      { id: 'service_current',   label: 'Scheduled service interval not overdue on the hour meter' },
      { id: 'decals_legible',    label: 'Safety decals and warning placards present and legible' },
    ],
  },
  {
    id: 'structural', num: 2, label: 'Structural — Frame, Bucket, Attachments',
    items: [
      { id: 'no_frame_cracks',   label: 'No cracks in welds or structural members of frame, tower or lift arms', safetyCritical: true },
      { id: 'no_bent_members',   label: 'No bent, twisted or gouged lift arms, mounting plate or chassis', safetyCritical: true },
      { id: 'quick_attach_lock', label: 'Quick-attach levers fully seated and locking pins engaged through the attachment', safetyCritical: true },
      { id: 'attachment_seated', label: 'Attachment pulled back square against the mounting plate with no gap', safetyCritical: true },
      { id: 'pins_bushings',     label: 'Lift arm and cylinder pins retained and free of excessive play', safetyCritical: true },
      { id: 'bucket_edge',       label: 'Bucket cutting edge, side plates and teeth intact and retained' },
    ],
  },
  {
    id: 'hydraulics', num: 3, label: 'Hydraulics — Lift Arms and Tilt',
    items: [
      { id: 'arm_support_device', label: 'Lift arm support device and its brace pin present and stowed on the machine', safetyCritical: true },
      { id: 'no_hyd_leaks',       label: 'No hydraulic leaks at hoses, fittings or cylinders', safetyCritical: true },
      { id: 'cylinder_rods',      label: 'Lift and tilt cylinder rods free of scoring, pitting or bending', safetyCritical: true },
      { id: 'no_arm_drift',       label: 'Lift arms and bucket hold position without drift when parked', safetyCritical: true },
      { id: 'hose_routing',       label: 'Hoses routed clear of pinch points with no chafing or bulging', safetyCritical: true },
      { id: 'hyd_fluid_level',    label: 'Hydraulic reservoir level within sight-glass range' },
      { id: 'aux_couplers',       label: 'Auxiliary hydraulic couplers clean, capped, seated and free of leaks' },
    ],
  },
  {
    id: 'tires_tracks', num: 4, label: 'Tires or Tracks',
    items: [
      { id: 'tire_condition',  label: 'Tires inflated to specification with no cuts, exposed cord or missing lugs' },
      { id: 'lug_nuts',        label: 'Wheel lug nuts and studs present and tight', safetyCritical: true },
      { id: 'track_tension',   label: 'Track tension within specification and adjusters holding' },
      { id: 'track_condition', label: 'Rubber tracks free of tears, missing lugs or exposed cord', safetyCritical: true },
      { id: 'rollers_idlers',  label: 'Rollers, idlers and drive sprockets turning freely, not seized or leaking' },
      { id: 'chaincase_level', label: 'Chaincase oil level correct and no leaks at the final drives' },
    ],
  },
  {
    id: 'controls', num: 5, label: 'Controls and Safety Devices',
    items: [
      { id: 'seat_bar_interlock', label: 'Seat bar lowers and latches, and lift, tilt and drive are locked out while it is raised', safetyCritical: true },
      { id: 'seat_belt',          label: 'Seat belt webbing, latch and retractor functional', safetyCritical: true },
      { id: 'operator_presence',  label: 'Operator presence switch disables all functions when the seat is vacated', safetyCritical: true },
      { id: 'controls_neutral',   label: 'Drive, lift and tilt controls move all functions correctly and return to neutral', safetyCritical: true },
      { id: 'park_brake',         label: 'Parking brake holds the machine on grade and does not slip', safetyCritical: true },
      { id: 'backup_alarm',       label: 'Backup alarm and horn audible over ambient noise' },
      { id: 'gauges_warnings',    label: 'Gauges and warning lamps illuminate on key-on and clear on start' },
    ],
  },
  {
    id: 'rops_fops', num: 6, label: 'ROPS/FOPS Certification',
    items: [
      { id: 'rops_structure',    label: 'ROPS structure free of cracks, bends or damaged welds', safetyCritical: true },
      { id: 'fops_top_guard',    label: 'FOPS top guard undamaged and securely mounted', safetyCritical: true },
      { id: 'cert_label',        label: 'ROPS/FOPS certification label present and legible', safetyCritical: true },
      { id: 'mounting_hardware', label: 'ROPS mounting bolts present, correct grade and tight', safetyCritical: true },
      { id: 'no_modifications',  label: 'No welding, drilling or field modification of the ROPS structure', safetyCritical: true },
      { id: 'cab_door_screens',  label: 'Cab door, side screens and front guard in place and latched' },
    ],
  },
  {
    id: 'engine', num: 7, label: 'Engine, Fluids and Filters',
    items: [
      { id: 'engine_oil',       label: 'Engine oil level within range and no visible leaks' },
      { id: 'coolant_level',    label: 'Coolant level adequate and radiator core clear of debris' },
      { id: 'fuel_water_sep',   label: 'Fuel level adequate and water separator drained' },
      { id: 'air_filter',       label: 'Air filter restriction indicator within range and housing sealed' },
      { id: 'belts_hoses',      label: 'Belts and coolant hoses free of cracks, fraying or looseness' },
      { id: 'battery_secure',   label: 'Battery secured, terminals clean and cables tight', safetyCritical: true },
      { id: 'engine_bay_clear', label: 'Engine compartment and screens free of chaff, debris and combustible material', safetyCritical: true },
    ],
  },
  {
    id: 'signoff', num: 8, label: 'Operator Sign-Off Readiness',
    items: [
      { id: 'overall_determination', label: 'Overall pass/fail determination made', safetyCritical: true },
      { id: 'deficiencies_noted',    label: 'All deficiencies described in notes' },
      { id: 'removal_assessed',      label: 'Removal from service assessed for any critical deficiency', safetyCritical: true },
      { id: 'lift_path_planned',     label: 'Overhead clearances and travel path assessed for the work area', safetyCritical: true },
      { id: 'operator_identified',   label: 'Operator identified and signature captured' },
      { id: 'datetime_recorded',     label: 'Date, time and hour meter recorded' },
    ],
  },
]
