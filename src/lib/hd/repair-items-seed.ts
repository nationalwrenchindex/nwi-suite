// Master HD repair-items catalog. Seeded server-side (via createServiceClient)
// as is_master: true, user_id: null by /api/admin/seed-repair-items.
//
// Refrigeration service definitions (referenced by refrigeration_service):
//   A = leak check + recover + repair + R&R drier + evacuate + charge  (2.6 hrs)
//   B = recover + repair + evacuate + charge                           (2.5 hrs)
//   C = low side pump down + evacuate + charge                         (1.75 hrs)
//   D = low side pump down + R&R drier + evacuate + charge             (2.0 hrs)

export interface RepairItemSeed {
  description:             string
  category:               string
  applies_to:             'truck' | 'trailer' | 'both'
  mobile_hours:           number
  shop_hours:             number
  requires_refrigeration: boolean
  refrigeration_service?: 'A' | 'B' | 'C' | 'D'
  refrigeration_hours?:   number
  notes?:                 string
}

export const MASTER_REPAIR_ITEMS: RepairItemSeed[] = [
  { description: 'R&R Evaporator Fan Motor', category: 'electrical', applies_to: 'both', mobile_hours: 2.0, shop_hours: 1.5, requires_refrigeration: false, notes: 'Precedent series' },
  { description: 'R&R Condenser Fan Motor', category: 'electrical', applies_to: 'both', mobile_hours: 1.5, shop_hours: 1.25, requires_refrigeration: false, notes: 'Precedent series' },
  { description: 'R&R Electric Standby Motor', category: 'electrical', applies_to: 'trailer', mobile_hours: 6.0, shop_hours: 5.0, requires_refrigeration: false },
  { description: 'R&R Electric Standby Motor', category: 'electrical', applies_to: 'truck', mobile_hours: 4.75, shop_hours: 4.0, requires_refrigeration: false },
  { description: 'R&R Contactor', category: 'electrical', applies_to: 'both', mobile_hours: 1.25, shop_hours: 1.25, requires_refrigeration: false },
  { description: 'R&R Compressor', category: 'refrigeration', applies_to: 'truck', mobile_hours: 4.25, shop_hours: 3.5, requires_refrigeration: true, refrigeration_service: 'A', refrigeration_hours: 2.6 },
  { description: 'R&R Compressor', category: 'refrigeration', applies_to: 'trailer', mobile_hours: 6.0, shop_hours: 5.0, requires_refrigeration: true, refrigeration_service: 'A', refrigeration_hours: 2.6 },
  { description: 'R&R ETV Valve', category: 'refrigeration', applies_to: 'both', mobile_hours: 1.9, shop_hours: 1.5, requires_refrigeration: true, refrigeration_service: 'C', refrigeration_hours: 1.75, notes: 'Refrigeration service varies A-D based on findings' },
  { description: 'R&R Alternator', category: 'electrical', applies_to: 'both', mobile_hours: 1.55, shop_hours: 1.25, requires_refrigeration: false },
  { description: 'R&R Fuel Solenoid', category: 'fuel', applies_to: 'both', mobile_hours: 1.25, shop_hours: 1.0, requires_refrigeration: false },
  { description: 'R&R Temperature Sensor', category: 'sensors', applies_to: 'both', mobile_hours: 1.0, shop_hours: 0.75, requires_refrigeration: false },
  { description: 'R&R High Pressure Cutout Switch', category: 'refrigeration', applies_to: 'both', mobile_hours: 0.75, shop_hours: 0.5, requires_refrigeration: true, refrigeration_service: 'C', refrigeration_hours: 1.75, notes: 'Typically Service C or D' },
  { description: 'R&R Belts (Full Set)', category: 'mechanical', applies_to: 'trailer', mobile_hours: 1.5, shop_hours: 1.25, requires_refrigeration: false },
  { description: 'R&R Belts (Full Set)', category: 'mechanical', applies_to: 'truck', mobile_hours: 1.75, shop_hours: 1.5, requires_refrigeration: false },
  { description: 'R&R Defrost Damper Solenoid', category: 'refrigeration', applies_to: 'both', mobile_hours: 1.5, shop_hours: 1.25, requires_refrigeration: false },
  { description: 'R&R EGR Cooler / EGR Valve + Coolant Drain & Refill', category: 'engine', applies_to: 'both', mobile_hours: 2.0, shop_hours: 1.75, requires_refrigeration: false },
  { description: 'R&R 3-Way Valve', category: 'refrigeration', applies_to: 'both', mobile_hours: 1.5, shop_hours: 1.25, requires_refrigeration: true, refrigeration_service: 'A', refrigeration_hours: 2.6 },
  { description: 'Service Refrigeration A — Leak Check, Recover, Repair, R&R Drier, Evacuate & Charge', category: 'refrigeration', applies_to: 'both', mobile_hours: 2.6, shop_hours: 2.6, requires_refrigeration: true },
  { description: 'Service Refrigeration B — Recover, Repair Leak, Evacuate & Charge', category: 'refrigeration', applies_to: 'both', mobile_hours: 2.5, shop_hours: 2.5, requires_refrigeration: true },
  { description: 'Service Refrigeration C — Low Side Pump Down, Evacuate & Charge', category: 'refrigeration', applies_to: 'both', mobile_hours: 1.75, shop_hours: 1.75, requires_refrigeration: true },
  { description: 'Service Refrigeration D — Low Side Pump Down, R&R Drier, Evacuate & Charge', category: 'refrigeration', applies_to: 'both', mobile_hours: 2.0, shop_hours: 2.0, requires_refrigeration: true },
]
