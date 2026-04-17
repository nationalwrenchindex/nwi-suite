// ─── Vehicle ──────────────────────────────────────────────────────────────────

export interface QWVehicle {
  vin:               string
  year:              string
  make:              string
  model:             string
  engine:            string
  trim?:             string
  driveType?:        string
  transmissionStyle?: string
  fuelType?:         string
  bodyClass?:        string
}

// ─── Job catalog ──────────────────────────────────────────────────────────────

export interface JobItem {
  name:  string
  hours: number
}

export interface JobCategory {
  id:    string
  label: string
  color: string
  jobs:  JobItem[]
}

export interface SelectedJob {
  category:      string
  categoryLabel: string
  name:          string
  hours:         number
}

// ─── Tech guide ───────────────────────────────────────────────────────────────

export type Difficulty = 'Easy' | 'Moderate' | 'Hard' | 'Expert'

export interface TorqueSpec {
  component: string
  spec:      string
  notes?:    string
}

export interface SpecialTool {
  name:   string
  notes?: string
}

export interface RawPart {
  name:              string
  part_number_hint:  string
  qty:               number
  price_estimate:    number
}

export interface TechGuide {
  difficulty:    Difficulty
  labor_hours:   number
  overview:      string
  torque_specs:  TorqueSpec[]
  repair_steps:  string[]
  special_tools: SpecialTool[]
  warnings:      string[]
  parts_needed:  RawPart[]
}

// ─── Parts with supplier pricing ─────────────────────────────────────────────

export type Supplier = 'autozone' | 'orielly' | 'napa' | 'rockauto' | 'custom'

export interface PartWithSuppliers extends RawPart {
  id:               string
  included:         boolean
  selected_supplier: Supplier
  custom_price:     number
  price_autozone:   number
  price_orielly:    number
  price_napa:       number
  price_rockauto:   number
}

// ─── Quote ────────────────────────────────────────────────────────────────────

export interface QuickWrenchQuote {
  id:            string
  user_id:       string
  vin:           string | null
  vehicle_year:  string | null
  vehicle_make:  string | null
  vehicle_model: string | null
  vehicle_engine: string | null
  job_category:  string | null
  job_name:      string | null
  parts_list:    PartWithSuppliers[] | null
  parts_total:   number | null
  labor_hours:   number | null
  labor_rate:    number | null
  labor_total:   number | null
  markup_percent: number | null
  tax_amount:    number | null
  grand_total:   number | null
  customer_name: string | null
  customer_phone: string | null
  status:        string
  created_at:    string
}

// ─── API payloads ─────────────────────────────────────────────────────────────

export interface TechGuideRequest {
  vehicle: QWVehicle
  job:     SelectedJob
}

export interface QuoteSaveRequest {
  vehicle:       QWVehicle
  job:           SelectedJob
  parts:         PartWithSuppliers[]
  parts_total:   number
  labor_hours:   number
  labor_rate:    number
  labor_total:   number
  markup_percent: number
  tax_amount:    number
  grand_total:   number
  customer_name: string
  customer_phone: string
  send_sms:      boolean
  save_invoice:  boolean
}
