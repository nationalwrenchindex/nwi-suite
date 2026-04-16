// ─── Customer ─────────────────────────────────────────────────────────────────

export interface Customer {
  id: string
  user_id: string
  first_name: string
  last_name: string
  phone: string | null
  email: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  notes: string | null
  created_at: string
  updated_at: string
  vehicles?: Vehicle[]
}

export interface CustomerListItem {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  email: string | null
  vehicles: { id: string }[]
}

// ─── Vehicle ──────────────────────────────────────────────────────────────────

export type Transmission = 'automatic' | 'manual' | 'cvt' | 'other'

export interface Vehicle {
  id: string
  customer_id: string
  year: number | null
  make: string
  model: string
  trim: string | null
  vin: string | null
  color: string | null
  mileage: number | null
  license_plate: string | null
  engine: string | null
  transmission: Transmission | null
  notes: string | null
  created_at: string
  updated_at: string
  service_history?: ServiceRecord[]
}

// ─── Service History ──────────────────────────────────────────────────────────

export interface PartUsed {
  name: string
  part_number?: string
  quantity: number
  unit_cost?: number
}

export interface ServiceRecord {
  id: string
  vehicle_id: string
  service_date: string          // YYYY-MM-DD
  service_type: string
  tech_notes: string | null
  mileage_at_service: number | null
  amount_charged: number | null
  parts_used: PartUsed[]
  next_service_date: string | null
  next_service_mileage: number | null
  created_at: string
  updated_at: string
}

// ─── Service Alerts ───────────────────────────────────────────────────────────

export type AlertStatus = 'overdue' | 'due_soon' | 'up_to_date' | 'no_history'

export interface ServiceAlert {
  vehicle: Omit<Vehicle, 'service_history'>
  customer: {
    id: string
    first_name: string
    last_name: string
    phone: string | null
    email: string | null
  }
  last_service: Pick<ServiceRecord, 'service_date' | 'service_type' | 'mileage_at_service'> | null
  next_service_date: string | null
  next_service_mileage: number | null
  alert_status: AlertStatus
  days_overdue: number | null
  days_until_due: number | null
}

// ─── VIN / NHTSA ─────────────────────────────────────────────────────────────

export interface VehicleSpecs {
  make: string
  model: string
  year: string
  trim: string
  bodyClass: string
  driveType: string
  engineCylinders: string
  displacementL: string
  fuelType: string
  transmissionStyle: string
  plantCountry: string
  vehicleType: string
  errorCode: string
  errorText: string
}

export interface NHTSARecall {
  NHTSACampaignNumber: string
  ReportReceivedDate: string
  Component: string
  Summary: string
  Consequence: string
  Remedy: string
  Manufacturer: string
  ModelYear: string
  Make: string
  Model: string
}

export interface VinResult {
  vin: string
  specs: VehicleSpecs
  recalls: NHTSARecall[]
  recallCount: number
  hasOpenRecalls: boolean
}

// ─── Payloads ─────────────────────────────────────────────────────────────────

export interface CreateCustomerPayload {
  first_name: string
  last_name: string
  phone?: string | null
  email?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  notes?: string | null
}

export type UpdateCustomerPayload = Partial<CreateCustomerPayload>

export interface CreateVehiclePayload {
  customer_id: string
  year?: number | null
  make: string
  model: string
  trim?: string | null
  vin?: string | null
  color?: string | null
  mileage?: number | null
  license_plate?: string | null
  engine?: string | null
  transmission?: Transmission | null
  notes?: string | null
}

export interface CreateServicePayload {
  vehicle_id: string
  service_date: string
  service_type: string
  tech_notes?: string | null
  mileage_at_service?: number | null
  amount_charged?: number | null
  parts_used?: PartUsed[]
  next_service_date?: string | null
  next_service_mileage?: number | null
}
