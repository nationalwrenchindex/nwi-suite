// The 9 sections of the forklift (powered industrial truck) pre-use checklist.
//
// OSHA 29 CFR 1910.178(q)(7) requires the truck be examined before each shift —
// not daily, not weekly — and any condition affecting safe operation puts it out
// of service until repaired. That cadence is why this form is short and run by
// the operator rather than a technician.
//
// safetyCritical marks the items that park the truck on failure: load-rating,
// fork, chain, mast, operator-protection and fuel-system defects. A scuffed
// decal or a low washer bottle is a deficiency; a stretched lift chain or a
// missing data plate is a truck nobody may operate.

import type { EquipmentSection } from '@/types/equipment'

export const FORKLIFT_SECTIONS: EquipmentSection[] = [
  {
    id: 'documentation', num: 1, label: 'Pre-Inspection Documentation',
    items: [
      { id: 'prior_shift_report',      label: 'Previous shift inspection report reviewed' },
      { id: 'prior_defects_corrected', label: 'Defects reported on the prior shift corrected or documented', safetyCritical: true },
      { id: 'not_tagged_out',          label: 'Truck not tagged or locked out of service', safetyCritical: true },
      { id: 'operator_manual',         label: 'Operator manual present on the truck and legible' },
      { id: 'operator_authorized',     label: 'Operator trained and authorized for this truck class', safetyCritical: true },
      { id: 'maintenance_current',     label: 'Scheduled hour-meter service current' },
    ],
  },
  {
    id: 'nameplate_capacity', num: 2, label: 'Nameplate and Capacity',
    items: [
      { id: 'data_plate_present',        label: 'Data plate present, legible and securely attached', safetyCritical: true },
      { id: 'plate_matches_attachments', label: 'Data plate reflects every attachment installed on the truck', safetyCritical: true },
      { id: 'attachment_derate',         label: 'Derated capacity for the installed attachment known to the operator', safetyCritical: true },
      { id: 'load_center_rating',        label: 'Rated capacity adequate at the load center and lift height in use', safetyCritical: true },
      { id: 'warning_decals',            label: 'Warning and instruction decals present and legible' },
      { id: 'serial_match',              label: 'Serial number on the plate matches the unit record' },
    ],
  },
  {
    id: 'forks_carriage', num: 3, label: 'Forks and Carriage',
    items: [
      { id: 'forks_no_cracks',    label: 'Forks free of cracks at the heel, welds and mounting', safetyCritical: true },
      { id: 'fork_heel_wear',     label: 'Fork heel thickness within 10% of original', safetyCritical: true },
      { id: 'fork_tip_alignment', label: 'Fork tips aligned within 3% of blade length', safetyCritical: true },
      { id: 'fork_locking_pins',  label: 'Fork positioning locks and retaining pins engaged', safetyCritical: true },
      { id: 'carriage_stops',     label: 'Carriage stops and retaining bar present and secure', safetyCritical: true },
      { id: 'load_backrest',      label: 'Load backrest extension present and undamaged' },
      { id: 'overhead_guard',     label: 'Overhead guard free of cracks, bends or missing hardware', safetyCritical: true },
    ],
  },
  {
    id: 'mast_chains', num: 4, label: 'Mast, Chains and Cylinders',
    items: [
      { id: 'chains_no_damage',    label: 'Lift chains free of cracked, worn, rusted or seized links', safetyCritical: true },
      { id: 'chain_tension_even',  label: 'Lift chains evenly tensioned with no slack side', safetyCritical: true },
      { id: 'chain_stretch',       label: 'Lift chain stretch within 3% of original pitch', safetyCritical: true },
      { id: 'chain_anchors',       label: 'Chain anchor pins and sheaves secure and turning freely', safetyCritical: true },
      { id: 'mast_rollers',        label: 'Mast rollers and channels free of excessive wear or binding' },
      { id: 'mast_welds',          label: 'Mast rails, welds and crossmembers free of cracks or distortion', safetyCritical: true },
      { id: 'lift_tilt_cylinders', label: 'Lift and tilt cylinders free of leaks, scoring or bent rods', safetyCritical: true },
    ],
  },
  {
    id: 'hydraulic', num: 5, label: 'Hydraulic Systems',
    items: [
      { id: 'hyd_fluid_level',      label: 'Hydraulic fluid level adequate' },
      { id: 'hyd_no_leaks',         label: 'No hydraulic leaks at hoses, fittings or cylinders', safetyCritical: true },
      { id: 'hoses_condition',      label: 'Hydraulic hoses free of chafing, kinks or bulging' },
      { id: 'functions_smooth',     label: 'Lift, lower, tilt and sideshift operate smoothly through full travel', safetyCritical: true },
      { id: 'no_mast_drift',        label: 'Mast holds a raised load without drift when controls are released', safetyCritical: true },
      { id: 'attachment_couplers',  label: 'Attachment couplers seated, secure and free of leaks' },
    ],
  },
  {
    id: 'tires_wheels', num: 6, label: 'Tires and Wheels',
    items: [
      { id: 'tire_condition',    label: 'Tires free of cuts, chunking or exposed cord', safetyCritical: true },
      { id: 'tire_pressure',     label: 'Pneumatic tires inflated to specification' },
      { id: 'cushion_tire_wear', label: 'Cushion tires within the wear line and bonded to the rim', safetyCritical: true },
      { id: 'wheel_lugs',        label: 'Wheel lug nuts present and tight', safetyCritical: true },
      { id: 'rims_intact',       label: 'Rims and split-ring components intact and undamaged', safetyCritical: true },
      { id: 'no_debris_wrapped', label: 'No wire, banding or debris wrapped around axles or wheels' },
      { id: 'steering_play',     label: 'Steer axle, tie rods and steering play within specification', safetyCritical: true },
    ],
  },
  {
    id: 'controls_alarms', num: 7, label: 'Controls, Lights, Horn and Backup Alarm',
    items: [
      { id: 'horn',               label: 'Horn audible above ambient noise' },
      { id: 'backup_alarm',       label: 'Backup alarm sounds when reverse is selected' },
      { id: 'lights',             label: 'Head, tail, brake and warning lights functional' },
      { id: 'service_brake',      label: 'Service brake stops the truck without pull or fade', safetyCritical: true },
      { id: 'parking_brake',      label: 'Parking brake holds the truck on a grade', safetyCritical: true },
      { id: 'seat_belt',          label: 'Seat belt latches, retracts and is free of fraying or cuts', safetyCritical: true },
      { id: 'operator_presence',  label: 'Operator presence system disables lift and travel when the seat is vacated', safetyCritical: true },
    ],
  },
  {
    id: 'fuel_battery', num: 8, label: 'Fuel or Battery System',
    items: [
      { id: 'lp_tank_mounting',    label: 'LP tank seated in its bracket with the locating pin engaged', safetyCritical: true },
      { id: 'lp_hose_condition',   label: 'LP hose and fittings free of cracks, abrasion or kinks', safetyCritical: true },
      { id: 'lp_leak_check',       label: 'No LP odor or leak at the coupler, valve or regulator', safetyCritical: true },
      { id: 'fuel_system_secure',  label: 'Fuel tank, lines and cap secure with no leaks', safetyCritical: true },
      { id: 'battery_secure',      label: 'Battery secured in its compartment with hold-down in place', safetyCritical: true },
      { id: 'battery_electrolyte', label: 'Battery electrolyte at proper level, terminals clean and tight' },
      { id: 'battery_connector',   label: 'Battery connector and cables free of burns, cracks or exposed conductor', safetyCritical: true },
    ],
  },
  {
    id: 'signoff', num: 9, label: 'Operator Sign-Off Readiness',
    items: [
      { id: 'overall_determination', label: 'Overall pass/fail determination made', safetyCritical: true },
      { id: 'deficiencies_noted',    label: 'All deficiencies described in notes' },
      { id: 'removal_assessed',      label: 'Removal from service assessed for any critical deficiency', safetyCritical: true },
      { id: 'truck_tagged',          label: 'Truck tagged and key removed if a critical defect was found', safetyCritical: true },
      { id: 'operator_signature',    label: 'Operator identified and signature captured' },
      { id: 'datetime_recorded',     label: 'Date, time and hour meter recorded' },
    ],
  },
]
