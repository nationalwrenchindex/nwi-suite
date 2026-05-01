import type { JobStatus, NotificationTemplateType } from '@/types/jobs'

// ─── Status display config ─────────────────────────────────────────────────

export const STATUS_CONFIG: Record<
  JobStatus,
  { label: string; badge: string; dot: string; ring: string }
> = {
  scheduled:   { label: 'Scheduled',   badge: 'bg-blue/20 text-blue-light border border-blue/40',          dot: 'bg-blue',      ring: 'ring-blue/30'    },
  en_route:    { label: 'En Route',    badge: 'bg-amber-500/20 text-amber-400 border border-amber-500/40', dot: 'bg-amber-400', ring: 'ring-amber-500/30' },
  in_progress: { label: 'In Progress', badge: 'bg-orange/20 text-orange-light border border-orange/40',    dot: 'bg-orange',    ring: 'ring-orange/30'  },
  on_site:     { label: 'On Site',     badge: 'bg-amber-500/20 text-amber-400 border border-amber-500/40', dot: 'bg-amber-400', ring: 'ring-amber-500/30' },
  completed:   { label: 'Completed',   badge: 'bg-success/20 text-success border border-success/40',       dot: 'bg-success',   ring: 'ring-success/30' },
  cancelled:   { label: 'Cancelled',   badge: 'bg-white/10 text-white/40 border border-white/10',          dot: 'bg-white/30',  ring: 'ring-white/10'   },
  no_show:     { label: 'No Show',     badge: 'bg-danger/20 text-danger border border-danger/40',          dot: 'bg-danger',    ring: 'ring-danger/30'  },
}

// Next logical statuses for quick-action buttons
export const STATUS_TRANSITIONS: Partial<Record<JobStatus, JobStatus[]>> = {
  scheduled:   ['en_route', 'cancelled'],
  en_route:    ['in_progress', 'cancelled'],
  in_progress: ['completed', 'no_show'],
  on_site:     ['completed', 'no_show'],
}

// ─── Service type options ──────────────────────────────────────────────────

export const MECHANIC_SERVICES = [
  'Oil Change',
  'Brake Service',
  'Tire Rotation',
  'Tire Replacement',
  'Battery Replacement',
  'Engine Diagnostic',
  'A/C Service',
  'Transmission Service',
  'Suspension Repair',
  'Electrical Repair',
  'Coolant Flush',
  'Power Steering Service',
  'Fuel System Service',
  'Pre-Purchase Inspection',
  'Other',
] as const

export const DETAILER_SERVICES = [
  'Basic Wash',
  'Full Detail',
  'Interior Detail',
  'Exterior Detail',
  'Paint Correction',
  'Ceramic Coating (1 Year)',
  'Ceramic Coating (3 Year)',
  'Ceramic Coating (5 Year)',
  'Headlight Restoration',
  'Engine Bay Cleaning',
  'Carpet & Upholstery Shampoo',
  'Leather Treatment',
  'Pet Hair & Odor Removal',
  'Boat Detailing',
  'RV Detailing',
  'Other',
] as const

export type DetailerService = typeof DETAILER_SERVICES[number]

export type DetailerServiceSlug =
  | 'basic_wash' | 'full_detail' | 'interior_detail' | 'exterior_detail'
  | 'paint_correction' | 'ceramic_coating_1yr' | 'ceramic_coating_3yr' | 'ceramic_coating_5yr'
  | 'headlight_restoration' | 'engine_bay' | 'carpet_upholstery' | 'leather_treatment'
  | 'pet_hair_odor' | 'boat_detailing' | 'rv_detailing' | 'other'

export const DETAILER_SERVICE_SLUGS: Record<DetailerService, DetailerServiceSlug> = {
  'Basic Wash':                   'basic_wash',
  'Full Detail':                  'full_detail',
  'Interior Detail':              'interior_detail',
  'Exterior Detail':              'exterior_detail',
  'Paint Correction':             'paint_correction',
  'Ceramic Coating (1 Year)':     'ceramic_coating_1yr',
  'Ceramic Coating (3 Year)':     'ceramic_coating_3yr',
  'Ceramic Coating (5 Year)':     'ceramic_coating_5yr',
  'Headlight Restoration':        'headlight_restoration',
  'Engine Bay Cleaning':          'engine_bay',
  'Carpet & Upholstery Shampoo':  'carpet_upholstery',
  'Leather Treatment':            'leather_treatment',
  'Pet Hair & Odor Removal':      'pet_hair_odor',
  'Boat Detailing':               'boat_detailing',
  'RV Detailing':                 'rv_detailing',
  'Other':                        'other',
}

export const DETAILER_SERVICE_SLUG_LABELS: Record<DetailerServiceSlug, string> = {
  basic_wash:            'Basic Wash',
  full_detail:           'Full Detail',
  interior_detail:       'Interior Detail',
  exterior_detail:       'Exterior Detail',
  paint_correction:      'Paint Correction',
  ceramic_coating_1yr:   'Ceramic Coating (1 Year)',
  ceramic_coating_3yr:   'Ceramic Coating (3 Year)',
  ceramic_coating_5yr:   'Ceramic Coating (5 Year)',
  headlight_restoration: 'Headlight Restoration',
  engine_bay:            'Engine Bay Cleaning',
  carpet_upholstery:     'Carpet & Upholstery Shampoo',
  leather_treatment:     'Leather Treatment',
  pet_hair_odor:         'Pet Hair & Odor Removal',
  boat_detailing:        'Boat Detailing',
  rv_detailing:          'RV Detailing',
  other:                 'Other',
}

export const VEHICLE_CATEGORIES = [
  'sedan', 'suv', 'truck', 'van', 'motorcycle', 'boat', 'rv', 'plane', 'other',
] as const

export type VehicleCategory = typeof VEHICLE_CATEGORIES[number]

export const VEHICLE_CATEGORY_LABELS: Record<VehicleCategory, string> = {
  sedan:      'Sedan / Car',
  suv:        'SUV / Crossover',
  truck:      'Truck / Pickup',
  van:        'Van / Minivan',
  motorcycle: 'Motorcycle',
  boat:       'Boat',
  rv:         'RV / Motorhome',
  plane:      'Aircraft / Plane',
  other:      'Other',
}

export function getServicesByBusinessType(type: string): readonly string[] {
  return type === 'detailer' ? DETAILER_SERVICES : MECHANIC_SERVICES
}

// Backwards-compatible alias used by BookJobTab, CustomersTab
export const SERVICE_TYPES = MECHANIC_SERVICES

// ─── Notification template types ───────────────────────────────────────────

export const TEMPLATE_TYPE_CONFIG: Record<
  NotificationTemplateType,
  { label: string; badge: string; trigger?: string }
> = {
  appointment_reminder:    { label: 'Day-Before Reminder',     badge: 'bg-blue/20 text-blue-light border border-blue/40',        trigger: 'day_before_reminder'  },
  appointment_confirmation:{ label: 'Booking Confirmation',    badge: 'bg-success/20 text-success border border-success/40',     trigger: 'booking_confirmation' },
  on_my_way:               { label: 'On My Way',               badge: 'bg-amber-500/20 text-amber-400 border border-amber-500/40', trigger: 'on_my_way'          },
  job_completed:           { label: 'Job Completed',           badge: 'bg-success/20 text-success border border-success/40',     trigger: 'job_completed'        },
  invoice_sent:            { label: 'Invoice Sent',            badge: 'bg-orange/20 text-orange border border-orange/40'         },
  invoice_overdue:         { label: 'Invoice Overdue',         badge: 'bg-danger/20 text-danger border border-danger/40'         },
  follow_up:               { label: 'Follow-Up',               badge: 'bg-amber-500/20 text-amber-400 border border-amber-500/40' },
  custom:                  { label: 'Custom',                  badge: 'bg-white/10 text-white/50 border border-white/10'          },
}

export const TEMPLATE_MERGE_TAGS = [
  '{{customer_name}}',
  '{{first_name}}',
  '{{job_date}}',
  '{{job_time}}',
  '{{service_type}}',
  '{{business_name}}',
  '{{tech_name}}',
  '{{vehicle}}',
  '{{location}}',
  '{{invoice_total}}',
  '{{invoice_number}}',
]

// ─── Date / time formatters ────────────────────────────────────────────────

export function formatTime(time: string | null | undefined): string {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

export function formatDate(dateStr: string): string {
  // Parse as local date to avoid UTC-shift
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(y, mo - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateShort(dateStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  return new Date(y, mo - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function todayStr(): string {
  return toDateStr(new Date())
}

// ─── Calendar grid builder ────────────────────────────────────────────────

export function buildCalendarGrid(year: number, month: number): (number | null)[] {
  const firstWeekday = new Date(year, month, 1).getDay()   // 0 = Sun
  const daysInMonth  = new Date(year, month + 1, 0).getDate()
  const grid: (number | null)[] = Array(firstWeekday).fill(null)
  for (let d = 1; d <= daysInMonth; d++) grid.push(d)
  // Pad to complete the last row
  while (grid.length % 7 !== 0) grid.push(null)
  return grid
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}
