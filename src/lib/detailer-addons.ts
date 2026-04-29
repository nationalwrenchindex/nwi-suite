export interface DetailerAddon {
  name:         string
  defaultPrice: number
}

export const DETAILER_ADDONS: Record<string, DetailerAddon[]> = {
  'Full Detail': [
    { name: 'Pet hair removal',      defaultPrice: 50  },
    { name: 'Odor elimination',      defaultPrice: 75  },
    { name: 'Headlight restoration', defaultPrice: 75  },
    { name: 'Engine bay cleaning',   defaultPrice: 60  },
    { name: 'Stain treatment',       defaultPrice: 40  },
  ],
  'Interior Detail': [
    { name: 'Pet hair removal',      defaultPrice: 50  },
    { name: 'Odor elimination',      defaultPrice: 75  },
    { name: 'Stain treatment',       defaultPrice: 40  },
    { name: 'Leather conditioning',  defaultPrice: 35  },
  ],
  'Exterior Detail': [
    { name: 'Tire dressing',         defaultPrice: 15  },
    { name: 'Paint sealant',         defaultPrice: 75  },
    { name: 'Headlight restoration', defaultPrice: 75  },
  ],
  'Paint Correction': [
    { name: 'Clay bar treatment',    defaultPrice: 60  },
    { name: 'Paint sealant',         defaultPrice: 75  },
  ],
  'Ceramic Coating (1 Year)': [
    { name: 'Paint correction prep', defaultPrice: 150 },
    { name: 'Headlight ceramic',     defaultPrice: 40  },
  ],
  'Ceramic Coating (3 Year)': [
    { name: 'Paint correction prep', defaultPrice: 150 },
    { name: 'Headlight ceramic',     defaultPrice: 40  },
  ],
  'Ceramic Coating (5 Year)': [
    { name: 'Paint correction prep', defaultPrice: 150 },
    { name: 'Headlight ceramic',     defaultPrice: 40  },
  ],
}

export function getAddonsForService(serviceName: string): DetailerAddon[] {
  return DETAILER_ADDONS[serviceName] ?? []
}
