// Mobile crane inspection sections (ASME B30.5).
//
// B30.5 splits periodic inspection into two cadences. Frequent covers the
// daily-to-monthly interval and is the 8 sections below. Annual is every 12
// months by a qualified inspector, and is the frequent sections plus the three
// deeper sections that follow — so CRANE_ANNUAL_SECTIONS holds only what annual
// adds, and forms.ts spreads frequent then annual. Numbering continues at 9 for
// that reason.
//
// safetyCritical marks the items that put a crane out of service on failure:
// hook deformation, rope broken-wire criteria, anti-two-block, load moment
// indicator, missing load chart, structural cracks, brakes, pawls, outriggers.
// A weeping fitting or a faded decal is a deficiency; a birdcaged rope is a
// crane nobody may pick with.

import type { EquipmentSection } from '@/types/equipment'

export const CRANE_FREQUENT_SECTIONS: EquipmentSection[] = [
  {
    id: 'documentation', num: 1, label: 'Pre-Inspection Documentation',
    items: [
      { id: 'annual_current',     label: 'Annual inspection current (within 12 months)', safetyCritical: true },
      { id: 'load_chart_present', label: 'Load chart present and legible for the configuration rigged', safetyCritical: true },
      { id: 'manual_present',     label: 'Operator manual present in weather-resistant storage' },
      { id: 'rope_records',       label: 'Wire rope replacement and inspection records on file' },
      { id: 'previous_reviewed',  label: 'Previous inspection report reviewed and deficiencies closed' },
      { id: 'decals_legible',     label: 'Capacity, warning and hand-signal decals present and legible' },
    ],
  },
  {
    id: 'structural', num: 2, label: 'Structural and Boom',
    items: [
      { id: 'no_boom_cracks',     label: 'No cracks in boom lattice chords, lacings or telescopic sections', safetyCritical: true },
      { id: 'no_bent_members',    label: 'No bent, dented or buckled boom or jib members', safetyCritical: true },
      { id: 'turntable_bolts',    label: 'Turntable and swing bearing bolts present and torqued', safetyCritical: true },
      { id: 'boom_pins_secure',   label: 'Boom and jib connecting pins secure with retainers in place', safetyCritical: true },
      { id: 'wear_pads',          label: 'Telescopic boom wear pads within wear tolerance' },
      { id: 'no_corrosion',       label: 'No corrosion affecting structural members', safetyCritical: true },
    ],
  },
  {
    id: 'rope_rigging', num: 3, label: 'Wire Rope, Rigging and Hooks',
    items: [
      { id: 'broken_wires',       label: 'Broken wires within B30.5 criteria per lay', safetyCritical: true },
      { id: 'no_birdcaging',      label: 'No crushing, birdcaging, kinking or core protrusion', safetyCritical: true },
      { id: 'rope_diameter',      label: 'Rope diameter reduction within allowable limit', safetyCritical: true },
      { id: 'end_connections',    label: 'End connections, wedge sockets and clips correct and secure', safetyCritical: true },
      { id: 'hook_throat',        label: 'Hook throat opening and twist within limits', safetyCritical: true },
      { id: 'hook_latch',         label: 'Hook latch present and operating', safetyCritical: true },
      { id: 'rope_lubrication',   label: 'Wire rope lubrication adequate, no heavy surface corrosion' },
    ],
  },
  {
    id: 'sheaves_drums', num: 4, label: 'Sheaves, Drums and Bearings',
    items: [
      { id: 'sheave_grooves',     label: 'Sheave groove wear and profile within limits', safetyCritical: true },
      { id: 'sheave_rotation',    label: 'Sheaves rotate freely, bearings without play or noise' },
      { id: 'rope_guards',        label: 'Rope guards and keepers in place at every sheave', safetyCritical: true },
      { id: 'drum_anchor',        label: 'Drum rope anchor secure with required dead wraps remaining', safetyCritical: true },
      { id: 'drum_grooves',       label: 'Drum grooves and flanges undamaged, spooling even' },
      { id: 'boom_hoist_reeving', label: 'Reeving matches load chart for the configuration rigged', safetyCritical: true },
    ],
  },
  {
    id: 'brakes_pawls', num: 5, label: 'Brakes, Clutches and Pawls',
    items: [
      { id: 'load_hoist_brake',   label: 'Load hoist brake holds rated load without drift', safetyCritical: true },
      { id: 'boom_hoist_brake',   label: 'Boom hoist brake holds boom without drift', safetyCritical: true },
      { id: 'holding_pawl',       label: 'Boom hoist holding pawl engages and releases correctly', safetyCritical: true },
      { id: 'swing_brake',        label: 'Swing brake and swing lock functional', safetyCritical: true },
      { id: 'clutch_operation',   label: 'Clutches engage and release without slip or drag', safetyCritical: true },
      { id: 'brake_linings',      label: 'Brake linings and adjustment within service limits' },
    ],
  },
  {
    id: 'controls_devices', num: 6, label: 'Controls, Safety Devices and Load Charts',
    items: [
      { id: 'anti_two_block',     label: 'Anti-two-block device functional and tested', safetyCritical: true },
      { id: 'load_moment_ind',    label: 'Load moment indicator functional and reading correctly', safetyCritical: true },
      { id: 'boom_angle_ind',     label: 'Boom angle indicator functional and accurate', safetyCritical: true },
      { id: 'boom_length_ind',    label: 'Boom length and radius indicators functional', safetyCritical: true },
      { id: 'level_indicator',    label: 'Level indicator functional, crane level within tolerance', safetyCritical: true },
      { id: 'controls_return',    label: 'All operating controls functional and return to neutral', safetyCritical: true },
      { id: 'horn_alarms',        label: 'Horn, swing alarm and travel alarm functional' },
    ],
  },
  {
    id: 'outriggers', num: 7, label: 'Outriggers and Stabilizers',
    items: [
      { id: 'outriggers_extend',  label: 'Outriggers extend fully and lock at the charted position', safetyCritical: true },
      { id: 'no_drift',           label: 'Outrigger cylinders hold without drift under load', safetyCritical: true },
      { id: 'float_pads',         label: 'Outrigger float pads present, undamaged and pinned', safetyCritical: true },
      { id: 'cribbing_ground',    label: 'Cribbing adequate and supporting ground stable', safetyCritical: true },
      { id: 'beam_condition',     label: 'Outrigger beams and boxes free of cracks or deformation', safetyCritical: true },
      { id: 'tires_load_bearing', label: 'Tires off ground or on-tire chart used as configured', safetyCritical: true },
    ],
  },
  {
    id: 'engine_hydraulic', num: 8, label: 'Engine and Hydraulic Systems',
    items: [
      { id: 'no_hyd_leaks',       label: 'No hydraulic leaks at hoses, fittings or cylinders', safetyCritical: true },
      { id: 'hoses_condition',    label: 'Hoses free of abrasion, bulging or cracking', safetyCritical: true },
      { id: 'hyd_fluid_level',    label: 'Hydraulic fluid level and condition adequate' },
      { id: 'engine_fluids',      label: 'Engine oil, coolant and fuel levels adequate' },
      { id: 'air_system',         label: 'Air system builds and holds pressure, no audible leaks' },
      { id: 'counterweight',      label: 'Counterweight correct for configuration and secured', safetyCritical: true },
    ],
  },
]

/** Additional checks for the 12-month annual inspection (ASME B30.5). */
export const CRANE_ANNUAL_SECTIONS: EquipmentSection[] = [
  {
    id: 'annual_structural', num: 9, label: 'Annual — Structural Fastener and Weld Examination',
    items: [
      { id: 'weld_examination',   label: 'Critical structural welds examined by qualified inspector', safetyCritical: true },
      { id: 'boom_section_ndt',   label: 'Boom sections and jib examined for cracks, NDT where required', safetyCritical: true },
      { id: 'swing_bearing_tilt', label: 'Swing bearing tilt-tolerance measurement within specification', safetyCritical: true },
      { id: 'fastener_torque',    label: 'Turntable, boom foot and counterweight fasteners torque-verified', safetyCritical: true },
      { id: 'pins_bushings',      label: 'Load-bearing pins and bushings gauged for wear', safetyCritical: true },
      { id: 'chassis_frame',      label: 'Carrier frame, outrigger boxes and jacks examined for cracks', safetyCritical: true },
    ],
  },
  {
    id: 'annual_powertrain', num: 10, label: 'Annual — Power Plant, Drive Train and Electrical',
    items: [
      { id: 'hyd_pressure_spec',  label: 'Hydraulic system pressures verified against manufacturer specification', safetyCritical: true },
      { id: 'relief_valves',      label: 'Relief and holding valves tested and set to specification', safetyCritical: true },
      { id: 'hyd_fluid_analysis', label: 'Hydraulic fluid sampled and analyzed, filters replaced' },
      { id: 'drive_train',        label: 'Drive train, axles and steering examined for wear and leakage' },
      { id: 'electrical_wiring',  label: 'Electrical wiring, connectors and insulation integrity verified', safetyCritical: true },
      { id: 'braking_road',       label: 'Carrier service and parking brakes tested to specification', safetyCritical: true },
    ],
  },
  {
    id: 'annual_certification', num: 11, label: 'Annual — Load Test and Certification Documentation',
    items: [
      { id: 'load_test_rated',    label: 'Load test performed at rated capacity and documented', safetyCritical: true },
      { id: 'lmi_calibration',    label: 'Load moment indicator calibration verified and certificate on file', safetyCritical: true },
      { id: 'atb_function_test',  label: 'Anti-two-block function test performed and documented', safetyCritical: true },
      { id: 'chart_audit',        label: 'Load chart set audited against crane serial and configuration', safetyCritical: true },
      { id: 'rope_certification', label: 'Wire rope and rigging certifications current and on file' },
      { id: 'inspector_cert',     label: 'Qualified inspector identified, credential number recorded' },
      { id: 'record_retained',    label: 'Signed inspection record retained and dated' },
    ],
  },
]
