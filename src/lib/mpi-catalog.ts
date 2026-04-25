// Shared catalog for the 25-Point Multi-Point Inspection feature.
// Inspection points, categories, and service mapping for quote generation.

export type InspectionCategory = 'fluids_engine' | 'tires_wheels' | 'brakes_underside' | 'lights_safety'

export interface InspectionPoint {
  point_number: number
  point_name: string
  category: InspectionCategory
}

export const INSPECTION_POINTS: InspectionPoint[] = [
  { point_number:  1, point_name: 'Engine Oil',              category: 'fluids_engine'    },
  { point_number:  2, point_name: 'Oil Filter',              category: 'fluids_engine'    },
  { point_number:  3, point_name: 'Coolant/Antifreeze',      category: 'fluids_engine'    },
  { point_number:  4, point_name: 'Brake Fluid',             category: 'fluids_engine'    },
  { point_number:  5, point_name: 'Power Steering Fluid',    category: 'fluids_engine'    },
  { point_number:  6, point_name: 'Windshield Washer Fluid', category: 'fluids_engine'    },
  { point_number:  7, point_name: 'Battery Terminals',       category: 'fluids_engine'    },
  { point_number:  8, point_name: 'Battery Health',          category: 'fluids_engine'    },
  { point_number:  9, point_name: 'Serpentine/Drive Belts',  category: 'fluids_engine'    },
  { point_number: 10, point_name: 'Radiator Hoses',          category: 'fluids_engine'    },
  { point_number: 11, point_name: 'Air Filter',              category: 'fluids_engine'    },
  { point_number: 12, point_name: 'Cabin Air Filter',        category: 'fluids_engine'    },
  { point_number: 13, point_name: 'Tire Pressure',           category: 'tires_wheels'     },
  { point_number: 14, point_name: 'Tire Tread Depth',        category: 'tires_wheels'     },
  { point_number: 15, point_name: 'Tire Condition',          category: 'tires_wheels'     },
  { point_number: 16, point_name: 'Spare Tire',              category: 'tires_wheels'     },
  { point_number: 17, point_name: 'Front Brake Pads',        category: 'brakes_underside' },
  { point_number: 18, point_name: 'Rear Brake Pads/Shoes',   category: 'brakes_underside' },
  { point_number: 19, point_name: 'Brake Discs/Drums',       category: 'brakes_underside' },
  { point_number: 20, point_name: 'Brake Lines/Hoses',       category: 'brakes_underside' },
  { point_number: 21, point_name: 'Suspension/Shocks',       category: 'brakes_underside' },
  { point_number: 22, point_name: 'Exhaust System',          category: 'brakes_underside' },
  { point_number: 23, point_name: 'Exterior Lights',         category: 'lights_safety'    },
  { point_number: 24, point_name: 'Wiper Blades',            category: 'lights_safety'    },
  { point_number: 25, point_name: 'Horn & Hazard Lights',    category: 'lights_safety'    },
]

// Maps inspection point names to the closest entry in JOB_CATEGORIES (Phase 1).
// Points with no direct service match return null — those get a placeholder on quotes.
const MPI_SERVICE_MAP: Record<string, { name: string; hours: number }> = {
  'Engine Oil':             { name: 'Oil & Filter Change',                hours: 0.5  },
  'Oil Filter':             { name: 'Oil & Filter Change',                hours: 0.5  },
  'Coolant/Antifreeze':     { name: 'Coolant Flush & Fill',               hours: 1.5  },
  'Brake Fluid':            { name: 'Brake Fluid Flush',                  hours: 1.0  },
  'Power Steering Fluid':   { name: 'Power Steering Fluid Flush',         hours: 0.75 },
  'Battery Terminals':      { name: 'Battery Replacement',                hours: 0.75 },
  'Battery Health':         { name: 'Battery Replacement',                hours: 0.75 },
  'Serpentine/Drive Belts': { name: 'Serpentine Belt Replacement',        hours: 1.5  },
  'Radiator Hoses':         { name: 'Radiator Hose Replacement',          hours: 1.5  },
  'Air Filter':             { name: 'Air Filter Replacement',             hours: 0.5  },
  'Cabin Air Filter':       { name: 'Cabin Air Filter Replacement',       hours: 0.5  },
  'Tire Tread Depth':       { name: 'Tire Replacement (4 tires)',         hours: 2.0  },
  'Tire Condition':         { name: 'Tire Replacement (4 tires)',         hours: 2.0  },
  'Spare Tire':             { name: 'Spare Tire Installation',            hours: 0.5  },
  'Front Brake Pads':       { name: 'Front Brake Pad Replacement',        hours: 1.5  },
  'Rear Brake Pads/Shoes':  { name: 'Rear Brake Pad Replacement',         hours: 1.5  },
  'Brake Discs/Drums':      { name: 'Full Brake Service (Pads & Rotors)', hours: 3.5  },
  'Suspension/Shocks':      { name: 'Shock / Strut Replacement (each)',   hours: 1.5  },
  'Exterior Lights':        { name: 'Headlight Bulb Replacement',         hours: 0.5  },
}

export function getMappedService(pointName: string): { name: string; hours: number } | null {
  return MPI_SERVICE_MAP[pointName] ?? null
}

export const CATEGORY_LABELS: Record<InspectionCategory, string> = {
  fluids_engine:    'Fluids & Engine Bay',
  tires_wheels:     'Tires & Wheels',
  brakes_underside: 'Brakes & Underside',
  lights_safety:    'Lights & Safety',
}
