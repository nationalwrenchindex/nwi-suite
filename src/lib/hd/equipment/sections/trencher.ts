// The 9 sections of the trencher pre-use daily checklist.
//
// Scoped to the machine under OSHA 29 CFR 1926 Subpart W (trenching and
// excavating equipment). The excavation itself — sloping, shoring, access and
// the competent-person inspection — falls under Subpart P and is documented on
// the excavation permit, not here.
//
// safetyCritical marks the items that put a machine out of service on failure:
// a missing chain guard, a deadman that does not stop the chain, a cracked boom
// weldment, brakes that will not hold, teeth or links that can be thrown. Wear
// still inside the manufacturer limit is a planning note, not a red tag.

import type { EquipmentSection } from '@/types/equipment'

export const TRENCHER_SECTIONS: EquipmentSection[] = [
  {
    id: 'documentation', num: 1, label: 'Pre-Inspection Documentation',
    items: [
      { id: 'locate_ticket',     label: 'Utility locate ticket current and marks verified on the ground', safetyCritical: true },
      { id: 'subpart_p_plan',    label: 'Excavation protective system and spoil setback confirmed (Subpart P)', safetyCritical: true },
      { id: 'previous_reviewed', label: 'Previous inspection report reviewed and open defects closed' },
      { id: 'manual_present',    label: 'Operator manual present in weather-resistant storage' },
      { id: 'decals_legible',    label: 'Safety decals and warning placards present and legible' },
    ],
  },
  {
    id: 'chain_teeth_boom', num: 2, label: 'Digging Chain, Teeth and Boom',
    items: [
      { id: 'teeth_retention',    label: 'Cutter teeth and retaining pins secure, none missing', safetyCritical: true },
      { id: 'teeth_wear',         label: 'Cutter tooth wear within manufacturer limits' },
      { id: 'chain_links',        label: 'Chain links, pins and bushings free of cracks or excessive play', safetyCritical: true },
      { id: 'boom_weldment',      label: 'No cracks in boom weldment, boom rails or headshaft mounts', safetyCritical: true },
      { id: 'headshaft_sprocket', label: 'Headshaft sprocket and bearings sound, no wobble or end play' },
      { id: 'boom_pivot_pins',    label: 'Boom pivot pins, retainers and keepers in place and secure', safetyCritical: true },
      { id: 'debris_clear',       label: 'Boom and chain clear of packed spoil, roots and debris' },
    ],
  },
  {
    id: 'chain_tension', num: 3, label: 'Digging Chain Tension',
    items: [
      { id: 'chain_sag',         label: 'Chain sag measured and within manufacturer specification' },
      { id: 'chain_tracks_true', label: 'Chain tracks true on the sprocket with no riding or jumping', safetyCritical: true },
      { id: 'tension_adjuster',  label: 'Tensioner or adjuster functional and not at the end of travel' },
      { id: 'chain_stretch',     label: 'Chain stretch within wear limit, no links added beyond spec' },
      { id: 'boom_slide_clean',  label: 'Boom slide and tension components clear of packed dirt' },
    ],
  },
  {
    id: 'side_plates_crumber', num: 4, label: 'Side Plates and Crumber',
    items: [
      { id: 'side_plates_secure', label: 'Side plates and boom shields in place with all fasteners tight', safetyCritical: true },
      { id: 'crumber_adjusted',   label: 'Crumber set to trench depth and locked in position' },
      { id: 'crumber_condition',  label: 'Crumber shoe, arm and mount free of cracks or excessive wear' },
      { id: 'auger_flighting',    label: 'Auger or cross-conveyor flighting undamaged and secure' },
      { id: 'spoil_discharge',    label: 'Spoil discharge path clear and directed away from the trench edge' },
    ],
  },
  {
    id: 'hydraulic', num: 5, label: 'Hydraulic Systems',
    items: [
      { id: 'no_hyd_leaks',       label: 'No hydraulic leaks at hoses, fittings or cylinders', safetyCritical: true },
      { id: 'hose_condition',     label: 'Hoses free of chafing, bulges or exposed reinforcement', safetyCritical: true },
      { id: 'boom_cylinder_hold', label: 'Boom lift cylinder holds position without drift', safetyCritical: true },
      { id: 'couplers_engaged',   label: 'Attachment quick couplers fully engaged and locked', safetyCritical: true },
      { id: 'hyd_fluid_level',    label: 'Hydraulic fluid level adequate and free of contamination' },
      { id: 'cooler_clean',       label: 'Hydraulic cooler and intake screens clear of debris' },
    ],
  },
  {
    id: 'ground_drive', num: 6, label: 'Ground Drive',
    items: [
      { id: 'track_tension',    label: 'Track tension within specification, no missing or damaged lugs' },
      { id: 'tires_condition',  label: 'Tires inflated to specification and free of cuts or damage' },
      { id: 'rollers_idlers',   label: 'Rollers, idlers and drive sprockets undamaged and not leaking' },
      { id: 'final_drives',     label: 'Final drives free of leaks and abnormal noise' },
      { id: 'brakes_hold',      label: 'Service and parking brakes hold the machine on grade', safetyCritical: true },
      { id: 'no_creep_neutral', label: 'Machine does not creep with ground drive levers in neutral', safetyCritical: true },
    ],
  },
  {
    id: 'controls', num: 7, label: 'Controls and Safety Devices',
    items: [
      { id: 'deadman_control',   label: 'Deadman or operator presence control stops the chain when released', safetyCritical: true },
      { id: 'chain_guard',       label: 'Chain guard and rear shield present and secured', safetyCritical: true },
      { id: 'emergency_stop',    label: 'Emergency stop shuts down engine and digging chain', safetyCritical: true },
      { id: 'chain_lockout',     label: 'Chain engagement lockout prevents starting with the chain engaged', safetyCritical: true },
      { id: 'controls_neutral',  label: 'Drive and boom controls return to neutral when released', safetyCritical: true },
      { id: 'rops_seatbelt',     label: 'ROPS and seat belt undamaged and secure on ride-on units', safetyCritical: true },
      { id: 'horn_backup_alarm', label: 'Horn and backup alarm functional' },
    ],
  },
  {
    id: 'engine_fluids', num: 8, label: 'Engine, Fluids and Filters',
    items: [
      { id: 'no_fuel_leaks',  label: 'No fuel leaks at tank, lines or fittings', safetyCritical: true },
      { id: 'engine_oil',     label: 'Engine oil level within range and free of contamination' },
      { id: 'coolant_level',  label: 'Coolant level adequate and radiator fins clear' },
      { id: 'air_filter',     label: 'Air filter and restriction indicator serviceable' },
      { id: 'belts_hoses',    label: 'Belts and coolant hoses sound and correctly tensioned' },
      { id: 'battery_secure', label: 'Battery secured, terminals clean and cables intact' },
    ],
  },
  {
    id: 'signoff', num: 9, label: 'Operator Sign-Off Readiness',
    items: [
      { id: 'overall_determination', label: 'Overall pass/fail determination made', safetyCritical: true },
      { id: 'removal_assessed',      label: 'Removal from service assessed for any critical deficiency', safetyCritical: true },
      { id: 'deficiencies_noted',    label: 'All deficiencies described in notes' },
      { id: 'operator_authorized',   label: 'Operator trained and authorized on this machine' },
      { id: 'datetime_recorded',     label: 'Date, time and hour meter recorded' },
    ],
  },
]
