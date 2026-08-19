// The 9 sections of the telehandler / rough terrain forklift pre-use daily check.
//
// OSHA 29 CFR 1910.178(q)(7) requires the examination before each shift; the
// rough terrain specifics — frame level, outrigger pads, longitudinal stability
// — come from ANSI/ITSDF B56.6, which is the standard a telehandler is actually
// built to even though OSHA cites the general powered industrial truck rule.
//
// safetyCritical marks the items that put a machine out of service on failure:
// fork and boom structural defects, a missing retaining pin or load chart, a
// dead stability indicator, damaged ROPS/FOPS, and brake or control failures. A
// dirty air filter or a scuffed decal is a deficiency; a cracked fork heel is a
// machine nobody may operate.

import type { EquipmentSection } from '@/types/equipment'

export const TELEHANDLER_SECTIONS: EquipmentSection[] = [
  {
    id: 'documentation', num: 1, label: 'Pre-Inspection Documentation',
    items: [
      { id: 'previous_reviewed',   label: 'Previous shift inspection report reviewed' },
      { id: 'manual_present',      label: 'Operator manual present in weather-resistant storage' },
      { id: 'load_charts_legible', label: 'Load chart present and legible for every attachment carried', safetyCritical: true },
      { id: 'chart_matches_attach', label: 'Load chart matches the attachment currently fitted', safetyCritical: true },
      { id: 'decals_legible',      label: 'Safety decals and capacity placards present and legible' },
      { id: 'hour_meter_recorded', label: 'Hour meter reading recorded' },
    ],
  },
  {
    id: 'forks_carriage', num: 2, label: 'Forks, Carriage and Tilt',
    items: [
      { id: 'no_fork_cracks',      label: 'No cracks in fork blades, heels, eyes or welds', safetyCritical: true },
      { id: 'heel_wear',           label: 'Fork heel thickness within 10% of original', safetyCritical: true },
      { id: 'retaining_pins',      label: 'Fork retaining pins and locks present and engaged', safetyCritical: true },
      { id: 'fork_alignment',      label: 'Fork tips aligned, no blade bend beyond 3% of length', safetyCritical: true },
      { id: 'carriage_intact',     label: 'Carriage plate, hooks and stops undamaged', safetyCritical: true },
      { id: 'quick_attach_locked', label: 'Quick-attach coupler fully seated, locked and pinned', safetyCritical: true },
      { id: 'tilt_no_drift',       label: 'Tilt cylinder holds position without drift' },
    ],
  },
  {
    id: 'boom', num: 3, label: 'Mast, Boom and Extension',
    items: [
      { id: 'no_boom_cracks',      label: 'No cracks, dents or deformation in boom sections', safetyCritical: true },
      { id: 'lift_no_drift',       label: 'Lift cylinder holds load without drift', safetyCritical: true },
      { id: 'extension_chains',    label: 'Extension chains or cables correctly tensioned and undamaged', safetyCritical: true },
      { id: 'wear_pads',           label: 'Boom extension wear pads within wear limits' },
      { id: 'travel_smooth',       label: 'Boom extends, retracts and lowers smoothly through full travel' },
      { id: 'boom_hoses',          label: 'Boom hoses and cable track secure, no chafing or leaks' },
      { id: 'angle_indicator',     label: 'Boom angle and extension indicator readable' },
    ],
  },
  {
    id: 'outriggers', num: 4, label: 'Outriggers and Stabilizers',
    items: [
      { id: 'outriggers_deploy',   label: 'Outriggers deploy and lock at full extension', safetyCritical: true },
      { id: 'outrigger_pads',      label: 'Outrigger pads present, correctly sized and undamaged', safetyCritical: true },
      { id: 'outriggers_no_drift', label: 'Outriggers hold position under load without drift', safetyCritical: true },
      { id: 'frame_level_cylinder', label: 'Frame level (sway) cylinder operates through full range and holds', safetyCritical: true },
      { id: 'level_indicator',     label: 'Frame level indicator readable and reads true on level ground', safetyCritical: true },
      { id: 'stow_interlock',      label: 'Outriggers stow fully and travel interlock functions' },
    ],
  },
  {
    id: 'tires_wheels', num: 5, label: 'Tires and Wheels',
    items: [
      { id: 'tire_pressure',       label: 'Tire pressure at specification (or foam fill intact)' },
      { id: 'tread_condition',     label: 'Tread depth adequate, no cuts exposing cord', safetyCritical: true },
      { id: 'no_sidewall_damage',  label: 'No sidewall bulges, splits or ply separation', safetyCritical: true },
      { id: 'rims_lock_rings',     label: 'Rims and lock rings intact and correctly seated', safetyCritical: true },
      { id: 'lugs_tight',          label: 'Wheel lug nuts present and torqued', safetyCritical: true },
      { id: 'no_debris',           label: 'No debris wedged in tread or between duals' },
    ],
  },
  {
    id: 'controls', num: 6, label: 'Controls and Safety Devices',
    items: [
      { id: 'stability_indicator', label: 'Longitudinal stability indicator functional and reading in range', safetyCritical: true },
      { id: 'overload_cutout',     label: 'Load moment overload cutout stops aggravating functions', safetyCritical: true },
      { id: 'service_brakes',      label: 'Service brakes functional', safetyCritical: true },
      { id: 'parking_brake',       label: 'Parking brake holds machine on grade', safetyCritical: true },
      { id: 'steering_modes',      label: 'Steering functional in every selectable mode', safetyCritical: true },
      { id: 'joystick_return',     label: 'Joystick and function controls return to neutral when released', safetyCritical: true },
      { id: 'horn_backup_alarm',   label: 'Horn and travel alarm functional' },
    ],
  },
  {
    id: 'rops_fops', num: 7, label: 'ROPS/FOPS',
    items: [
      { id: 'rops_undamaged',      label: 'ROPS structure free of cracks, bends and structural corrosion', safetyCritical: true },
      { id: 'fops_guard',          label: 'FOPS overhead guard undamaged and securely mounted', safetyCritical: true },
      { id: 'rops_fasteners',      label: 'ROPS/FOPS mounting fasteners present and torqued', safetyCritical: true },
      { id: 'no_modifications',    label: 'No drilling, welding or unauthorized modification of ROPS/FOPS', safetyCritical: true },
      { id: 'seat_belt',           label: 'Seat belt undamaged, latches and retracts', safetyCritical: true },
      { id: 'presence_interlock',  label: 'Operator presence interlock disables functions when seat unoccupied', safetyCritical: true },
      { id: 'glass_mirrors',       label: 'Cab glass, mirrors and wipers intact and clear' },
    ],
  },
  {
    id: 'engine_fluids', num: 8, label: 'Engine, Fluids and Filters',
    items: [
      { id: 'engine_oil',          label: 'Engine oil at operating level' },
      { id: 'coolant_level',       label: 'Coolant level adequate and radiator core clear' },
      { id: 'hydraulic_level',     label: 'Hydraulic reservoir level within sight gauge range' },
      { id: 'fuel_and_leaks',      label: 'Fuel level adequate, no fuel or oil leaks' },
      { id: 'air_filter',          label: 'Air filter restriction indicator in acceptable range' },
      { id: 'belts_hoses',         label: 'Belts and hoses undamaged and correctly tensioned' },
      { id: 'no_pooling',          label: 'No fluid pooling under machine at start of shift' },
    ],
  },
  {
    id: 'signoff', num: 9, label: 'Operator Sign-Off Readiness',
    items: [
      { id: 'operator_qualified',  label: 'Operator trained and evaluated on this machine class', safetyCritical: true },
      { id: 'overall_determination', label: 'Overall pass/fail determination made', safetyCritical: true },
      { id: 'removal_assessed',    label: 'Removal from service assessed for any critical deficiency', safetyCritical: true },
      { id: 'deficiencies_noted',  label: 'All deficiencies described in notes' },
      { id: 'operator_identified', label: 'Operator identified and signature captured' },
      { id: 'datetime_recorded',   label: 'Date, time and hour meter recorded' },
    ],
  },
]
