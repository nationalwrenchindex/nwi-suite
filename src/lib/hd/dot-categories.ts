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

export interface CategoryData {
  result: InspectionResult
  notes: string
}

export type InspectionData = Record<string, CategoryData>

export function initialInspectionData(): InspectionData {
  const data: InspectionData = {}
  for (const cat of INSPECTION_CATEGORIES) {
    data[cat.id] = { result: 'pass', notes: '' }
  }
  return data
}

export function categoryLabel(id: string): string {
  return INSPECTION_CATEGORIES.find(c => c.id === id)?.label ?? id
}
