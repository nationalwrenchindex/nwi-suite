// The 9 sections of the dozer pre-use daily checklist.
//
// Operator-run before the first shift of the day (OSHA 29 CFR 1926 Subpart W,
// 1926.601/1926.602 — earthmoving equipment inspected prior to each use).
//
// safetyCritical marks the items that put a machine out of service on failure:
// ROPS damage or modification, structural cracks in the blade, push arms or
// frame, and any control, brake or steering failure. Undercarriage wear is a
// deficiency to schedule against; a cracked push arm is a dozer nobody may run.

import type { EquipmentSection } from '@/types/equipment'

export const DOZER_SECTIONS: EquipmentSection[] = [
  {
    id: 'documentation', num: 1, label: 'Pre-Inspection Documentation',
    items: [
      { id: 'manual_present',      label: 'Operator manual present in cab storage' },
      { id: 'previous_reviewed',   label: 'Previous shift report reviewed and open defects known' },
      { id: 'hour_meter_recorded', label: 'Hour meter reading recorded' },
      { id: 'service_current',     label: 'Scheduled service interval not overdue' },
      { id: 'decals_legible',      label: 'Safety decals and warning placards present and legible' },
    ],
  },
  {
    id: 'blade', num: 2, label: 'Blade, Push Arms and Tilt Cylinders',
    items: [
      { id: 'moldboard_sound',     label: 'Moldboard free of cracks, tears and deformation', safetyCritical: true },
      { id: 'push_arms_sound',     label: 'Push arms free of cracks, bends and weld separation', safetyCritical: true },
      { id: 'trunnion_ball_joint', label: 'Blade trunnion and ball joint secure, no excessive play', safetyCritical: true },
      { id: 'cutting_edge_wear',   label: 'Cutting edge within wear limit, bolts tight' },
      { id: 'end_bits',            label: 'End bits present, within wear limit and secured' },
      { id: 'tilt_cylinders',      label: 'Tilt and angle cylinders free of scoring, drift and leakage' },
      { id: 'ripper_condition',    label: 'Ripper shanks, tips and frame sound and pinned (if equipped)' },
    ],
  },
  {
    id: 'tracks', num: 3, label: 'Tracks, Rollers, Sprockets and Idlers',
    items: [
      { id: 'track_sag',           label: 'Track sag measured and within specification' },
      { id: 'shoes_grousers',      label: 'Track shoes and grousers intact, bolts tight' },
      { id: 'master_link',         label: 'Master link and pins secure, no cracks or backed-out pins', safetyCritical: true },
      { id: 'sprocket_wear',       label: 'Sprocket teeth within wear limit, no hooking or broken teeth' },
      { id: 'idler_condition',     label: 'Front idlers aligned, no flange damage or seal leakage' },
      { id: 'roller_leakage',      label: 'Carrier and track rollers turning freely, no oil leakage' },
    ],
  },
  {
    id: 'undercarriage', num: 4, label: 'Undercarriage',
    items: [
      { id: 'track_frame',         label: 'Track frame and equalizer bar free of cracks and damage', safetyCritical: true },
      { id: 'final_drive_seepage', label: 'Final drives free of oil seepage, levels correct' },
      { id: 'recoil_spring',       label: 'Recoil spring and track adjuster holding grease, no leakage' },
      { id: 'guards_secure',       label: 'Undercarriage guards, rock guards and belly pan secure' },
      { id: 'debris_cleared',      label: 'Undercarriage cleared of packed mud, rock and debris' },
    ],
  },
  {
    id: 'rops', num: 5, label: 'ROPS',
    items: [
      { id: 'rops_undamaged',      label: 'ROPS structure free of cracks, bends and corrosion damage', safetyCritical: true },
      { id: 'rops_unmodified',     label: 'ROPS not drilled, welded or otherwise modified', safetyCritical: true },
      { id: 'rops_mounting',       label: 'ROPS mounting bolts present, correct grade and torqued', safetyCritical: true },
      { id: 'seat_belt',           label: 'Seat belt present, undamaged and latching', safetyCritical: true },
      { id: 'rops_label',          label: 'ROPS certification label present and legible' },
      { id: 'falling_object_guard', label: 'FOPS canopy and screens intact (if equipped)', safetyCritical: true },
    ],
  },
  {
    id: 'hydraulic', num: 6, label: 'Hydraulic Systems',
    items: [
      { id: 'hyd_fluid_level',     label: 'Hydraulic reservoir level within range' },
      { id: 'no_hyd_leaks',        label: 'No hydraulic leaks at hoses, fittings or cylinders' },
      { id: 'hose_condition',      label: 'Hoses free of chafing, bulging and exposed reinforcement' },
      { id: 'cylinder_rods',       label: 'Cylinder rods free of scoring, pitting and bending' },
      { id: 'blade_holds',         label: 'Blade holds position without drift when raised' },
      { id: 'pins_bushings',       label: 'Pins, bushings and retainers secure and greased' },
    ],
  },
  {
    id: 'controls', num: 7, label: 'Controls and Safety Devices',
    items: [
      { id: 'blade_controls',      label: 'Blade lift, tilt and angle controls functional and self-centering', safetyCritical: true },
      { id: 'steering_control',    label: 'Steering responds in both directions without lag', safetyCritical: true },
      { id: 'service_brakes',      label: 'Service brakes hold and stop the machine', safetyCritical: true },
      { id: 'parking_brake',       label: 'Parking brake holds machine on grade', safetyCritical: true },
      { id: 'safety_lockout',      label: 'Hydraulic lockout and neutral start interlock functional', safetyCritical: true },
      { id: 'backup_alarm',        label: 'Backup alarm audible above ambient noise' },
      { id: 'horn_lights',         label: 'Horn, work lights and mirrors functional' },
    ],
  },
  {
    id: 'engine', num: 8, label: 'Engine, Fluids and Filters',
    items: [
      { id: 'engine_oil',          label: 'Engine oil level within range, no visible leaks' },
      { id: 'coolant_level',       label: 'Coolant level correct, radiator and cooler cores clear' },
      { id: 'fuel_water_sep',      label: 'Fuel level adequate, water separator drained' },
      { id: 'air_filter',          label: 'Air filter restriction indicator within range, housing sealed' },
      { id: 'belts_hoses',         label: 'Belts and coolant hoses free of cracking, fraying and looseness' },
      { id: 'battery_secure',      label: 'Battery secure, terminals clean and cables intact' },
      { id: 'exhaust_intact',      label: 'Exhaust system intact, no leaks into operator area', safetyCritical: true },
    ],
  },
  {
    id: 'signoff', num: 9, label: 'Operator Sign-Off Readiness',
    items: [
      { id: 'overall_determination', label: 'Overall pass/fail determination made', safetyCritical: true },
      { id: 'deficiencies_noted',    label: 'All deficiencies described in notes' },
      { id: 'removal_assessed',      label: 'Removal from service assessed for any critical deficiency', safetyCritical: true },
      { id: 'operator_identified',   label: 'Operator identified and signature captured' },
      { id: 'datetime_recorded',     label: 'Date, time and hour meter of inspection recorded' },
    ],
  },
]
