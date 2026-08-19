// The 10 sections of the backhoe loader pre-use daily checklist.
//
// Run by the operator before the first cycle of the shift (OSHA 29 CFR 1926
// Subpart W, 1926.600 and 1926.602). 60 points covering both working ends —
// the front loader, the rear backhoe and swing tower — plus the stabilizers
// that hold the machine down while the hoe digs.
//
// safetyCritical marks the items that put a machine out of service on failure:
// a boom transport lock that will not hold, a stabilizer lock valve that lets
// the machine settle under load, ROPS damage, structural cracks, and control,
// brake or steering failures. A worn cutting edge, a missing tooth or a low
// washer bottle is a deficiency to be written up; a drifting stabilizer or an
// unlatched boom lock is a machine nobody may operate.

import type { EquipmentSection } from '@/types/equipment'

export const BACKHOE_SECTIONS: EquipmentSection[] = [
  {
    id: 'documentation', num: 1, label: 'Pre-Inspection Documentation',
    items: [
      { id: 'manual_present',      label: 'Operator manual present in weather-resistant storage' },
      { id: 'capacity_legible',    label: 'Lift capacity chart present and legible for the installed hoe and loader' },
      { id: 'previous_reviewed',   label: 'Previous shift report reviewed and open defects known' },
      { id: 'hour_meter_recorded', label: 'Hour meter reading recorded' },
      { id: 'service_current',     label: 'Scheduled service interval not overdue' },
    ],
  },
  {
    id: 'loader', num: 2, label: 'Front Loader — Bucket and Arms',
    items: [
      { id: 'no_arm_cracks',      label: 'No cracks in loader arm welds, cross-tube or tower mounts', safetyCritical: true },
      { id: 'no_bent_arms',       label: 'No bent, twisted or gouged loader arms or bucket linkage', safetyCritical: true },
      { id: 'arm_pins_retained',  label: 'Loader arm and linkage pins secure, retained and free of excessive play', safetyCritical: true },
      { id: 'cutting_edge',       label: 'Bucket cutting edge and bolt-on edge secure and within wear limits' },
      { id: 'bucket_teeth',       label: 'Bucket teeth and adapters present and retained' },
      { id: 'arm_support_strut',  label: 'Loader arm service support strut present and stowed' },
    ],
  },
  {
    id: 'backhoe', num: 3, label: 'Rear Backhoe — Boom, Stick and Bucket',
    items: [
      { id: 'boom_transport_lock', label: 'Boom transport lock engages and holds the boom in the stowed position', safetyCritical: true },
      { id: 'no_boom_cracks',      label: 'No cracks in boom, dipper stick or swing tower welds', safetyCritical: true },
      { id: 'swing_tower_play',    label: 'Swing tower and king post free of excessive play or elongated bores', safetyCritical: true },
      { id: 'boom_pins_retained',  label: 'Boom, stick and linkage pins secure with retainers installed', safetyCritical: true },
      { id: 'hoe_bucket_teeth',    label: 'Hoe bucket teeth and shanks present and retained' },
      { id: 'thumb_coupler',       label: 'Thumb or quick coupler engages positive lock with safety pin installed', safetyCritical: true },
      { id: 'swing_lock_pin',      label: 'Swing lock pin engages and secures the boom for travel', safetyCritical: true },
    ],
  },
  {
    id: 'stabilizers', num: 4, label: 'Stabilizers and Outriggers',
    items: [
      { id: 'stab_deploy',         label: 'Stabilizers deploy and retract fully without binding', safetyCritical: true },
      { id: 'stab_lock_valves',    label: 'Stabilizer lock valves hold under load with no settling', safetyCritical: true },
      { id: 'stab_no_drift',       label: 'Stabilizers hold position with no uncommanded drift when parked', safetyCritical: true },
      { id: 'stab_pads_flipover',  label: 'Stabilizer pads and flip-over street shoes intact and pinned' },
      { id: 'stab_no_cracks',      label: 'No cracks in stabilizer legs, boxes or frame mounts', safetyCritical: true },
      { id: 'stab_transport_lock', label: 'Stabilizer transport locks engage for road travel', safetyCritical: true },
    ],
  },
  {
    id: 'hydraulic', num: 5, label: 'Hydraulic Systems',
    items: [
      { id: 'no_hyd_leaks',       label: 'No hydraulic leaks at hoses, fittings or cylinders', safetyCritical: true },
      { id: 'cylinder_rods',      label: 'Loader, boom, stick and bucket cylinder rods free of scoring, pitting or bending', safetyCritical: true },
      { id: 'no_cylinder_drift',  label: 'Raised loader and boom hold position without drift', safetyCritical: true },
      { id: 'hose_routing',       label: 'Hoses routed clear of pinch points with no chafing or bulging', safetyCritical: true },
      { id: 'hyd_fluid_level',    label: 'Hydraulic reservoir level within sight-glass range' },
      { id: 'aux_couplers',       label: 'Auxiliary and hammer circuit couplers clean, capped and free of leaks' },
    ],
  },
  {
    id: 'tires', num: 6, label: 'Tires and Wheels',
    items: [
      { id: 'tire_condition',     label: 'Tires free of cuts, exposed cord or sidewall damage', safetyCritical: true },
      { id: 'tire_pressure',      label: 'Front and rear tire pressures within specification' },
      { id: 'tread_depth',        label: 'Tread depth adequate for the surface being worked' },
      { id: 'wheels_rims',        label: 'Wheels and rims intact with lug nuts present and tight', safetyCritical: true },
      { id: 'hub_seals',          label: 'Hub and axle seals free of leaks' },
    ],
  },
  {
    id: 'controls', num: 7, label: 'Controls and Safety Devices',
    items: [
      { id: 'loader_controls',     label: 'Loader control lever moves all functions correctly and returns to neutral', safetyCritical: true },
      { id: 'hoe_controls',        label: 'Backhoe controls move all functions correctly and return to neutral', safetyCritical: true },
      { id: 'seat_rotation_lock',  label: 'Backhoe seat rotates and locks in both operating positions', safetyCritical: true },
      { id: 'service_park_brakes', label: 'Service brakes stop the machine, pedals locked for travel, and parking brake holds on grade', safetyCritical: true },
      { id: 'steering_response',   label: 'Steering responds without excessive free play or wander', safetyCritical: true },
      { id: 'differential_lock',   label: 'Differential lock engages and releases correctly', safetyCritical: true },
      { id: 'alarm_horn_lights',   label: 'Backup alarm audible over ambient noise, horn and road lights functional', safetyCritical: true },
    ],
  },
  {
    id: 'rops', num: 8, label: 'ROPS',
    items: [
      { id: 'rops_undamaged',     label: 'ROPS structure free of cracks, bends or weld damage', safetyCritical: true },
      { id: 'rops_bolts',         label: 'ROPS mounting bolts present, correct grade and torqued', safetyCritical: true },
      { id: 'rops_no_field_mods', label: 'No drilling, welding or field modification of the ROPS', safetyCritical: true },
      { id: 'seat_belt',          label: 'Seat belt webbing, latch and retractor functional', safetyCritical: true },
      { id: 'rops_label',         label: 'ROPS certification label present and legible' },
    ],
  },
  {
    id: 'engine', num: 9, label: 'Engine, Fluids and Filters',
    items: [
      { id: 'engine_oil',         label: 'Engine oil level within range and no visible leaks' },
      { id: 'coolant_level',      label: 'Coolant level adequate and radiator core clear of debris' },
      { id: 'fuel_water_sep',     label: 'Fuel level adequate and water separator drained' },
      { id: 'air_filter',         label: 'Air filter restriction indicator within range and housing sealed' },
      { id: 'belts_hoses',        label: 'Belts and coolant hoses free of cracks, fraying or looseness' },
      { id: 'battery_secure',     label: 'Battery secured, terminals clean and cables tight', safetyCritical: true },
      { id: 'no_exhaust_leaks',   label: 'No exhaust leaks into the cab or engine compartment', safetyCritical: true },
    ],
  },
  {
    id: 'signoff', num: 10, label: 'Operator Sign-Off Readiness',
    items: [
      { id: 'overall_determination', label: 'Overall pass/fail determination made', safetyCritical: true },
      { id: 'deficiencies_noted',    label: 'All deficiencies described in notes' },
      { id: 'removal_assessed',      label: 'Removal from service assessed for any critical deficiency', safetyCritical: true },
      { id: 'swing_area_planned',    label: 'Hoe swing area, underground utilities and overhead clearances assessed', safetyCritical: true },
      { id: 'operator_identified',   label: 'Operator identified and signature captured' },
      { id: 'datetime_recorded',     label: 'Date, time and hour meter recorded' },
    ],
  },
]
