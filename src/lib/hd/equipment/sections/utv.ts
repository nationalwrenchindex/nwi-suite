// The 10 sections of the UTV / utility vehicle pre-use daily checklist.
//
// No standard mandates a UTV inspection by name, so this form is written to the
// OSHA general duty clause with ANSI/OPEI B71.9 (multipurpose off-highway
// utility vehicles) supplying the machine-specific content: ROPS, occupant
// retention, load rating and towing.
//
// safetyCritical marks the items that put a machine out of service on failure:
// brakes, steering, ROPS, occupant restraints, frame and wheels. A dirty bed or
// a dead cargo lamp is a deficiency; a cracked ROPS weld or a seat belt that
// will not latch is a machine nobody may operate.

import type { EquipmentSection } from '@/types/equipment'

export const UTV_SECTIONS: EquipmentSection[] = [
  {
    id: 'documentation', num: 1, label: 'Pre-Inspection Documentation',
    items: [
      { id: 'operator_manual',    label: 'Operator manual present on the machine' },
      { id: 'capacity_decals',    label: 'Occupant, cargo and towing capacity decals present and legible' },
      { id: 'previous_reviewed',  label: 'Previous pre-use inspection reviewed' },
      { id: 'open_defects_clear', label: 'No open defect from the last shift left uncorrected', safetyCritical: true },
      { id: 'hour_meter',         label: 'Hour meter reading recorded' },
    ],
  },
  {
    id: 'frame_body', num: 2, label: 'Frame and Body',
    items: [
      { id: 'no_frame_cracks',    label: 'No cracks or bends in frame, A-arms or suspension mounts', safetyCritical: true },
      { id: 'fasteners_tight',    label: 'Frame and skid plate fasteners present and tight', safetyCritical: true },
      { id: 'no_corrosion',       label: 'No corrosion affecting structural members', safetyCritical: true },
      { id: 'body_panels',        label: 'Body panels and fenders secure, no sharp edges' },
      { id: 'no_debris_buildup',  label: 'No debris packed against exhaust, driveline or radiator' },
    ],
  },
  {
    id: 'tires_wheels', num: 3, label: 'Tires and Wheels',
    items: [
      { id: 'tire_pressure',      label: 'Tire pressure at placard specification on all four wheels', safetyCritical: true },
      { id: 'tread_depth',        label: 'Tread depth adequate, lug pattern not worn smooth' },
      { id: 'no_sidewall_damage', label: 'No cuts, plugs, bulges or exposed cord in sidewalls', safetyCritical: true },
      { id: 'lug_nuts_torqued',   label: 'Lug nuts present and torqued to specification', safetyCritical: true },
      { id: 'wheels_undamaged',   label: 'Wheels and rims free of cracks, bends and elongated bolt holes', safetyCritical: true },
      { id: 'hub_bearing_play',   label: 'No wheel bearing play or noise when rocked', safetyCritical: true },
    ],
  },
  {
    id: 'steering', num: 4, label: 'Steering',
    items: [
      { id: 'free_play_limit',    label: 'Steering wheel free play within manufacturer limit', safetyCritical: true },
      { id: 'tie_rod_ends',       label: 'Tie rod ends tight, no play at ball joints', safetyCritical: true },
      { id: 'rack_secure',        label: 'Steering rack or gearbox securely mounted, boots intact', safetyCritical: true },
      { id: 'cotter_pins',        label: 'Castle nuts and cotter pins present at steering joints', safetyCritical: true },
      { id: 'eps_operation',      label: 'Power steering operates without binding or warning light' },
      { id: 'tracks_straight',    label: 'Vehicle tracks straight with no pull on a level surface' },
    ],
  },
  {
    id: 'brakes', num: 5, label: 'Brakes',
    items: [
      { id: 'pedal_travel',       label: 'Brake pedal travel firm and within limit, no sink under hold', safetyCritical: true },
      { id: 'stops_straight',     label: 'Vehicle stops straight from low speed without pulling', safetyCritical: true },
      { id: 'pad_thickness',      label: 'Brake pad and rotor thickness above wear limit', safetyCritical: true },
      { id: 'no_fluid_leaks',     label: 'No brake fluid leaks at lines, hoses or calipers', safetyCritical: true },
      { id: 'fluid_level',        label: 'Brake fluid level at or above the minimum mark', safetyCritical: true },
      { id: 'park_brake_holds',   label: 'Parking brake holds the vehicle on a grade', safetyCritical: true },
    ],
  },
  {
    id: 'lights_horn', num: 6, label: 'Lights and Horn',
    items: [
      { id: 'headlights',         label: 'Headlights functional on both high and low beam' },
      { id: 'tail_lights',        label: 'Tail lights functional' },
      { id: 'brake_lights',       label: 'Brake lights illuminate on pedal application' },
      { id: 'turn_hazard',        label: 'Turn signals and hazard flashers functional if equipped' },
      { id: 'beacon_reverse',     label: 'Beacon and reverse alarm functional if required on site' },
      { id: 'horn',               label: 'Horn functional' },
      { id: 'lenses_clean',       label: 'Lenses and reflectors clean, unbroken and unobstructed' },
    ],
  },
  {
    id: 'rops_restraints', num: 7, label: 'ROPS and Seat Belts',
    items: [
      { id: 'rops_undamaged',     label: 'ROPS cage free of cracks, bends and weld damage', safetyCritical: true },
      { id: 'rops_fasteners',     label: 'ROPS mounting bolts present and torqued', safetyCritical: true },
      { id: 'no_unauth_mods',     label: 'No drilling, cutting or unauthorized modification to ROPS', safetyCritical: true },
      { id: 'belts_latch',        label: 'Seat belts latch, release and retract at every seat', safetyCritical: true },
      { id: 'belt_webbing',       label: 'Belt webbing and anchors free of fraying, cuts and corrosion', safetyCritical: true },
      { id: 'nets_doors',         label: 'Occupant nets or doors present, secured and latching', safetyCritical: true },
      { id: 'seats_secure',       label: 'Seats securely mounted and latched to the frame', safetyCritical: true },
    ],
  },
  {
    id: 'bed_hitch', num: 8, label: 'Cargo Bed and Hitch',
    items: [
      { id: 'bed_latch',          label: 'Cargo bed latch engages and holds the bed down' },
      { id: 'dump_pivot',         label: 'Dump pivot, prop and release linkage operate freely' },
      { id: 'load_decal',         label: 'Bed load rating decal present and legible' },
      { id: 'bed_clear',          label: 'Bed clear of loose tools and unsecured load' },
      { id: 'hitch_secure',       label: 'Hitch receiver and mounting hardware tight and uncracked', safetyCritical: true },
      { id: 'hitch_pin_clip',     label: 'Hitch pin and safety clip present and installed', safetyCritical: true },
      { id: 'trailer_wiring',     label: 'Trailer wiring connector intact and functional if towing' },
    ],
  },
  {
    id: 'engine_fluids', num: 9, label: 'Engine, Fluids and Filters',
    items: [
      { id: 'engine_oil',         label: 'Engine oil level between the marks, no visible leaks' },
      { id: 'coolant_level',      label: 'Coolant level adequate, radiator and screen clear of debris' },
      { id: 'fuel_level',         label: 'Fuel level adequate for the shift, no fuel leaks or odor', safetyCritical: true },
      { id: 'air_filter',         label: 'Air filter clean and seated, housing latched' },
      { id: 'drive_belt',         label: 'CVT drive belt free of cracks, glazing and fraying' },
      { id: 'spark_arrestor',     label: 'Spark arrestor and exhaust intact and secured', safetyCritical: true },
      { id: 'battery_secure',     label: 'Battery secured, terminals clean and tight' },
    ],
  },
  {
    id: 'signoff', num: 10, label: 'Operator Sign-Off Readiness',
    items: [
      { id: 'operator_trained',   label: 'Operator trained and authorized for this vehicle', safetyCritical: true },
      { id: 'ppe_available',      label: 'Required PPE worn and available for all occupants' },
      { id: 'deficiencies_noted', label: 'All deficiencies described in notes' },
      { id: 'removal_assessed',   label: 'Removal from service assessed for any critical deficiency', safetyCritical: true },
      { id: 'operator_signature', label: 'Operator identified and signature captured' },
      { id: 'datetime_recorded',  label: 'Date and time of inspection recorded' },
    ],
  },
]
