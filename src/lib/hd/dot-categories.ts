export const INSPECTION_CATEGORIES = [
  { id: 'brake_systems',       label: 'Brake Systems',                  num: 1  },
  { id: 'coupling_devices',    label: 'Coupling Devices',               num: 2  },
  { id: 'exhaust_systems',     label: 'Exhaust Systems',                num: 3  },
  { id: 'fuel_systems',        label: 'Fuel Systems',                   num: 4  },
  { id: 'lighting_devices',    label: 'Lighting Devices',               num: 5  },
  { id: 'safe_loading',        label: 'Safe Loading',                   num: 6  },
  { id: 'steering_mechanisms', label: 'Steering Mechanisms',            num: 7  },
  { id: 'suspension',          label: 'Suspension',                     num: 8  },
  { id: 'frame_assemblies',    label: 'Frame and Frame Assemblies',     num: 9  },
  { id: 'tires',               label: 'Tires',                          num: 10 },
  { id: 'wheels_rims',         label: 'Wheels and Rims',                num: 11 },
  { id: 'windshield_glazing',  label: 'Windshield Glazing',             num: 12 },
  { id: 'windshield_wipers',   label: 'Windshield Wipers',              num: 13 },
  { id: 'emergency_exits',     label: 'Emergency Exits',                num: 14 },
  { id: 'electrical_cables',   label: 'Electrical Cables and Systems',  num: 15 },
  { id: 'speedometer',         label: 'Speedometer',                    num: 16 },
  { id: 'seat_belts',          label: 'Seat Belts',                     num: 17 },
  { id: 'cargo_securing',      label: 'Cargo Securing Devices',         num: 18 },
] as const

export type CategoryId = typeof INSPECTION_CATEGORIES[number]['id']
export type InspectionResult = 'pass' | 'fail' | 'na'

export interface SubItemDef {
  id: string
  label: string
  safetyCritical?: boolean
}

export interface SubItemData {
  result: InspectionResult
  notes: string
}

export interface CategoryData {
  items: Record<string, SubItemData>
}

export type InspectionData = Record<string, CategoryData>

export interface ViolationRecord {
  category: string
  item: string
  label: string
  notes: string
  safetyCritical: boolean
}

export const CATEGORY_ITEMS: Record<string, SubItemDef[]> = {
  brake_systems: [
    { id: 'lining_thickness',     label: 'Brake lining thickness — steer axle min 1/4”, others min 1/8”', safetyCritical: true },
    { id: 'drum_rotor',           label: 'Brake drum or rotor condition — no cracks or holes' },
    { id: 'hose_condition',       label: 'Brake hose condition — no chafing, cracks, cuts or abrasions' },
    { id: 'tubing_condition',     label: 'Brake tubing condition — no leaks, proper support' },
    { id: 'chamber_condition',    label: 'Brake chamber condition — no cracks or damage' },
    { id: 'slack_adjuster',       label: 'Slack adjuster condition and travel within limits', safetyCritical: true },
    { id: 'air_leakage',          label: 'Air system leakage — less than 3 PSI per minute single vehicle' },
    { id: 'pushrod_stroke',       label: 'Pushrod stroke within limits at 90 PSI applied', safetyCritical: true },
    { id: 'low_pressure_warning', label: 'Low pressure warning device operational below 60 PSI' },
    { id: 'abs_lamp',             label: 'ABS malfunction lamp functional' },
  ],
  coupling_devices: [
    { id: 'fifth_wheel',       label: 'Fifth wheel — no cracks, properly mounted, locking jaws closed' },
    { id: 'pintle_hook',       label: 'Pintle hook — no cracks, properly mounted, latch engaged' },
    { id: 'drawbar',           label: 'Drawbar — no cracks, properly attached' },
    { id: 'safety_chains',     label: 'Safety chains or cables — proper condition and attachment' },
    { id: 'king_pin',          label: 'King pin — no excessive wear' },
    { id: 'upper_coupler',     label: 'Upper coupler plate — no cracks or damage' },
    { id: 'locking_mechanism', label: 'Locking mechanism fully engaged — no visible gap between upper and lower coupler' },
  ],
  exhaust_systems: [
    { id: 'no_leaks_forward', label: 'No leaks forward of or below the cab' },
    { id: 'exhaust_into_cab', label: 'Exhaust not leaking into cab or sleeper', safetyCritical: true },
    { id: 'burn_damage',      label: 'Exhaust not likely to burn, char or damage wiring or fuel supply' },
    { id: 'exhaust_secured',  label: 'Exhaust system properly secured with no contact with fuel lines or wiring' },
  ],
  fuel_systems: [
    { id: 'no_fuel_leaks', label: 'No leaks in any part of the fuel system', safetyCritical: true },
    { id: 'filler_cap',    label: 'Fuel tank filler cap present and secure' },
    { id: 'tank_mounted',  label: 'Fuel tank properly mounted and secure' },
    { id: 'fuel_lines',    label: 'Fuel lines and connections secure and leak free' },
    { id: 'tank_damage',   label: 'No fuel tank damage that could cause leakage' },
  ],
  lighting_devices: [
    { id: 'headlights',       label: 'Headlights both operational — high and low beam', safetyCritical: true },
    { id: 'tail_lights',      label: 'Tail lights operational' },
    { id: 'stop_lights',      label: 'Stop lights operational', safetyCritical: true },
    { id: 'turn_signals',     label: 'Turn signals front and rear operational' },
    { id: 'clearance_lights', label: 'Clearance lights operational' },
    { id: 'id_lights',        label: 'Identification lights operational' },
    { id: 'marker_lights',    label: 'Marker lights operational' },
    { id: 'reflectors',       label: 'Reflectors present and properly located' },
    { id: 'hazard_lights',    label: 'Hazard warning lights operational' },
    { id: 'backup_lights',    label: 'Backup lights operational if equipped' },
    { id: 'cab_lights',       label: 'Cab lights operational' },
  ],
  safe_loading: [
    { id: 'cargo_secured',    label: 'Cargo properly blocked, braced, tied or chained' },
    { id: 'securing_devices', label: 'Cargo securing devices in good condition' },
    { id: 'header_boards',    label: 'Header boards where required' },
    { id: 'spare_tire',       label: 'Spare tire properly secured if carried' },
    { id: 'no_obstruction',   label: "No cargo obscuring driver’s view or access to controls" },
  ],
  steering_mechanisms: [
    { id: 'steering_lash',    label: 'Steering wheel lash within limits — maximum 2” on 20” wheel', safetyCritical: true },
    { id: 'column_mounted',   label: 'Steering column properly mounted and secured' },
    { id: 'ps_hoses',         label: 'Power steering hoses — no leaks' },
    { id: 'ps_fluid',         label: 'Power steering fluid level adequate' },
    { id: 'tie_rod_ends',     label: 'Tie rod ends — no excessive wear or looseness' },
    { id: 'drag_link',        label: 'Drag link — no excessive wear or looseness' },
    { id: 'ball_joints',      label: 'Ball and socket joints — no excessive wear' },
    { id: 'gear_box_mounted', label: 'Steering gear box properly mounted and secure' },
    { id: 'gear_box_play',    label: 'Steering gear box — no excessive play' },
  ],
  suspension: [
    { id: 'spring_hangers',    label: 'Spring hangers — no cracks or breaks' },
    { id: 'springs',           label: 'Springs — no broken or missing leaves' },
    { id: 'torque_components', label: 'Torque, radius or tracking components — no cracks or improper repairs' },
    { id: 'air_bags',          label: 'Air bags — no leaks or damage' },
    { id: 'adjustable_axles',  label: 'Adjustable axles properly secured' },
    { id: 'shock_absorbers',   label: 'Shock absorbers properly mounted and not leaking' },
  ],
  frame_assemblies: [
    { id: 'frame_members',       label: 'Frame members — no cracks, breaks or improper repairs' },
    { id: 'cross_members',       label: 'Cross members — no missing or damaged members' },
    { id: 'frame_welds',         label: 'Frame welds — no visible cracks' },
    { id: 'body_mounts',         label: 'Body mounts properly secured' },
    { id: 'structural_integrity',label: 'No frame damage affecting structural integrity' },
  ],
  tires: [
    { id: 'steer_tread_depth', label: 'Steer axle tires — minimum 4/32” tread depth', safetyCritical: true },
    { id: 'other_tread_depth', label: 'All other tires — minimum 2/32” tread depth' },
    { id: 'cord_ply_exposed',  label: 'No cuts or breaks exposing ply or cord', safetyCritical: true },
    { id: 'bulges_knots',      label: 'No bulges or knots' },
    { id: 'under_inflation',   label: 'No obvious under inflation' },
    { id: 'regrooved',         label: 'No regrooved tires on steer axle' },
    { id: 'tire_rubbing',      label: 'Tires not rubbing any part of vehicle' },
    { id: 'valve_stems',       label: 'Valve stems in good condition with caps present' },
    { id: 'matched_size',      label: 'Tires matched in size on same axle' },
  ],
  wheels_rims: [
    { id: 'cracked_rims',    label: 'No cracked, broken or bent rims or wheels', safetyCritical: true },
    { id: 'lug_nuts',        label: 'All lug nuts present and properly torqued' },
    { id: 'studs',           label: 'No missing or damaged studs' },
    { id: 'loose_wheels',    label: 'No loose wheels — check for rust trails' },
    { id: 'valve_seated',    label: 'Tubeless tire valves properly seated' },
    { id: 'no_welded_steer', label: 'No welded or brazed wheels on steering axle' },
  ],
  windshield_glazing: [
    { id: 'discoloration',   label: 'No discoloration or vision distortion in critical viewing area' },
    { id: 'cracks_chips',    label: "No cracks, chips or starred breaks in driver’s critical viewing area" },
    { id: 'no_obstructions', label: "No obstructions to driver’s view" },
    { id: 'tinting',         label: "Tinting within legal limits for driver’s critical area" },
  ],
  windshield_wipers: [
    { id: 'arms_blades',    label: 'Wiper arms and blades present and operational' },
    { id: 'no_damage',      label: 'No missing or damaged wiper components' },
    { id: 'washer_system',  label: 'Washer system operational if equipped' },
    { id: 'wiper_clearance',label: 'Wipers clear windshield adequately' },
  ],
  emergency_exits: [
    { id: 'exits_operational', label: 'All emergency exits operational — buses only' },
    { id: 'exit_marking',      label: 'Exit marking visible' },
    { id: 'exit_unobstructed', label: 'Exit not obstructed' },
  ],
  electrical_cables: [
    { id: 'no_bare_wiring',     label: 'No bare or frayed wiring' },
    { id: 'wiring_secured',     label: 'Wiring properly secured and protected from chafing' },
    { id: 'no_short_risk',      label: 'No wiring likely to cause shorts or fires' },
    { id: 'battery_secured',    label: 'Battery properly secured and hold-downs in place' },
    { id: 'battery_connections',label: 'Battery connections tight and corrosion free' },
    { id: 'no_fire_risk',       label: 'No electrical components likely to cause fire or shock' },
  ],
  speedometer: [
    { id: 'speedo_operational', label: 'Speedometer operational and accurate' },
    { id: 'speedo_visible',     label: 'Speedometer visible to driver' },
  ],
  seat_belts: [
    { id: 'belt_present',     label: 'Driver seat belt present and operational' },
    { id: 'webbing_condition',label: 'No fraying, cuts or damage to webbing' },
    { id: 'buckle',           label: 'Buckle properly latches and releases' },
    { id: 'retractor',        label: 'Retractor operational if equipped' },
    { id: 'mounting',         label: 'Seat belt mounted securely' },
  ],
  cargo_securing: [
    { id: 'tie_downs',           label: 'All tie-downs in good condition — no cuts, fraying or hooks out of shape' },
    { id: 'tie_down_anchors',    label: 'Tie-down anchors properly welded or bolted' },
    { id: 'front_end_structure', label: 'Front end structure present where required' },
    { id: 'dunnage_bags',        label: 'Dunnage bags in good condition if used' },
    { id: 'blocking_bracing',    label: 'Blocking and bracing adequate for cargo type' },
  ],
}

export function initialInspectionData(): InspectionData {
  const data: InspectionData = {}
  for (const cat of INSPECTION_CATEGORIES) {
    const items: Record<string, SubItemData> = {}
    for (const item of CATEGORY_ITEMS[cat.id] ?? []) {
      items[item.id] = { result: 'pass', notes: '' }
    }
    data[cat.id] = { items }
  }
  return data
}

export function categoryResult(catData: CategoryData): InspectionResult {
  const results = Object.values(catData.items).map(i => i.result)
  if (results.some(r => r === 'fail')) return 'fail'
  if (results.length > 0 && results.every(r => r === 'na')) return 'na'
  return 'pass'
}

export function categoryLabel(id: string): string {
  return INSPECTION_CATEGORIES.find(c => c.id === id)?.label ?? id
}

export function itemLabel(categoryId: string, itemId: string): string {
  return CATEGORY_ITEMS[categoryId]?.find(i => i.id === itemId)?.label ?? itemId
}

export function isItemSafetyCritical(categoryId: string, itemId: string): boolean {
  return CATEGORY_ITEMS[categoryId]?.find(i => i.id === itemId)?.safetyCritical ?? false
}
