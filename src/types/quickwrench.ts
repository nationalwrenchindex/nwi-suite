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
  /** Set when the hours came from an AI estimate (lib/labor-estimate): shown beside them. */
  labor_estimate?: import('@/lib/labor-estimate').LaborEstimate | null
}

// ─── Tech guide ───────────────────────────────────────────────────────────────

export interface TorqueSpec {
  part: string
  spec: string
}

// Demo pricing returned by the AI until PartsTech integration is live.
export interface TechGuidePart {
  name:       string
  qty:        number
  unit_cost:  number   // always 0 from the AI: the tech enters the cost (lib/tech-guide)
  unit_price: number   // always 0 from the AI: priced from the typed cost
}

export interface TechGuide {
  torque:  TorqueSpec[]
  steps:   string[]
  tools:   string[]
  warning: string
  hours:   number
  // string[] = legacy format (backward compat); TechGuidePart[] = current format with demo pricing
  parts:   Array<TechGuidePart | string>
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
  // LEGACY, never written since Oct 28. These held invented "retailer" prices (the AI
  // estimate times a fixed factor) labelled with store names. The client now sends one
  // price, custom_price. Kept optional only so a quote saved before then still reads.
  price_autozone?:  number
  price_orielly?:   number
  price_napa?:      number
  price_rockauto?:  number
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
  /** The AI estimate the hours started from, when they did (lib/labor-estimate). */
  labor_estimate?: import('@/lib/labor-estimate').LaborEstimate | null
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
  extra_labor?:  Array<{ description: string; hours: number }>  // custom labor lines
  parts:         PartWithSuppliers[]   // all included parts flat (backwards compat)
  // What the tech typed. Every total is priced by the route (lib/quickwrench-money),
  // under the shop's settings - none is taken from the request.
  labor_hours?:  number                // single-job legacy request only
  labor_rate:    number
  markup_percent: number
  /** The rate the quote records; the tax itself is the shop's split. */
  tax_percent?:  number
  travel_hours?:  number
  mileage_miles?: number
  /** The fee as on the Quote tab. Absent: the shop's own fee when it bills one. */
  service_call_fee?: number
  /** The customer QuickWrench already saved to Intel Hub. */
  customer_id?:  string | null
  customer_name: string
  customer_phone: string
  send_sms:   boolean
  save_quote: boolean
}
