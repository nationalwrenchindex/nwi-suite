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

export interface TorqueSpec {
  part: string
  spec: string
}

export interface TechGuide {
  torque:  TorqueSpec[]
  steps:   string[]
  tools:   string[]
  warning: string
  hours:   number
  parts:   string[]
}

export interface RawPart {
  name:              string
  part_number_hint:  string
  qty:               number
  price_estimate:    number
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

// ─── Multi-job structures ──────────────────────────────────────────────────────

export interface MultiJobPart {
  name:       string
  qty:        number
  unit_cost:  number   // what the tech pays the supplier
  unit_price: number   // what the customer pays (after markup)
}

export interface MultiJobEntry {
  id:          string
  category:    string   // catalog category id (e.g. 'brakes')
  subtype:     string   // job name (e.g. 'Front Brake Pad Replacement')
  labor_hours: number
  labor_rate:  number
  parts:       MultiJobPart[]
  notes:       string
}

// ─── API payloads ─────────────────────────────────────────────────────────────

export interface TechGuideRequest {
  vehicle: QWVehicle
  job:     SelectedJob
}

export interface QuoteSaveRequest {
  vehicle:       QWVehicle
  job:           SelectedJob           // first job (backwards compat scalar columns)
  jobs?:         MultiJobEntry[]       // all jobs (multi-job JSONB)
  parts:         PartWithSuppliers[]   // all included parts flat (backwards compat)
  parts_total:   number
  labor_hours:   number                // total labor hours across all jobs
  labor_rate:    number
  labor_total:   number
  markup_percent: number
  tax_amount:    number
  grand_total:   number
  customer_name: string
  customer_phone: string
  send_sms:   boolean
  save_quote: boolean
}
