// ─── Enums ────────────────────────────────────────────────────────────────────

export type JobStatus =
  | 'scheduled'
  | 'en_route'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export type NotificationTemplateType =
  | 'appointment_reminder'
  | 'appointment_confirmation'
  | 'invoice_sent'
  | 'invoice_overdue'
  | 'job_completed'
  | 'on_my_way'
  | 'follow_up'
  | 'custom'

export type NotificationChannel = 'sms' | 'email' | 'both'

// ─── Core models ──────────────────────────────────────────────────────────────

export interface CustomerSummary {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  email: string | null
}

export interface VehicleSummary {
  id: string
  year: number | null
  make: string
  model: string
  color: string | null
  license_plate: string | null
}

export interface CustomerWithVehicles extends CustomerSummary {
  vehicles: VehicleSummary[]
}

export interface Job {
  id: string
  user_id: string
  customer_id: string | null
  vehicle_id: string | null
  job_date: string               // YYYY-MM-DD
  job_time: string | null        // HH:MM:SS from Postgres
  service_type: string
  services: string[]             // multi-service array; empty [] on mechanic records
  status: JobStatus
  location_address: string | null
  location_lat: number | null
  location_lng: number | null
  estimated_duration_minutes: number | null
  notes: string | null
  internal_notes: string | null
  inspection_requested: boolean | null
  created_at: string
  updated_at: string
  // Joined relations
  customer?: CustomerSummary | null
  vehicle?: VehicleSummary | null
}

// ─── Multi-Point Inspection ───────────────────────────────────────────────────

export type InspectionStatus     = 'pending' | 'in_progress' | 'completed'
export type InspectionItemStatus = 'not_checked' | 'pass' | 'fail' | 'needs_attention'
export type InspectionCategory   = 'fluids_engine' | 'tires_wheels' | 'brakes_underside' | 'lights_safety'

export interface InspectionItem {
  id:                  string
  inspection_id:       string
  point_number:        number
  point_name:          string
  category:            InspectionCategory
  status:              InspectionItemStatus
  notes:               string | null
  mapped_service_name: string | null
}

export interface Inspection {
  id:                    string
  job_id:                string
  mechanic_id:           string
  customer_id:           string | null
  status:                InspectionStatus
  requested_by_customer: boolean
  labor_charge_applied:  boolean
  created_at:            string
  completed_at:          string | null
  items?:                InspectionItem[]
}

export interface NotificationTemplate {
  id: string
  user_id: string
  template_type: NotificationTemplateType
  name: string
  subject: string | null
  message_content: string
  channel: NotificationChannel
  is_active: boolean
  created_at: string
  updated_at: string
}

// ─── Payloads ─────────────────────────────────────────────────────────────────

export interface CreateJobPayload {
  job_date: string
  job_time?: string | null
  service_type: string
  customer_id?: string | null
  vehicle_id?: string | null
  status?: JobStatus
  location_address?: string | null
  location_lat?: number | null
  location_lng?: number | null
  estimated_duration_minutes?: number | null
  notes?: string | null
  internal_notes?: string | null
}

export type UpdateJobPayload = Partial<CreateJobPayload> & {
  status?: JobStatus
}

export interface CreateNotificationPayload {
  template_type: NotificationTemplateType
  name: string
  subject?: string | null
  message_content: string
  channel: NotificationChannel
  is_active?: boolean
}

// ─── API response shapes ──────────────────────────────────────────────────────

export type CalendarData = Record<string, Job[]>  // date key → jobs

export interface JobsResponse {
  jobs: Job[]
}

export interface CalendarResponse {
  calendar: CalendarData
  from_date: string
  to_date: string
}

export interface ApiError {
  error: string
}
